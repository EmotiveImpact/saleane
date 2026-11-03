import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATHER_MS, MicrophoneError, connectTalk } from './talkLine'

// The browser's half of a talk, with the microphone and WebRTC pretended: jsdom has neither.
type Listener = (event: { data?: unknown }) => void
let peers: FakePeer[] = []
const track = { stop: vi.fn() }
const microphone = { getTracks: () => [track] }
// Whether a new connection finishes gathering by itself, as most do within moments.
let gathersAtOnce = true
const OFFER = 'v=0 offer'
const GATHERED = `${OFFER}\r\na=candidate:1 1 udp 1 192.0.2.1 3478 typ relay`

class FakePeer {
  listeners: Record<string, Listener[]> = {}
  channel = {
    readyState: 'open',
    send: vi.fn(),
    listeners: {} as Record<string, Listener[]>,
    addEventListener(type: string, listener: Listener) {
      ;(this.listeners[type] ??= []).push(listener)
    },
  }
  connectionState = 'new'
  iceGatheringState = 'new'
  localDescription: { type: string; sdp: string } | null = null
  ontrack: ((event: { streams: unknown[] }) => void) | null = null
  added: unknown[] = []
  remote: unknown
  closed = false
  constructor() {
    peers.push(this)
  }
  createDataChannel(label: string) {
    expect(label).toBe('oai-events')
    return this.channel
  }
  addTrack(t: unknown) {
    this.added.push(t)
  }
  addEventListener(type: string, listener: Listener) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener)
  }
  async createOffer() {
    return { type: 'offer', sdp: OFFER }
  }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description
    this.iceGatheringState = 'gathering'
    if (gathersAtOnce) setTimeout(() => this.gather())
  }
  /** The last way through is found: the offer now carries it. */
  gather() {
    this.localDescription = { type: 'offer', sdp: GATHERED }
    this.iceGatheringState = 'complete'
    for (const listener of this.listeners.icegatheringstatechange ?? []) listener({})
  }
  async setRemoteDescription(description: unknown) {
    this.remote = description
  }
  close() {
    this.closed = true
  }
}

beforeEach(() => {
  peers = []
  gathersAtOnce = true
  track.stop.mockReset()
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => microphone) },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the browser’s line to a talk', () => {
  it('offers the microphone, takes the voice’s answer, and hangs up cleanly', async () => {
    const start = vi.fn(async (sdp: string) => {
      expect(sdp).toBe(GATHERED)
      return { sdp: 'v=0 answer' }
    })
    const onEnded = vi.fn()
    const line = await connectTalk(start, onEnded)
    const [peer] = peers
    expect(peer.added).toEqual([track])
    expect(peer.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' })
    line!.stop()
    line!.stop()
    expect(peer.channel.send).toHaveBeenCalledTimes(1)
    expect(peer.channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'session.close' }))
    expect(peer.closed).toBe(true)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('hears once when the voice hangs up or the line fails', async () => {
    const onEnded = vi.fn()
    await connectTalk(async () => ({ sdp: 'v=0 answer' }), onEnded)
    const [peer] = peers
    for (const listener of peer.channel.listeners.message)
      listener({ data: JSON.stringify({ type: 'session.closed', reason: 'expired' }) })
    peer.connectionState = 'failed'
    for (const listener of peer.listeners.connectionstatechange) listener({})
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('lets the microphone go itself when the line fails', async () => {
    const onEnded = vi.fn()
    const line = await connectTalk(async () => ({ sdp: 'v=0 answer' }), onEnded)
    const [peer] = peers
    peer.connectionState = 'failed'
    for (const listener of peer.listeners.connectionstatechange) listener({})
    expect(peer.closed).toBe(true)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
    // Hanging up afterwards changes nothing more.
    line!.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('does not report back a hang-up the panel asked for', async () => {
    const onEnded = vi.fn()
    const line = await connectTalk(async () => ({ sdp: 'v=0 answer' }), onEnded)
    line!.stop()
    peers[0].connectionState = 'closed'
    for (const listener of peers[0].listeners.connectionstatechange) listener({})
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('lets everything go when SALEANE does not start the talk', async () => {
    expect(await connectTalk(async () => null, vi.fn())).toBeNull()
    expect(peers[0].closed).toBe(true)
    expect(track.stop).toHaveBeenCalled()
  })

  it('offers only once every way through is gathered, as OpenAI asks', async () => {
    gathersAtOnce = false
    const start = vi.fn(async () => ({ sdp: 'v=0 answer' }))
    const connecting = connectTalk(start, vi.fn())
    await vi.waitFor(() => expect(peers[0]?.iceGatheringState).toBe('gathering'))
    await new Promise((done) => setTimeout(done, 20))
    expect(start).not.toHaveBeenCalled()
    peers[0].gather()
    expect(await connecting).not.toBeNull()
    // The offer sent is the browser's whole description, with what it gathered, not the first draft.
    expect(start).toHaveBeenCalledWith(GATHERED)
  })

  it('gives up plainly when gathering takes too long, and lets everything go', async () => {
    gathersAtOnce = false
    vi.useFakeTimers()
    const start = vi.fn(async () => ({ sdp: 'v=0 answer' }))
    const connecting = connectTalk(start, vi.fn())
    const refused = expect(connecting).rejects.toThrow(
      'Talking could not connect from here. Check your connection and try again.',
    )
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    await refused
    expect(start).not.toHaveBeenCalled()
    expect(peers[0].closed).toBe(true)
    expect(track.stop).toHaveBeenCalled()
  })

  it('starts nothing once called off, whenever that happens', async () => {
    // Closed while the browser asked for the microphone: no connection is made at all.
    const before = new AbortController()
    let allow!: (mic: typeof microphone) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((done) => (allow = done)) as unknown as Promise<MediaStream>,
    )
    const start = vi.fn(async () => ({ sdp: 'v=0 answer' }))
    const asking = connectTalk(start, vi.fn(), before.signal)
    before.abort()
    allow(microphone)
    expect(await asking).toBeNull()
    expect(peers).toHaveLength(0)
    expect(track.stop).toHaveBeenCalledTimes(1)

    // Closed while gathering: nothing is offered.
    gathersAtOnce = false
    const gathering = new AbortController()
    const waiting = connectTalk(start, vi.fn(), gathering.signal)
    await vi.waitFor(() => expect(peers[0]?.iceGatheringState).toBe('gathering'))
    gathering.abort()
    expect(await waiting).toBeNull()
    expect(start).not.toHaveBeenCalled()
    expect(peers[0].closed).toBe(true)

    // Closed while SALEANE started the talk: the line is let go, and the caller ends the talk.
    gathersAtOnce = true
    const late = new AbortController()
    const answered = connectTalk(
      async () => {
        late.abort()
        return { sdp: 'v=0 answer' }
      },
      vi.fn(),
      late.signal,
    )
    expect(await answered).toBeNull()
    expect(peers[1].closed).toBe(true)
    expect(peers[1].remote).toBeUndefined()
    expect(track.stop).toHaveBeenCalledTimes(3)
  })

  it('says plainly when the microphone is refused', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError'),
    )
    await expect(connectTalk(async () => ({ sdp: '' }), vi.fn())).rejects.toBeInstanceOf(
      MicrophoneError,
    )
    expect(peers).toHaveLength(0)
  })
})

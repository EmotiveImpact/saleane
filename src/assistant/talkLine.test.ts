import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MicrophoneError, connectTalk } from './talkLine'

// The browser's half of a talk, with the microphone and WebRTC pretended: jsdom has neither.
type Listener = (event: { data?: unknown }) => void
let peers: FakePeer[] = []
const track = { stop: vi.fn() }
const microphone = { getTracks: () => [track] }

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
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async setLocalDescription() {}
  async setRemoteDescription(description: unknown) {
    this.remote = description
  }
  close() {
    this.closed = true
  }
}

beforeEach(() => {
  peers = []
  track.stop.mockReset()
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => microphone) },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('the browser’s line to a talk', () => {
  it('offers the microphone, takes the voice’s answer, and hangs up cleanly', async () => {
    const start = vi.fn(async (sdp: string) => {
      expect(sdp).toBe('v=0 offer')
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

  it('lets everything go when SALEANE does not start the talk', async () => {
    expect(await connectTalk(async () => null, vi.fn())).toBeNull()
    expect(peers[0].closed).toBe(true)
    expect(track.stop).toHaveBeenCalled()
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

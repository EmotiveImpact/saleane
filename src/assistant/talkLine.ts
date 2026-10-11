/**
 * The browser's half of talking to Ask SALEANE (NEXT-12 part 2): the microphone, the voice's
 * audio, and the WebRTC connection to OpenAI. SALEANE's server starts the session with its own
 * key, which never reaches the browser, and follows it; the browser can only hang up.
 */
export type TalkConnection = {
  /** Hangs up, stops the microphone and the voice. Safe to call more than once. */
  stop(): void
}

/** The microphone was refused or is missing, so talking cannot start. */
export class MicrophoneError extends Error {
  constructor() {
    super('SALEANE needs your microphone to talk. Allow it in your browser, or type instead.')
    this.name = 'MicrophoneError'
  }
}

/** The most a browser waits to gather its ways to connect, as OpenAI's own example does. */
export const GATHER_MS = 10_000

/**
 * Waits until the browser has gathered every way it can be reached (its candidates), so the offer
 * OpenAI receives is complete: on some networks the only way through is one gathered late.
 */
function gathered(peer: RTCPeerConnection, signal?: AbortSignal) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      peer.removeEventListener('icegatheringstatechange', check)
      signal?.removeEventListener('abort', check)
    }
    const check = () => {
      if (peer.iceGatheringState !== 'complete' && !signal?.aborted) return
      done()
      resolve()
    }
    const timer = setTimeout(() => {
      done()
      reject(new Error('Talking could not connect from here. Check your connection and try again.'))
    }, GATHER_MS)
    peer.addEventListener('icegatheringstatechange', check)
    signal?.addEventListener('abort', check)
  })
}

/**
 * Connects the browser to a talk. `start` sends the browser's offer to SALEANE and returns the
 * voice's answer, or null when SALEANE did not start the talk. Resolves to null in that case, with
 * everything already let go. `onEnded` is called once if the voice hangs up or the line drops.
 * Once `signal` aborts (the panel closed while the talk was starting), nothing more is started and
 * anything already open is let go; it resolves to null, and ending a talk SALEANE had already
 * started is left to the caller, which knows it.
 */
export async function connectTalk(
  start: (sdp: string) => Promise<{ sdp: string } | null>,
  onEnded: () => void,
  signal?: AbortSignal,
): Promise<TalkConnection | null> {
  let mic: MediaStream
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new MicrophoneError()
  }
  if (signal?.aborted) {
    for (const track of mic.getTracks()) track.stop()
    return null
  }
  const peer = new RTCPeerConnection()
  const audio = document.createElement('audio')
  audio.autoplay = true
  let stopped = false
  let ended = false
  const channel = peer.createDataChannel('oai-events')
  // The voice hung up or the line failed: the microphone stops here, whatever the panel does next.
  const end = () => {
    if (ended) return
    ended = true
    stop()
    onEnded()
  }
  function stop() {
    if (stopped) return
    stopped = true
    // Hung up from here: the panel already knows.
    ended = true
    try {
      if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'session.close' }))
    } catch {
      // Hanging up below ends the talk all the same.
    }
    peer.close()
    for (const track of mic.getTracks()) track.stop()
    audio.srcObject = null
  }
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null
  }
  for (const track of mic.getTracks()) peer.addTrack(track, mic)
  channel.addEventListener('message', (event) => {
    try {
      if ((JSON.parse(String(event.data)) as { type?: string }).type === 'session.closed') end()
    } catch {
      // Only the end of the talk is sent here; anything else is ignored.
    }
  })
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed') end()
  })
  try {
    await peer.setLocalDescription(await peer.createOffer())
    await gathered(peer, signal)
    const sdp = peer.localDescription?.sdp
    if (signal?.aborted || !sdp) {
      stop()
      if (signal?.aborted) return null
      throw new Error('Talking could not start. Try again.')
    }
    const answer = await start(sdp)
    if (!answer || signal?.aborted) {
      stop()
      return null
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
  } catch (error) {
    stop()
    throw error
  }
  return { stop }
}

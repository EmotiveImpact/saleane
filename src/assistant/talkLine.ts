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

/**
 * Connects the browser to a talk. `start` sends the browser's offer to SALEANE and returns the
 * voice's answer, or null when SALEANE did not start the talk. Resolves to null in that case, with
 * everything already let go. `onEnded` is called once if the voice hangs up or the line drops.
 */
export async function connectTalk(
  start: (sdp: string) => Promise<{ sdp: string } | null>,
  onEnded: () => void,
): Promise<TalkConnection | null> {
  let mic: MediaStream
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new MicrophoneError()
  }
  const peer = new RTCPeerConnection()
  const audio = document.createElement('audio')
  audio.autoplay = true
  let stopped = false
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onEnded()
  }
  const channel = peer.createDataChannel('oai-events')
  const stop = () => {
    if (stopped) return
    stopped = true
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
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const answer = await start(offer.sdp ?? '')
    if (!answer) {
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

import { useEffect, useRef, useState } from 'react'
import { Mic, NotebookPen, Square } from 'lucide-react'
import { api } from '../state/api'
import type { Command } from '../domain/commands'
import { VISIT_AFTERCARE_LIMIT } from '../domain/model'
import { VOICE_NOTE_SECONDS, WRITE_UP_WORDS_LIMIT } from '../assistant/writeUp'
import { Button, ErrorMessage } from '../design'
import './visitWriteUp.css'

type WriteUpStatus = {
  mode: 'test' | 'live'
  listens: boolean
  /** Whether aftercare saved now still goes in this visit's aftercare email. */
  aftercareEmail?: boolean
}
type WriteUpReply =
  | { heard: string; note: string; aftercare: string; status?: undefined }
  | { status: 'refused' | 'unheard' | 'unavailable'; text: string; heard?: string }

/** Speech is recorded small: a two-minute note stays well under the server's one megabyte. */
const BITS_PER_SECOND = 24_000
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

/** When the visit's aftercare email has gone, or will not be sent, the aftercare stays on the visit. */
const KEPT =
  'Kept on the visit only: their aftercare email has gone or will not be sent. Message them if they need it.'

const RECORDER_FAILED =
  'This browser could not start recording, and the microphone was let go. Type it instead.'

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/**
 * NEXT-16: after a visit, the professional speaks (or types) what they did and any aftercare. It
 * is written up as a note for the studio and aftercare for the guest, which they check and change
 * before saving. Nothing is saved until they press Save, and a recording is never kept.
 */
export function VisitWriteUp({
  path,
  appointmentId,
  guest,
  aftercare,
  saving,
  onSave,
}: {
  /** The workspace's API path. */
  path: string
  appointmentId: string
  /** The guest's first name. */
  guest: string
  /** Aftercare already saved for this visit. */
  aftercare?: string
  saving: boolean
  onSave: (command: Command, done: string) => Promise<boolean>
}) {
  const [status, setStatus] = useState<WriteUpStatus | null>(null)
  const [words, setWords] = useState('')
  const [draft, setDraft] = useState<{ note: string; aftercare: string; heard: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [seconds, setSeconds] = useState<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const microphone = useRef<MediaStream | null>(null)
  // False once the screen has gone, so a microphone granted after leaving is let go at once.
  const shown = useRef(true)
  // True while the browser is asking for the microphone, so a second tap cannot open another.
  const asking = useRef(false)
  const [waiting, setWaiting] = useState(false)
  // The status could not be read: nothing is written up until it is, so no promise is made wrongly.
  const [lost, setLost] = useState(false)
  const [tries, setTries] = useState(0)
  const statusPath = `${path}/write-up?visit=${encodeURIComponent(appointmentId)}`
  const canRecord =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia

  useEffect(() => {
    let active = true
    api<WriteUpStatus>(statusPath)
      .then((next) => active && setStatus(next))
      .catch(() => active && setLost(true))
    return () => {
      active = false
    }
  }, [statusPath, tries])
  /** Asks again whether aftercare still goes in the visit's email, which can go at any time. */
  async function emailAhead() {
    try {
      const next = await api<WriteUpStatus>(statusPath)
      if (shown.current) setStatus(next)
      return next.aftercareEmail === true
    } catch {
      return false
    }
  }
  // A recording never outlives the screen it was started on, and the microphone is let go with it.
  // Each visit has its own copy of this screen (keyed by the visit), so a new visit starts afresh.
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
      const live = recorder.current
      recorder.current = null
      if (live && live.state !== 'inactive') {
        live.ondataavailable = null
        live.onstop = null
        live.stop()
      }
      microphone.current?.getTracks().forEach((track) => track.stop())
      microphone.current = null
    }
  }, [])
  useEffect(() => {
    if (seconds === null) return
    if (seconds >= VOICE_NOTE_SECONDS) {
      recorder.current?.stop()
      return
    }
    const timer = setTimeout(() => setSeconds((s) => (s === null ? s : s + 1)), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  function take(result: WriteUpReply) {
    if (result.status) {
      setProblem(result.text)
      if (result.heard) setWords(result.heard)
      return
    }
    if (!result.note && !result.aftercare) {
      setProblem('Nothing in it could be written up. Add a little more and try again.')
      return
    }
    setDraft({ note: result.note, aftercare: result.aftercare, heard: result.heard })
  }

  async function writeUp(request: () => Promise<WriteUpReply>) {
    setBusy(true)
    setProblem('')
    try {
      take(await request())
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'It could not be written up just now.')
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    if (asking.current || recorder.current) return
    setProblem('')
    asking.current = true
    setWaiting(true)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      if (shown.current)
        setProblem(
          'SALEANE could not use the microphone. Allow it in your browser, or type instead.',
        )
      return
    } finally {
      asking.current = false
      if (shown.current) setWaiting(false)
    }
    // They left while the browser was still asking for the microphone.
    if (!shown.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    const mimeType = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t))
    let next: MediaRecorder
    try {
      next = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: BITS_PER_SECOND,
      })
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setProblem(RECORDER_FAILED)
      return
    }
    const chunks: Blob[] = []
    next.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    next.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      if (microphone.current === stream) microphone.current = null
      setSeconds(null)
      if (recorder.current !== next) return
      recorder.current = null
      const recording = new Blob(chunks, { type: next.mimeType || mimeType || 'audio/webm' })
      if (recording.size < 1000) {
        setProblem('That was too short to hear. Try again, or type it.')
        return
      }
      void writeUp(() =>
        api<WriteUpReply>(`${path}/visits/${encodeURIComponent(appointmentId)}/voice-note`, {
          method: 'POST',
          body: recording,
          timeoutMs: 60_000,
        }),
      )
    }
    recorder.current = next
    microphone.current = stream
    try {
      next.start()
    } catch {
      next.onstop = null
      recorder.current = null
      microphone.current = null
      stream.getTracks().forEach((track) => track.stop())
      setProblem(RECORDER_FAILED)
      return
    }
    setSeconds(0)
  }

  async function save() {
    if (!draft) return
    const note = draft.note.trim()
    const care = draft.aftercare.trim()
    const command: Command = {
      type: 'visit-write-up',
      appointmentId,
      ...(note.length >= 2 ? { note } : {}),
      ...(care.length >= 2 ? { aftercare: care } : {}),
    }
    const ahead = care.length >= 2 && (await emailAhead())
    if (
      await onSave(
        command,
        care.length >= 2
          ? ahead
            ? `Saved. The aftercare is added to ${guest}’s aftercare email.`
            : 'Saved. The aftercare is kept on the visit, and no email will carry it.'
          : 'Saved to their history.',
      )
    ) {
      setDraft(null)
      setWords('')
      void emailAhead()
    }
  }
  async function remove() {
    const ahead = await emailAhead()
    if (
      await onSave(
        { type: 'visit-write-up', appointmentId, aftercare: null },
        ahead
          ? 'The aftercare is removed from their aftercare email.'
          : 'The aftercare is removed from the visit.',
      )
    )
      void emailAhead()
  }

  const listening = seconds !== null
  const listens = !!status?.listens && canRecord
  const live = status?.mode === 'live'
  const emailed = status?.aftercareEmail === true
  const noteReady = (draft?.note.trim().length ?? 0) >= 2
  const careReady = (draft?.aftercare.trim().length ?? 0) >= 2

  return (
    <div className="visit-write-up">
      <h3 id="write-up-heading">After the visit</h3>
      <p className="subtle">
        {listens ? 'Speak or type' : 'Type'} what was done and any aftercare. SALEANE sorts it into
        a note for the studio and aftercare for {guest}, and nothing is saved until you have checked
        it.
      </p>
      {status && (
        <p className="visit-write-up-privacy">
          {!live
            ? 'In test mode it is sorted here by its words, and nothing leaves SALEANE.'
            : listens
              ? 'Your voice goes to OpenAI to be written down and your words to Claude to be written up. The recording is not kept. Each one counts as one Ask SALEANE question.'
              : 'Your words go to Claude to be written up. Each one counts as one Ask SALEANE question.'}
        </p>
      )}
      {lost && (
        <div className="visit-write-up-voice">
          <p className="visit-write-up-privacy">
            SALEANE could not check how write-ups are handled just now, so nothing can be written up
            yet.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setLost(false)
              setTries((n) => n + 1)
            }}
          >
            Check again
          </Button>
        </div>
      )}
      {aftercare && !draft && (
        <div className="visit-write-up-saved">
          <p className="visit-write-up-label">Aftercare for {guest}</p>
          <p>{aftercare}</p>
          <small>
            {emailed
              ? 'Added to their aftercare email, after the treatment’s own aftercare.'
              : KEPT}
          </small>
          <Button variant="secondary" disabled={saving} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      )}
      {!draft && (
        <>
          {listens && (
            <div className="visit-write-up-voice">
              {listening ? (
                <>
                  <Button onClick={() => recorder.current?.stop()}>
                    <Square size={16} aria-hidden="true" />
                    Stop and write it up
                  </Button>
                  <span role="status" className="visit-write-up-clock">
                    Listening · {clock(seconds ?? 0)} of {clock(VOICE_NOTE_SECONDS)}
                  </span>
                </>
              ) : (
                <Button disabled={busy || waiting} onClick={() => void startRecording()}>
                  <Mic size={16} aria-hidden="true" />
                  Speak a note
                </Button>
              )}
            </div>
          )}
          <form
            className="practitioner-note"
            onSubmit={(event) => {
              event.preventDefault()
              const text = words.trim()
              if (text.length < 2 || !status) return
              void writeUp(() =>
                api<WriteUpReply>(`${path}/visits/${encodeURIComponent(appointmentId)}/write-up`, {
                  method: 'POST',
                  body: { words: text },
                  timeoutMs: 60_000,
                }),
              )
            }}
          >
            <label htmlFor="write-up-words">
              {listens ? 'Or type what you would say' : 'What you would say'}
            </label>
            <textarea
              id="write-up-words"
              value={words}
              rows={3}
              maxLength={WRITE_UP_WORDS_LIMIT}
              disabled={listening}
              placeholder="Balayage with a toner. They loved the warmth. Avoid hot water for two days."
              onChange={(e) => setWords(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!status || busy || listening || words.trim().length < 2}
            >
              <NotebookPen size={16} aria-hidden="true" />
              Write it up
            </Button>
          </form>
        </>
      )}
      {busy && (
        <p role="status" className="subtle">
          Writing it up…
        </p>
      )}
      {problem && <ErrorMessage error={problem} />}
      {draft && (
        <form
          className="visit-write-up-draft"
          aria-label="Check the write-up"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {draft.heard && (
            <p className="visit-write-up-heard">
              <span className="visit-write-up-label">Heard</span>
              {draft.heard}
            </p>
          )}
          <label htmlFor="write-up-note">For the studio</label>
          <textarea
            id="write-up-note"
            value={draft.note}
            rows={3}
            maxLength={1000}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <label htmlFor="write-up-aftercare">Aftercare for {guest}</label>
          <textarea
            id="write-up-aftercare"
            value={draft.aftercare}
            rows={3}
            maxLength={VISIT_AFTERCARE_LIMIT}
            aria-describedby="write-up-aftercare-hint"
            onChange={(e) => setDraft({ ...draft, aftercare: e.target.value })}
          />
          <small id="write-up-aftercare-hint" className="subtle">
            {emailed
              ? 'Added to their aftercare email, after the treatment’s own aftercare.'
              : KEPT}
            {aftercare ? ' It replaces the aftercare saved earlier.' : ''}
          </small>
          <span className="practitioner-actions">
            <Button type="submit" disabled={saving || (!noteReady && !careReady)}>
              Save
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setDraft(null)}>
              Start again
            </Button>
          </span>
        </form>
      )}
    </div>
  )
}

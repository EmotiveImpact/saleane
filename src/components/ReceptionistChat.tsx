import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'
import './receptionistChat.css'

type Proposal = { id: string; summary: string; kind: 'time' | 'message'; expiresAt: string }
/** A free time the answer lists, shown as a button that starts booking it. */
type ListedTime = OfferedTime & { label: string; location?: string }
type Turn = {
  from: 'guest' | 'receptionist'
  text: string
  proposals?: Proposal[]
  times?: ListedTime[]
}
/** A time the receptionist offered. With several locations it names where it is (V2). */
export type OfferedTime = {
  serviceId: string
  staffId: string
  date: string
  startMinutes: number
  locationId?: string
}

const HISTORY = 8
// No treatment is named here, since not every studio offers the same ones.
const starters = ['When are you open?', 'What treatments do you offer?', 'Any times tomorrow?']

/**
 * V4: the AI receptionist on the booking page. It says it is an AI, answers from the studio's own
 * menu and diary, and offers a time for the guest to finish booking on this page: each free time
 * it lists is a button that opens the booking steps with that time chosen. A message for the team
 * goes to the studio only when the guest taps to send it.
 */
export function ReceptionistChat({
  base,
  studio,
  onTime,
}: {
  base: string
  studio: string
  onTime: (time: OfferedTime) => void
}) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [taken, setTaken] = useState<string[]>([])
  // The server's name for this chat, so the whole conversation counts once.
  const [chat, setChat] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  // The newest message stays in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [turns, pending])

  async function ask(question: string) {
    const said = question.trim()
    if (!said || pending) return
    setPending(true)
    setError('')
    const history = turns.slice(-HISTORY).map(({ from, text }) => ({ from, text }))
    setTurns((now) => [...now, { from: 'guest', text: said }])
    setText('')
    try {
      const answer = await api<{
        text: string
        proposals: Proposal[]
        chat: string | null
        times?: ListedTime[]
      }>(`${base}/receptionist`, {
        method: 'POST',
        body: chat && history.length ? { text: said, chat, history } : { text: said },
      })
      setChat(answer.chat)
      setTurns((now) => [
        ...now,
        {
          from: 'receptionist',
          text: answer.text,
          proposals: answer.proposals,
          times: answer.times ?? [],
        },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The receptionist could not answer. Try again.')
    } finally {
      setPending(false)
    }
  }
  async function take(proposal: Proposal) {
    setPending(true)
    setError('')
    try {
      const result = await api<OfferedTime | { kind: 'message'; sent: true }>(
        `${base}/receptionist/proposals/${encodeURIComponent(proposal.id)}`,
        { method: 'POST', body: { approve: true } },
      )
      setTaken((now) => [...now, proposal.id])
      if ('serviceId' in result) {
        setOpen(false)
        onTime(result)
      } else {
        setTurns((now) => [
          ...now,
          {
            from: 'receptionist',
            text: 'Your message is with the team. Someone from the studio will answer you there.',
          },
        ])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be done. Ask again.')
    } finally {
      setPending(false)
    }
  }
  /** A listed time starts the booking steps with it chosen; nothing is held until the guest does. */
  function choose({ serviceId, staffId, date, startMinutes, locationId }: ListedTime) {
    setOpen(false)
    onTime({ serviceId, staffId, date, startMinutes, ...(locationId ? { locationId } : {}) })
  }
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void ask(text)
  }

  if (!open)
    return (
      <div className="reception-launch">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <MessageCircle size={17} aria-hidden="true" />
          Ask a question
        </Button>
      </div>
    )
  return (
    <section className="reception-chat" aria-labelledby="reception-title">
      <header>
        <div>
          <h2 id="reception-title">Ask {studio}</h2>
          <p className="reception-note">
            You are chatting with an AI receptionist, not a person. It answers from the
            studio&rsquo;s menu, hours and free times. It cannot book for you or take a payment, and
            it never asks about your health.
          </p>
        </div>
        <button className="reception-close" onClick={() => setOpen(false)}>
          <X size={18} aria-hidden="true" />
          <span className="sr-only">Close the chat</span>
        </button>
      </header>
      <div ref={log} className="reception-log" role="log" aria-live="polite">
        {turns.length === 0 && (
          <div className="reception-starters">
            {starters.map((s) => (
              <button key={s} className="ask-starter" disabled={pending} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`reception-bubble reception-${turn.from}`}>
            <span className="sr-only">{turn.from === 'guest' ? 'You: ' : 'AI receptionist: '}</span>
            {turn.text.split('\n').map((line, j) => (
              <p key={j}>{line}</p>
            ))}
            {!!turn.times?.length && (
              <div className="reception-times" role="group" aria-label="Free times">
                {turn.times.map((time) => (
                  <button
                    key={`${time.date}-${time.startMinutes}-${time.locationId ?? ''}`}
                    type="button"
                    className="reception-time"
                    disabled={pending}
                    aria-label={`Choose ${time.label}${time.location ? ` at ${time.location}` : ''}`}
                    onClick={() => choose(time)}
                  >
                    {time.label}
                    {time.location && <small>{time.location}</small>}
                  </button>
                ))}
              </div>
            )}
            {turn.proposals?.map((proposal) => (
              <div key={proposal.id} className="reception-offer">
                <p>{proposal.summary}</p>
                <Button
                  disabled={pending || taken.includes(proposal.id)}
                  onClick={() => void take(proposal)}
                >
                  {taken.includes(proposal.id)
                    ? 'Done'
                    : proposal.kind === 'time'
                      ? 'Choose this time'
                      : 'Send to the team'}
                </Button>
              </div>
            ))}
          </div>
        ))}
        {pending && <p className="reception-thinking">Looking that up…</p>}
      </div>
      <ErrorMessage error={error} />
      <form className="reception-form" onSubmit={send}>
        <label htmlFor="reception-input" className="sr-only">
          Your question
        </label>
        <input
          id="reception-input"
          ref={input}
          maxLength={500}
          value={text}
          placeholder="Ask about treatments, prices or times"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={pending || !text.trim()}>
          Send
        </Button>
      </form>
    </section>
  )
}

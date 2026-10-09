import { useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { textNumber } from '../domain/reminders'
import { numberLabel } from '../domain/phone'
import type { ReplyKeyword } from '../domain/inboxSchema'
import { Button, ErrorMessage, Modal } from '../design'
import './inboxReply.css'
import './textStop.css'

type Delivered = {
  kept: boolean
  answered: boolean
  ref: string
  replyId: string | null
  clientId: string | null
  keyword: ReplyKeyword | null
}
const EXAMPLES = ['STOP', 'START', 'HELP', 'Can I come at 3 on Friday?']

/** What became of a test text, in plain words. Every answer ends by saying nothing was sent. */
function outcome(result: Delivered) {
  const said = !result.kept
    ? 'Already kept: delivering the same text again changes nothing, as when a provider retries.'
    : result.keyword === 'stop'
      ? 'Kept in the Inbox as “Turned texts off”. SALEANE will not text this number until it texts START, and nothing was queued to answer it.'
      : result.keyword === 'start'
        ? 'Kept in the Inbox as “Turned texts back on”. Texts turned off by a STOP reply are on again.'
        : result.keyword === 'asked'
          ? 'Kept in the Inbox as “Asked for texts again”. Texts turned off at the desk stay off; the client’s page shows they asked.'
          : result.keyword === 'already'
            ? 'Kept in the Inbox as “Asked for texts”. Texts were not off, so nothing changed.'
            : result.keyword === 'help'
              ? 'Kept in the Inbox as “Asked for help”. Their phone network answers HELP; SALEANE does not.'
              : result.answered
                ? 'Kept in the Inbox, and the AI receptionist wrote an answer.'
                : 'Kept in the Inbox for the team to answer.'
  return `${said} Test mode: no phone network was involved and nothing was sent.`
}

/**
 * Stage 1: in test mode the owner or a manager can deliver a text to the studio's line as if a
 * guest sent it, to see what SALEANE does with STOP, START, HELP or an ordinary message. The
 * server takes it through the same path as a text from the provider and records it as a test.
 */
export function TestText({ onClose }: { onClose: () => void }) {
  const { state, reload, blocked } = useStore()
  const withNumbers = state.clients.filter((c) => textNumber(c.phone))
  const [who, setWho] = useState(withNumbers[0]?.id ?? 'other')
  const [other, setOther] = useState('')
  const [words, setWords] = useState('STOP')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [last, setLast] = useState<{ from: string; body: string; ref: string } | null>(null)
  const [notice, setNotice] = useState('')
  const from = who === 'other' ? other : (withNumbers.find((c) => c.id === who)?.phone ?? other)

  async function deliver(text: { from: string; body: string; ref?: string }) {
    if (pending || blocked) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await api<Delivered>(
        `/api/workspaces/${encodeURIComponent(state.organisation.id)}/test-text`,
        { method: 'POST', body: text },
      )
      setLast({ from: text.from, body: text.body, ref: result.ref })
      setNotice(outcome(result))
      await reload().catch(() => null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test text could not be delivered.')
    } finally {
      setPending(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void deliver({ from, body: words })
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Deliver a test text"
      description="Test mode. This delivers a text to your studio’s line as if a guest sent it, so you can see what SALEANE does with it. No phone network is involved and nothing is sent."
    >
      <form onSubmit={submit} aria-busy={pending}>
        <div className="ops-fields">
          <label className="ops-wide">
            From
            <select value={who} onChange={(event) => setWho(event.target.value)}>
              {withNumbers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {numberLabel(textNumber(c.phone)!)}
                </option>
              ))}
              <option value="other">A number not on file</option>
            </select>
          </label>
          {who === 'other' && (
            <label className="ops-wide">
              Their number
              <input
                required
                inputMode="tel"
                autoComplete="off"
                maxLength={40}
                placeholder="+44 7700 900999"
                value={other}
                onChange={(event) => setOther(event.target.value)}
              />
            </label>
          )}
          <label className="ops-wide">
            What they texted
            <textarea
              required
              rows={3}
              maxLength={1600}
              value={words}
              onChange={(event) => setWords(event.target.value)}
            />
          </label>
        </div>
        <div className="test-text-words" role="group" aria-label="Examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="inbox-quick-chip"
              onClick={() => setWords(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <p className="ops-help">
          STOP, START and HELP count only as the whole text. “Please don’t cancel my visit” is an
          ordinary message.
        </p>
        <ErrorMessage error={error} />
        {notice && (
          <p className="text-stop-note" role="status">
            {notice}
          </p>
        )}
        <div className="ops-actions">
          <Button type="submit" disabled={pending || blocked || !words.trim() || !from.trim()}>
            {pending ? 'Delivering…' : 'Deliver test text'}
          </Button>
          {last && (
            <Button
              variant="secondary"
              disabled={pending || blocked}
              onClick={() => void deliver(last)}
            >
              Deliver the same text again
            </Button>
          )}
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  )
}

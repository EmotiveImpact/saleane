import { useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import { defaultReceptionist } from '../domain/receptionistSchema'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'
import { useAiLive } from './useAiLive'
import './management.css'

/** V4: the owner or manager turns the AI receptionist on the booking page on or off. */
export function ReceptionistSettings() {
  const { state, role, blocked } = useStore()
  const current = operations(state).receptionist ?? defaultReceptionist
  const [enabled, setEnabled] = useState(current.enabled)
  const [handOver, setHandOver] = useState(current.handOver)
  const [texts, setTexts] = useState(current.texts ?? false)
  const [social, setSocial] = useState(current.social ?? false)
  const [saved, setSaved] = useState(false)
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'receptionist')
  const live = useAiLive()
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    setSaved(await run({ type: 'receptionist', settings: { enabled, handOver, texts, social } }))
  }
  return (
    <section className="surface ops-panel" aria-labelledby="receptionist-settings">
      <header>
        <div>
          <h2 id="receptionist-settings">AI receptionist</h2>
          <p>
            A chat on your booking page that answers questions about your treatments, prices, hours
            and free times. It always says it is an AI. It offers times for guests to book
            themselves and never books, cancels or takes a payment on its own.{' '}
            {live
              ? 'It uses Claude, an AI from Anthropic: what guests write is sent there to be answered, and each chat counts towards your monthly guest chats.'
              : 'It works in test mode: no AI supplier is used and it costs nothing.'}
          </p>
        </div>
        <MessageCircle size={21} aria-hidden="true" />
      </header>
      <form onSubmit={save}>
        <div className="ops-fields">
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!allowed}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Show the AI receptionist on the booking page
          </label>
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={handOver}
              disabled={!allowed}
              onChange={(e) => setHandOver(e.target.checked)}
            />
            Let guests leave a message for the team when it cannot help. Messages arrive in your
            Inbox.
          </label>
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={texts}
              disabled={!allowed}
              onChange={(e) => setTexts(e.target.checked)}
            />
            Also answer texts to your text line. Its answers go out like your other texts, show in
            the Inbox, and say they come from an AI. Anything it cannot answer waits there for the
            team.
          </label>
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={social}
              disabled={!allowed}
              onChange={(e) => setSocial(e.target.checked)}
            />
            Also answer messages to your Instagram, Facebook and WhatsApp. It answers in the same
            app, says it is an AI, and steps back for an hour once someone from the team answers.
          </label>
        </div>
        <ErrorMessage error={error} />
        {allowed && (
          <div className="ops-actions">
            <span role="status" className="ops-help">
              {saved ? 'Saved.' : ''}
            </span>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save receptionist settings'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

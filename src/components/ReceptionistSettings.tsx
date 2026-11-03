import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import { defaultReceptionist } from '../domain/receptionistSchema'
import { Button, ErrorMessage, Checkbox } from '../design'
import { useRun } from './usePayment'
import { useAiLive } from './useAiLive'
import { api } from '../state/api'

/** NEXT-17: the phone line as the server sees it, for the studio's settings. */
type PhoneStatus = {
  connected: boolean
  included: boolean
  chosen: boolean
  answering: boolean
  minutes: { used: number; of: number }
}

function usePhoneStatus(saved: boolean) {
  const { mode, slug, session } = useStore()
  const orgId = session?.workspaces.find((w) => w.slug === slug)?.id
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  useEffect(() => {
    if (mode !== 'server' || !orgId) return
    let active = true
    api<PhoneStatus>(`/api/workspaces/${encodeURIComponent(orgId)}/phone`)
      .then((found) => {
        if (active) setStatus(found)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [mode, orgId, saved])
  return status
}

/** What the phone choice does today, in one sentence. */
function phoneWords(status: PhoneStatus | null, on: boolean) {
  if (!status || !status.connected)
    return 'Phone calls are not connected yet, so calls the desk misses are written down for a call back, as now.'
  if (!status.included)
    return status.chosen
      ? 'The phone receptionist starts with your first paid month. Until then, calls the desk misses are written down for a call back.'
      : 'Add the phone receptionist in Plan and billing first. Until then, calls the desk misses are written down for a call back.'
  if (!on) return `Off. ${status.minutes.of} minutes of calls a month are included.`
  return status.answering
    ? `On: ${status.minutes.used} of ${status.minutes.of} minutes used this month. Once they are used, missed calls are written down for a call back.`
    : `Not answering now: ${status.minutes.used} of ${status.minutes.of} minutes used this month, so missed calls are written down for a call back.`
}
import './management.css'

/** V4: the owner or manager turns the AI receptionist on the booking page on or off. */
export function ReceptionistSettings() {
  const { state, role, blocked } = useStore()
  const current = operations(state).receptionist ?? defaultReceptionist
  const [enabled, setEnabled] = useState(current.enabled)
  const [handOver, setHandOver] = useState(current.handOver)
  const [texts, setTexts] = useState(current.texts ?? false)
  const [social, setSocial] = useState(current.social ?? false)
  const [calls, setCalls] = useState(current.calls ?? false)
  const [saved, setSaved] = useState(false)
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'receptionist')
  const live = useAiLive()
  const phone = usePhoneStatus(saved)
  // Nothing can be turned on that cannot work yet; turning it off always can.
  const phoneReady = !!phone?.connected && (phone.included || phone.chosen)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    setSaved(
      await run({ type: 'receptionist', settings: { enabled, handOver, texts, social, calls } }),
    )
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
            <Checkbox
              checked={enabled}
              disabled={!allowed}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Show the AI receptionist on the booking page
          </label>
          <label className="ops-check ops-wide">
            <Checkbox
              checked={handOver}
              disabled={!allowed}
              onChange={(e) => setHandOver(e.target.checked)}
            />
            Let guests leave a message for the team when it cannot help. Messages arrive in your
            Inbox.
          </label>
          <label className="ops-check ops-wide">
            <Checkbox
              checked={texts}
              disabled={!allowed}
              onChange={(e) => setTexts(e.target.checked)}
            />
            Also answer texts to your text line. Its answers go out like your other texts, show in
            the Inbox, and say they come from an AI. Anything it cannot answer waits there for the
            team.
          </label>
          <label className="ops-check ops-wide">
            <Checkbox
              checked={social}
              disabled={!allowed}
              onChange={(e) => setSocial(e.target.checked)}
            />
            Also answer messages to your Instagram, Facebook and WhatsApp. It answers in the same
            app, says it is an AI, and steps back for an hour once someone from the team answers.
          </label>
          <label className="ops-check ops-wide">
            <Checkbox
              checked={calls}
              disabled={!allowed || (!calls && !phoneReady)}
              aria-describedby="receptionist-calls-note"
              onChange={(e) => setCalls(e.target.checked)}
            />
            Also answer calls the desk misses. It speaks in your studio’s voice, says it is an AI,
            answers from your records, texts callers a link to book and takes messages. The call
            shows on Today for the team to follow up.
          </label>
          <p className="ops-help ops-wide" id="receptionist-calls-note">
            {phoneWords(phone, calls)}
          </p>
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

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage, Checkbox } from '../design'
import { useRun } from './usePayment'
import { assistantChannels } from '../domain/model'
import { operations } from '../domain/operations'
import './management.css'
import '../guest-extras.css'

type Status = { mode: 'off' | 'test'; reachable: boolean; address: string; sample: boolean }

/**
 * Stage 5: booking through ChatGPT or Claude. The owner chooses whether an AI assistant a guest is
 * talking to can book a visit for them, and sees the studio's address for it. Test mode only
 * answers on the computer SALEANE runs on: ChatGPT and Claude reach it once SALEANE is online.
 */
export function AiBooking() {
  const { mode, session, state, role, blocked } = useStore()
  const allowed = mode === 'server' && !!session && role === 'owner'
  const url = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/ai-booking`
  const chosen = !!state.operations?.aiBooking?.enabled
  const [enabled, setEnabled] = useState(chosen)
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const { run, pending, error } = useRun()

  useEffect(() => {
    if (!allowed) return
    let current = true
    api<Status>(url)
      .then((next) => {
        if (current) setStatus(next)
      })
      .catch((e: unknown) => {
        if (current) setLoadError(e instanceof Error ? e.message : 'This could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [allowed, url])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    setSaved(await run({ type: 'ai-booking', settings: { enabled } }))
  }

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Without clipboard access, select the text so the owner can copy it by hand.
      const field = document.getElementById('ai-booking-address') as HTMLInputElement | null
      field?.select()
      setCopied(false)
    }
  }

  if (!allowed || !status) return loadError ? <ErrorMessage error={loadError} /> : null
  const booked = state.appointments.filter(
    (a) => !!a.channel && (assistantChannels as readonly string[]).includes(a.channel),
  ).length
  const bookingOpen = operations(state).bookingEnabled
  return (
    <section className="surface ops-panel" aria-labelledby="ai-booking-title">
      <header>
        <div>
          <h2 id="ai-booking-title">Booking through ChatGPT or Claude</h2>
          <p>
            Let guests ask ChatGPT or Claude to book a visit for them. The assistant sees only what
            your booking page shows: your opening hours, the treatments guests can book online and
            free times. It books with the same checks as your booking page, after the guest says
            yes, and gives them their private link to move or cancel. Treatments that need a deposit
            or a patch test stay on your booking page. Guests are never signed up for news or offers
            this way.
          </p>
        </div>
        <MessagesSquare size={21} aria-hidden="true" />
      </header>
      <p className="ops-help" role="status">
        {status.mode === 'off'
          ? 'Booking through ChatGPT or Claude is switched off where SALEANE runs, so nothing answers at this address.'
          : status.reachable
            ? 'Test mode: only this computer can reach the address below. SALEANE is not online yet, so ChatGPT and Claude cannot reach it. Once it is online, you add the address to them as a connector.'
            : 'Test mode only answers on the computer SALEANE runs on, so this address does not answer yet.'}
      </p>
      {status.sample && (
        <p className="ops-help">This is a sample studio, so visits booked here are for practice.</p>
      )}
      <form onSubmit={save}>
        <div className="ops-fields">
          <label className="ops-check ops-wide">
            <Checkbox
              checked={enabled}
              disabled={blocked || pending}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Let guests book through ChatGPT or Claude
          </label>
        </div>
        {!bookingOpen && (
          <p className="ops-help">
            Online booking is off, so nothing answers until you switch it on in Studio details.
          </p>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <span role="status" className="ops-help">
            {saved ? 'Saved.' : ''}
          </span>
          <Button type="submit" variant="secondary" disabled={pending || blocked}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
      {chosen && (
        <div className="share-links">
          <div className="share-link">
            <label htmlFor="ai-booking-address">Your studio’s address for AI assistants</label>
            <div className="share-link-row">
              <input
                id="ai-booking-address"
                readOnly
                value={status.address}
                onFocus={(e) => e.target.select()}
              />
              <Button variant="secondary" onClick={() => void copy(status.address)}>
                {copied ? 'Copied' : 'Copy'}
                <span className="sr-only"> address for AI assistants</span>
              </Button>
            </div>
            <small>
              {booked
                ? `${booked} ${booked === 1 ? 'visit has' : 'visits have'} been booked through an AI assistant.`
                : 'No visits booked through an AI assistant yet.'}
            </small>
          </div>
        </div>
      )}
    </section>
  )
}

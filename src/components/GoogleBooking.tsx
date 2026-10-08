import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MapPin } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'
import './management.css'

type Status = { mode: 'off' | 'test'; offered: boolean; sample: boolean; bookings: number }
type Counts = { treatments: number; times: number }

/**
 * V4: Book with Google. The owner chooses whether guests can book the studio inside Google Search
 * and Maps, and sees what Google would receive. Nothing is sent to Google from here.
 */
export function GoogleBooking() {
  const { mode, session, state, role, blocked } = useStore()
  const allowed = mode === 'server' && !!session && role === 'owner'
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/google`
  const chosen = !!state.operations?.googleBooking?.enabled
  const [enabled, setEnabled] = useState(chosen)
  const [status, setStatus] = useState<Status | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const { run, pending, error } = useRun()

  useEffect(() => {
    if (!allowed) return
    let current = true
    Promise.all([
      api<Status>(base),
      api<{ service: unknown[] }>(`${base}/services`),
      api<{ service_availability: { availability: unknown[] }[] }>(`${base}/availability`),
    ])
      .then(([next, services, availability]) => {
        if (!current) return
        setStatus(next)
        setCounts({
          treatments: services.service.length,
          times: availability.service_availability[0]?.availability.length ?? 0,
        })
      })
      .catch((e: unknown) => {
        if (current) setLoadError(e instanceof Error ? e.message : 'This could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [allowed, base, refresh, chosen])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const done = await run({ type: 'google-booking', settings: { enabled } })
    setSaved(done)
    if (done) setRefresh((n) => n + 1)
  }

  if (!allowed || !status || status.sample)
    return loadError ? <ErrorMessage error={loadError} /> : null
  return (
    <section className="surface ops-panel" aria-labelledby="google-booking-title">
      <header>
        <div>
          <h2 id="google-booking-title">Book with Google</h2>
          <p>
            Let guests book your treatments without leaving Google Search and Maps. Their visits
            arrive in your diary like any online booking, with the usual confirmation. Treatments
            that need a deposit stay on your own booking page, where the deposit is taken. Guests
            can cancel there until the visit starts, as with their own booking link.
          </p>
        </div>
        <MapPin size={21} aria-hidden="true" />
      </header>
      <p className="ops-help" role="status">
        {status.mode === 'test'
          ? 'Test mode: this computer answers Google’s booking calls with test credentials. Nothing has been sent to Google.'
          : 'SALEANE is not a Google booking partner yet, so Google cannot send bookings. You can choose this now, and your studio will be offered once the connection is ready.'}
      </p>
      <form onSubmit={save}>
        <div className="ops-fields">
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={enabled}
              disabled={blocked || pending}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Offer my studio for booking on Google
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" variant="secondary" disabled={pending || blocked}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <span role="status" className="ops-help">
            {saved ? 'Saved.' : ''}
          </span>
        </div>
      </form>
      {status.offered && counts && (
        <p>
          Google would show {counts.treatments}{' '}
          {counts.treatments === 1 ? 'treatment' : 'treatments'} and {counts.times} free{' '}
          {counts.times === 1 ? 'time' : 'times'} over the next 30 days.{' '}
          {status.bookings
            ? `${status.bookings} ${status.bookings === 1 ? 'visit has' : 'visits have'} been booked through Google.`
            : 'No visits booked through Google yet.'}
        </p>
      )}
    </section>
  )
}

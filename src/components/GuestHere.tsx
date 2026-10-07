import { useState } from 'react'
import { DoorOpen } from 'lucide-react'
import { api } from '../state/api'
import { guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { Button, ErrorMessage } from '../design'

/**
 * V1.5: "I've arrived". On the day of the visit, from half an hour before it, a guest can let the
 * desk know they are here. The desk still welcomes them in person.
 */
export function GuestHere({
  token,
  view,
  onChange,
}: {
  token: string
  view: GuestView
  onChange: (view: GuestView) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const here = view.here
  if (!here || here.welcomed) return null
  const org = view.organisation
  const time = (iso: string) =>
    new Intl.DateTimeFormat(org.locale, {
      timeZone: org.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: org.locale === 'en-US',
    }).format(new Date(iso))
  async function tell() {
    setSaving(true)
    setError('')
    try {
      onChange(
        guestViewSchema.parse(
          await api<GuestView>('/api/guest/here', { method: 'POST', body: { token } }),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Please tell the desk.')
    } finally {
      setSaving(false)
    }
  }
  if (here.saidAt)
    return (
      <section className="guest-here" aria-labelledby="here-heading">
        <h2 id="here-heading">
          <DoorOpen size={18} aria-hidden="true" /> Thank you, we know you are here
        </h2>
        <p role="status">
          You told us at {time(here.saidAt)}. Take a seat and someone will be with you shortly.
        </p>
      </section>
    )
  if (!here.open && !saving)
    return (
      <section className="guest-here" aria-labelledby="here-heading">
        <h2 id="here-heading">
          <DoorOpen size={18} aria-hidden="true" /> Arriving today?
        </h2>
        <p className="subtle">
          From {time(here.opensAt)} you can let us know here when you arrive.
        </p>
      </section>
    )
  return (
    <section className="guest-here" aria-labelledby="here-heading">
      <h2 id="here-heading">
        <DoorOpen size={18} aria-hidden="true" /> Here already?
      </h2>
      <p className="subtle">Let {org.name} know you have arrived, then take a seat.</p>
      <ErrorMessage error={error} />
      <Button disabled={saving} onClick={() => void tell()}>
        {saving ? 'Letting them know…' : 'I’ve arrived'}
      </Button>
    </section>
  )
}

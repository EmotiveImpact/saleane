import { useState } from 'react'
import type { FormEvent } from 'react'
import { MapPin } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { GUEST_NOTE_LIMIT } from '../domain/model'
import type { Command } from '../domain/commands'
import { Button, ErrorMessage } from '../design'
import '../guest-extras.css'

/**
 * Manage studio: the "before you arrive" notes guests see on their confirmation and their private
 * visit page. Owners and managers edit them; the server enforces the same rule.
 */
export function GuestNotesSettings() {
  const { state, commit, blocked, role } = useStore()
  const services = state.services.filter((service) => !service.archived)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const allowed = !blocked && can(role, 'catalogue')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allowed || pending) return
    const data = new FormData(event.currentTarget)
    const note = (name: string) => String(data.get(name) ?? '').trim()
    const command: Command = {
      type: 'guest-notes',
      arrivalNote: note('arrivalNote'),
      prepNotes: services.map((service) => ({
        serviceId: service.id,
        note: note(`prep-${service.id}`),
      })),
    }
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit(command)
      if (result.ok) setSaved('Guest notes saved.')
      else setError(result.error)
    } catch {
      setError('Could not save. Your notes are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface ops-panel" aria-labelledby="guest-notes-heading">
      <header>
        <div>
          <h2 id="guest-notes-heading">Before you arrive</h2>
          <p>
            Shown to guests on their booking confirmation and their private visit page. Keep it
            practical; leave health and treatment advice to a conversation.
          </p>
        </div>
        <MapPin size={21} />
      </header>
      <form aria-busy={pending} onSubmit={(event) => void save(event)}>
        <fieldset className="guest-notes-fields" disabled={!allowed || pending}>
          <label>
            For every visit
            <textarea
              name="arrivalNote"
              rows={3}
              maxLength={GUEST_NOTE_LIMIT}
              defaultValue={state.organisation.arrivalNote ?? ''}
              placeholder="Directions, parking and how long to allow. For example: ring the bell at the blue door; allow ten minutes to settle in."
            />
            <small>Up to {GUEST_NOTE_LIMIT} characters.</small>
          </label>
          {services.map((service) => (
            <label key={service.id}>
              {service.name}
              <textarea
                name={`prep-${service.id}`}
                rows={2}
                maxLength={GUEST_NOTE_LIMIT}
                defaultValue={service.prepNote ?? ''}
                placeholder="Optional. For example: come with clean skin."
              />
            </label>
          ))}
        </fieldset>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        <div className="ops-actions">
          <Button type="submit" disabled={!allowed || pending}>
            {pending ? 'Saving…' : 'Save guest notes'}
          </Button>
        </div>
      </form>
    </section>
  )
}

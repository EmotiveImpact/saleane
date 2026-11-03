import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import type { OperatingCommand } from '../domain/commandSchema'
import { businessDate, can, operations, usualHoursFor } from '../domain/operations'
import { addDays } from '../domain/format'
import { places, resourceLocation } from '../domain/locations'
import type { Place } from '../domain/locations'
import { scheduleImpact } from '../domain/schedule'
import { Button, ErrorMessage, Modal, TimeField, Checkbox } from '../design'
import { AffectedVisits } from './ScheduleImpact'
import { LocationOpening } from './LocationOpening'

/**
 * V2: the studio's locations. The main one is edited in Studio details; further locations have a
 * name, an address, an optional note, phone and email for guests and, if they differ, their own
 * opening hours.
 * Rooms are placed in Spaces and each person's working days in Team. A new location is added
 * through "Add a location" (LocationOpening.tsx), with its rooms, team and menu in one go.
 */
type WeeklyHours = ReturnType<typeof operations>['hours']
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekOrder = [1, 2, 3, 4, 5, 6, 0]
const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const minutes = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export function LocationsSettings() {
  const { state, role, blocked } = useStore()
  const [editing, setEditing] = useState<Place | 'new' | null>(null)
  const [saved, setSaved] = useState('')
  const all = places(state, true)
  const allowed = !blocked && can(role, 'location')
  // The coming seven days, so a move to another location still to come (Stage 4) counts from its
  // own date rather than straight away.
  const today = businessDate(state)
  const coming = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const week = (place: Place) =>
    weekOrder
      .filter((day) => {
        const date = coming.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === day)!
        return state.staff.some((person) => {
          if (person.archived) return false
          const usual = usualHoursFor(state, person.id, date)
          return !usual.closed && (usual.locationId ?? state.organisation.locationId) === place.id
        })
      })
      .map((day) => days[day].slice(0, 3))
  return (
    <section className="surface ops-panel" aria-labelledby="locations-heading">
      <header>
        <div>
          <h2 id="locations-heading">Where you work</h2>
          <p>
            Each location has its own rooms and the people working there that day. Guests choose a
            location when you have more than one.
          </p>
        </div>
        {allowed ? (
          <Button
            onClick={() => {
              setEditing('new')
              setSaved('')
            }}
          >
            <Plus size={16} aria-hidden="true" /> Add location
          </Button>
        ) : (
          <MapPin size={21} aria-hidden="true" />
        )}
      </header>
      {saved && (
        <p className="ops-save-note" role="status">
          {saved}
        </p>
      )}
      <div className="ops-ledger">
        {all.map((place) => {
          const rooms = state.resources.filter(
            (r) => !r.archived && resourceLocation(state, r) === place.id,
          )
          const open = week(place)
          return (
            <div className="ops-record" key={place.id}>
              <MapPin size={24} aria-hidden="true" />
              <div className="ops-record-copy">
                <strong>{place.name}</strong>
                <small>
                  {place.address || 'No address yet'} · {rooms.length}{' '}
                  {rooms.length === 1 ? 'room or chair' : 'rooms and chairs'}
                  {open.length === 7
                    ? ' · someone working every day'
                    : open.length
                      ? ` · someone working on ${open.join(', ')}`
                      : ' · nobody working here yet'}
                </small>
              </div>
              <div className="ops-record-controls">
                {place.main && <span className="ops-tag">Main</span>}
                {place.archived && <span className="ops-tag">Closed</span>}
                {!place.main && allowed && (
                  <Button
                    variant="secondary"
                    aria-label={`Edit ${place.name}`}
                    onClick={() => {
                      setEditing(place)
                      setSaved('')
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="ops-help">
        The main location&rsquo;s name and address are in Studio details. Put rooms in a location
        under Spaces, and choose where each person works each day under Team.
      </p>
      {editing === 'new' && (
        <LocationOpening
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null)
            setSaved(message)
          }}
        />
      )}
      {editing && editing !== 'new' && (
        <LocationDialog
          place={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null)
            setSaved(message)
          }}
        />
      )}
    </section>
  )
}

function LocationDialog({
  place,
  onClose,
  onDone,
}: {
  place: Place | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const studio = operations(state).hours
  const stored = place ? operations(state).locations?.find((l) => l.id === place.id) : undefined
  const [name, setName] = useState(place?.name ?? '')
  const [address, setAddress] = useState(place?.address ?? '')
  const [note, setNote] = useState(place?.arrivalNote ?? '')
  const [phone, setPhone] = useState(stored?.phone ?? '')
  const [email, setEmail] = useState(stored?.email ?? '')
  const [own, setOwn] = useState(!!stored?.hours)
  const [hours, setHours] = useState<WeeklyHours>(() =>
    (stored?.hours ?? studio).map((day) => ({ ...day })),
  )
  const [closed, setClosed] = useState(!!place?.archived)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const command: OperatingCommand = {
    type: 'location',
    ...(place ? { id: place.id } : {}),
    input: {
      name: name.trim(),
      address: address.trim(),
      ...(note.trim() ? { arrivalNote: note.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(own ? { hours } : {}),
      ...(closed ? { archived: true } : {}),
    },
  }
  const impact = useMemo(
    () => (place ? scheduleImpact(state, command, new Date().toISOString()) : []),
    // The command is rebuilt from these values on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, place, name, address, note, phone, email, own, hours, closed],
  )

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (impact.length) return
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else
        onDone(
          closed
            ? `${name.trim()} is closed for new bookings. Its history is kept.`
            : `${name.trim()} saved.`,
        )
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={place ? `Edit ${place.name}` : 'Add a location'}
      description="Guests see the name and address when they book here and in their messages."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label className="ops-wide">
            Name
            <input
              value={name}
              required
              minLength={2}
              maxLength={100}
              placeholder="Islington"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ops-wide">
            Address
            <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label>
            Phone for guests (optional)
            <input
              type="tel"
              value={phone}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label>
            Email for guests (optional)
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="ops-wide">
            Before you arrive (optional)
            <textarea
              rows={2}
              maxLength={400}
              value={note}
              placeholder="Directions, parking, which door to use"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <fieldset className="ops-checks ops-wide">
            <legend>Opening hours</legend>
            <label>
              <Checkbox checked={!own} onChange={(e) => setOwn(!e.target.checked)} />
              Same as the studio&rsquo;s opening hours
            </label>
            {own && (
              <div className="ops-hours">
                {weekOrder.map((weekday) => {
                  const day = hours.find((item) => item.day === weekday)
                  if (!day) return null
                  const update = (patch: Partial<typeof day>) =>
                    setHours((current) =>
                      current.map((item) => (item.day === weekday ? { ...item, ...patch } : item)),
                    )
                  return (
                    <div className="ops-day" key={weekday}>
                      <label>
                        <Checkbox
                          checked={!day.closed}
                          onChange={(e) => update({ closed: !e.target.checked })}
                        />
                        {days[weekday]}
                      </label>
                      <label className="ops-field">
                        Opens
                        <TimeField
                          locale={state.organisation.locale}
                          aria-label={`${days[weekday]} opens`}
                          required={!day.closed}
                          disabled={day.closed}
                          value={clock(day.open)}
                          onChange={(time) => update({ open: minutes(time) })}
                        />
                      </label>
                      <label className="ops-field">
                        Closes
                        <TimeField
                          locale={state.organisation.locale}
                          aria-label={`${days[weekday]} closes`}
                          required={!day.closed}
                          disabled={day.closed}
                          value={clock(day.close)}
                          onChange={(time) => update({ close: minutes(time) })}
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
            )}
          </fieldset>
          {place && (
            <label className="ops-check ops-wide">
              <Checkbox checked={closed} onChange={(e) => setClosed(e.target.checked)} />
              Closed for good: no new bookings here; its history is kept
            </label>
          )}
        </div>
        <AffectedVisits visits={impact} locale={state.organisation.locale} />
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || impact.length > 0}>
            {pending ? 'Saving…' : place ? 'Save changes' : 'Add location'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

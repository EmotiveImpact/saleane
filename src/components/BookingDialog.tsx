import { useId, useState } from 'react'
import { Check, CalendarDays, Search } from 'lucide-react'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { slots } from '../domain/commands'
import { usualWeeks } from '../domain/selectors'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { numberLabel } from '../domain/missedCalls'
import { Button, ErrorMessage, Modal, TimeChoices } from '../design'

export type BookingDefaults = {
  clientId?: string
  serviceId?: string
  staffId?: string
  date?: string
  /** A time chosen on the calendar, or the time of the visit being rebooked. */
  startMinutes?: number
  rebookedFromId?: string
  /** V1.5: a missed call the desk is booking for, from Today's list. */
  callId?: string
}

export function BookingDialog({
  onClose,
  defaults = {},
}: {
  onClose: () => void
  defaults?: BookingDefaults
}) {
  const { state, commit, today, blocked, saving, role } = useStore()
  const sandbox = operations(state).mode === 'sandbox'
  const services = state.services.filter((item) => !item.archived)
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const [clientId, setClientId] = useState(defaults.clientId ?? '')
  const call = defaults.callId
    ? operations(state).missedCalls?.find((c) => c.id === defaults.callId)
    : undefined
  // A caller nobody recognises may be new: the desk can add them while booking.
  const [someoneNew, setSomeoneNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState(call ? numberLabel(call.number) : '')
  const newReady =
    someoneNew && newName.trim().length >= 2 && !!newEmail.trim() && !!newPhone.trim()
  const firstService = () => {
    // A time picked on the calendar should open with a service that person can fit in there.
    const person = state.staff.find((item) => item.id === defaults.staffId && !item.archived)
    if (person && defaults.startMinutes !== undefined && !defaults.serviceId) {
      const date = defaults.date ?? addDays(today, 1)
      const fits = services.find(
        (item) =>
          person.serviceIds.includes(item.id) &&
          slots(state, item.id, person.id, date).some(
            (time) => Math.abs(time - defaults.startMinutes!) <= 90,
          ),
      )
      if (fits) return fits.id
      const offered = services.find((item) => person.serviceIds.includes(item.id))
      if (offered) return offered.id
    }
    return (
      services.find((item) => item.id === defaults.serviceId)?.id ??
      services.find((item) =>
        state.staff.some((person) => !person.archived && person.serviceIds.includes(item.id)),
      )?.id ??
      services[0]?.id ??
      ''
    )
  }
  const [serviceId, setServiceId] = useState(firstService)
  const service = services.find((s) => s.id === serviceId)
  const eligible = state.staff.filter((s) => !s.archived && s.serviceIds.includes(serviceId))
  const [staffId, setStaffId] = useState(
    eligible.find((item) => item.id === defaults.staffId)?.id ?? eligible[0]?.id ?? '',
  )
  const [date, setDate] = useState(defaults.date ?? addDays(today, 1))
  const [start, setStart] = useState<number | null>(() => {
    const wanted = defaults.startMinutes
    if (wanted === undefined) return null
    // A spot on the calendar may sit too close to the next visit, so take the nearest time that fits.
    const nearest = slots(state, serviceId, staffId, date).sort(
      (a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b,
    )[0]
    return nearest !== undefined && Math.abs(nearest - wanted) <= 90 ? nearest : null
  })
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const available = slots(state, serviceId, staffId, date)
  const client = state.clients.find((c) => c.id === clientId)
  const bookedClient = state.clients.find(
    (c) => c.id === (state.appointments.find((a) => a.id === confirmedId)?.clientId ?? clientId),
  )
  const locale = state.organisation.locale
  const pastVisits = state.appointments
    .filter(
      (a) =>
        a.clientId === clientId &&
        a.date <= today &&
        (a.status === 'completed' || a.status === 'arrived'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)
  const lastVisit = pastVisits[0]
  const lastService = lastVisit && state.services.find((s) => s.id === lastVisit.serviceId)
  const rebookedFrom = state.appointments.find((a) => a.id === defaults.rebookedFromId)
  const usual = usualWeeks(pastVisits.map((a) => a.date))
  const rhythm = rebookedFrom
    ? [...new Set([usual, 4, 6, 8].filter((w): w is number => w !== null))]
        .map((weeks) => ({ weeks, date: addDays(rebookedFrom.date, weeks * 7) }))
        .filter((choice) => choice.date > today)
    : []
  function chooseDate(next: string) {
    setDate(next)
    // Keep a familiar time when it is free on the new day.
    const keep = defaults.startMinutes
    setStart(
      keep !== undefined && slots(state, serviceId, staffId, next).includes(keep) ? keep : null,
    )
  }
  async function save() {
    if (busy || blocked || !can(role, 'book')) return
    if (!clientId && !newReady) {
      setError(someoneNew ? 'Enter their name, email and phone.' : 'Choose a client.')
      return
    }
    if (start === null) {
      setError('Choose an available time.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'book',
        input: {
          ...(someoneNew
            ? {
                contact: {
                  name: newName.trim(),
                  email: newEmail.trim(),
                  phone: newPhone.trim(),
                  marketingConsent: false,
                },
              }
            : { clientId }),
          serviceId,
          staffId,
          date,
          startMinutes: start,
          source: defaults.rebookedFromId ? 'rebook' : 'desk',
          rebookedFromId: defaults.rebookedFromId,
          ...(call ? { callId: call.id } : {}),
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmedId(result.recordId)
    } catch {
      setError('Could not save this visit. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={
        confirmedId
          ? 'A visit to look forward to'
          : defaults.rebookedFromId
            ? 'Keep the relationship going'
            : 'Book an appointment'
      }
      description={
        confirmedId
          ? 'The calendar and client timeline are updated.'
          : 'Availability includes the professional, treatment space and turnaround time.'
      }
    >
      {!service || (!state.clients.length && !call) ? (
        <div className="empty">
          <h3>A little setup is needed.</h3>
          <p>
            {!state.clients.length
              ? 'Add a client before reserving their visit.'
              : !service
                ? 'Add an active service in Business management.'
                : 'Qualify an active professional for this service in Business management.'}
          </p>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
      ) : confirmedId ? (
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>{bookedClient?.name}</h3>
          <p>
            {service.name}
            <br /> {dateLabel(date, state.organisation.locale)} at{' '}
            {timeLabel(start!, state.organisation.locale)}
          </p>
          <p className="subtle">
            {sandbox
              ? 'Deposit simulated. No real payment taken.'
              : 'Visit reserved. Record any deposit already received in Money; no card has been charged.'}
          </p>
          {call && <p className="subtle">The call is off the missed calls list.</p>}
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          {call && (
            <p className="booking-call-note">
              For the missed call from {numberLabel(call.number)}. Booking takes it off the list.
            </p>
          )}
          {someoneNew ? (
            <fieldset className="booking-new-client">
              <legend>Someone new</legend>
              <div className="form-grid">
                <label className="form-grid-wide">
                  Name
                  <input
                    value={newName}
                    autoComplete="off"
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={newEmail}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </label>
                <label>
                  Phone
                  <input
                    type="tel"
                    value={newPhone}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </label>
              </div>
              <small>
                They are added as a client when you confirm. Ask before sending them news.
              </small>
              <Button variant="quiet" disabled={busy} onClick={() => setSomeoneNew(false)}>
                Choose an existing client instead
              </Button>
            </fieldset>
          ) : (
            <>
              <ClientPicker
                clientId={clientId}
                locked={busy || !!defaults.rebookedFromId || !!call?.clientId}
                initialQuery={call && !call.clientId ? call.number : ''}
                onChange={(id) => {
                  setClientId(id)
                  setError('')
                }}
              />
              {call && !call.clientId && !clientId && (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setSomeoneNew(true)
                    setError('')
                  }}
                >
                  They are new: add them while booking
                </Button>
              )}
            </>
          )}
          {client && !someoneNew && (
            <div className="booking-client-context">
              <div className="preference-note">
                <span>Good to remember</span>
                <p>{client.preferences || 'No preferences recorded yet.'}</p>
              </div>
              <p className="subtle">
                {lastVisit
                  ? `Last visit ${dateLabel(lastVisit.date, locale)}${lastService ? `, ${lastService.name}` : ''}. ${pastVisits.length} ${pastVisits.length === 1 ? 'visit' : 'visits'} so far.`
                  : 'First visit with you.'}
              </p>
            </div>
          )}
          <div className="form-grid">
            <label className="form-grid-wide">
              Service
              <select
                value={serviceId}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value
                  setServiceId(next)
                  setStaffId(
                    state.staff.find((s) => !s.archived && s.serviceIds.includes(next))?.id ?? '',
                  )
                  setStart(null)
                }}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.durationMinutes} min · {money(s.priceMinor, state.organisation)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Professional
              <select
                value={staffId}
                disabled={busy || !eligible.length}
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setStart(null)
                }}
              >
                {!eligible.length && <option value="">No qualified professional</option>}
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {rhythm.length > 0 && (
              <fieldset className="rebook-rhythm">
                <legend>Next visit</legend>
                <div>
                  {rhythm.map((choice) => (
                    <button
                      type="button"
                      key={choice.weeks}
                      className={`time-slot ${date === choice.date ? 'selected' : ''}`}
                      aria-pressed={date === choice.date}
                      disabled={busy}
                      onClick={() => chooseDate(choice.date)}
                    >
                      In {choice.weeks} weeks
                      <small>
                        {choice.weeks === usual
                          ? 'Their usual rhythm'
                          : dateLabel(choice.date, locale)}
                      </small>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <label>
              Date
              <input
                type="date"
                value={date}
                min={today}
                max={addDays(today, 365)}
                disabled={busy}
                onChange={(e) => chooseDate(e.target.value)}
              />
            </label>
          </div>
          <TimeChoices
            label="Available times"
            times={available.map((value) => ({ value, label: timeLabel(value, locale) }))}
            value={start}
            onChange={(time) => {
              setStart(time)
              setError('')
            }}
          />
          <div className="booking-summary">
            <CalendarDays size={20} />
            <span>
              {service.durationMinutes} minutes, with {service.bufferMinutes} minutes to turn the
              room around.
            </span>
          </div>
          <div className="receipt-line">
            <span>Service total</span>
            <strong>{money(service.priceMinor, state.organisation)}</strong>
          </div>
          <div className="receipt-line subtle">
            <span>{sandbox ? 'Simulated deposit' : 'Deposit requested'}</span>
            <span>{money(service.depositMinor, state.organisation)}</span>
          </div>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={
                busy ||
                blocked ||
                !can(role, 'book') ||
                !(someoneNew ? newReady : clientId) ||
                start === null ||
                !available.includes(start)
              }
            >
              {busy ? 'Saving visit…' : sandbox ? 'Confirm demo booking' : 'Confirm booking'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Type a few letters to find a client, rather than scrolling one long list. */
function ClientPicker({
  clientId,
  locked,
  initialQuery = '',
  onChange,
}: {
  clientId: string
  locked: boolean
  /** Starts the search with this, such as a caller's number. */
  initialQuery?: string
  onChange: (id: string) => void
}) {
  const { state } = useStore()
  const id = useId()
  const [query, setQuery] = useState(initialQuery)
  const [editing, setEditing] = useState(!clientId)
  const chosen = state.clients.find((c) => c.id === clientId)
  const words = query.trim().toLowerCase()
  const matches = state.clients
    .filter(
      (c) =>
        !words ||
        c.name.toLowerCase().includes(words) ||
        c.email.toLowerCase().includes(words) ||
        c.phone.replace(/\s/g, '').includes(words.replace(/\s/g, '')),
    )
    .slice(0, 6)
  if (chosen && !editing)
    return (
      <div className="client-picker-chosen">
        <span className="client-picker-label">Client</span>
        <strong>{chosen.name}</strong>
        <small>{chosen.email}</small>
        {!locked && (
          <Button
            variant="quiet"
            onClick={() => {
              setQuery('')
              setEditing(true)
            }}
          >
            Change
          </Button>
        )}
      </div>
    )
  return (
    <div className="client-picker">
      <label htmlFor={id}>Client</label>
      <div className="client-picker-field">
        <Search size={16} aria-hidden />
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder="Type a name, email or phone"
          value={query}
          disabled={locked}
          aria-controls={`${id}-results`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault()
              onChange(matches[0].id)
              setEditing(false)
            }
          }}
        />
      </div>
      <ul className="client-picker-results" id={`${id}-results`} aria-label="Matching clients">
        {matches.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                onChange(c.id)
                setEditing(false)
              }}
            >
              <strong>{c.name}</strong> <small>{c.email}</small>
            </button>
          </li>
        ))}
        {!matches.length && <li className="subtle">No client matches “{query}”.</li>}
      </ul>
    </div>
  )
}

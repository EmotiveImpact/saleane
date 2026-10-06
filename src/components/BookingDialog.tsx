import { useState } from 'react'
import { Check, CalendarDays } from 'lucide-react'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Button, ErrorMessage, Modal } from './ui'

export type BookingDefaults = {
  clientId?: string
  serviceId?: string
  staffId?: string
  date?: string
  rebookedFromId?: string
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
  const [clientId, setClientId] = useState(defaults.clientId ?? state.clients[0]?.id ?? '')
  const [serviceId, setServiceId] = useState(
    services.find((item) => item.id === defaults.serviceId)?.id ??
      services.find((item) =>
        state.staff.some((person) => !person.archived && person.serviceIds.includes(item.id)),
      )?.id ??
      services[0]?.id ??
      '',
  )
  const service = services.find((s) => s.id === serviceId)
  const eligible = state.staff.filter((s) => !s.archived && s.serviceIds.includes(serviceId))
  const [staffId, setStaffId] = useState(
    eligible.find((item) => item.id === defaults.staffId)?.id ?? eligible[0]?.id ?? '',
  )
  const [date, setDate] = useState(defaults.date ?? addDays(today, 1))
  const [start, setStart] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const available = slots(state, serviceId, staffId, date)
  async function save() {
    if (busy || blocked || !can(role, 'book')) return
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
          clientId,
          serviceId,
          staffId,
          date,
          startMinutes: start,
          source: defaults.rebookedFromId ? 'rebook' : 'desk',
          rebookedFromId: defaults.rebookedFromId,
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
      {!service || !clientId ? (
        <div className="empty">
          <h3>A little setup is needed.</h3>
          <p>
            {!clientId
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
          <h3>{state.clients.find((c) => c.id === clientId)?.name}</h3>
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
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Client
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={busy || !!defaults.rebookedFromId}
              >
                {state.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
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
                    {s.name}
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
            <label>
              Date
              <input
                type="date"
                value={date}
                min={today}
                max={addDays(today, 365)}
                disabled={busy}
                onChange={(e) => {
                  setDate(e.target.value)
                  setStart(null)
                }}
              />
            </label>
          </div>
          <fieldset className="time-fieldset">
            <legend>Available times</legend>
            <div className="time-slots">
              {available.map((time) => (
                <button
                  className={`time-slot ${start === time ? 'selected' : ''}`}
                  aria-pressed={start === time}
                  key={time}
                  disabled={busy}
                  onClick={() => {
                    setStart(time)
                    setError('')
                  }}
                >
                  {timeLabel(time, state.organisation.locale)}
                </button>
              ))}
            </div>
            {!available.length && (
              <p className="subtle">No times available. Try another day or professional.</p>
            )}
          </fieldset>
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

import { useState } from 'react'
import { Check, CalendarDays } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
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
  const { state, commit } = useStore()
  const [clientId, setClientId] = useState(defaults.clientId ?? state.clients[0].id)
  const [serviceId, setServiceId] = useState(defaults.serviceId ?? state.services[0].id)
  const service = state.services.find((s) => s.id === serviceId)!
  const eligible = state.staff.filter((s) => s.serviceIds.includes(serviceId))
  const [staffId, setStaffId] = useState(defaults.staffId ?? eligible[0].id)
  const [date, setDate] = useState(defaults.date ?? addDays(DEMO_DATE, 1))
  const [start, setStart] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const available = slots(state, serviceId, staffId, date)
  function save() {
    if (start === null) {
      setError('Choose an available time.')
      return
    }
    const result = commit({
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
  }
  return (
    <Modal
      open
      onClose={onClose}
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
      {confirmedId ? (
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
          <p className="subtle">Deposit simulated. No real payment taken.</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Client
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={!!defaults.rebookedFromId}
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
                onChange={(e) => {
                  const next = e.target.value
                  setServiceId(next)
                  setStaffId(state.staff.find((s) => s.serviceIds.includes(next))!.id)
                  setStart(null)
                }}
              >
                {state.services.map((s) => (
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
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setStart(null)
                }}
              >
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
                min={DEMO_DATE}
                max="2027-10-06"
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
            <span>Simulated deposit</span>
            <span>{money(service.depositMinor, state.organisation)}</span>
          </div>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={start === null}>
              Confirm demo booking
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

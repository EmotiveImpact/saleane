import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, CreditCard } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { depositPaid } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, ErrorMessage, Modal, Status } from './ui'
import { BookingDialog } from './BookingDialog'

export function AppointmentDialog({
  appointmentId,
  onClose,
}: {
  appointmentId: string
  onClose: () => void
}) {
  const { state, commit } = useStore()
  const [checkout, setCheckout] = useState(false)
  const [tip, setTip] = useState('0')
  const [method, setMethod] = useState<'demo_card' | 'demo_cash'>('demo_card')
  const [error, setError] = useState('')
  const [rebook, setRebook] = useState(false)
  const appointment = state.appointments.find((a) => a.id === appointmentId)
  if (!appointment) return null
  const client = state.clients.find((c) => c.id === appointment.clientId)!
  const service = state.services.find((s) => s.id === appointment.serviceId)!
  const staff = state.staff.find((s) => s.id === appointment.staffId)!
  const resource = state.resources.find((r) => r.id === appointment.resourceId)!
  const sale = state.sales.find((s) => s.appointmentId === appointmentId)
  const deposit = depositPaid(state, appointmentId)
  const tipMinor = Math.round(Number(tip) * 100)
  const total = appointment.bookedPriceMinor + (Number.isFinite(tipMinor) ? tipMinor : 0) - deposit
  if (rebook)
    return (
      <BookingDialog
        defaults={{
          clientId: client.id,
          serviceId: service.id,
          staffId: staff.id,
          date:
            addDays(appointment.date, 28) > DEMO_DATE
              ? addDays(appointment.date, 28)
              : addDays(DEMO_DATE, 1),
          rebookedFromId: appointment.id,
        }}
        onClose={onClose}
      />
    )
  function welcome() {
    const result = commit({ type: 'arrive', appointmentId })
    if (!result.ok) setError(result.error)
  }
  function pay() {
    const result = commit({ type: 'checkout', appointmentId, tipMinor, method })
    if (!result.ok) setError(result.error)
  }
  return (
    <Modal
      open
      placement="side"
      onClose={onClose}
      title={sale ? 'A well-finished visit' : checkout ? 'Checkout' : 'Appointment'}
      description={
        sale
          ? 'Demo receipt saved to the client relationship.'
          : checkout
            ? 'Review the service, deposit and optional tip before recording payment.'
            : `${dateLabel(appointment.date, state.organisation.locale)} at ${timeLabel(appointment.startMinutes, state.organisation.locale)}`
      }
    >
      <div className="client-identity">
        <Avatar identity={client.id} name={client.name} />
        <div>
          <h3>{client.name}</h3>
          <Link onClick={onClose} to={`/clients/${client.id}`}>
            Open relationship <ArrowUpRight size={14} />
          </Link>
        </div>
        <Status status={appointment.status} />
      </div>
      {sale ? (
        <>
          <div className="success-strip">
            <Check size={18} />
            Receipt recorded · {sale.method === 'demo_card' ? 'Demo card' : 'Demo cash'}
          </div>
          <div className="receipt-line">
            <span>{service.name}</span>
            <strong>{money(sale.serviceMinor, state.organisation, true)}</strong>
          </div>
          <div className="receipt-line">
            <span>Tip</span>
            <span>{money(sale.tipMinor, state.organisation, true)}</span>
          </div>
          <div className="receipt-line">
            <span>Deposit applied</span>
            <span>−{money(sale.depositAppliedMinor, state.organisation, true)}</span>
          </div>
          <div className="receipt-line total">
            <span>Collected at checkout</span>
            <strong>{money(sale.balanceMinor, state.organisation, true)}</strong>
          </div>
          <p className="subtle demo-note">
            This is a simulated receipt. No payment provider was contacted.
          </p>
          <div className="rebook-callout">
            <h3>Give the next visit a place.</h3>
            <p>A simple invitation to keep a good rhythm.</p>
            <Button onClick={() => setRebook(true)}>Rebook this client</Button>
          </div>
        </>
      ) : checkout ? (
        <>
          <div className="receipt-line">
            <span>{service.name}</span>
            <strong>{money(appointment.bookedPriceMinor, state.organisation, true)}</strong>
          </div>
          <div className="receipt-line">
            <span>Deposit already recorded</span>
            <span>−{money(deposit, state.organisation, true)}</span>
          </div>
          <fieldset className="time-fieldset">
            <legend>Optional tip</legend>
            <div className="tip-options">
              {[0, 10, 15, 20].map((percent) => (
                <button
                  key={percent}
                  aria-pressed={Number(tip) === (appointment.bookedPriceMinor * percent) / 10000}
                  className={`time-slot ${Number(tip) === (appointment.bookedPriceMinor * percent) / 10000 ? 'selected' : ''}`}
                  onClick={() =>
                    setTip(((appointment.bookedPriceMinor * percent) / 10000).toFixed(2))
                  }
                >
                  {percent ? `${percent}%` : 'No tip'}
                </button>
              ))}
            </div>
            <label>
              Custom tip ({state.organisation.currency})
              <input
                type="number"
                min="0"
                step="0.01"
                max={appointment.bookedPriceMinor / 50}
                value={tip}
                onChange={(e) => setTip(e.target.value)}
              />
            </label>
          </fieldset>
          <label>
            Payment method
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="demo_card">Demo card</option>
              <option value="demo_cash">Demo cash</option>
            </select>
          </label>
          <div className="receipt-line total">
            <span>To collect</span>
            <strong>{money(total, state.organisation, true)}</strong>
          </div>
          <p className="subtle demo-note">
            Service tax is not configured in this demo. Tips are separate from service revenue. No
            real payment will be taken.
          </p>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" onClick={() => setCheckout(false)}>
              Back
            </Button>
            <Button onClick={pay}>
              <CreditCard size={16} />
              Record demo payment
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="visit-details">
            <h3>{service.name}</h3>
            <p>
              {appointment.bookedDurationMinutes} minutes with {staff.name}
            </p>
            <p>
              {resource.name} · {appointment.bookedBufferMinutes} minute turnaround
            </p>
          </div>
          <div className="preference-note">
            <span>Good to remember</span>
            <p>{client.preferences || 'No preferences recorded yet.'}</p>
          </div>
          <div className="receipt-line">
            <span>Service</span>
            <strong>{money(appointment.bookedPriceMinor, state.organisation)}</strong>
          </div>
          <div className="receipt-line subtle">
            <span>Demo deposit recorded</span>
            <span>{money(deposit, state.organisation)}</span>
          </div>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {appointment.status === 'confirmed' && appointment.date === DEMO_DATE && (
              <Button onClick={welcome}>Welcome client</Button>
            )}
            {appointment.status === 'arrived' && (
              <Button onClick={() => setCheckout(true)}>Continue to checkout</Button>
            )}
            {appointment.date > DEMO_DATE && (
              <span className="subtle">Arrival opens on the visit day.</span>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

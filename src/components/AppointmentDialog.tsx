import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronRight,
  CircleX,
  CreditCard,
  MessageSquareText,
  UserX,
} from 'lucide-react'
import { useStore } from '../state/context'
import { GuestLinkPanel } from './GuestLinkPanel'
import { can, operations, visitTax } from '../domain/operations'
import type { Command } from '../domain/commands'
import { hasLocations, places, staffLocationOn } from '../domain/locations'
import { depositPaid, rescheduleSlots } from '../domain/commands'
import { addDays, dateLabel, fullDateLabel, money, timeLabel } from '../domain/format'
import { checkoutTotals, minorInput, parseMinor } from '../domain/money'
import { coverPreview, holdings, memberDiscountPercent, plansForVisit } from '../domain/plans'
import { priceRetail, retailCharge } from '../domain/retail'
import type { RetailItems } from '../domain/retailSchema'
import { CheckoutProducts, ReceiptProducts } from './CheckoutProducts'
import { findGiftCard, giftCards, giftStanding } from '../domain/giftCards'
import '../components/plans.css'
import { Avatar, Button, ErrorMessage, Modal, Status, TimeChoices, photos } from '../design'
import { StudioDateField } from './StudioDateField'
import { BookingDialog } from './BookingDialog'
import { CardCheckout, VisitCardPanel } from './CardPayments'
import { VisitPatchTest } from './PatchTests'
import { VisitForms } from './GuestForms'
import { VisitConsultation } from './Consultations'
import { shownStatus } from '../domain/selectors'
import { servicePhoto } from './servicePhoto'
import './visitPanel.css'

export function AppointmentDialog({
  appointmentId,
  onClose,
  onMoved,
  proposal,
}: {
  appointmentId: string
  onClose: () => void
  onMoved?: (date: string, staffId: string) => void
  /** A new person and time from dragging on the calendar, opened straight into the move step. */
  proposal?: { date: string; staffId: string; startMinutes: number }
}) {
  const { state, commit, today, blocked, saving, role, mode: storeMode } = useStore()
  const config = operations(state)
  const sandbox = config.mode === 'sandbox'
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const allowed = (action: string) => !blocked && !busy && can(role, action)
  const [reference, setReference] = useState('')
  const [collected, setCollected] = useState(false)
  const [discount, setDiscount] = useState('0')
  // V1.5: the package or membership paying for this visit ('' pays as usual).
  const [holdingId, setHoldingId] = useState<string | null>(null)
  // V1.5: a gift card the desk applied at checkout, and how much to take from it.
  const [giftCode, setGiftCode] = useState('')
  const [giftId, setGiftId] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [giftError, setGiftError] = useState('')
  const [checkout, setCheckout] = useState(false)
  // V2: products the guest is buying with the visit.
  const [items, setItems] = useState<RetailItems>([])
  const [tip, setTip] = useState('0')
  const [otherTip, setOtherTip] = useState(false)
  const [method, setMethod] = useState<
    'demo_card' | 'demo_cash' | 'cash' | 'external_card' | 'card'
  >(sandbox ? 'demo_card' : 'cash')
  const [error, setError] = useState('')
  const [rebook, setRebook] = useState(false)
  const appointment = state.appointments.find((a) => a.id === appointmentId)
  const [mode, setMode] = useState<'details' | 'move' | 'cancel' | 'no-show'>(
    proposal ? 'move' : 'details',
  )
  const [date, setDate] = useState(proposal?.date ?? appointment?.date ?? today)
  const [staffId, setStaffId] = useState(proposal?.staffId ?? appointment?.staffId ?? '')
  // V2: a visit can move to another location when the studio has more than one.
  const [placeId, setPlaceId] = useState(appointment?.locationId ?? '')
  const multiSite = hasLocations(state)
  const [start, setStart] = useState<number | null>(
    proposal?.startMinutes ?? appointment?.startMinutes ?? null,
  )
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState('')
  const rebookHeading = useId()
  if (!appointment)
    return (
      <Modal
        open
        onClose={onClose}
        title="Visit unavailable"
        description="This visit is no longer available in your current workspace."
      >
        <Button onClick={onClose}>Close</Button>
      </Modal>
    )
  const client = state.clients.find((c) => c.id === appointment.clientId)
  const service = state.services.find((s) => s.id === appointment.serviceId)
  const staff = state.staff.find((s) => s.id === appointment.staffId)
  const resource = state.resources.find((r) => r.id === appointment.resourceId)
  if (!client || !service || !staff || !resource)
    return (
      <Modal
        open
        onClose={onClose}
        title="Visit needs review"
        description="A related record is unavailable. Reload this workspace before changing the visit."
      >
        <Button onClick={onClose}>Close</Button>
      </Modal>
    )
  const sale = state.sales.find((s) => s.appointmentId === appointmentId)
  const locale = state.organisation.locale
  const firstName = client.name.split(' ')[0]
  const serviceName = appointment.bookedServiceName ?? service.name
  const photo = servicePhoto(state.services, service.id)
  const ends = appointment.startMinutes + appointment.bookedDurationMinutes
  // Earlier visits the client came to, for a line of context beside what is good to remember.
  const earlier = state.appointments
    .filter(
      (a) =>
        a.clientId === client.id &&
        a.id !== appointment.id &&
        (a.status === 'completed' || a.status === 'arrived') &&
        (a.date < appointment.date ||
          (a.date === appointment.date && a.startMinutes < appointment.startMinutes)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)
  const previous = earlier[0]
  const previousName =
    previous &&
    (previous.bookedServiceName ?? state.services.find((s) => s.id === previous.serviceId)?.name)
  // The client's next booked visit after this one, if they already have one.
  const nextVisit = state.appointments
    .filter(
      (a) =>
        a.clientId === client.id &&
        a.id !== appointment.id &&
        a.status === 'confirmed' &&
        a.date >= today &&
        (a.date > appointment.date ||
          (a.date === appointment.date && a.startMinutes > appointment.startMinutes)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)[0]
  // Rebooking opens four weeks on from this visit, or tomorrow when that has already passed.
  const fourWeeksOn = addDays(appointment.date, 28)
  const rebookDate = fourWeeksOn > today ? fourWeeksOn : addDays(today, 1)
  const messaging = can(role, 'message') && !blocked
  // PILOT-02: a signed-in local studio can take a card through the payment provider.
  const cardTaking = storeMode === 'server' && !sandbox
  const deposit = depositPaid(state, appointmentId)
  const tipMinor = parseMinor(tip, 0)
  const coverable = deposit ? [] : plansForVisit(state, appointment, today)
  const memberPercent = memberDiscountPercent(state, appointment, today)
  // The first plan that can pay is chosen unless the desk picks "pay as usual".
  const chosenPlan =
    holdingId === ''
      ? undefined
      : (coverable.find((p) => p.holding.id === holdingId) ?? coverable[0])
  const coveredMinor = chosenPlan
    ? coverPreview(chosenPlan.holding, appointment.bookedPriceMinor, today)
    : 0
  const discountMinor = chosenPlan
    ? appointment.bookedPriceMinor - coveredMinor
    : parseMinor(discount, 0)
  const bookedTax = visitTax(state, appointment)
  const tax = chosenPlan && bookedTax ? { ...bookedTax, inclusive: true } : bookedTax
  const { taxMinor, balanceMinor: dueMinor } = checkoutTotals({
    priceMinor: appointment.bookedPriceMinor,
    discountMinor: Number.isFinite(discountMinor) ? discountMinor : 0,
    tipMinor: Number.isFinite(tipMinor) ? tipMinor : 0,
    depositMinor: deposit,
    tax,
  })
  let retail: ReturnType<typeof priceRetail>
  let retailError = ''
  try {
    retail = priceRetail(state, items, appointment.locationId)
  } catch (problem) {
    retailError = problem instanceof Error ? problem.message : 'Check the products.'
  }
  const gift = giftCards(state).find((c) => c.id === giftId)
  const giftLeft = gift ? giftStanding(gift, today).balanceMinor : 0
  // A gift card can pay for products as well as the visit.
  const beforeGift = Math.max(0, dueMinor - coveredMinor) + retailCharge(retail)
  // Typed amounts are kept within what the card holds and what is due.
  const giftMinor = gift
    ? Math.min(Math.max(0, parseMinor(giftAmount, 0) || 0), giftLeft, beforeGift)
    : 0
  const total = beforeGift - giftMinor
  // Nothing is charged to a card when a plan or gift card leaves nothing to pay.
  const byCard = cardTaking && method === 'card' && total > 0
  function applyGift() {
    if (!giftCode.trim()) {
      setGiftError('Type the code from the gift card or voucher, then apply it.')
      return
    }
    const card = findGiftCard(state, giftCode)
    const standing = card && giftStanding(card, today)
    if (!card || !standing) {
      setGiftError('No gift card here has that code. Check it and try again.')
      return
    }
    if (!standing.canSpend) {
      setGiftError(
        standing.state === 'cancelled'
          ? 'This gift card was cancelled.'
          : standing.state === 'used'
            ? 'This gift card has been used up.'
            : `This gift card expired on ${fullDateLabel(card.expiresOn, state.organisation.locale)}. A manager can give it more time.`,
      )
      return
    }
    setGiftId(card.id)
    setGiftAmount(minorInput(Math.min(standing.balanceMinor, beforeGift)))
    setGiftError('')
    setCollected(false)
  }
  const needsConfirm = !sandbox && total > 0
  const tipPreset = (percent: number) => Math.round((appointment.bookedPriceMinor * percent) / 100)
  const available =
    mode === 'move' ? rescheduleSlots(state, appointmentId, staffId, date, undefined, placeId) : []
  // Keep the existing booked allocation available for an unchanged visit.
  if (
    mode === 'move' &&
    appointment.date === date &&
    appointment.staffId === staffId &&
    !available.includes(appointment.startMinutes)
  )
    available.push(appointment.startMinutes)
  available.sort((a, b) => a - b)
  if (rebook)
    return (
      <BookingDialog
        defaults={{
          clientId: client.id,
          serviceId: service.id,
          staffId: staff.id,
          date: rebookDate,
          startMinutes: appointment.startMinutes,
          rebookedFromId: appointment.id,
        }}
        onClose={() => {
          if (!busy) onClose()
        }}
      />
    )
  async function run(command: Command) {
    if (!allowed(command.type)) return false
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      return true
    } catch {
      setError('Could not save this change. Your entries are retained; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  async function welcome() {
    await run({ type: 'arrive', appointmentId })
  }
  async function pay() {
    if (needsConfirm && !collected) {
      setError('Confirm that the balance has already been received outside Saleane.')
      return
    }
    // With nothing left to pay the payment fields are hidden; the visit closes at nothing due.
    const nothingDue = total === 0
    if (method === 'external_card' && !nothingDue && !reference.trim()) {
      setError('Enter the external card payment reference.')
      return
    }
    if (!Number.isFinite(tipMinor) || !Number.isFinite(discountMinor)) {
      setError('Enter the tip and discount as amounts with up to two decimal places.')
      return
    }
    await run({
      type: 'checkout',
      appointmentId,
      tipMinor,
      // A provider card is charged only through its own screen, and a terminal only when money is due.
      method: method === 'card' || (nothingDue && method === 'external_card') ? 'cash' : method,
      ...(chosenPlan ? { holdingId: chosenPlan.holding.id } : { discountMinor }),
      ...(items.length ? { products: items } : {}),
      ...(gift && giftMinor > 0 ? { giftCardId: gift.id, giftCardMinor: giftMinor } : {}),
      reference: (!nothingDue && reference.trim()) || undefined,
    })
  }
  function changeMode(next: typeof mode) {
    setMode(next)
    setError('')
    setNotice('')
    setReason(next === 'cancel' ? 'Client requested cancellation' : 'Client did not attend')
  }
  async function move() {
    if (start === null) {
      setError('Choose an available time.')
      return
    }
    const elsewhere = placeId && placeId !== appointment!.locationId ? { locationId: placeId } : {}
    if (
      !(await run({
        type: 'reschedule',
        appointmentId,
        date,
        staffId,
        startMinutes: start,
        ...elsewhere,
      }))
    )
      return
    setMode('details')
    setNotice('Appointment saved. Booked service and deposit history retained. No message sent.')
    onMoved?.(date, staffId)
  }
  async function endVisit() {
    if (mode !== 'cancel' && mode !== 'no-show') return
    if (!(await run({ type: mode, appointmentId, reason }))) return
    setMode('details')
    setNotice(
      mode === 'cancel'
        ? 'Cancellation recorded in the client relationship.'
        : 'Missed visit recorded in the client relationship.',
    )
  }
  const details = !sale && !checkout && mode === 'details'
  const identity = (
    <div className="client-identity">
      <Avatar identity={client.id} name={client.name} />
      <div>
        <h3>{client.name}</h3>
        <Link onClick={onClose} to={`/clients/${client.id}`}>
          Open client page <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <Status status={shownStatus(appointment)} />
    </div>
  )
  const strips = (
    <>
      {appointment.status === 'confirmed' && appointment.guestHereAt && (
        <p className="success-strip">
          {`${firstName} tapped “I’ve arrived” at ${new Intl.DateTimeFormat(locale, {
            timeZone: state.organisation.timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: locale === 'en-US',
          }).format(new Date(appointment.guestHereAt))}. Welcome them when you’re ready.`}
        </p>
      )}
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
    </>
  )
  // The treatment as a line of the bill, with its photograph and who gives it.
  const serviceLine = (price: number) => (
    <div className="receipt-line visit-service-line">
      <span className="visit-service-name">
        <span
          className="visit-service-photo"
          aria-hidden="true"
          style={{ backgroundImage: `url(${photo.src})`, backgroundPosition: photo.position }}
        />
        <span>
          {serviceName}
          <small>
            {appointment.bookedDurationMinutes} minutes with {staff.name}
          </small>
        </span>
      </span>
      <strong>{money(price, state.organisation, true)}</strong>
    </div>
  )
  // Messages are written in the Inbox, with this client and this visit already chosen.
  const messageTo = `/inbox?write=${encodeURIComponent(client.id)}&visit=${encodeURIComponent(appointment.id)}`
  const messageLink = messaging && (
    <Link className="visit-action" to={messageTo} onClick={onClose}>
      <MessageSquareText size={18} aria-hidden="true" />
      <span>Message {firstName}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  )
  return (
    <Modal
      open
      placement="side"
      onClose={() => {
        if (!busy) onClose()
      }}
      title={
        sale
          ? 'A well-finished visit'
          : checkout
            ? 'Checkout'
            : mode === 'move'
              ? 'Move appointment'
              : mode === 'cancel'
                ? 'Cancel appointment'
                : mode === 'no-show'
                  ? 'Record a missed visit'
                  : serviceName
      }
      description={
        sale
          ? sandbox
            ? 'Demo receipt saved to the client relationship.'
            : sale.method === 'card'
              ? 'Receipt saved. The payment provider confirmed the card payment.'
              : 'Local receipt saved. No payment provider was contacted.'
          : checkout
            ? 'Review the service, any products, the deposit and an optional tip before recording payment.'
            : details
              ? `${dateLabel(appointment.date, locale)}, ${timeLabel(appointment.startMinutes, locale)} to ${timeLabel(ends, locale)}`
              : `${dateLabel(appointment.date, locale)} at ${timeLabel(appointment.startMinutes, locale)}`
      }
    >
      {!details && (
        <>
          {identity}
          {strips}
        </>
      )}
      {sale ? (
        <>
          <div className="success-strip">
            <Check size={18} />
            Receipt recorded ·{' '}
            {sale.coveredMinor !== undefined && !sale.balanceMinor && !sale.giftCardMinor
              ? `Paid by ${holdings(state).find((h) => h.id === sale.holdingId)?.name ?? 'plan'}`
              : sale.giftCardMinor && !sale.balanceMinor
                ? 'Paid by gift card'
                : {
                    demo_card: 'Demo card',
                    demo_cash: 'Demo cash',
                    cash: 'Cash',
                    external_card: 'External card',
                    card: sale.processor?.live ? 'Card' : 'Test card, no money moved',
                    previous_system: 'Previous system',
                  }[sale.method]}
          </div>
          {serviceLine(sale.serviceMinor)}
          {!!sale.coveredMinor && (
            <div className="receipt-line">
              <span>
                Paid by {holdings(state).find((h) => h.id === sale.holdingId)?.name ?? 'plan'}
              </span>
              <span>−{money(sale.coveredMinor, state.organisation, true)}</span>
            </div>
          )}
          {!!sale.discountMinor && (
            <div className="receipt-line">
              <span>{sale.coveredMinor !== undefined ? 'Plan saving' : 'Discount'}</span>
              <span>−{money(sale.discountMinor, state.organisation, true)}</span>
            </div>
          )}
          {!!sale.taxMinor && (
            <div className="receipt-line">
              <span>
                {sale.taxLabel || 'Tax'} {sale.taxInclusive ? '(included)' : ''}
              </span>
              <span>{money(sale.taxMinor, state.organisation, true)}</span>
            </div>
          )}
          {sale.retail && <ReceiptProducts retail={sale.retail} />}
          <div className="receipt-line">
            <span>Tip</span>
            <span>{money(sale.tipMinor, state.organisation, true)}</span>
          </div>
          <div className="receipt-line">
            <span>Deposit applied</span>
            <span>−{money(sale.depositAppliedMinor, state.organisation, true)}</span>
          </div>
          {!!sale.giftCardMinor && (
            <div className="receipt-line">
              <span>
                Paid by gift card{' '}
                {giftCards(state).find((c) => c.id === sale.giftCardId)?.code ?? ''}
              </span>
              <span>−{money(sale.giftCardMinor, state.organisation, true)}</span>
            </div>
          )}
          <div className="receipt-line total">
            <span>Collected at checkout</span>
            <strong>{money(sale.balanceMinor, state.organisation, true)}</strong>
          </div>
          <p className="subtle demo-note">
            {sandbox
              ? 'This is a simulated receipt. No payment provider was contacted.'
              : sale.method === 'card'
                ? sale.processor?.live
                  ? 'Paid by card through SALEANE. The payment provider confirmed it.'
                  : 'Paid with a test card. Test mode: no money moved.'
                : 'This receipt records funds handled outside Saleane. No payment provider was contacted.'}
          </p>
          <section className="rebook-moment" aria-labelledby={rebookHeading}>
            <div
              className="rebook-moment-photo"
              aria-hidden="true"
              style={{ backgroundImage: `url(${photos.tea})` }}
            />
            <div className="rebook-moment-text">
              <p className="eyebrow">Next visit</p>
              <h3 id={rebookHeading}>
                {nextVisit ? 'The next visit is already booked.' : 'Give the next visit a place.'}
              </h3>
              <p>
                {nextVisit
                  ? `${dateLabel(nextVisit.date, locale)} at ${timeLabel(nextVisit.startMinutes, locale)}, ${nextVisit.bookedServiceName ?? state.services.find((s) => s.id === nextVisit.serviceId)?.name ?? 'a visit'}.`
                  : rebookDate === fourWeeksOn
                    ? `A simple invitation to keep a good rhythm. Four weeks on is ${dateLabel(rebookDate, locale)}.`
                    : 'A simple invitation to keep a good rhythm.'}
              </p>
              <div className="rebook-moment-actions">
                <Button
                  variant={nextVisit ? 'secondary' : 'primary'}
                  disabled={!allowed('book')}
                  onClick={() => setRebook(true)}
                >
                  Rebook this client
                </Button>
                {messaging && (
                  <Link className="text-link" to={messageTo} onClick={onClose}>
                    Message {firstName}
                  </Link>
                )}
              </div>
            </div>
          </section>
        </>
      ) : mode === 'move' ? (
        <>
          <div className="allocation-summary">
            <span>Currently reserved</span>
            <strong>
              {dateLabel(appointment.date, state.organisation.locale)} ·{' '}
              {timeLabel(appointment.startMinutes, state.organisation.locale)}
            </strong>
            <p>
              {staff.name} · {appointment.bookedServiceName ?? service.name}
            </p>
          </div>
          <div className="form-grid">
            <label>
              New date
              <StudioDateField
                min={today}
                max={addDays(today, 365)}
                disabled={busy}
                value={date}
                onChange={(next) => {
                  setDate(next)
                  setStart(null)
                  setError('')
                }}
              />
            </label>
            {multiSite && (
              <label>
                Location
                <select
                  value={placeId}
                  disabled={busy}
                  onChange={(e) => {
                    setPlaceId(e.target.value)
                    setStart(null)
                    setError('')
                  }}
                >
                  {places(state).map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Professional
              <select
                value={staffId}
                disabled={busy}
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setStart(null)
                  setError('')
                }}
              >
                {state.staff
                  .filter(
                    (person) =>
                      !person.archived &&
                      person.serviceIds.includes(service.id) &&
                      (!multiSite ||
                        person.id === staffId ||
                        staffLocationOn(state, person.id, date) === placeId),
                  )
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <TimeChoices
            label="Available times"
            value={start}
            times={available.map((value) => ({
              value,
              label: timeLabel(value, state.organisation.locale),
            }))}
            onChange={(value) => {
              setStart(value)
              setError('')
            }}
          />
          {start !== null && !available.includes(start) && (
            <p className="form-error" role="status">
              {timeLabel(start, state.organisation.locale)} is not free for this visit with this
              professional. Choose one of the times above.
            </p>
          )}
          <div className="booking-summary">
            <span>
              {appointment.bookedDurationMinutes} minutes + {appointment.bookedBufferMinutes} minute
              turnaround. The original {money(appointment.bookedPriceMinor, state.organisation)}{' '}
              service and {money(deposit, state.organisation)} recorded deposit stay with this
              visit.
            </span>
          </div>
          <p className="subtle demo-note">
            Availability checks the professional and treatment space together. Save updates the
            calendar and timeline; no confirmation message is sent.
          </p>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" disabled={busy} onClick={() => changeMode('details')}>
              Back
            </Button>
            <Button
              onClick={move}
              disabled={!allowed('reschedule') || start === null || !available.includes(start)}
            >
              {busy ? 'Saving…' : 'Save appointment'}
            </Button>
          </div>
        </>
      ) : mode === 'cancel' || mode === 'no-show' ? (
        <>
          <div className="allocation-summary">
            <strong>{appointment.bookedServiceName ?? service.name}</strong>
            <p>
              {dateLabel(appointment.date, state.organisation.locale)} ·{' '}
              {timeLabel(appointment.startMinutes, state.organisation.locale)} with {staff.name}
            </p>
          </div>
          <label>
            Operational reason
            <input
              maxLength={300}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setError('')
              }}
            />
          </label>
          <p className="subtle demo-note">
            Use an operational reason; keep health information out of this workspace.
          </p>
          {mode === 'no-show' && (
            <p className="preference-note">
              Confirm that the scheduled visit time has passed and the client did not attend.{' '}
              {sandbox
                ? 'The sandbox checks the visit date; it does not enforce elapsed time.'
                : 'The local workspace checks elapsed venue time before recording this status.'}
            </p>
          )}
          <div className="deposit-review">
            <strong>{money(deposit, state.organisation)} deposit remains recorded</strong>
            <p>
              Review its treatment with the client. This action releases the reserved time and
              retains the history. It creates no refund, cancellation fee or completed sale.
            </p>
          </div>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" disabled={busy} onClick={() => changeMode('details')}>
              Keep appointment
            </Button>
            <Button onClick={endVisit} disabled={!allowed(mode) || reason.trim().length < 2}>
              {busy
                ? 'Saving…'
                : mode === 'cancel'
                  ? 'Confirm cancellation'
                  : 'Confirm missed visit'}
            </Button>
          </div>
        </>
      ) : checkout ? (
        <div className="checkout-stack">
          <div className="checkout-lines">
            {serviceLine(appointment.bookedPriceMinor)}
            <div className="receipt-line">
              <span>Deposit already recorded</span>
              <span>−{money(deposit, state.organisation, true)}</span>
            </div>
          </div>
          {coverable.length > 0 && (
            <fieldset className="checkout-plans">
              <legend>Pay with</legend>
              {coverable.map(({ holding, standing }) => (
                <label key={holding.id}>
                  <input
                    type="radio"
                    name="checkout-plan"
                    checked={chosenPlan?.holding.id === holding.id}
                    onChange={() => {
                      setHoldingId(holding.id)
                      setCollected(false)
                      if (method === 'card') setMethod('cash')
                    }}
                  />
                  {holding.name} ({standing.visitsLeft}{' '}
                  {standing.visitsLeft === 1 ? 'visit' : 'visits'} left
                  {holding.kind === 'membership' ? ' this month' : ''})
                </label>
              ))}
              <label>
                <input
                  type="radio"
                  name="checkout-plan"
                  checked={!chosenPlan}
                  onChange={() => {
                    setHoldingId('')
                    setCollected(false)
                  }}
                />
                Pay as usual
              </label>
            </fieldset>
          )}
          {chosenPlan ? (
            <div className="checkout-lines">
              <div className="receipt-line">
                <span>Paid by {chosenPlan.holding.name}</span>
                <span>−{money(coveredMinor, state.organisation, true)}</span>
              </div>
              {discountMinor > 0 && (
                <div className="receipt-line">
                  <span>Plan saving</span>
                  <span>−{money(discountMinor, state.organisation, true)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="checkout-discount-group">
              {memberPercent > 0 && (
                <p className="member-discount">
                  Member price: {memberPercent}% off is{' '}
                  {money(
                    Math.round((appointment.bookedPriceMinor * memberPercent) / 100),
                    state.organisation,
                    true,
                  )}
                  .{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setDiscount(
                        minorInput(
                          Math.round((appointment.bookedPriceMinor * memberPercent) / 100),
                        ),
                      )
                      setCollected(false)
                    }}
                  >
                    Apply it
                  </button>
                </p>
              )}
              <label className="checkout-discount">
                Discount ({state.organisation.currency})
                <input
                  type="number"
                  min="0"
                  max={appointment.bookedPriceMinor / 100}
                  step="0.01"
                  value={discount}
                  onChange={(event) => {
                    setDiscount(event.target.value)
                    setCollected(false)
                    setError('')
                  }}
                />
              </label>
            </div>
          )}
          <CheckoutProducts
            items={items}
            retail={retail}
            disabled={busy}
            onChange={(next) => {
              setItems(next)
              setCollected(false)
              setError('')
            }}
          />
          <fieldset className="time-fieldset">
            <legend>Optional tip</legend>
            <div className="tip-options">
              {[0, 10, 15, 20].map((percent) => (
                <button
                  type="button"
                  key={percent}
                  aria-pressed={!otherTip && tipMinor === tipPreset(percent)}
                  className={`time-slot ${!otherTip && tipMinor === tipPreset(percent) ? 'selected' : ''}`}
                  onClick={() => {
                    setOtherTip(false)
                    setTip(minorInput(tipPreset(percent)))
                    setCollected(false)
                    setError('')
                  }}
                >
                  {percent ? `${percent}%` : 'No tip'}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={otherTip}
                className={`time-slot ${otherTip ? 'selected' : ''}`}
                onClick={() => {
                  setOtherTip(true)
                  setCollected(false)
                }}
              >
                Other
              </button>
            </div>
            {otherTip && (
              <label>
                Custom tip ({state.organisation.currency})
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  max={appointment.bookedPriceMinor / 50}
                  value={tip}
                  onChange={(e) => {
                    setTip(e.target.value)
                    setCollected(false)
                    setError('')
                  }}
                />
              </label>
            )}
          </fieldset>
          <ErrorMessage error={retailError} />
          {gift ? (
            <div className="checkout-gift">
              <div className="receipt-line">
                <span>
                  Gift card {gift.code} · {money(giftLeft, state.organisation, true)} on it
                </span>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setGiftId('')
                    setGiftCode('')
                    setCollected(false)
                  }}
                >
                  Remove
                </button>
              </div>
              <label>
                Take from the gift card ({state.organisation.currency})
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={Math.min(giftLeft, beforeGift) / 100}
                  value={giftAmount}
                  onChange={(event) => {
                    setGiftAmount(event.target.value)
                    setCollected(false)
                  }}
                />
              </label>
              <div className="receipt-line">
                <span>Paid by gift card</span>
                <span>−{money(giftMinor, state.organisation, true)}</span>
              </div>
            </div>
          ) : (
            beforeGift > 0 &&
            giftCards(state).length > 0 && (
              <div className="checkout-gift">
                <label>
                  Gift card or voucher code
                  <span className="checkout-gift-row">
                    <input
                      value={giftCode}
                      maxLength={20}
                      autoComplete="off"
                      placeholder="ABCD-EFGH-JKLM"
                      onChange={(event) => {
                        setGiftCode(event.target.value)
                        setGiftError('')
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        applyGift()
                      }}
                    />
                    <Button type="button" variant="secondary" disabled={busy} onClick={applyGift}>
                      Apply
                    </Button>
                  </span>
                </label>
                <ErrorMessage error={giftError} />
              </div>
            )
          )}
          {(total > 0 || (!chosenPlan && !gift)) && (
            <div className="checkout-payment">
              <label>
                Payment method
                <select
                  value={method}
                  disabled={busy}
                  onChange={(e) => {
                    setMethod(e.target.value as typeof method)
                    setCollected(false)
                  }}
                >
                  {sandbox ? (
                    <>
                      <option value="demo_card">Demo card</option>
                      <option value="demo_cash">Demo cash</option>
                    </>
                  ) : (
                    <>
                      {cardTaking && !chosenPlan && (
                        <option value="card">Card through SALEANE</option>
                      )}
                      <option value="cash">Cash received</option>
                      <option value="external_card">External card payment</option>
                    </>
                  )}
                </select>
              </label>
              {!sandbox && !byCard && (
                <>
                  <label>
                    Payment reference {method === 'external_card' ? '(required)' : '(optional)'}
                    <input
                      value={reference}
                      maxLength={150}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                  <label className="checkbox-label consent-label">
                    <input
                      type="checkbox"
                      checked={collected}
                      onChange={(event) => setCollected(event.target.checked)}
                    />
                    I confirm the balance has already been received outside Saleane.
                  </label>
                </>
              )}
            </div>
          )}
          <div className="checkout-lines">
            {tax && (
              <div className="receipt-line">
                <span>
                  {tax.label || 'Tax'} {tax.inclusive ? '(included)' : ''}
                </span>
                <span>{money(taxMinor, state.organisation, true)}</span>
              </div>
            )}
            <div className="receipt-line total">
              <span>
                {sandbox ? 'To collect' : byCard ? 'To pay by card' : 'Balance to record'}
              </span>
              <strong>{money(total, state.organisation, true)}</strong>
            </div>
          </div>
          <p className="subtle demo-note">
            {tax
              ? 'Tax follows the setting in place when this visit was booked. '
              : 'No tax applies to this visit. '}
            Tips are separate from service revenue.{' '}
            {gift && total === 0
              ? 'The gift card pays for this visit; there is nothing to collect.'
              : chosenPlan && total === 0
                ? `${chosenPlan.holding.name} pays for this visit; there is nothing to collect.`
                : sandbox
                  ? 'No real payment will be taken.'
                  : byCard
                    ? 'The visit is checked out only when the card payment goes through.'
                    : 'Only record funds already received outside SALEANE.'}
          </p>
          {byCard && (
            <CardCheckout
              appointmentId={appointmentId}
              amountMinor={total}
              tipMinor={Number.isFinite(tipMinor) ? tipMinor : 0}
              discountMinor={Number.isFinite(discountMinor) ? discountMinor : 0}
              products={items}
              giftCard={gift && giftMinor > 0 ? { id: gift.id, amountMinor: giftMinor } : undefined}
            />
          )}
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" disabled={busy} onClick={() => setCheckout(false)}>
              Back
            </Button>
            {!byCard && (
              <Button
                disabled={!allowed('checkout') || (needsConfirm && !collected) || !!retailError}
                onClick={pay}
              >
                <CreditCard size={16} />
                {busy ? 'Recording…' : sandbox ? 'Record demo payment' : 'Record payment'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            className="visit-photo"
            aria-hidden="true"
            style={{ backgroundImage: `url(${photo.src})`, backgroundPosition: photo.position }}
          />
          <p className="visit-facts">
            {appointment.bookedDurationMinutes} minutes with {staff.name} · {resource.name} ·{' '}
            {appointment.bookedBufferMinutes} minute turnaround
            {resource.restMinutes ? ` · room rests ${resource.restMinutes} minutes` : ''}
          </p>
          {strips}
          <div className="visit-client">
            {identity}
            <div className="visit-remember">
              <span>Good to remember</span>
              <p>{client.preferences || 'No preferences recorded yet.'}</p>
              <p className="visit-history">
                {previous
                  ? `Last came ${dateLabel(previous.date, locale)}${previousName ? ` for ${previousName}` : ''}. ${earlier.length} ${earlier.length === 1 ? 'visit' : 'visits'} before this one.`
                  : 'No earlier visits.'}
              </p>
            </div>
          </div>
          <div className="visit-notes">
            {['confirmed', 'arrived'].includes(appointment.status) && (
              <VisitPatchTest appointment={appointment} />
            )}
            <VisitConsultation appointment={appointment} />
            <VisitForms appointment={appointment} />
          </div>
          <div className="visit-money">
            <div className="receipt-line">
              <span>Service</span>
              <strong>{money(appointment.bookedPriceMinor, state.organisation)}</strong>
            </div>
            <div className="receipt-line subtle">
              <span>{sandbox ? 'Demo deposit recorded' : 'Deposit recorded'}</span>
              <span>{money(deposit, state.organisation)}</span>
            </div>
          </div>
          {(appointment.status === 'cancelled' || appointment.status === 'no_show') && (
            <div className="deposit-review">
              <strong>Deposit review remains open</strong>
              <p>
                The original deposit and relationship history are retained. No refund, fee or sale
                was recorded for this change.
              </p>
            </div>
          )}
          {(appointment.status === 'confirmed' || messageLink) && (
            <div className="visit-actions" role="group" aria-label="Manage this visit">
              {appointment.status === 'confirmed' && (
                <button
                  type="button"
                  className="visit-action"
                  disabled={!allowed('reschedule')}
                  onClick={() => changeMode('move')}
                >
                  <CalendarClock size={18} aria-hidden="true" />
                  <span>Move appointment</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
              {messageLink}
              {appointment.status === 'confirmed' && (
                <button
                  type="button"
                  className="visit-action"
                  disabled={!allowed('cancel')}
                  onClick={() => changeMode('cancel')}
                >
                  <CircleX size={18} aria-hidden="true" />
                  <span>Cancel appointment</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
              {appointment.status === 'confirmed' && appointment.date <= today && (
                <button
                  type="button"
                  className="visit-action"
                  disabled={!allowed('no-show')}
                  onClick={() => changeMode('no-show')}
                >
                  <UserX size={18} aria-hidden="true" />
                  <span>Mark as missed</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {cardTaking && <VisitCardPanel appointmentId={appointment.id} />}
          {storeMode === 'server' && appointment.status === 'confirmed' && (
            <GuestLinkPanel appointmentId={appointment.id} />
          )}
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            {appointment.status === 'confirmed' && appointment.date > today && (
              <span className="subtle dialog-footer-note">Arrival opens on the visit day.</span>
            )}
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Close
            </Button>
            {appointment.status === 'confirmed' && appointment.date === today && (
              <Button disabled={!allowed('arrive')} onClick={welcome}>
                {busy ? 'Saving…' : 'Welcome client'}
              </Button>
            )}
            {appointment.status === 'arrived' && (
              <Button disabled={!allowed('checkout')} onClick={() => setCheckout(true)}>
                Continue to checkout
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Banknote, ChevronRight, ReceiptText, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { returnable } from '../domain/retail'
import { useStore } from '../state/context'
import { depositPaid } from '../domain/commands'
import { operations, can } from '../domain/operations'
import { dateLabel, money, wholeMoney } from '../domain/format'
import { parseMinor } from '../domain/money'
import {
  Button,
  ErrorMessage,
  Modal,
  Status,
  PageHeader,
  SegmentedControl,
  Stat,
  Stats,
} from '../design'
import '../components/management.css'
import { TillCount } from '../components/TillCount'
import { CardRefund } from '../components/CardPayments'
import { CarriedBalances } from '../components/Switching'
import { PlansLedger } from '../components/Plans'
import { giftCards, refundableOnReceipt } from '../domain/giftCards'

const methodLabel = (method: string) =>
  ({
    demo_card: 'Simulated card',
    demo_cash: 'Simulated cash',
    cash: 'Cash recorded',
    external_card: 'External card recorded',
    card: 'Card through SALEANE',
    previous_system: 'Paid before switching',
  })[method] ?? method

export function Money() {
  const { state, commit, blocked, role, session } = useStore()
  const config = operations(state)
  const sandbox = config.mode === 'sandbox'
  const [tab, setTab] = useState<
    'receipts' | 'funds' | 'deposits' | 'refunds' | 'carried' | 'plans'
  >('receipts')
  const carried = !!config.balances?.length
  const plans = !!state.holdings?.length
  const [receiptId, setReceiptId] = useState('')
  const [refund, setRefund] = useState(false)
  const [depositId, setDepositId] = useState('')
  const [cardRefundId, setCardRefundId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [shownDays, setShownDays] = useState(5)
  const receipt = state.sales.find((sale) => sale.id === receiptId)
  const refundedPayment = state.payments.find((payment) => payment.id === cardRefundId)
  const paymentRefunded = (paymentId: string) =>
    config.refunds
      .filter((item) => item.paymentId === paymentId)
      .reduce((total, item) => total + item.amountMinor, 0)
  // A card receipt can return only what the card paid; a deposit was its own charge.
  const cardRefundable = (saleId: string) => {
    const sale = state.sales.find((item) => item.id === saleId)
    if (!sale || sale.method !== 'card') return 0
    const toCard = config.refunds
      .filter((item) => item.saleId === saleId && item.method === 'card')
      .reduce((total, item) => total + item.amountMinor, 0)
    return Math.max(
      0,
      Math.min(sale.balanceMinor - toCard, refundableOnReceipt(sale) - refundFor(saleId)),
    )
  }
  const visit = state.appointments.find((appointment) => appointment.id === receipt?.appointmentId)
  const depositVisit = state.appointments.find((appointment) => appointment.id === depositId)
  const refundFor = (saleId: string) =>
    config.refunds
      .filter((item) => item.saleId === saleId)
      .reduce((total, item) => total + item.amountMinor, 0)
  const retained = (appointmentId: string) =>
    Math.max(
      0,
      depositPaid(state, appointmentId) -
        state.sales
          .filter((sale) => sale.appointmentId === appointmentId)
          .reduce((total, sale) => total + sale.depositAppliedMinor, 0),
    )
  const depositAppointments = state.appointments.filter(
    (appointment) =>
      retained(appointment.id) > 0 ||
      (['confirmed', 'arrived'].includes(appointment.status) &&
        depositPaid(state, appointment.id) < appointment.bookedDepositMinor),
  )
  const received = state.payments.reduce((total, payment) => total + payment.amountMinor, 0)
  const refunded = config.refunds.reduce((total, item) => total + item.amountMinor, 0)
  const deposits = state.appointments.reduce(
    (total, appointment) => total + retained(appointment.id),
    0,
  )
  const format = (amount: number) => money(amount, state.organisation, true)
  const locale = state.organisation.locale
  const serviceName = (appointmentId: string) =>
    state.services.find(
      (service) =>
        service.id ===
        state.appointments.find((appointment) => appointment.id === appointmentId)?.serviceId,
    )?.name ?? 'Visit'
  // V2: products sold without a visit appear on their day beside the visit receipts.
  const counterByDay = (state.counterSales ?? []).reduce<
    Record<string, NonNullable<typeof state.counterSales>>
  >((days, sale) => {
    ;(days[sale.paidAt.slice(0, 10)] ??= []).push(sale)
    return days
  }, {})
  const visitDays = state.sales.reduce<Record<string, typeof state.sales>>((days, sale) => {
    ;(days[sale.paidAt.slice(0, 10)] ??= []).push(sale)
    return days
  }, {})
  const receiptDays = [...new Set([...Object.keys(visitDays), ...Object.keys(counterByDay)])]
    .sort((a, b) => b.localeCompare(a))
    .map(
      (day) =>
        [
          day,
          (visitDays[day] ?? []).sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
          counterByDay[day] ?? [],
        ] as const,
    )
  const counterRefunded = (counterSaleId: string) =>
    operations(state)
      .refunds.filter((r) => r.counterSaleId === counterSaleId)
      .reduce((sum, r) => sum + r.amountMinor, 0)
  const clientName = (appointmentId: string) =>
    state.clients.find(
      (client) =>
        client.id ===
        state.appointments.find((appointment) => appointment.id === appointmentId)?.clientId,
    )?.name ?? 'Client'
  function close() {
    if (!pending) {
      setReceiptId('')
      setRefund(false)
      setDepositId('')
      setCardRefundId('')
      setError('')
    }
  }
  async function recordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!receipt || pending || blocked || !can(role, 'refund')) return
    const data = new FormData(event.currentTarget)
    if (data.get('confirmed') !== 'on') {
      setError('Tick the box to confirm where this refund was made first.')
      return
    }
    // V2: products the guest brought back, to go back on the shelf.
    const restock = returnable(state, receipt.id)
      .map((line) => ({
        productId: line.productId,
        quantity: Number(data.get(`back-${line.productId}`) ?? 0),
      }))
      .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0)
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'refund',
        saleId: receipt.id,
        ...(restock.length ? { restock } : {}),
        amountMinor: parseMinor(data.get('amount')),
        reason: String(data.get('reason') ?? '').trim(),
        reference: String(data.get('reference') ?? '').trim(),
        method: String(data.get('method')) as 'cash' | 'external_card' | 'demo_cash' | 'demo_card',
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRefund(false)
      setNotice(
        sandbox
          ? 'Simulated refund recorded. No money moved.'
          : 'Refund recorded. SALEANE did not move any money.',
      )
    } catch {
      setError('The record could not be saved. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  async function recordDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!depositVisit || pending || blocked || !can(role, 'deposit')) return
    const data = new FormData(event.currentTarget)
    if (data.get('confirmed') !== 'on') {
      setError('Tick the box to confirm this money has already been received first.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'deposit',
        appointmentId: depositVisit.id,
        amountMinor: parseMinor(data.get('amount')),
        method: String(data.get('method')) as 'cash' | 'external_card' | 'demo_cash' | 'demo_card',
        reference: String(data.get('reference') ?? '').trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDepositId('')
      setNotice(
        sandbox
          ? 'Simulated deposit recorded. No money moved.'
          : 'Deposit recorded. No payment provider was contacted.',
      )
    } catch {
      setError('The record could not be saved. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="money-page">
      <PageHeader
        variant="compact"
        eyebrow="Business"
        title="Money, clearly."
        description="Receipts, recorded funds and the deposits still held for a visit."
      />
      <div className="ops-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>
            {sandbox
              ? 'Made-up money in a sample studio.'
              : 'A record of money taken at the desk or elsewhere.'}
          </strong>
          <p>
            {sandbox
              ? 'All payments and refunds here are simulated. No real money is collected or returned.'
              : session?.services.payments
                ? 'Card payments and refunds through SALEANE are confirmed by the payment provider. Cash and outside card payments are recorded by hand. Matching to the bank is not connected yet.'
                : 'Card payments through SALEANE are in test mode and move no money. Cash and outside card payments are recorded by hand. Matching to the bank is not connected yet.'}
          </p>
        </div>
      </div>
      <Stats>
        <Stat
          label={sandbox ? 'Simulated funds received' : 'Funds recorded'}
          value={wholeMoney(received, state.organisation)}
          detail={
            state.payments.some((p) => p.method === 'previous_system')
              ? `Includes ${format(
                  state.payments
                    .filter((p) => p.method === 'previous_system')
                    .reduce((total, p) => total + p.amountMinor, 0),
                )} paid to your old system before switching`
              : 'Deposits and payments, each counted once'
          }
        />
        <Stat
          label="Unapplied deposits"
          value={wholeMoney(deposits, state.organisation)}
          detail="Includes cancelled and missed visits awaiting review"
        />
        <Stat
          label={sandbox ? 'Simulated refunds' : 'External refunds recorded'}
          value={wholeMoney(refunded, state.organisation)}
          detail={`Net recorded funds: ${format(received - refunded)}`}
        />
      </Stats>
      <SegmentedControl
        label="Money records"
        className="ops-switch"
        value={tab}
        onChange={(value) => {
          setTab(value)
          setError('')
        }}
        options={[
          { value: 'receipts', label: 'Receipts' },
          { value: 'funds', label: 'Recorded funds' },
          { value: 'deposits', label: 'Deposit review' },
          { value: 'refunds', label: 'Refund records' },
          ...(carried ? [{ value: 'carried' as const, label: 'Carried over' }] : []),
          ...(plans ? [{ value: 'plans' as const, label: 'Plans' }] : []),
        ]}
      />
      <p className="ops-save-note" role="status">
        {receipt ? '' : notice}
      </p>
      <div className="ops-layout">
        <section className="surface ops-panel">
          <header>
            <div>
              <h2>
                {tab === 'receipts'
                  ? 'A record of every settled visit'
                  : tab === 'funds'
                    ? 'Funds ledger'
                    : tab === 'deposits'
                      ? 'Deposits to follow through'
                      : tab === 'carried'
                        ? 'Balances from your old system'
                        : tab === 'plans'
                          ? 'Packages and memberships'
                          : 'Refund history'}
              </h2>
              <p>
                {tab === 'receipts'
                  ? 'Open a receipt to review the original amounts.'
                  : tab === 'funds'
                    ? 'Recorded payment methods and references. This is not a bank statement.'
                    : tab === 'deposits'
                      ? 'A cancellation keeps its deposit history; it does not decide a refund or fee.'
                      : tab === 'carried'
                        ? 'Credit and money owed brought across when you switched. Close each one once it is used, paid or returned.'
                        : tab === 'plans'
                          ? 'What clients have paid for plans, what they have used and what is still to come.'
                          : 'Separate records preserve the original receipt.'}
              </p>
            </div>
            <ReceiptText size={22} />
          </header>
          {tab === 'receipts' && (
            <>
              {receiptDays.slice(0, shownDays).map(([day, sales, counter]) => (
                <section className="receipt-day" key={day} aria-label={dateLabel(day, locale)}>
                  <h3 className="receipt-day-heading">
                    <span>{dateLabel(day, locale)}</span>
                    <span>
                      {format(
                        [...sales, ...counter].reduce((total, sale) => total + sale.totalMinor, 0),
                      )}
                    </span>
                  </h3>
                  {counter.map((sale) => (
                    <Link className="receipt-row" key={sale.id} to="/business/stock">
                      <span className="receipt-row-copy">
                        <strong>Products without a visit</strong>
                        <small>
                          {sale.retail.lines.map((line) => line.name).join(', ')} ·{' '}
                          {methodLabel(sale.method)} · {sale.receiptNumber}
                          {counterRefunded(sale.id) > 0
                            ? ` · ${format(counterRefunded(sale.id))} refunded`
                            : ''}
                        </small>
                      </span>
                      <span className="ops-record-money">{format(sale.totalMinor)}</span>
                      <ChevronRight size={16} />
                    </Link>
                  ))}
                  {sales.map((sale) => (
                    <button
                      type="button"
                      className="receipt-row"
                      key={sale.id}
                      onClick={() => {
                        setReceiptId(sale.id)
                        setRefund(false)
                        setError('')
                      }}
                    >
                      <span className="receipt-row-copy">
                        <span className="sr-only">View receipt for </span>
                        <strong>{clientName(sale.appointmentId)}</strong>
                        <small>
                          {serviceName(sale.appointmentId)} · {methodLabel(sale.method)}
                          {sale.receiptNumber ? ` · ${sale.receiptNumber}` : ''}
                          {refundFor(sale.id) > 0
                            ? ` · ${format(refundFor(sale.id))} refunded`
                            : ''}
                        </small>
                      </span>
                      <span className="ops-record-money">{format(sale.totalMinor)}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              ))}
              {receiptDays.length > shownDays && (
                <Button variant="quiet" onClick={() => setShownDays((days) => days + 7)}>
                  Show earlier receipts
                </Button>
              )}
              {!receiptDays.length && (
                <EmptyMoney
                  title="The first receipt starts with a visit."
                  detail="Check out a client who has arrived to record a sale."
                />
              )}
            </>
          )}
          {tab === 'funds' && (
            <>
              {state.payments
                .slice()
                .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
                .map((payment) => (
                  <div className="ops-record" key={payment.id}>
                    <Banknote size={21} />
                    <div className="ops-record-copy">
                      <strong>
                        {clientName(payment.appointmentId)} ·{' '}
                        {payment.kind === 'deposit'
                          ? 'Deposit'
                          : payment.kind === 'fee'
                            ? 'Missed visit fee'
                            : 'Settlement'}
                      </strong>
                      <small>
                        {methodLabel(payment.method)} ·{' '}
                        {dateLabel(payment.recordedAt.slice(0, 10), state.organisation.locale)}
                      </small>
                      <small>
                        {payment.reference
                          ? `Reference: ${payment.reference}`
                          : 'No external reference recorded'}
                      </small>
                    </div>
                    <span className="ops-record-money">{format(payment.amountMinor)}</span>
                    {payment.method === 'card' &&
                      payment.kind !== 'settlement' &&
                      can(role, 'refund') &&
                      paymentRefunded(payment.id) < payment.amountMinor &&
                      (payment.kind === 'fee' ||
                        state.appointments.find((a) => a.id === payment.appointmentId)?.status ===
                          'cancelled') && (
                        <Button
                          variant="quiet"
                          disabled={blocked}
                          onClick={() => {
                            setCardRefundId(payment.id)
                            setError('')
                          }}
                        >
                          Refund to card
                        </Button>
                      )}
                  </div>
                ))}
              {!state.payments.length && (
                <EmptyMoney
                  title="No funds recorded yet."
                  detail="Deposits and payments you record will appear here."
                />
              )}
            </>
          )}
          {tab === 'deposits' && (
            <>
              {depositAppointments.map((appointment) => {
                const paid = depositPaid(state, appointment.id)
                const outstanding = Math.max(0, appointment.bookedDepositMinor - paid)
                const terminal =
                  appointment.status === 'cancelled' || appointment.status === 'no_show'
                return (
                  <div className="ops-record" key={appointment.id}>
                    <div className="ops-record-copy">
                      <strong>{clientName(appointment.id)}</strong>
                      <small>
                        {dateLabel(appointment.date, state.organisation.locale)} ·{' '}
                        {
                          state.services.find((service) => service.id === appointment.serviceId)
                            ?.name
                        }
                      </small>
                      <small>
                        {format(retained(appointment.id))} retained
                        {outstanding && !terminal
                          ? ` · ${format(outstanding)} still to record`
                          : ''}
                      </small>
                      {terminal && (
                        <small>
                          Policy review required. This screen does not refund or forfeit the
                          deposit.
                        </small>
                      )}
                    </div>
                    <div className="ops-record-controls">
                      <Status status={appointment.status} />
                      {outstanding > 0 && !terminal && (
                        <Button
                          variant="secondary"
                          disabled={!can(role, 'deposit') || blocked}
                          onClick={() => {
                            setDepositId(appointment.id)
                            setError('')
                          }}
                        >
                          Record deposit
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {!depositAppointments.length && (
                <EmptyMoney
                  title="No outstanding deposit review."
                  detail="Unapplied deposits and visits with unrecorded deposits appear here."
                />
              )}
            </>
          )}
          {tab === 'carried' && <CarriedBalances />}
          {tab === 'plans' && <PlansLedger />}
          {tab === 'refunds' && (
            <>
              {config.refunds
                .slice()
                .reverse()
                .map((entry) => {
                  const sale = state.sales.find((item) => item.id === entry.saleId)
                  return (
                    <div className="ops-record" key={entry.id}>
                      <div className="ops-record-copy">
                        <strong>
                          {sale ? clientName(sale.appointmentId) : 'Receipt'} · {entry.reason}
                        </strong>
                        <small>
                          Reference: {entry.reference} ·{' '}
                          {sandbox ? 'Simulated' : 'Recorded externally'}
                        </small>
                        <small>
                          {dateLabel(entry.createdAt.slice(0, 10), state.organisation.locale)} ·{' '}
                          {entry.actor}
                        </small>
                      </div>
                      <span className="ops-record-money">−{format(entry.amountMinor)}</span>
                    </div>
                  )
                })}
              {!config.refunds.length && (
                <EmptyMoney
                  title="No refunds recorded."
                  detail="Open a paid receipt to record a refund you have already given back."
                />
              )}
            </>
          )}
        </section>
        <aside className="ops-aside">
          <h2>The numbers should agree.</h2>
          <p>A deposit is part-payment. Applying it at checkout does not collect it again.</p>
          <p>
            Treatment takings, tips, refunds and deposits not yet used mean different things, so
            each is shown on its own.
          </p>
          <p>
            {session?.services.payments
              ? 'Card payments taken through SALEANE appear here only once the payment provider confirms them.'
              : 'Card payments run in test mode until a payment provider is connected. Test payments move no money.'}
          </p>
        </aside>
      </div>
      <TillCount />
      {receipt && (
        <Modal
          open
          placement="side"
          onClose={close}
          title={refund ? (sandbox ? 'Record a simulated refund' : 'Record a refund') : 'Receipt'}
          description={`${clientName(receipt.appointmentId)} · ${receipt.receiptNumber ?? receipt.id}`}
        >
          <p className="ops-save-note" role="status">
            {notice}
          </p>
          <div className="ops-receipt">
            <div>
              <span>
                {visit
                  ? (visit.bookedServiceName ??
                    state.services.find((item) => item.id === visit.serviceId)?.name)
                  : 'Treatment'}
              </span>
              <strong>{format(receipt.serviceMinor)}</strong>
            </div>
            {!!receipt.discountMinor && (
              <div>
                <span>Discount</span>
                <strong>−{format(receipt.discountMinor)}</strong>
              </div>
            )}
            {!!receipt.taxMinor && (
              <div>
                <span>
                  {receipt.taxLabel ?? 'Tax'}
                  {receipt.taxInclusive ? ' (included)' : ''}
                </span>
                <strong>{format(receipt.taxMinor)}</strong>
              </div>
            )}
            {receipt.retail?.lines.map((line) => (
              <div key={line.productId}>
                <span>
                  {line.quantity > 1 ? `${line.quantity} × ` : ''}
                  {line.name}
                </span>
                <strong>{format(line.quantity * line.unitMinor)}</strong>
              </div>
            ))}
            {!!receipt.retail?.taxMinor && (
              <div>
                <span>
                  {receipt.retail.taxLabel || 'Tax'} on products
                  {receipt.retail.taxInclusive ? ' (included)' : ''}
                </span>
                <strong>{format(receipt.retail.taxMinor)}</strong>
              </div>
            )}
            <div>
              <span>Tip</span>
              <strong>{format(receipt.tipMinor)}</strong>
            </div>
            <div>
              <span>Deposit applied</span>
              <strong>{format(receipt.depositAppliedMinor)}</strong>
            </div>
            {!!receipt.coveredMinor && (
              <div>
                <span>Paid by a package or membership</span>
                <strong>{format(receipt.coveredMinor)}</strong>
              </div>
            )}
            {!!receipt.giftCardMinor && (
              <div>
                <span>
                  Paid by gift card{' '}
                  {giftCards(state).find((c) => c.id === receipt.giftCardId)?.code ?? ''}
                </span>
                <strong>{format(receipt.giftCardMinor)}</strong>
              </div>
            )}
            <div>
              <span>Collected at checkout</span>
              <strong>{format(receipt.balanceMinor)}</strong>
            </div>
            <div className="ops-total">
              <span>Total sale</span>
              <strong>{format(receipt.totalMinor)}</strong>
            </div>
            <div>
              <span>Refunds recorded</span>
              <strong>{format(refundFor(receipt.id))}</strong>
            </div>
          </div>
          <p className="ops-help">
            {methodLabel(receipt.method)}
            {receipt.reference ? ` · ${receipt.reference}` : ''}.{' '}
            {sandbox
              ? 'Simulated receipt; no real payment.'
              : receipt.method === 'card'
                ? receipt.processor?.live
                  ? 'Paid by card; the payment provider confirmed it.'
                  : 'Paid with a test card; no money moved.'
                : 'A receipt for money recorded by hand; no card company was involved.'}
          </p>
          {visit && (
            <Link className="text-link" onClick={close} to={`/clients/${visit.clientId}`}>
              Open client page
            </Link>
          )}
          {refund && receipt.method === 'card' && cardRefundable(receipt.id) > 0 ? (
            <CardRefund
              target={{ saleId: receipt.id }}
              maxMinor={cardRefundable(receipt.id)}
              testMode={!receipt.processor?.live}
              onDone={() => {
                setRefund(false)
                setNotice('Refunded to the card. The refund is on the receipt.')
              }}
            />
          ) : refund ? (
            <form onSubmit={recordRefund} aria-busy={pending}>
              <h3 className="ops-section-title">Record the refund</h3>
              <p className="ops-editor-note">
                {sandbox
                  ? 'This adds a fictional refund entry. No real funds move.'
                  : 'Use only after returning the funds through your bank, terminal or cash process. Saving this form does not issue a refund.'}
              </p>
              <div className="ops-fields">
                <label>
                  Amount ({state.organisation.currency})
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max={(refundableOnReceipt(receipt) - refundFor(receipt.id)) / 100}
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Returned as
                  <select
                    name="method"
                    defaultValue={
                      sandbox
                        ? receipt.method === 'demo_cash'
                          ? 'demo_cash'
                          : 'demo_card'
                        : receipt.method === 'cash'
                          ? 'cash'
                          : 'external_card'
                    }
                  >
                    {sandbox ? (
                      <>
                        <option value="demo_cash">Simulated cash</option>
                        <option value="demo_card">Simulated card</option>
                      </>
                    ) : (
                      <>
                        <option value="cash">Cash from the till</option>
                        <option value="external_card">Card or bank, outside SALEANE</option>
                      </>
                    )}
                  </select>
                </label>
                <label>
                  External reference
                  <input
                    name="reference"
                    required
                    maxLength={150}
                    placeholder={sandbox ? 'Simulation reference' : 'Terminal or bank reference'}
                  />
                </label>
                <label className="ops-wide">
                  Reason
                  <textarea name="reason" required minLength={3} maxLength={300} rows={2} />
                </label>
                {returnable(state, receipt.id)
                  .filter((line) => line.left > 0)
                  .map((line) => (
                    <label key={line.productId}>
                      {line.name} back on the shelf
                      <input
                        name={`back-${line.productId}`}
                        type="number"
                        min={0}
                        max={line.left}
                        defaultValue={0}
                      />
                    </label>
                  ))}
              </div>
              <label className="ops-check">
                <input type="checkbox" name="confirmed" required />
                {sandbox
                  ? 'I understand this is a simulated refund.'
                  : 'I confirm this money has already been given back outside SALEANE.'}
              </label>
              <ErrorMessage error={error} />
              <div className="ops-actions">
                <Button type="submit" disabled={pending || blocked}>
                  {pending ? 'Recording…' : 'Record refund'}
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setRefund(false)}>
                  Back to receipt
                </Button>
              </div>
            </form>
          ) : (
            // The front desk reads receipts; refunds are for owners and managers (the server agrees).
            can(role, 'refund') && (
              <div className="ops-actions">
                <Button
                  variant="secondary"
                  disabled={blocked || refundFor(receipt.id) >= refundableOnReceipt(receipt)}
                  onClick={() => {
                    setRefund(true)
                    setError('')
                  }}
                >
                  {sandbox
                    ? 'Record simulated refund'
                    : receipt.method === 'card' && cardRefundable(receipt.id) > 0
                      ? 'Refund to the card'
                      : 'Record external refund'}
                </Button>
              </div>
            )
          )}
        </Modal>
      )}
      {refundedPayment && (
        <Modal
          open
          onClose={close}
          title="Refund to the card"
          description={`${clientName(refundedPayment.appointmentId)} · ${refundedPayment.kind === 'fee' ? 'Missed visit fee' : 'Deposit'}`}
        >
          <CardRefund
            target={{ paymentId: refundedPayment.id }}
            maxMinor={refundedPayment.amountMinor - paymentRefunded(refundedPayment.id)}
            testMode={!refundedPayment.processor?.live}
            onDone={() => {
              setCardRefundId('')
              setNotice('Refunded to the card. It is listed under refund records.')
            }}
          />
        </Modal>
      )}
      {depositVisit && (
        <Modal
          open
          onClose={close}
          title={sandbox ? 'Record a simulated deposit' : 'Record a deposit'}
          description={`${clientName(depositVisit.id)} · ${dateLabel(depositVisit.date, state.organisation.locale)}`}
        >
          <form onSubmit={recordDeposit} aria-busy={pending}>
            <p className="ops-editor-note">
              {sandbox
                ? 'This is a simulated payment. No real money moves.'
                : 'Record money already received. SALEANE will not charge a card or contact a card company.'}
            </p>
            <div className="ops-fields">
              <label>
                Amount ({state.organisation.currency})
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  max={
                    (depositVisit.bookedDepositMinor - depositPaid(state, depositVisit.id)) / 100
                  }
                  defaultValue={
                    (depositVisit.bookedDepositMinor - depositPaid(state, depositVisit.id)) / 100
                  }
                />
              </label>
              <label>
                Method
                <select name="method">
                  {sandbox ? (
                    <>
                      <option value="demo_cash">Simulated cash</option>
                      <option value="demo_card">Simulated card</option>
                    </>
                  ) : (
                    <>
                      <option value="cash">Cash received</option>
                      <option value="external_card">External card payment</option>
                    </>
                  )}
                </select>
              </label>
              <label className="ops-wide">
                Reference
                <input
                  name="reference"
                  maxLength={150}
                  placeholder="Required for an external card payment"
                />
              </label>
            </div>
            <label className="ops-check">
              <input type="checkbox" name="confirmed" required />
              {sandbox
                ? 'I understand this is a simulated deposit.'
                : 'I confirm this money has already been received outside SALEANE.'}
            </label>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending || blocked}>
                {pending ? 'Recording…' : 'Record deposit'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function EmptyMoney({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ops-no-records">
      <ReceiptText size={27} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  )
}

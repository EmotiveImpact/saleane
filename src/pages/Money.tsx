import { useState } from 'react'
import type { FormEvent } from 'react'
import { Banknote, ReceiptText, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { depositPaid } from '../domain/commands'
import { operations, can } from '../domain/operations'
import { dateLabel, money } from '../domain/format'
import { parseMinor } from '../domain/money'
import { Button, ErrorMessage, Modal, Status } from '../components/ui'
import '../components/management.css'

const methodLabel = (method: string) =>
  ({
    demo_card: 'Simulated card',
    demo_cash: 'Simulated cash',
    cash: 'Cash recorded',
    external_card: 'External card recorded',
  })[method] ?? method

export function Money() {
  const { state, commit, blocked, role } = useStore()
  const config = operations(state)
  const sandbox = config.mode === 'sandbox'
  const [tab, setTab] = useState<'receipts' | 'funds' | 'deposits' | 'refunds'>('receipts')
  const [receiptId, setReceiptId] = useState('')
  const [refund, setRefund] = useState(false)
  const [depositId, setDepositId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const receipt = state.sales.find((sale) => sale.id === receiptId)
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
      setError('')
    }
  }
  async function recordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!receipt || pending || blocked || !can(role, 'refund')) return
    const data = new FormData(event.currentTarget)
    if (data.get('confirmed') !== 'on') {
      setError('Confirm the provenance of this refund first.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'refund',
        saleId: receipt.id,
        amountMinor: parseMinor(data.get('amount')),
        reason: String(data.get('reason') ?? '').trim(),
        reference: String(data.get('reference') ?? '').trim(),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRefund(false)
      setNotice(
        sandbox
          ? 'Simulated refund recorded. No money moved.'
          : 'External refund recorded. Saleane did not move any money.',
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
      setError('Confirm the provenance of these funds first.')
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
      <div className="page-heading">
        <div>
          <p className="date-caption">Every amount, with a source</p>
          <h1>Money, clearly.</h1>
          <p>Receipts, recorded funds and the deposits still held for a visit.</p>
        </div>
      </div>
      <div className="ops-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>
            {sandbox
              ? 'Fictional money in a sandbox.'
              : 'A local record of funds handled elsewhere.'}
          </strong>
          <p>
            {sandbox
              ? 'All payments and refunds here are simulated. No real money is collected or returned.'
              : 'Cash and external card activity can be recorded. Payment collection, refunds through a provider and bank reconciliation are unconfigured.'}
          </p>
        </div>
      </div>
      <div className="ops-summary">
        <div>
          <span>{sandbox ? 'Simulated funds received' : 'Funds recorded'}</span>
          <strong>{format(received)}</strong>
          <small>Deposits and settlements counted once</small>
        </div>
        <div>
          <span>Unapplied deposits</span>
          <strong>{format(deposits)}</strong>
          <small>Includes cancelled and missed visits awaiting review</small>
        </div>
        <div>
          <span>{sandbox ? 'Simulated refunds' : 'External refunds recorded'}</span>
          <strong>{format(refunded)}</strong>
          <small>Net recorded funds: {format(received - refunded)}</small>
        </div>
      </div>
      <div className="ops-tabs" role="group" aria-label="Money records">
        {(['receipts', 'funds', 'deposits', 'refunds'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value)
              setError('')
            }}
          >
            {value === 'receipts'
              ? 'Receipts'
              : value === 'funds'
                ? 'Recorded funds'
                : value === 'deposits'
                  ? 'Deposit review'
                  : 'Refund records'}
          </button>
        ))}
      </div>
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
                      : 'Refund history'}
              </h2>
              <p>
                {tab === 'receipts'
                  ? 'Open a receipt to review the original amounts.'
                  : tab === 'funds'
                    ? 'Recorded payment methods and references. This is not a bank statement.'
                    : tab === 'deposits'
                      ? 'A cancellation keeps its deposit history; it does not decide a refund or fee.'
                      : 'Separate records preserve the original receipt.'}
              </p>
            </div>
            <ReceiptText size={22} />
          </header>
          {tab === 'receipts' && (
            <>
              {state.sales
                .slice()
                .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
                .map((sale) => (
                  <div className="ops-record" key={sale.id}>
                    <div className="ops-record-copy">
                      <strong>{clientName(sale.appointmentId)}</strong>
                      <small>
                        {sale.receiptNumber ?? sale.id} · {methodLabel(sale.method)}
                      </small>
                      <small>
                        {dateLabel(sale.paidAt.slice(0, 10), state.organisation.locale)}
                        {refundFor(sale.id) > 0 ? ` · ${format(refundFor(sale.id))} refunded` : ''}
                      </small>
                    </div>
                    <div className="ops-record-controls">
                      <span className="ops-record-money">{format(sale.totalMinor)}</span>
                      <Button
                        variant="secondary"
                        aria-label={`View receipt for ${clientName(sale.appointmentId)}`}
                        onClick={() => {
                          setReceiptId(sale.id)
                          setRefund(false)
                          setError('')
                        }}
                      >
                        View
                        <span className="sr-only">
                          {' '}
                          receipt for {clientName(sale.appointmentId)}
                        </span>
                      </Button>
                    </div>
                  </div>
                ))}
              {!state.sales.length && (
                <EmptyMoney
                  title="The first receipt starts with a visit."
                  detail="Complete checkout from an arrived appointment to record a sale."
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
                        {payment.kind === 'deposit' ? 'Deposit' : 'Settlement'}
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
                  </div>
                ))}
              {!state.payments.length && (
                <EmptyMoney
                  title="No funds recorded yet."
                  detail="Recorded deposits and checkout settlements will appear here."
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
                  detail="Open a settled receipt to record a refund already handled externally, or a simulation in the sandbox."
                />
              )}
            </>
          )}
        </section>
        <aside className="ops-aside">
          <h2>The numbers should agree.</h2>
          <p>A deposit is part-payment. Applying it at checkout does not collect it again.</p>
          <p>
            Service revenue, tips, refunds and unapplied deposits have different meanings. Keep each
            source visible.
          </p>
          <p>Live payment services remain unconfigured.</p>
        </aside>
      </div>
      {receipt && (
        <Modal
          open
          placement="side"
          onClose={close}
          title={
            refund
              ? sandbox
                ? 'Record a simulated refund'
                : 'Record an external refund'
              : 'Receipt'
          }
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
                  : 'Service'}
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
            <div>
              <span>Tip</span>
              <strong>{format(receipt.tipMinor)}</strong>
            </div>
            <div>
              <span>Deposit applied</span>
              <strong>{format(receipt.depositAppliedMinor)}</strong>
            </div>
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
              : 'A local receipt for manually recorded funds; provider reconciliation is unconfigured.'}
          </p>
          {visit && (
            <Link className="text-link" onClick={close} to={`/clients/${visit.clientId}`}>
              Open client relationship
            </Link>
          )}
          {refund ? (
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
                    max={(receipt.totalMinor - refundFor(receipt.id)) / 100}
                    step="0.01"
                    required
                  />
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
              </div>
              <label className="ops-check">
                <input type="checkbox" name="confirmed" required />
                {sandbox
                  ? 'I understand this is a simulated refund.'
                  : 'I confirm these funds have already been returned outside Saleane.'}
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
            <div className="ops-actions">
              <Button
                variant="secondary"
                disabled={
                  !can(role, 'refund') || blocked || refundFor(receipt.id) >= receipt.totalMinor
                }
                onClick={() => {
                  setRefund(true)
                  setError('')
                }}
              >
                {sandbox ? 'Record simulated refund' : 'Record external refund'}
              </Button>
            </div>
          )}
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
                ? 'This is a fictional payment entry. No real funds move.'
                : 'Record funds already received. Saleane will not charge a card or contact a payment provider.'}
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
                : 'I confirm these funds have already been received outside Saleane.'}
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

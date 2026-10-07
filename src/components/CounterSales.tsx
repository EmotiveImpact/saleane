import { useState } from 'react'
import type { FormEvent } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { priceRetail, retailCharge, returnable } from '../domain/retail'
import type { CounterSale, RetailItems } from '../domain/retailSchema'
import { Button, ErrorMessage, Modal } from '../design'
import { CheckoutProducts } from './CheckoutProducts'

/**
 * V2: products sold to someone without a visit, and money back when they return one. Paid in
 * cash or on the studio's own card terminal; SALEANE records the sale and moves no money.
 */
type Method = CounterSale['method']
const METHOD_LABEL: Record<Method, string> = {
  demo_card: 'Demo card',
  demo_cash: 'Demo cash',
  cash: 'Cash',
  external_card: 'Own card terminal',
}

function useRun() {
  const { commit } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command) {
    if (pending) return false
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      return result.ok
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error, setError }
}

export function CounterSales() {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const sandbox = operations(state).mode === 'sandbox'
  const [selling, setSelling] = useState(false)
  const [returning, setReturning] = useState<CounterSale | null>(null)
  const [notice, setNotice] = useState('')
  const sales = [...(state.counterSales ?? [])]
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    .slice(0, 8)
  const refunded = (saleId: string) =>
    operations(state)
      .refunds.filter((r) => r.counterSaleId === saleId)
      .reduce((sum, r) => sum + r.amountMinor, 0)
  const clientName = (id?: string) => state.clients.find((c) => c.id === id)?.name
  const staffName = (id?: string) => state.staff.find((p) => p.id === id)?.name
  return (
    <section className="surface ops-panel" aria-labelledby="counter-heading">
      <header>
        <div>
          <h2 id="counter-heading">Sold without a visit</h2>
          <p>
            For someone who pops in for a product. Take the money in cash or on your own card
            terminal, then record it here so the stock and the till stay right.
          </p>
        </div>
        <ShoppingBag size={21} aria-hidden="true" />
      </header>
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      {sales.length > 0 && (
        <div className="ops-ledger">
          {sales.map((sale) => {
            const back = refunded(sale.id)
            return (
              <div className="ops-record" key={sale.id}>
                <div className="ops-record-copy">
                  <strong>
                    {sale.retail.lines
                      .map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ''}${l.name}`)
                      .join(', ')}
                  </strong>
                  <small>
                    {dateLabel(sale.paidAt.slice(0, 10), org.locale)} · {sale.receiptNumber} ·{' '}
                    {METHOD_LABEL[sale.method]}
                    {clientName(sale.clientId) ? ` · ${clientName(sale.clientId)}` : ''}
                    {staffName(sale.staffId) ? ` · sold by ${staffName(sale.staffId)}` : ''}
                    {back ? ` · ${money(back, org, true)} given back` : ''}
                  </small>
                </div>
                <span className="ops-record-money">{money(sale.totalMinor, org, true)}</span>
                {can(role, 'refund') && back < sale.totalMinor && (
                  <Button
                    variant="quiet"
                    disabled={blocked}
                    aria-label={`Give money back for receipt ${sale.receiptNumber}`}
                    onClick={() => {
                      setReturning(sale)
                      setNotice('')
                    }}
                  >
                    Give money back
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {can(role, 'counter-sale') && (
        <div className="ops-actions">
          <Button
            disabled={blocked}
            onClick={() => {
              setSelling(true)
              setNotice('')
            }}
          >
            <ShoppingBag size={16} aria-hidden="true" /> Sell without a visit
          </Button>
        </div>
      )}
      {selling && (
        <SellDialog
          sandbox={sandbox}
          onClose={() => setSelling(false)}
          onDone={(sale) => {
            setSelling(false)
            setNotice(
              `Receipt ${sale} recorded. ${sandbox ? 'Demo sale: no money moved.' : 'SALEANE did not take the money; it records what you took.'}`,
            )
          }}
        />
      )}
      {returning && (
        <ReturnDialog
          sale={returning}
          refundedMinor={refunded(returning.id)}
          sandbox={sandbox}
          onClose={() => setReturning(null)}
          onDone={() => {
            setReturning(null)
            setNotice(
              sandbox
                ? 'Simulated refund recorded. No money moved.'
                : 'Refund recorded. SALEANE did not move any money.',
            )
          }}
        />
      )}
    </section>
  )
}

function SellDialog({
  sandbox,
  onClose,
  onDone,
}: {
  sandbox: boolean
  onClose: () => void
  onDone: (receiptNumber: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const { run, pending, error, setError } = useRun()
  const [items, setItems] = useState<RetailItems>([])
  const [clientId, setClientId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [method, setMethod] = useState<Method>(sandbox ? 'demo_cash' : 'cash')
  const [reference, setReference] = useState('')
  const [collected, setCollected] = useState(false)
  let retail: ReturnType<typeof priceRetail>
  let problem = ''
  try {
    retail = priceRetail(state, items)
  } catch (caught) {
    problem = caught instanceof Error ? caught.message : 'Check the products.'
  }
  const total = retailCharge(retail)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!items.length) {
      setError('Add a product.')
      return
    }
    if (!sandbox && !collected) {
      setError('Confirm the money has been taken.')
      return
    }
    const before = state.counterSales?.length ?? 0
    if (
      await run({
        type: 'counter-sale',
        ...(clientId ? { clientId } : {}),
        ...(staffId ? { staffId } : {}),
        products: items,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
    )
      onDone(`SC-${before + 1}`)
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Sell without a visit"
      description="Products are priced with your current tax and must be in stock."
    >
      <form onSubmit={save} className="plan-form">
        <CheckoutProducts items={items} retail={retail} disabled={pending} onChange={setItems} />
        <div className="ops-fields">
          <label className="ops-wide">
            Client (optional)
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client record</option>
              {[...state.clients]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sold by
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Not recorded</option>
              {state.staff
                .filter((person) => !person.archived)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Paid by
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as Method)
                setCollected(false)
              }}
            >
              {sandbox ? (
                <>
                  <option value="demo_cash">Demo cash</option>
                  <option value="demo_card">Demo card</option>
                </>
              ) : (
                <>
                  <option value="cash">Cash</option>
                  <option value="external_card">Own card terminal</option>
                </>
              )}
            </select>
          </label>
          {!sandbox && (
            <label>
              Reference {method === 'external_card' ? '(required)' : '(optional)'}
              <input
                value={reference}
                maxLength={150}
                required={method === 'external_card'}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="receipt-line total">
          <span>{sandbox ? 'To collect' : 'Taken'}</span>
          <strong>{money(total, org, true)}</strong>
        </div>
        {!sandbox && (
          <label className="ops-check">
            <input
              type="checkbox"
              checked={collected}
              onChange={(e) => setCollected(e.target.checked)}
            />
            I confirm the money has already been taken outside SALEANE.
          </label>
        )}
        <ErrorMessage error={problem || error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !items.length || !!problem}>
            {pending ? 'Recording…' : 'Record the sale'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ReturnDialog({
  sale,
  refundedMinor,
  sandbox,
  onClose,
  onDone,
}: {
  sale: CounterSale
  refundedMinor: number
  sandbox: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const { run, pending, error, setError } = useRun()
  const lines = returnable(state, sale.id)
  const [back, setBack] = useState<Record<string, number>>({})
  const [amount, setAmount] = useState(minorInput(sale.totalMinor - refundedMinor))
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = parseMinor(amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError('Enter the amount given back, with up to two decimal places.')
      return
    }
    if (!confirmed) {
      setError(
        sandbox ? 'Confirm this is a simulated refund.' : 'Confirm the money has been given back.',
      )
      return
    }
    const restock = Object.entries(back)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }))
    if (
      await run({
        type: 'refund',
        counterSaleId: sale.id,
        amountMinor,
        reason: reason.trim(),
        reference: reference.trim(),
        method: sale.method,
        ...(restock.length ? { restock } : {}),
      })
    )
      onDone()
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Give money back"
      description={`Receipt ${sale.receiptNumber}, paid ${METHOD_LABEL[sale.method].toLowerCase()}. Up to ${money(sale.totalMinor - refundedMinor, org, true)} can be given back.`}
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          {lines
            .filter((line) => line.left > 0)
            .map((line) => (
              <label key={line.productId}>
                {line.name} back on the shelf
                <input
                  type="number"
                  min={0}
                  max={line.left}
                  value={back[line.productId] ?? 0}
                  onChange={(e) => setBack({ ...back, [line.productId]: Number(e.target.value) })}
                />
                <small>Leave at 0 if it cannot be sold again.</small>
              </label>
            ))}
          <label>
            Amount ({org.currency})
            <input
              inputMode="decimal"
              value={amount}
              required
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Reference
            <input
              value={reference}
              required
              maxLength={150}
              placeholder={sandbox ? 'Simulation reference' : 'Terminal or till reference'}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="ops-wide">
            Reason
            <input
              value={reason}
              required
              minLength={3}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {sandbox
            ? 'I understand this is a simulated refund.'
            : 'I confirm the money has already been given back outside SALEANE.'}
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record the refund'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

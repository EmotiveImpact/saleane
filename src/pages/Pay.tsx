import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, Wallet } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can } from '../domain/operations'
import { addDays, dateLabel, money } from '../domain/format'
import { payCsv, payPeriod, rateFor, rateHistory } from '../domain/pay'
import type { PaySummary } from '../domain/pay'
import type { Staff } from '../domain/model'
import { rentalOn } from '../domain/rent'
import { RentPanel } from '../components/RentPanel'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, SegmentedControl } from '../design'
import '../components/management.css'
import '../stock.css'
import '../pay.css'

/**
 * V2: commission and tips per person for a month. SALEANE works out what each person has earned;
 * the studio pays them through its own payroll. Owners set the rates; managers can see them.
 */
type Period = 'this' | 'last'

const percent = (bps: number) =>
  `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`

/** "40" or "12.5" as basis points; NaN when it is not a percentage. */
function parsePercent(value: string) {
  const trimmed = value.trim().replace(/%$/, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return NaN
  const bps = Math.round(Number(trimmed) * 100)
  return bps <= 10000 ? bps : NaN
}

function monthRange(today: string, period: Period) {
  const first = `${today.slice(0, 7)}-01`
  if (period === 'this') return { from: first, to: today }
  const to = addDays(first, -1)
  return { from: `${to.slice(0, 7)}-01`, to }
}

export function Pay() {
  const { state, role } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const [period, setPeriod] = useState<Period>('this')
  const [open, setOpen] = useState<string | null>(null)
  const [rating, setRating] = useState<Staff | null>(null)
  const [notice, setNotice] = useState('')
  const { from, to } = monthRange(today, period)
  const rows = payPeriod(state, from, to)
  const total = (pick: (row: PaySummary) => number) => rows.reduce((sum, row) => sum + pick(row), 0)
  const canRate = can(role, 'pay-rate')
  const monthName = new Date(`${from}T12:00:00Z`).toLocaleDateString(org.locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  function download() {
    const csv = payCsv(rows, from, to, org.currency)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `saleane-pay-${from}-to-${to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="pay-page">
      <PageHeader
        variant="compact"
        title="What the team has earned."
        description="Commission on services and products, and tips, for each person. SALEANE works it out; you pay people through your own payroll."
        actions={
          <Button variant="secondary" onClick={download}>
            <Download size={16} aria-hidden="true" /> Download for payroll
          </Button>
        }
      />
      <SegmentedControl
        label="Period"
        className="ops-switch"
        value={period}
        onChange={(value) => {
          setPeriod(value)
          setOpen(null)
        }}
        options={[
          { value: 'this', label: 'This month' },
          { value: 'last', label: 'Last month' },
        ]}
      />
      <p className="pay-range">
        {monthName}
        {period === 'this' ? `, up to ${dateLabel(to, org.locale)}` : ''}
      </p>
      <dl className="stock-totals">
        <div>
          <dt>Commission</dt>
          <dd>
            {money(
              total((row) => row.commissionMinor),
              org,
              true,
            )}
          </dd>
        </div>
        <div>
          <dt>Tips</dt>
          <dd>
            {money(
              total((row) => row.tipsMinor),
              org,
              true,
            )}
          </dd>
        </div>
        <div>
          <dt>Owed to the team</dt>
          <dd>
            {money(
              total((row) => row.owedMinor),
              org,
              true,
            )}
            <small>Before any deductions</small>
          </dd>
        </div>
      </dl>
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <section className="surface ops-panel" aria-labelledby="team-pay-heading">
        <header>
          <div>
            <h2 id="team-pay-heading">Each person</h2>
            <p>
              Counted without tax and after discounts. Money given back comes off in the month it is
              given back. Tips go in full to the person who did the visit.
            </p>
          </div>
          <Wallet size={21} aria-hidden="true" />
        </header>
        <div className="ops-ledger">
          {rows.map((row) => {
            const rate = rateFor(state, row.staff.id, to)
            const expanded = open === row.staff.id
            return (
              <div className="pay-person" key={row.staff.id}>
                <div className="ops-record pay-record">
                  <Avatar
                    small
                    identity={row.staff.id}
                    name={row.staff.name}
                    tone={row.staff.tone}
                  />
                  <div className="ops-record-copy">
                    <strong>{row.staff.name}</strong>
                    <small>
                      {row.visits} {row.visits === 1 ? 'visit' : 'visits'} ·{' '}
                      {rentalOn(state, row.staff.id, to)
                        ? 'Rents a chair or room, keeps own takings'
                        : rate
                          ? `${percent(rate.serviceBps)} on services, ${percent(rate.productBps)} on products`
                          : 'No commission rate set'}
                    </small>
                  </div>
                  <dl className="pay-figures">
                    <div>
                      <dt>Commission</dt>
                      <dd>{money(row.commissionMinor, org, true)}</dd>
                    </div>
                    <div>
                      <dt>Tips</dt>
                      <dd>{money(row.tipsMinor, org, true)}</dd>
                    </div>
                    <div>
                      <dt>Owed</dt>
                      <dd>
                        <strong>{money(row.owedMinor, org, true)}</strong>
                      </dd>
                    </div>
                  </dl>
                  <div className="stock-actions">
                    <Button
                      variant="quiet"
                      aria-label={`${expanded ? 'Hide' : 'Details'} for ${row.staff.name}`}
                      aria-expanded={expanded}
                      aria-controls={`pay-lines-${row.staff.id}`}
                      onClick={() => setOpen(expanded ? null : row.staff.id)}
                    >
                      {expanded ? 'Hide' : 'Details'}
                    </Button>
                    {canRate && (
                      <Button
                        variant="quiet"
                        aria-label={`Rates for ${row.staff.name}`}
                        onClick={() => {
                          setRating(row.staff)
                          setNotice('')
                        }}
                      >
                        Rates
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="pay-lines" id={`pay-lines-${row.staff.id}`}>
                    <p className="pay-sums">
                      Services {money(row.servicesMinor, org, true)} · Products{' '}
                      {money(row.productsMinor, org, true)}
                      {row.givenBackMinor
                        ? ` · Given back ${money(row.givenBackMinor, org, true)}`
                        : ''}
                    </p>
                    {row.lines.length ? (
                      <ul>
                        {row.lines.map((line, i) => (
                          <li key={`${line.receipt}-${line.label}-${i}`}>
                            <span>
                              <strong>{line.label}</strong>
                              <small>
                                {dateLabel(line.date, org.locale, true)}
                                {line.receipt ? ` · ${line.receipt}` : ''}
                                {line.servicesMinor
                                  ? ` · services ${money(line.servicesMinor, org, true)}`
                                  : ''}
                                {line.productsMinor
                                  ? ` · products ${money(line.productsMinor, org, true)}`
                                  : ''}
                                {line.tipMinor ? ` · tip ${money(line.tipMinor, org, true)}` : ''}
                              </small>
                            </span>
                            <span className="ops-record-money">
                              {money(line.commissionMinor, org, true)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="subtle">Nothing earned in this period yet.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
      <RentPanel from={from} to={to} />
      {rating && (
        <RateDialog
          staff={rating}
          today={today}
          onClose={() => setRating(null)}
          onDone={(message) => {
            setRating(null)
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}

function RateDialog({
  staff,
  today,
  onClose,
  onDone,
}: {
  staff: Staff
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const current = rateFor(state, staff.id, today)
  const [services, setServices] = useState(current ? String(current.serviceBps / 100) : '')
  const [products, setProducts] = useState(current ? String(current.productBps / 100) : '')
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const history = rateHistory(state, staff.id)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const serviceBps = parsePercent(services)
    const productBps = parsePercent(products)
    if (!Number.isFinite(serviceBps) || !Number.isFinite(productBps)) {
      setError('Enter each rate as a percentage from 0 to 100, such as 40 or 12.5.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setError('Choose the date the new rates start.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'pay-rate',
        staffId: staff.id,
        serviceBps,
        productBps,
        from,
      })
      if (!result.ok) setError(result.error)
      else
        onDone(
          `${staff.name} is on ${percent(serviceBps)} on services and ${percent(productBps)} on products from ${dateLabel(from, org.locale)}.`,
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
      title={`Commission for ${staff.name}`}
      description="New rates apply to visits and sales from the date you choose. Earlier rates are kept, so past months do not change unless the new date reaches back into them."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label>
            On services (%)
            <input
              inputMode="decimal"
              value={services}
              required
              onChange={(e) => setServices(e.target.value)}
            />
          </label>
          <label>
            On products (%)
            <input
              inputMode="decimal"
              value={products}
              required
              onChange={(e) => setProducts(e.target.value)}
            />
          </label>
          <label>
            Starting
            <input type="date" value={from} required onChange={(e) => setFrom(e.target.value)} />
          </label>
        </div>
        {history.length > 0 && (
          <div className="pay-history">
            <h3>Earlier rates</h3>
            <ul>
              {history.map((rate) => (
                <li key={rate.id}>
                  From {dateLabel(rate.from, org.locale)}: {percent(rate.serviceBps)} on services,{' '}
                  {percent(rate.productBps)} on products
                  <small>Set by {rate.actor}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the rates'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

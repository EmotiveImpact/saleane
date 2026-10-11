import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, Wallet } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import { addDays, dateLabel, money, wholeMoney } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { payCsv, payPeriod, rateFor, rateHistory, rulesFor, rulesHistory } from '../domain/pay'
import type { PaySummary, TargetProgress } from '../domain/pay'
import {
  STEP_KIND_SENTENCE,
  commissionBasis,
  commissionRates,
  commissionSteps,
  itemName,
  ownRatesOn,
  parsePercent,
  percent,
  progressPercent,
  stepsPhrase,
  stepsRecord,
  targetFor,
  targetHistory,
} from '../domain/commission'
import { MOST_STEPS, treatmentKinds } from '../domain/commissionSchema'
import type {
  CommissionRate,
  CommissionSteps,
  RateItem,
  StaffTarget,
} from '../domain/commissionSchema'
import type { Staff } from '../domain/model'
import type { PayRules } from '../domain/operations'
import { rentalOn } from '../domain/rent'
import { RentPanel } from '../components/RentPanel'
import { HoursPanel } from '../components/HoursPanel'
import { hoursPeriod } from '../domain/hours'
import {
  Avatar,
  Button,
  ErrorMessage,
  Modal,
  PageHeader,
  SegmentedControl,
  Stat,
  Stats,
} from '../design'
import '../components/management.css'
import '../stock.css'
import '../pay.css'
import { StudioDateField } from '../components/StudioDateField'

/**
 * V2: commission and tips per person for a month. SALEANE works out what each person has earned;
 * the studio pays them through its own payroll. Owners set the rates; managers can see them.
 * Stage 3: rates for a treatment, a kind of treatment, products or one product; steps by takings;
 * and a monthly target for each person, which owners and managers set.
 */
type Period = 'this' | 'last'

function monthRange(today: string, period: Period) {
  const first = `${today.slice(0, 7)}-01`
  if (period === 'this') return { from: first, to: today }
  const to = addDays(first, -1)
  return { from: `${to.slice(0, 7)}-01`, to }
}

/** "October 2026". */
function monthWords(month: string, locale: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The month a number of months from another, "2026-10" and 1 is "2026-11". */
function monthFrom(month: string, by: number) {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** A year back to a year ahead, for choosing the month a change starts. */
function MonthField({
  label,
  value,
  today,
  onChange,
}: {
  label: string
  value: string
  today: string
  onChange: (month: string) => void
}) {
  const { state } = useStore()
  const here = today.slice(0, 7)
  const months = Array.from({ length: 25 }, (_, i) => monthFrom(here, i - 12))
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {months.map((month) => (
          <option key={month} value={month}>
            {monthWords(month, state.organisation.locale)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Runs one command for a dialog, keeping what was typed when it fails. */
function useSave() {
  const { commit } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function save(command: Parameters<typeof commit>[0]) {
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
  return { save, pending, error, setError }
}

export function Pay() {
  const { state, role } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const [period, setPeriod] = useState<Period>('this')
  const [open, setOpen] = useState<string | null>(null)
  const [rating, setRating] = useState<Staff | null>(null)
  const [targeting, setTargeting] = useState<Staff | null>(null)
  const [dialog, setDialog] = useState<'rules' | 'own' | 'steps' | null>(null)
  const [notice, setNotice] = useState('')
  const { from, to } = monthRange(today, period)
  const rows = payPeriod(state, from, to)
  const total = (pick: (row: PaySummary) => number) => rows.reduce((sum, row) => sum + pick(row), 0)
  const canRate = can(role, 'pay-rate')
  const canRules = can(role, 'pay-rules')
  const canTarget = can(role, 'staff-target')
  const rules = rulesFor(state, to)
  const monthName = monthWords(from.slice(0, 7), org.locale)
  const opening = (open: () => void) => () => {
    open()
    setNotice('')
  }
  const done = (message: string) => {
    setDialog(null)
    setRating(null)
    setTargeting(null)
    setNotice(message)
  }

  function download() {
    const csv = payCsv(rows, from, to, org.currency, hoursPeriod(state, from, to))
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
        eyebrow="Business"
        title="What the team has earned."
        description="Commission and tips for each person. SALEANE works it out; you pay people through your own payroll."
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
      <Stats>
        <Stat
          label="Commission"
          value={wholeMoney(
            total((row) => row.commissionMinor),
            org,
          )}
        />
        <Stat
          label="Tips"
          value={wholeMoney(
            total((row) => row.tipsMinor),
            org,
          )}
        />
        <Stat
          label="Owed to the team"
          value={wholeMoney(
            total((row) => row.owedMinor),
            org,
          )}
          detail="Before any deductions"
        />
      </Stats>
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <section className="surface ops-panel" aria-labelledby="team-pay-heading">
        <header>
          <div>
            <h2 id="team-pay-heading">Each person</h2>
            <p>Counted without tax and after discounts. {rulesSentence(rules)}</p>
          </div>
          <Wallet size={21} aria-hidden="true" />
        </header>
        {(canRules || canRate) && (
          <div className="ops-actions pay-owner-actions">
            {canRules && (
              <Button variant="secondary" onClick={opening(() => setDialog('rules'))}>
                Tips and money given back
              </Button>
            )}
            {canRate && (
              <Button variant="secondary" onClick={opening(() => setDialog('own'))}>
                Rates for treatments and products
              </Button>
            )}
            {canRate && (
              <Button variant="secondary" onClick={opening(() => setDialog('steps'))}>
                Steps by takings
              </Button>
            )}
          </div>
        )}
        <div className="ops-ledger">
          {rows.map((row) => {
            const expanded = open === row.staff.id
            const rentsNow = rentalOn(state, row.staff.id, to)
            // Visits while renting earn no commission, but they still happened.
            const renting = state.appointments.filter(
              (a) =>
                a.staffId === row.staff.id &&
                a.status === 'completed' &&
                a.date >= from &&
                a.date <= to &&
                rentalOn(state, a.staffId, a.date),
            ).length
            const visits = (n: number) => `${n} ${n === 1 ? 'visit' : 'visits'}`
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
                      {!renting
                        ? visits(row.visits)
                        : row.visits
                          ? `${visits(row.visits)} on commission, ${renting} while renting`
                          : `${visits(renting)} while renting`}{' '}
                      ·{' '}
                      {rentsNow
                        ? 'Rents a chair or room, keeps own takings'
                        : commissionBasis(state, row.staff.id, to)}
                    </small>
                    {row.target && <TargetLine target={row.target} ended={period !== 'this'} />}
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
                      variant="secondary"
                      aria-label={`${expanded ? 'Hide' : 'Details'} for ${row.staff.name}`}
                      aria-expanded={expanded}
                      aria-controls={`pay-lines-${row.staff.id}`}
                      onClick={() => setOpen(expanded ? null : row.staff.id)}
                    >
                      {expanded ? 'Hide' : 'Details'}
                    </Button>
                    {canRate && (
                      <Button
                        variant="secondary"
                        aria-label={`Rates for ${row.staff.name}`}
                        onClick={opening(() => setRating(row.staff))}
                      >
                        Rates
                      </Button>
                    )}
                    {canTarget && !rentsNow && !row.staff.archived && (
                      <Button
                        variant="secondary"
                        aria-label={`Target for ${row.staff.name}`}
                        onClick={opening(() => setTargeting(row.staff))}
                      >
                        Target
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="pay-lines" id={`pay-lines-${row.staff.id}`}>
                    {row.parts.length > 0 && (
                      <div className="pay-how">
                        <h3>How commission was worked out</h3>
                        <ul>
                          {row.parts.map((part) => (
                            <li key={part.label}>
                              <span>
                                <strong>{part.label}</strong>
                                <small>
                                  {part.takingsMinor < 0
                                    ? `${money(-part.takingsMinor, org, true)} given back`
                                    : `On ${money(part.takingsMinor, org, true)} of takings`}
                                </small>
                              </span>
                              <span className="ops-record-money">
                                {money(part.commissionMinor, org, true)}
                              </span>
                            </li>
                          ))}
                          <li className="pay-how-total">
                            <strong>Commission</strong>
                            <strong className="ops-record-money">
                              {money(row.commissionMinor, org, true)}
                            </strong>
                          </li>
                        </ul>
                      </div>
                    )}
                    <p className="pay-sums">
                      Treatments {money(row.servicesMinor, org, true)} · Products{' '}
                      {money(row.productsMinor, org, true)}
                      {row.givenBackMinor
                        ? ` · Given back ${money(row.givenBackMinor, org, true)}`
                        : ''}
                    </p>
                    {row.lines.length ? (
                      <ul aria-label={`Receipts for ${row.staff.name}`}>
                        {row.lines.map((line, i) => (
                          <li key={`${line.receipt}-${line.label}-${i}`}>
                            <span>
                              <strong>{line.label}</strong>
                              <small>
                                {dateLabel(line.date, org.locale, true)}
                                {line.receipt ? ` · ${line.receipt}` : ''}
                                {line.servicesMinor
                                  ? ` · treatments ${money(line.servicesMinor, org, true)}`
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
      <HoursPanel from={from} to={to} />
      <RentPanel from={from} to={to} />
      {dialog === 'rules' && (
        <RulesDialog today={today} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'own' && (
        <OwnRatesDialog today={today} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'steps' && (
        <StepsDialog today={today} onClose={() => setDialog(null)} onDone={done} />
      )}
      {rating && (
        <RateDialog staff={rating} today={today} onClose={() => setRating(null)} onDone={done} />
      )}
      {targeting && (
        <TargetDialog
          staff={targeting}
          month={from.slice(0, 7)}
          today={today}
          onClose={() => setTargeting(null)}
          onDone={done}
        />
      )}
    </div>
  )
}

/** A target's progress in one line, with the thin bar Business uses. */
function TargetLine({ target, ended }: { target: TargetProgress; ended: boolean }) {
  const { state } = useStore()
  const org = state.organisation
  const cash = (minor: number) => wholeMoney(minor, org)
  const share = progressPercent(target.takenMinor, target.targetMinor)
  const parts = [
    target.treatmentsTargetMinor
      ? `treatments ${cash(target.treatmentsMinor)} of ${cash(target.treatmentsTargetMinor)}`
      : '',
    target.productsTargetMinor
      ? `products ${cash(target.productsMinor)} of ${cash(target.productsTargetMinor)}`
      : '',
  ].filter(Boolean)
  return (
    <span className="pay-target">
      <small>
        Target {cash(target.targetMinor)} · {cash(target.takenMinor)}
        {ended ? '' : ' so far'}, {share}%{parts.length ? ` · ${parts.join(', ')}` : ''}
      </small>
      <span className="performance-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, share)}%` }} />
      </span>
    </span>
  )
}

const POOL_WORD = { day: 'day', week: 'week (Monday to Sunday)', month: 'month' } as const

function rulesSentence(rules: Pick<PayRules, 'refunds' | 'tips' | 'pool'>) {
  const back =
    rules.refunds === 'commission'
      ? 'Money given back comes off the commission in the month it is given back.'
      : 'Money given back is paid by the studio and does not change commission.'
  const tips =
    rules.tips === 'person'
      ? 'Tips go in full to the person who did the job.'
      : `Tips are shared equally between everyone who did a visit that ${POOL_WORD[rules.pool]}.`
  return `${back} ${tips}`
}

function RulesDialog({
  today,
  onClose,
  onDone,
}: {
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const current = rulesFor(state, today)
  const [refunds, setRefunds] = useState<PayRules['refunds']>(current.refunds)
  const [tips, setTips] = useState<PayRules['tips']>(current.tips)
  const [pool, setPool] = useState<PayRules['pool']>(current.pool)
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const history = rulesHistory(state)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setError('Choose the date the new settings start.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'pay-rules', rules: { refunds, tips, pool, from } })
      if (!result.ok) setError(result.error)
      else onDone(`From ${dateLabel(from, org.locale)}: ${rulesSentence({ refunds, tips, pool })}`)
    } catch {
      setError('This could not be saved. Your choices are still here; try again.')
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
      title="Tips and money given back"
      description="New settings apply from the date you choose. Earlier settings are kept, so past months do not change unless the new date reaches back into them."
    >
      <form onSubmit={save} className="plan-form">
        <fieldset className="pay-choice">
          <legend>When money is given back to a client</legend>
          <label>
            <input
              type="radio"
              name="refunds"
              checked={refunds === 'commission'}
              onChange={() => setRefunds('commission')}
            />
            It comes off the commission of the person who did the job (usual)
          </label>
          <label>
            <input
              type="radio"
              name="refunds"
              checked={refunds === 'studio'}
              onChange={() => setRefunds('studio')}
            />
            The studio pays it and their commission stays the same
          </label>
        </fieldset>
        <fieldset className="pay-choice">
          <legend>Tips</legend>
          <label>
            <input
              type="radio"
              name="tips"
              checked={tips === 'person'}
              onChange={() => setTips('person')}
            />
            Go in full to the person who did the job (usual)
          </label>
          <label>
            <input
              type="radio"
              name="tips"
              checked={tips === 'pool'}
              onChange={() => setTips('pool')}
            />
            Go into a shared pot, split equally between everyone who did a visit
          </label>
          {tips === 'pool' && (
            <label className="pay-pool">
              Share the pot each
              <select value={pool} onChange={(e) => setPool(e.target.value as PayRules['pool'])}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          )}
          <small>
            The studio never keeps any of the tips. The law says they belong to the team.
          </small>
        </fieldset>
        <label>
          Starting
          <StudioDateField value={from} required onChange={setFrom} />
        </label>
        {history.length > 0 && (
          <div className="pay-history">
            <h3>Earlier settings</h3>
            <ul>
              {history.map((rules) => (
                <li key={rules.id}>
                  From {dateLabel(rules.from, org.locale)}: {rulesSentence(rules)}
                  <small>Set by {rules.actor}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the settings'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
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
          `${staff.name} is on ${percent(serviceBps)} on treatments and ${percent(productBps)} on products from ${dateLabel(from, org.locale)}.`,
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
      description="Their usual rates. New rates apply to visits and sales from the date you choose. Earlier rates are kept, so past months do not change unless the new date reaches back into them. A rate for a treatment or product, or steps by takings, takes the place of these where it applies."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label>
            On treatments (%)
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
            <StudioDateField value={from} required onChange={setFrom} />
          </label>
        </div>
        {history.length > 0 && (
          <div className="pay-history">
            <h3>Earlier rates</h3>
            <ul>
              {history.map((rate) => (
                <li key={rate.id}>
                  From {dateLabel(rate.from, org.locale)}: {percent(rate.serviceBps)} on treatments,{' '}
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

const everyone = 'Everyone'
/** The item a select's value stands for: "treatment:<id>", "category:Skin", "products". */
function itemOf(key: string): RateItem | undefined {
  const [kind, value] = key.split(':')
  if (kind === 'treatment' && value) return { kind, serviceId: value }
  if (kind === 'category' && (treatmentKinds as readonly string[]).includes(value))
    return { kind, category: value as (typeof treatmentKinds)[number] }
  if (kind === 'product' && value) return { kind, productId: value }
  if (kind === 'products') return { kind }
  return undefined
}

/**
 * Stage 3: rates for one treatment, a kind of treatment, products in general or one product, for
 * everyone or one person. The most specific rate wins (see `commission.ts`). Owner only.
 */
function OwnRatesDialog({
  today,
  onClose,
  onDone,
}: {
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const team = state.staff.filter((p) => !p.archived)
  const treatments = state.services.filter((x) => !x.archived)
  const products = operations(state).products.filter((x) => !x.archived && x.forSale !== false)
  const { save, pending, error, setError } = useSave()
  const [who, setWho] = useState('')
  const [item, setItem] = useState(treatments[0] ? `treatment:${treatments[0].id}` : 'products')
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [ending, setEnding] = useState<CommissionRate | null>(null)
  const [endFrom, setEndFrom] = useState(today)
  const personName = (id?: string) =>
    id ? (state.staff.find((p) => p.id === id)?.name ?? 'Someone') : everyone
  const inForce = ownRatesOn(state, today)
  const later = commissionRates(state).filter((r) => r.from > today)
  const history = commissionRates(state)
    .map((r, order) => ({ r, order }))
    .sort((a, b) => b.r.from.localeCompare(a.r.from) || b.order - a.order)
    .map(({ r }) => r)
  const describe = (r: CommissionRate) =>
    `${itemName(state, r.item)}, ${r.staffId ? personName(r.staffId) : 'everyone'}: ${
      r.bps === null ? 'back to the usual rate' : percent(r.bps)
    }`

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const chosen = itemOf(item)
    const bps = parsePercent(rate)
    if (!chosen || !Number.isFinite(bps)) {
      setError('Choose what the rate is for and enter it as a percentage, such as 45 or 12.5.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setError('Choose the date the rate starts.')
      return
    }
    if (
      await save({
        type: 'commission-rate',
        input: { ...(who ? { staffId: who } : {}), item: chosen, bps, from },
      })
    )
      onDone(
        `${itemName(state, chosen)} earns ${percent(bps)} for ${who ? personName(who) : 'everyone'} from ${dateLabel(from, org.locale)}.`,
      )
  }

  async function end(rate: CommissionRate) {
    if (
      await save({
        type: 'commission-rate',
        input: {
          ...(rate.staffId ? { staffId: rate.staffId } : {}),
          item: rate.item,
          bps: null,
          from: endFrom,
        },
      })
    )
      onDone(
        `${itemName(state, rate.item)} goes back to the usual rate for ${rate.staffId ? personName(rate.staffId) : 'everyone'} from ${dateLabel(endFrom, org.locale)}.`,
      )
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Rates for treatments and products"
      description="A rate set here takes the place of the usual rate and of any steps for that treatment or product. The most specific rate wins: one person and one treatment first, then that treatment for everyone, then the person’s rate for the kind of treatment or for products, then everyone’s."
    >
      <div className="pay-history">
        <h3>In force today</h3>
        {inForce.length ? (
          <ul>
            {inForce.map((r) => (
              <li key={r.id} className="pay-rate-row">
                <span>
                  {describe(r)}
                  <small>
                    From {dateLabel(r.from, org.locale)} · set by {r.actor}
                  </small>
                </span>
                {ending?.id === r.id ? (
                  <span className="pay-end">
                    <StudioDateField value={endFrom} min={r.from} onChange={setEndFrom} />
                    <Button disabled={pending} onClick={() => void end(r)}>
                      End from this day
                    </Button>
                    <Button variant="quiet" disabled={pending} onClick={() => setEnding(null)}>
                      Keep it
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    aria-label={`End the rate for ${itemName(state, r.item)}, ${personName(r.staffId)}`}
                    onClick={() => {
                      setEnding(r)
                      setEndFrom(today < r.from ? r.from : today)
                    }}
                  >
                    End
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">No rates of their own yet. Everyone is on their usual rates.</p>
        )}
        {later.length > 0 && (
          <>
            <h3>Starting later</h3>
            <ul>
              {later.map((r) => (
                <li key={r.id}>
                  From {dateLabel(r.from, org.locale)}: {describe(r)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <form onSubmit={add} className="plan-form">
        <h3 className="pay-form-heading">Add a rate</h3>
        <div className="ops-fields">
          <label>
            For
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            On
            <select value={item} onChange={(e) => setItem(e.target.value)}>
              <optgroup label="One treatment">
                {treatments.map((x) => (
                  <option key={x.id} value={`treatment:${x.id}`}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="A kind of treatment">
                {treatmentKinds.map((kind) => (
                  <option key={kind} value={`category:${kind}`}>
                    {kind} treatments
                  </option>
                ))}
              </optgroup>
              <optgroup label="Products">
                <option value="products">Products in general</option>
                {products.map((x) => (
                  <option key={x.id} value={`product:${x.id}`}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Rate (%)
            <input
              inputMode="decimal"
              value={rate}
              required
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <label>
            Starting
            <StudioDateField value={from} required onChange={setFrom} />
          </label>
        </div>
        {history.length > 0 && (
          <details className="pay-earlier">
            <summary>Every change, newest first</summary>
            <ul>
              {history.map((r) => (
                <li key={r.id}>
                  From {dateLabel(r.from, org.locale)}: {describe(r)}
                  <small>Set by {r.actor}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the rate'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  )
}

type StepRow = { from: string; rate: string }
const stepRows = (steps?: CommissionSteps['steps']): StepRow[] =>
  steps
    ? steps.map((step) => ({ from: minorInput(step.fromMinor), rate: String(step.bps / 100) }))
    : [
        { from: '0.00', rate: '' },
        { from: '', rate: '' },
      ]

/**
 * Stage 3: steps by takings, for everyone or one person. Each calendar month's takings count
 * afresh from the first. Owner only.
 */
function StepsDialog({
  today,
  onClose,
  onDone,
}: {
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const team = state.staff.filter((p) => !p.archived)
  const { save, pending, error, setError } = useSave()
  const [month, setMonth] = useState(today.slice(0, 7))
  const first = (who: string, m = month) => stepsRecord(state, who || undefined, `${m}-01`)
  const [who, setWho] = useState('')
  const [kind, setKind] = useState<CommissionSteps['kind']>(first('')?.kind ?? 'marginal')
  const [on, setOn] = useState<CommissionSteps['on']>(first('')?.on ?? 'treatments')
  const [rows, setRows] = useState<StepRow[]>(stepRows(first('')?.steps))
  const current = first(who)
  const personName = (id?: string) =>
    id ? (state.staff.find((p) => p.id === id)?.name ?? 'Someone') : everyone
  const history = commissionSteps(state)
    .map((x, order) => ({ x, order }))
    .sort((a, b) => b.x.from.localeCompare(a.x.from) || b.order - a.order)
    .map(({ x }) => x)
  const parsed = rows.map((row, i) => ({
    fromMinor: i === 0 ? 0 : parseMinor(row.from),
    bps: parsePercent(row.rate),
  }))
  const valid =
    parsed.every((step) => Number.isFinite(step.fromMinor) && Number.isFinite(step.bps)) &&
    parsed.every((step, i) => i === 0 || step.fromMinor > parsed[i - 1].fromMinor)
  const load = (person: string, m = month) => {
    const found = first(person, m)
    setKind(found?.kind ?? 'marginal')
    setOn(found?.on ?? 'treatments')
    setRows(stepRows(found?.steps))
  }
  const forWhom = who ? personName(who) : 'everyone without steps of their own'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) {
      setError(
        'Give each step a rate as a percentage, and each step after the first the takings it starts at, higher than the one before.',
      )
      return
    }
    if (
      await save({
        type: 'commission-steps',
        input: { ...(who ? { staffId: who } : {}), on, kind, steps: parsed, from: `${month}-01` },
      })
    )
      onDone(
        `From ${monthWords(month, org.locale)}, ${forWhom}: ${stepsPhrase(state, { on, kind, steps: parsed })}.`,
      )
  }

  async function stop() {
    if (!current?.steps) return
    if (
      await save({
        type: 'commission-steps',
        input: {
          ...(who ? { staffId: who } : {}),
          on: current.on,
          kind: current.kind,
          steps: null,
          from: `${month}-01`,
        },
      })
    )
      onDone(`Steps stopped for ${forWhom} from ${monthWords(month, org.locale)}.`)
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Steps by takings"
      description="A higher rate once someone’s takings for the month reach a step. Each month starts afresh on the first. Steps take the place of the usual rate; a rate set for a treatment or product still wins, and its takings do not count towards the steps."
    >
      <form onSubmit={submit} className="plan-form">
        <div className="ops-fields">
          <label>
            For
            <select
              value={who}
              onChange={(e) => {
                setWho(e.target.value)
                load(e.target.value)
              }}
            >
              <option value="">Everyone without steps of their own</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <MonthField
            label="Starting"
            value={month}
            today={today}
            onChange={(m) => {
              setMonth(m)
              load(who, m)
            }}
          />
          <label>
            Counting
            <select value={on} onChange={(e) => setOn(e.target.value as CommissionSteps['on'])}>
              <option value="treatments">Treatments only</option>
              <option value="all">Treatments and products together</option>
            </select>
          </label>
        </div>
        <p className="ops-help">
          {current?.steps
            ? `In force for ${forWhom} in ${monthWords(month, org.locale)}: ${stepsPhrase(state, { ...current, steps: current.steps })}.`
            : `No steps for ${forWhom} in ${monthWords(month, org.locale)}.`}
        </p>
        <fieldset className="pay-choice">
          <legend>How the steps pay</legend>
          <label>
            <input
              type="radio"
              name="step-kind"
              checked={kind === 'marginal'}
              onChange={() => setKind('marginal')}
            />
            <span>
              Only the takings above a step (usual)
              <small>{STEP_KIND_SENTENCE.marginal}</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="step-kind"
              checked={kind === 'whole'}
              onChange={() => setKind('whole')}
            />
            <span>
              The whole month, once a step is reached
              <small>{STEP_KIND_SENTENCE.whole}</small>
            </span>
          </label>
        </fieldset>
        <ol className="pay-steps" aria-label="Steps">
          {rows.map((row, i) => (
            <li key={i}>
              <label>
                {i === 0 ? 'From the first sale' : `From takings of (${org.currency})`}
                <input
                  inputMode="decimal"
                  value={i === 0 ? minorInput(0) : row.from}
                  disabled={i === 0}
                  required={i > 0}
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, from: e.target.value } : r)))
                  }
                />
              </label>
              <label>
                Rate (%)
                <input
                  inputMode="decimal"
                  value={row.rate}
                  required
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))
                  }
                />
              </label>
              {i > 1 && (
                <Button
                  variant="quiet"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ol>
        {rows.length < MOST_STEPS && (
          <Button variant="quiet" onClick={() => setRows([...rows, { from: '', rate: '' }])}>
            Add a step
          </Button>
        )}
        {valid && (
          <p className="ops-help" role="status">
            {stepsPhrase(state, { on, kind, steps: parsed })}.
          </p>
        )}
        {history.length > 0 && (
          <details className="pay-earlier">
            <summary>Every change, newest first</summary>
            <ul>
              {history.map((x) => (
                <li key={x.id}>
                  From {monthWords(x.from.slice(0, 7), org.locale)}, {personName(x.staffId)}:{' '}
                  {x.steps ? stepsPhrase(state, { ...x, steps: x.steps }) : 'steps stopped'}
                  <small>Set by {x.actor}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the steps'}
          </Button>
          {current?.steps && (
            <Button variant="secondary" disabled={pending} onClick={() => void stop()}>
              Stop these steps from {monthWords(month, org.locale)}
            </Button>
          )}
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Stage 3: one person's monthly takings target, which owners and managers set. */
function TargetDialog({
  staff,
  month: shown,
  today,
  onClose,
  onDone,
}: {
  staff: Staff
  month: string
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const { save, pending, error, setError } = useSave()
  const [month, setMonth] = useState(shown)
  const current = targetFor(state, staff.id, month)
  const fill = (target?: StaffTarget) => ({
    total: target?.takingsMinor ? minorInput(target.takingsMinor) : '',
    treatments: target?.treatmentsMinor ? minorInput(target.treatmentsMinor) : '',
    products: target?.productsMinor ? minorInput(target.productsMinor) : '',
  })
  const [values, setValues] = useState(fill(current))
  const history = targetHistory(state, staff.id)
  const first = staff.name.split(' ')[0]
  const describe = (target: StaffTarget) =>
    target.takingsMinor === null
      ? 'no target'
      : [
          money(target.takingsMinor, org),
          target.treatmentsMinor ? `treatments ${money(target.treatmentsMinor, org)}` : '',
          target.productsMinor ? `products ${money(target.productsMinor, org)}` : '',
        ]
          .filter(Boolean)
          .join(', ')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const takingsMinor = parseMinor(values.total)
    const treatmentsMinor = parseMinor(values.treatments, 0)
    const productsMinor = parseMinor(values.products, 0)
    if (!Number.isFinite(takingsMinor) || takingsMinor <= 0) {
      setError('Enter the target for the month, with up to two decimal places.')
      return
    }
    if (!Number.isFinite(treatmentsMinor) || !Number.isFinite(productsMinor)) {
      setError('Enter the treatment and product targets as amounts, or leave them empty.')
      return
    }
    if (
      await save({
        type: 'staff-target',
        input: {
          staffId: staff.id,
          from: month,
          takingsMinor,
          ...(treatmentsMinor ? { treatmentsMinor } : {}),
          ...(productsMinor ? { productsMinor } : {}),
        },
      })
    )
      onDone(
        `${first}’s target is ${money(takingsMinor, org)} a month from ${monthWords(month, org.locale)}.`,
      )
  }

  async function stop() {
    if (
      await save({
        type: 'staff-target',
        input: { staffId: staff.id, from: month, takingsMinor: null },
      })
    )
      onDone(`${first} has no target from ${monthWords(month, org.locale)}.`)
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`Target for ${staff.name}`}
      description="Takings for the month, counted the same way as their pay: treatments and products after discounts and without tax, less money given back that comes off their commission. Tips never count. It carries on each month until you change it. They see their own target and progress on their page."
    >
      <form onSubmit={submit} className="plan-form">
        <div className="ops-fields">
          <MonthField
            label="Starting"
            value={month}
            today={today}
            onChange={(m) => {
              setMonth(m)
              setValues(fill(targetFor(state, staff.id, m)))
            }}
          />
          <label>
            Target for the month ({org.currency})
            <input
              inputMode="decimal"
              value={values.total}
              required
              onChange={(e) => setValues({ ...values, total: e.target.value })}
            />
          </label>
          <label>
            Of which treatments (optional)
            <input
              inputMode="decimal"
              value={values.treatments}
              onChange={(e) => setValues({ ...values, treatments: e.target.value })}
            />
          </label>
          <label>
            Of which products (optional)
            <input
              inputMode="decimal"
              value={values.products}
              onChange={(e) => setValues({ ...values, products: e.target.value })}
            />
          </label>
        </div>
        {history.length > 0 && (
          <details className="pay-earlier">
            <summary>Every change, newest first</summary>
            <ul>
              {history.map((target) => (
                <li key={target.id}>
                  From {monthWords(target.from, org.locale)}: {describe(target)}
                  <small>Set by {target.actor}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the target'}
          </Button>
          {current && (
            <Button variant="secondary" disabled={pending} onClick={() => void stop()}>
              Stop the target from {monthWords(month, org.locale)}
            </Button>
          )}
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenCheck, Download } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import { dateLabel, money, wholeMoney } from '../domain/format'
import {
  accountingPayload,
  dailySummary,
  dayJournal,
  dayTakings,
  monthOf,
  moneyCsv,
  moneyInAndOut,
  salesByReceipt,
  salesCsv,
  taxCsv,
  taxSummary,
} from '../domain/accounts'
import { accountingProviders } from '../domain/accountsSchema'
import type { AccountCodes, AccountingProvider } from '../domain/accountsSchema'
import {
  Button,
  Empty,
  ErrorMessage,
  Modal,
  PageHeader,
  SegmentedControl,
  Stat,
  Stats,
  Select,
  photos,
} from '../design'
import '../components/management.css'
import '../pay.css'
import '../rota.css'
import '../stock.css'
import '../accounts.css'

/**
 * V2: what the accountant needs. Spreadsheets for a month, a day-by-day summary, and a batch
 * prepared for Xero or QuickBooks in test mode. Nothing here moves money or leaves SALEANE.
 */
type Period = 'this' | 'last'
const PROVIDER: Record<AccountingProvider, string> = { xero: 'Xero', quickbooks: 'QuickBooks' }
const CODE_LABEL: Record<keyof AccountCodes, string> = {
  services: 'Treatments',
  products: 'Products',
  tax: 'Tax (VAT or sales tax)',
  tips: 'Tips owed to staff',
  plans: 'Packages and memberships',
  rent: 'Chair and room rent',
  fees: 'No-show and late fees',
  refunds: 'Refunds',
  clearing: 'Takings clearing',
  renters: 'Takings held for renters',
}

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function Accounts() {
  const { state, role, blocked, commit } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const [period, setPeriod] = useState<Period>('last')
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const range = period === 'this' ? { from: monthOf(today).from, to: today } : monthOf(today, 1)
  const { from, to } = range
  const days = dailySummary(state, from, to)
  // A studio that has never taken anything meets a welcome, not a month of noughts.
  const untouched =
    !state.sales.length &&
    !state.payments.length &&
    !dailySummary(state, '0000-01-01', today).length
  const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((t, d) => t + pick(d), 0)
  // Stage 3: renters' own takings pass through the till but are held for them, not the studio's.
  const renters = days.some((d) => d.rentersMinor || d.rentersBackMinor)
  const settings = operations(state).accounting
  const batches = [...(operations(state).accountingExports ?? [])].reverse().slice(0, 6)
  const canSettings = !blocked && can(role, 'accounting-settings')
  const canExport = !blocked && can(role, 'accounting-export')
  const fmt = (minor: number) => money(minor, org, true)
  const name = (what: string) => `saleane-${what}-${from}-to-${to}.csv`
  const posted = settings ? days.filter((day) => dayJournal(day, settings.codes).length) : []
  const preview =
    settings && posted.length
      ? JSON.stringify(
          accountingPayload(
            settings.provider,
            posted.slice(0, 1),
            settings.codes,
            org.currency,
            org.name,
          ),
          null,
          2,
        )
      : ''

  async function prepare() {
    if (!settings) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await commit({
        type: 'accounting-export',
        provider: settings.provider,
        from,
        to,
      })
      if (!result.ok) setError(result.error)
      else
        setNotice(
          `Prepared ${posted.length} ${posted.length === 1 ? 'day' : 'days'} for ${PROVIDER[settings.provider]} in test mode. Nothing was sent.`,
        )
    } catch {
      setError('This could not be saved. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="accounts-page">
      {untouched ? (
        <Empty
          photo={photos.windowLight}
          photoPosition="40% center"
          eyebrow="Business"
          level={1}
          title="Ready for your accountant."
        >
          From the first payment you take, each month’s takings, tax, tips and refunds gather here,
          with spreadsheets that open in Excel, Numbers or Google Sheets.
        </Empty>
      ) : (
        <>
          <PageHeader
            variant="compact"
            eyebrow="Business"
            title="For your accountant."
            description="Spreadsheets for the month and a day-by-day summary of takings, tax, tips and refunds."
          />
          <SegmentedControl
            label="Period"
            className="ops-switch"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'last', label: 'Last month' },
              { value: 'this', label: 'This month' },
            ]}
          />
          <p className="pay-range">
            {dateLabel(from, org.locale)} to {dateLabel(to, org.locale)}
          </p>
          <Stats>
            <Stat
              label="Takings"
              value={wholeMoney(sum(dayTakings), org)}
              detail={
                renters
                  ? 'Including tax, tips and renters’ own takings, less refunds'
                  : 'Including tax and tips, less refunds'
              }
            />
            <Stat
              label="Tax"
              value={wholeMoney(
                sum((d) => d.taxMinor),
                org,
              )}
            />
            <Stat
              label="Tips"
              value={wholeMoney(
                sum((d) => d.tipsMinor),
                org,
              )}
            />
            <Stat
              label="Refunds"
              value={wholeMoney(
                sum((d) => d.refundsMinor),
                org,
              )}
            />
          </Stats>
        </>
      )}
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={error} />
      {!untouched && (
        <>
          <section className="surface ops-panel" aria-labelledby="downloads-heading">
            <header>
              <div>
                <h2 id="downloads-heading">Spreadsheets</h2>
                <p>
                  Each opens in Excel, Numbers or Google Sheets. Demo and test card payments are
                  marked, as they moved no real money.
                </p>
              </div>
              <Download size={21} aria-hidden="true" />
            </header>
            <div className="accounts-downloads">
              <Button
                variant="secondary"
                onClick={() =>
                  save(name('money'), moneyCsv(moneyInAndOut(state, from, to), org.currency))
                }
              >
                Money in and out
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  save(name('sales'), salesCsv(salesByReceipt(state, from, to), org.currency))
                }
              >
                Sales by receipt
              </Button>
              <Button
                variant="secondary"
                onClick={() => save(name('tax'), taxCsv(taxSummary(state, from, to), org.currency))}
              >
                Tax summary
              </Button>
              <Link className="button button-quiet" to="/business/pay">
                Commission and tips on Pay
              </Link>
            </div>
          </section>
          <section className="surface ops-panel" aria-labelledby="days-heading">
            <header>
              <h2 id="days-heading">Day by day</h2>
            </header>
            {days.length ? (
              <div
                className="rota-scroll"
                role="region"
                aria-label="Takings day by day"
                tabIndex={0}
              >
                <table className="accounts-table">
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Treatments</th>
                      <th scope="col">Products</th>
                      <th scope="col">Tax</th>
                      <th scope="col">Tips</th>
                      <th scope="col">Plans, rent, fees</th>
                      {renters && <th scope="col">Held for renters</th>}
                      <th scope="col">Refunds</th>
                      <th scope="col">Takings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.date}>
                        <th scope="row">{dateLabel(d.date, org.locale, true)}</th>
                        <td>{fmt(d.servicesMinor)}</td>
                        <td>{fmt(d.productsMinor)}</td>
                        <td>{fmt(d.taxMinor)}</td>
                        <td>{fmt(d.tipsMinor)}</td>
                        <td>{fmt(d.plansMinor + d.rentMinor + d.feesMinor)}</td>
                        {renters && <td>{fmt(d.rentersMinor - d.rentersBackMinor)}</td>}
                        <td>{d.refundsMinor ? fmt(-d.refundsMinor) : fmt(0)}</td>
                        <td>
                          <strong>{fmt(dayTakings(d))}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle">Nothing was taken in this period.</p>
            )}
            <p className="subtle">
              Treatments leave out visits a package or membership paid for, as those were counted
              when the plan was sold. Deposits count when the visit is paid.
              {renters &&
                ' Someone renting a chair or room keeps their own takings: they come through your till but are held for them, apart from your income. Their rent is your income.'}
            </p>
          </section>
        </>
      )}
      <section className="surface ops-panel" aria-labelledby="link-heading">
        <header>
          <div>
            <h2 id="link-heading">Xero or QuickBooks</h2>
            <p>
              Test mode. SALEANE prepares each day as a journal in your software's own format so you
              and your accountant can check it. Nothing is sent until a real connection is set up,
              which needs your accountant to sign in.
            </p>
          </div>
          <BookOpenCheck size={21} aria-hidden="true" />
        </header>
        {settings ? (
          <>
            <p>
              <strong>{PROVIDER[settings.provider]}</strong>, with account codes{' '}
              {Object.entries(settings.codes)
                .map(
                  ([key, code]) =>
                    `${CODE_LABEL[key as keyof AccountCodes]} ${code || '(not set)'}`,
                )
                .join(', ')}
              .
            </p>
            <div className="ops-actions">
              {canExport && (
                <Button disabled={pending || !posted.length} onClick={() => void prepare()}>
                  {pending ? 'Preparing…' : `Prepare for ${PROVIDER[settings.provider]}`}
                </Button>
              )}
              {canSettings && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Change software or codes
                </Button>
              )}
            </div>
            {preview && (
              <details className="accounts-preview">
                <summary>What the first day looks like to {PROVIDER[settings.provider]}</summary>
                <pre>{preview}</pre>
              </details>
            )}
          </>
        ) : (
          <div className="ops-actions">
            <p className="subtle">Choose your accounting software and add the account codes.</p>
            {canSettings && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Set up
              </Button>
            )}
          </div>
        )}
        {batches.length > 0 && (
          <ul className="orders-closed" aria-label="Prepared batches">
            {batches.map((b) => (
              <li key={b.id}>
                {PROVIDER[b.provider]} · {dateLabel(b.from, org.locale, true)} to{' '}
                {dateLabel(b.to, org.locale, true)} · {b.days} days · {fmt(b.takingsMinor)} · test
                mode, not sent · prepared by {b.actor}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && (
        <SettingsDialog
          onClose={() => setEditing(false)}
          onDone={(message) => {
            setEditing(false)
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}

function SettingsDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const current = operations(state).accounting
  const blank = Object.fromEntries(Object.keys(CODE_LABEL).map((k) => [k, ''])) as AccountCodes
  const [provider, setProvider] = useState<AccountingProvider>(current?.provider ?? 'xero')
  const [codes, setCodes] = useState<AccountCodes>(current?.codes ?? blank)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'accounting-settings', settings: { provider, codes } })
      if (!result.ok) setError(result.error)
      else onDone(`${PROVIDER[provider]} and its account codes are saved.`)
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
      title="Accounting software"
      description="Your accountant can tell you which account code each line goes to."
    >
      <form onSubmit={submit} className="plan-form">
        <div className="ops-fields">
          <label className="ops-wide">
            Software
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AccountingProvider)}
            >
              {accountingProviders.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER[p]}
                </option>
              ))}
            </Select>
          </label>
          {(Object.keys(CODE_LABEL) as (keyof AccountCodes)[]).map((key) => (
            <label key={key}>
              {CODE_LABEL[key]}
              {key === 'renters' && <small>Only if someone rents a chair or room</small>}
              <input
                value={codes[key] ?? ''}
                maxLength={30}
                onChange={(e) => setCodes({ ...codes, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

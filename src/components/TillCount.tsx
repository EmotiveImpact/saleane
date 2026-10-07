import { useState } from 'react'
import type { FormEvent } from 'react'
import { Coins } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import { dateLabel, money } from '../domain/format'
import { parseMinor } from '../domain/money'
import { expectedCash, tillCountsFor, tillDifference } from '../domain/tillCount'
import type { TillCount as TillCountRecord } from '../domain/tillCount'
import { Button, ErrorMessage } from '../design'
import './till.css'

/**
 * End-of-day till count on the Money page. Staff record what they counted; SALEANE compares it
 * with the cash on record for that venue day. Nothing here banks, moves or reconciles money.
 */
export function TillCount() {
  const { state, commit, blocked, role, today } = useStore()
  const sandbox = operations(state).mode === 'sandbox'
  const org = state.organisation
  const [date, setDate] = useState(today)
  const counts = tillCountsFor(state, date)
  const [float, setFloat] = useState('')
  const [counted, setCounted] = useState('')
  const [banking, setBanking] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  if (role === 'practitioner') return null
  const allowed = can(role, 'till-count')
  const format = (amount: number) => money(amount, org, true)
  const floatMinor = parseMinor(float, 0)
  const countedMinor = parseMinor(counted)
  const live = expectedCash(state, date, Number.isNaN(floatMinor) ? 0 : floatMinor)
  const time = (instant: string) =>
    new Intl.DateTimeFormat(org.locale, {
      timeZone: org.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: org.locale === 'en-US',
    }).format(new Date(instant))

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || blocked || !allowed) return
    const amounts = {
      openingFloatMinor: parseMinor(float, 0),
      countedMinor: parseMinor(counted),
      bankingMinor: parseMinor(banking, 0),
    }
    if (Object.values(amounts).some(Number.isNaN)) {
      setError('Enter amounts such as 85 or 85.50, with no more than two decimal places.')
      return
    }
    if (amounts.bankingMinor > amounts.countedMinor) {
      setError('Cash taken out for banking cannot be more than the cash counted.')
      return
    }
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await commit({
        type: 'till-count',
        date,
        ...amounts,
        note: note.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCounted('')
      setBanking('')
      setNote('')
      setNotice(
        `Till count recorded for ${dateLabel(date, org.locale)}. ${sandbox ? 'Simulated cash only; no money moved.' : 'SALEANE has not banked or moved any money.'}`,
      )
    } catch {
      setError('The count could not be saved. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface till-panel" aria-labelledby="till-title">
      <header>
        <div>
          <h2 id="till-title">End-of-day till count</h2>
          <p>
            Count the cash drawer and record what you find. SALEANE compares it with the cash on
            record for the day. It does not bank, move or reconcile money.
          </p>
        </div>
        <Coins size={22} aria-hidden="true" />
      </header>
      <div className="till-layout">
        <form onSubmit={record} aria-busy={pending} className="till-form">
          <div className="ops-fields">
            <label className="ops-wide">
              Day counted
              <input
                type="date"
                value={date}
                max={today}
                required
                onChange={(e) => {
                  setDate(e.target.value || today)
                  setNotice('')
                  setError('')
                }}
              />
            </label>
            <label>
              Opening float ({org.currency})
              <input
                name="openingFloat"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={float}
                placeholder="0.00"
                onChange={(e) => setFloat(e.target.value)}
              />
            </label>
            <label>
              Cash counted in the till ({org.currency})
              <input
                name="counted"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
              <small>Everything in the drawer, before any is taken out.</small>
            </label>
            <label>
              Cash taken out for banking ({org.currency})
              <input
                name="banking"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={banking}
                onChange={(e) => setBanking(e.target.value)}
              />
              <small>Recorded only. SALEANE does not bank it.</small>
            </label>
            <label>
              Note (optional)
              <input
                name="note"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <ErrorMessage error={error} />
          <p className="ops-save-note" role="status">
            {notice}
          </p>
          <div className="ops-actions">
            <Button type="submit" disabled={pending || blocked || !allowed}>
              {pending ? 'Recording…' : 'Record till count'}
            </Button>
          </div>
        </form>
        <div className="till-expected" aria-live="polite">
          <h3>Expected in the till</h3>
          <dl>
            <div>
              <dt>Opening float</dt>
              <dd>{format(Number.isNaN(floatMinor) ? 0 : floatMinor)}</dd>
            </div>
            <div>
              <dt>{sandbox ? 'Simulated cash recorded' : 'Cash payments recorded'}</dt>
              <dd>+{format(live.cashIn)}</dd>
            </div>
            <div>
              <dt>Cash refunds recorded</dt>
              <dd>−{format(live.cashRefunded)}</dd>
            </div>
            <div className="till-total">
              <dt>Expected cash</dt>
              <dd>{format(live.expected)}</dd>
            </div>
          </dl>
          <p className="till-difference">
            {Number.isNaN(countedMinor)
              ? 'Enter the cash counted to see any difference.'
              : tillDifference(countedMinor, live.expected, org)}
          </p>
          <small>
            Payments and refunds recorded on {dateLabel(date, org.locale, true)} in the studio’s
            time zone. A refund counts as cash when its receipt was paid in cash.
            {sandbox ? ' Sample cash is simulated.' : ''}
          </small>
        </div>
      </div>
      <div className="till-history">
        <h3>Counts for {dateLabel(date, org.locale)}</h3>
        {counts.length ? (
          counts.map((count, i) => (
            <TillCountEntry
              key={count.id}
              count={count}
              current={i === 0}
              recount={i === 0 && counts.length > 1}
              time={time(count.recordedAt)}
              format={format}
              difference={tillDifference(count.countedMinor, count.expectedMinor, org)}
              changedTo={
                i === 0 &&
                expectedCash(state, count.date, count.openingFloatMinor).expected !==
                  count.expectedMinor
                  ? format(expectedCash(state, count.date, count.openingFloatMinor).expected)
                  : ''
              }
            />
          ))
        ) : (
          <p className="till-none">No till count recorded for this day yet.</p>
        )}
      </div>
    </section>
  )
}

function TillCountEntry({
  count,
  current,
  recount,
  time,
  format,
  difference,
  changedTo,
}: {
  count: TillCountRecord
  current: boolean
  recount: boolean
  time: string
  format: (amount: number) => string
  difference: string
  changedTo: string
}) {
  return (
    <div className={`ops-record till-entry ${current ? '' : 'till-superseded'}`}>
      <div className="ops-record-copy">
        <strong>
          {current
            ? `${recount ? 'Recounted' : 'Till counted'} at ${time}`
            : `Earlier count at ${time}, replaced by the later count`}
        </strong>
        <small>
          Recorded by {count.actor} · counted {format(count.countedMinor)} against{' '}
          {format(count.expectedMinor)} expected
        </small>
        <small>
          Float {format(count.openingFloatMinor)} · taken out for banking{' '}
          {format(count.bankingMinor)} · left in the till{' '}
          {format(count.countedMinor - count.bankingMinor)}
        </small>
        {count.note && <small>Note: {count.note}</small>}
        {changedTo && (
          <small>
            Cash records for this day have changed since this count. Expected now: {changedTo}.
          </small>
        )}
      </div>
      <span className="ops-record-money">{difference}</span>
    </div>
  )
}

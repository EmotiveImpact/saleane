import { useState } from 'react'
import type { FormEvent } from 'react'
import { Armchair, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { parsePercent } from '../domain/commission'
import {
  RENT_METHOD_LABEL,
  periodWorking,
  rentReceived,
  rentStatement,
  rentTerms,
} from '../domain/rent'
import { rentMethods } from '../domain/rentSchema'
import type { Rental, RentPayment } from '../domain/rentSchema'
import { Button, ErrorMessage, Modal } from '../design'
import { StudioDateField } from './StudioDateField'

/**
 * V2: chairs and rooms rented to self-employed people. SALEANE works out the rent due and records
 * what was paid; it does not collect it. Stage 3: rent can be a share of the renter's own takings,
 * with or without a fixed amount, and each period shows how it was worked out.
 */
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

export function RentPanel({ from, to }: { from: string; to: string }) {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const canEdit = !blocked && can(role, 'rental')
  const [setting, setSetting] = useState(false)
  const [paying, setPaying] = useState<Rental | null>(null)
  const [ending, setEnding] = useState<Rental | null>(null)
  const [notice, setNotice] = useState('')
  const rentals = [...(operations(state).rentals ?? [])]
    .filter((r) => !r.to || r.to >= from)
    .sort((a, b) => a.from.localeCompare(b.from))
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'
  const space = (r: Rental) =>
    state.resources.find((x) => x.id === r.resourceId)?.name ??
    (r.space === 'chair' ? 'A chair' : 'A room')
  const received = rentReceived(state, from, to)
  const done = (message: string) => {
    setSetting(false)
    setPaying(null)
    setEnding(null)
    setNotice(message)
  }

  return (
    <section className="surface ops-panel" aria-labelledby="rent-heading">
      <header>
        <div>
          <h2 id="rent-heading">Chair and room rent</h2>
          <p>
            For self-employed people who rent a chair or room and keep their own takings, which are
            kept out of the studio’s figures. They earn no commission while renting.{' '}
            {money(received, org, true)} rent recorded in this period.
          </p>
        </div>
        <Armchair size={21} aria-hidden="true" />
      </header>
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      {rentals.length ? (
        <div className="ops-ledger">
          {rentals.map((rental) => {
            const periods = rentStatement(state, rental)
            const owed = periods.reduce((sum, p) => sum + p.owedMinor, 0)
            const running = periods.reduce((sum, p) => sum + p.runningMinor, 0)
            const recent = periods.slice(-6).reverse()
            return (
              <div className="pay-person" key={rental.id}>
                <div className="ops-record pay-record">
                  <div className="ops-record-copy">
                    <strong>
                      {name(rental.staffId)} · {space(rental)}
                    </strong>
                    <small>
                      {rentTerms(state, rental)} from {dateLabel(rental.from, org.locale)}
                      {rental.to ? `, ended ${dateLabel(rental.to, org.locale)}` : ''}
                      {rental.products
                        ? '. The products they sell are their own.'
                        : '. Products they sell stay the studio’s sales.'}
                    </small>
                  </div>
                  <span className={`ops-record-money rent-money ${owed ? 'rota-over' : ''}`}>
                    {owed
                      ? `${money(owed, org, true)} owed`
                      : running
                        ? `${money(running, org, true)} so far`
                        : 'Up to date'}
                    {owed > 0 && running > 0 && (
                      <small>
                        {money(running, org, true)} more so far this {rental.every}
                      </small>
                    )}
                  </span>
                  {canEdit && (
                    <div className="stock-actions">
                      {owed + running > 0 && (
                        <Button
                          variant="secondary"
                          aria-label={`Record rent from ${name(rental.staffId)}`}
                          onClick={() => {
                            setPaying(rental)
                            setNotice('')
                          }}
                        >
                          Record rent
                        </Button>
                      )}
                      {!rental.to && (
                        <Button
                          variant="secondary"
                          aria-label={`End ${name(rental.staffId)}'s rental`}
                          onClick={() => {
                            setEnding(rental)
                            setNotice('')
                          }}
                        >
                          End
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <ul
                  className="rent-periods"
                  aria-label={`Recent rent from ${name(rental.staffId)}`}
                >
                  {recent.map((p) => (
                    <li key={p.start} className={p.owedMinor ? 'rent-owed' : ''}>
                      <span>{dateLabel(p.start, org.locale, true)}</span>
                      <strong>
                        {p.owedMinor
                          ? p.paidMinor
                            ? `${money(p.owedMinor, org, true)} owed`
                            : 'Owed'
                          : p.runningMinor
                            ? `${money(p.runningMinor, org, true)} so far`
                            : 'Paid'}
                      </strong>
                    </li>
                  ))}
                </ul>
                {rental.percentBps && recent.length > 0 && (
                  <details className="rent-working">
                    <summary>How the rent was worked out</summary>
                    <ul>
                      {recent.map((p) => (
                        <li key={p.start}>
                          <strong>
                            {rental.every === 'week' ? 'Week' : 'Month'} from{' '}
                            {dateLabel(p.start, org.locale, true)}
                          </strong>
                          <span>
                            {periodWorking(state, rental, p)}
                            {p.paidMinor ? ` ${money(p.paidMinor, org, true)} paid.` : ''}
                            {p.overMinor
                              ? ` ${money(p.overMinor, org, true)} more than is now due, after money given back.`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <small>
                      Their takings are their treatments
                      {rental.products ? ' and products' : ''} on the days they rent, after
                      discounts and without tax. Tips never count. Money given back comes off in the{' '}
                      {rental.every} it is given back.
                    </small>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="subtle">Nobody rents a chair or room.</p>
      )}
      {canEdit && (
        <div className="ops-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setSetting(true)
              setNotice('')
            }}
          >
            <Plus size={16} aria-hidden="true" /> Set up a rental
          </Button>
        </div>
      )}
      {setting && <RentalDialog today={today} onClose={() => setSetting(false)} onDone={done} />}
      {paying && (
        <PaymentDialog
          rental={paying}
          who={name(paying.staffId)}
          onClose={() => setPaying(null)}
          onDone={done}
        />
      )}
      {ending && (
        <EndDialog
          rental={ending}
          who={name(ending.staffId)}
          today={today}
          onClose={() => setEnding(null)}
          onDone={done}
        />
      )}
    </section>
  )
}

function RentalDialog({
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
  const { run, pending, error, setError } = useRun()
  const [staffId, setStaffId] = useState(team[0]?.id ?? '')
  const [space, setSpace] = useState<Rental['space']>('chair')
  const [resourceId, setResourceId] = useState('')
  const [kind, setKind] = useState<'fixed' | 'share' | 'both'>('fixed')
  const [amount, setAmount] = useState('')
  const [share, setShare] = useState('')
  const [products, setProducts] = useState(false)
  const [every, setEvery] = useState<Rental['every']>('week')
  const [from, setFrom] = useState(today)
  const spaces = state.resources.filter(
    (r) => !r.archived && r.type === (space === 'chair' ? 'chair' : 'treatment'),
  )
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = kind === 'share' ? 0 : parseMinor(amount)
    if (kind !== 'share' && (!Number.isFinite(amountMinor) || amountMinor <= 0)) {
      setError('Enter the rent, with up to two decimal places.')
      return
    }
    const percentBps = kind === 'fixed' ? 0 : parsePercent(share)
    if (kind !== 'fixed' && (!Number.isFinite(percentBps) || percentBps <= 0)) {
      setError('Enter their share as a percentage above 0 and up to 100, such as 10 or 12.5.')
      return
    }
    const who = team.find((p) => p.id === staffId)?.name ?? 'They'
    const terms = {
      amountMinor,
      ...(percentBps ? { percentBps } : {}),
      ...(products ? { products: true } : {}),
      every,
    }
    if (
      await run({
        type: 'rental',
        input: { staffId, space, ...(resourceId ? { resourceId } : {}), ...terms, from },
      })
    )
      onDone(
        `${who} rents ${space === 'chair' ? 'a chair' : 'a room'} for ${rentTerms(state, terms)} from ${dateLabel(from, org.locale)}.`,
      )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Set up a rental"
      description="A fixed rent is due at the start of each week or month from the first day. A share of their takings is worked out on each week or month once it ends. They earn no commission while renting."
    >
      <form onSubmit={save} className="plan-form">
        <fieldset className="pay-choice">
          <legend>Rent</legend>
          <label>
            <input
              type="radio"
              name="rent-kind"
              checked={kind === 'fixed'}
              onChange={() => setKind('fixed')}
            />
            A fixed amount
          </label>
          <label>
            <input
              type="radio"
              name="rent-kind"
              checked={kind === 'share'}
              onChange={() => setKind('share')}
            />
            A share of their takings
          </label>
          <label>
            <input
              type="radio"
              name="rent-kind"
              checked={kind === 'both'}
              onChange={() => setKind('both')}
            />
            A fixed amount plus a share of their takings
          </label>
        </fieldset>
        <div className="ops-fields">
          <label className="ops-wide">
            Who
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Renting
            <select
              value={space}
              onChange={(e) => {
                setSpace(e.target.value as Rental['space'])
                setResourceId('')
              }}
            >
              <option value="chair">A chair</option>
              <option value="room">A room</option>
            </select>
          </label>
          <label>
            Which one (optional)
            <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
              <option value="">Not fixed</option>
              {spaces.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {kind !== 'share' && (
            <label>
              Fixed rent ({org.currency})
              <input
                inputMode="decimal"
                value={amount}
                required
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          {kind !== 'fixed' && (
            <label>
              Share of their takings (%)
              <input
                inputMode="decimal"
                value={share}
                required
                onChange={(e) => setShare(e.target.value)}
              />
            </label>
          )}
          <label>
            Every
            <select value={every} onChange={(e) => setEvery(e.target.value as Rental['every'])}>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label>
            First day
            <StudioDateField value={from} onChange={setFrom} />
          </label>
        </div>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={products}
            onChange={(e) => setProducts(e.target.checked)}
          />
          The products they sell are their own
          {kind !== 'fixed' ? ', and count towards the share' : ''}. Leave this off when products
          come off your shelf: they stay your sales.
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !staffId}>
            {pending ? 'Saving…' : 'Save the rental'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PaymentDialog({
  rental,
  who,
  onClose,
  onDone,
}: {
  rental: Rental
  who: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const { run, pending, error, setError } = useRun()
  // Stage 3: with a share of takings, a running period can be paid as it goes, up to what is due.
  const owed = rentStatement(state, rental)
    .filter((p) => p.owedMinor + p.runningMinor > 0)
    .map((p) => ({ ...p, unpaidMinor: p.owedMinor + p.runningMinor }))
  const [period, setPeriod] = useState(owed[0]?.start ?? '')
  const chosen = owed.find((p) => p.start === period)
  const [amount, setAmount] = useState(chosen ? minorInput(chosen.unpaidMinor) : '')
  const [method, setMethod] = useState<RentPayment['method']>('bank_transfer')
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = parseMinor(amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError('Enter the amount paid, with up to two decimal places.')
      return
    }
    if (!confirmed) {
      setError('Confirm the rent has been paid to the studio.')
      return
    }
    if (
      await run({
        type: 'rent-payment',
        rentalId: rental.id,
        periodStart: period,
        amountMinor,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
    )
      onDone(
        `${money(amountMinor, org, true)} rent from ${who} recorded. SALEANE did not take this payment.`,
      )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`Record rent from ${who}`}
      description="For rent already paid to the studio in cash, by bank transfer or on your own card terminal."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label className="ops-wide">
            For
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value)
                const next = owed.find((p) => p.start === e.target.value)
                if (next) setAmount(minorInput(next.unpaidMinor))
              }}
            >
              {owed.map((p) => (
                <option key={p.start} value={p.start}>
                  {rental.every === 'week' ? 'Week' : 'Month'} from {dateLabel(p.start, org.locale)}{' '}
                  · {money(p.unpaidMinor, org, true)} {p.open && p.runningMinor ? 'so far' : 'owed'}
                </option>
              ))}
            </select>
          </label>
          {chosen?.takings && (
            <p className="ops-help ops-wide">{periodWorking(state, rental, chosen)}</p>
          )}
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
            Paid by
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as RentPayment['method'])}
            >
              {rentMethods.map((m) => (
                <option key={m} value={m}>
                  {RENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="ops-wide">
            Reference {method === 'cash' ? '(optional)' : '(required)'}
            <input
              value={reference}
              maxLength={150}
              required={method !== 'cash'}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm this rent has already been paid to the studio outside SALEANE.
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !period}>
            {pending ? 'Recording…' : 'Record the rent'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function EndDialog({
  rental,
  who,
  today,
  onClose,
  onDone,
}: {
  rental: Rental
  who: string
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const { run, pending, error } = useRun()
  const [to, setTo] = useState(today < rental.from ? rental.from : today)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await run({ type: 'end-rental', rentalId: rental.id, to }))
      onDone(
        `${who}'s rental ends on ${dateLabel(to, org.locale)}. Rent already owed is still shown.`,
      )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`End ${who}'s rental`}
      description="The rental and its payments stay on record. From the day after, their visits earn commission again if they have a rate."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label>
            Last day
            <StudioDateField value={to} min={rental.from} onChange={setTo} />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'End the rental'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

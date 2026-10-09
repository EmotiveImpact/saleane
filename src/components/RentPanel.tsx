import { useState } from 'react'
import type { FormEvent } from 'react'
import { Armchair, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { RENT_METHOD_LABEL, rentReceived, rentStatement } from '../domain/rent'
import { rentMethods } from '../domain/rentSchema'
import type { Rental, RentPayment } from '../domain/rentSchema'
import { Button, ErrorMessage, Modal } from '../design'
import { StudioDateField } from './StudioDateField'

/**
 * V2: chairs and rooms rented to self-employed people. SALEANE works out the rent due and records
 * what was paid; it does not collect it.
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
            For self-employed people who rent a chair or room and keep their own takings. They earn
            no commission while renting. {money(received, org, true)} rent recorded in this period.
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
            return (
              <div className="pay-person" key={rental.id}>
                <div className="ops-record pay-record">
                  <div className="ops-record-copy">
                    <strong>
                      {name(rental.staffId)} · {space(rental)}
                    </strong>
                    <small>
                      {money(rental.amountMinor, org, true)} a {rental.every} from{' '}
                      {dateLabel(rental.from, org.locale)}
                      {rental.to ? `, ended ${dateLabel(rental.to, org.locale)}` : ''}
                    </small>
                  </div>
                  <span className={`ops-record-money ${owed ? 'rota-over' : ''}`}>
                    {owed ? `${money(owed, org, true)} owed` : 'Up to date'}
                  </span>
                  {canEdit && (
                    <div className="stock-actions">
                      {owed > 0 && (
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
                  {periods
                    .slice(-6)
                    .reverse()
                    .map((p) => (
                      <li key={p.start} className={p.owedMinor ? 'rent-owed' : ''}>
                        <span>{dateLabel(p.start, org.locale, true)}</span>
                        <strong>
                          {p.owedMinor === 0
                            ? 'Paid'
                            : p.paidMinor
                              ? `${money(p.owedMinor, org, true)} owed`
                              : 'Owed'}
                        </strong>
                      </li>
                    ))}
                </ul>
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
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<Rental['every']>('week')
  const [from, setFrom] = useState(today)
  const spaces = state.resources.filter(
    (r) => !r.archived && r.type === (space === 'chair' ? 'chair' : 'treatment'),
  )
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = parseMinor(amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError('Enter the rent, with up to two decimal places.')
      return
    }
    const who = team.find((p) => p.id === staffId)?.name ?? 'They'
    if (
      await run({
        type: 'rental',
        input: {
          staffId,
          space,
          ...(resourceId ? { resourceId } : {}),
          amountMinor,
          every,
          from,
        },
      })
    )
      onDone(
        `${who} rents ${space === 'chair' ? 'a chair' : 'a room'} for ${money(amountMinor, org, true)} a ${every} from ${dateLabel(from, org.locale)}.`,
      )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Set up a rental"
      description="Rent is due at the start of each week or month from the first day. They earn no commission while renting."
    >
      <form onSubmit={save} className="plan-form">
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
          <label>
            Rent ({org.currency})
            <input
              inputMode="decimal"
              value={amount}
              required
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
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
  const owed = rentStatement(state, rental).filter((p) => p.owedMinor > 0)
  const [period, setPeriod] = useState(owed[0]?.start ?? '')
  const chosen = owed.find((p) => p.start === period)
  const [amount, setAmount] = useState(chosen ? minorInput(chosen.owedMinor) : '')
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
                if (next) setAmount(minorInput(next.owedMinor))
              }}
            >
              {owed.map((p) => (
                <option key={p.start} value={p.start}>
                  {rental.every === 'week' ? 'Week' : 'Month'} from {dateLabel(p.start, org.locale)}{' '}
                  · {money(p.owedMinor, org, true)} owed
                </option>
              ))}
            </select>
          </label>
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

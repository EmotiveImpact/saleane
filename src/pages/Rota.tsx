import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarOff, ChevronLeft, ChevronRight, Plus, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations, timeOffKinds } from '../domain/operations'
import type { TimeOff } from '../domain/operations'
import type { OperatingCommand } from '../domain/commandSchema'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { describeVisit, scheduleImpact } from '../domain/schedule'
import {
  TIME_OFF_LABEL,
  holidaySummary,
  mondayOf,
  rotaWeek,
  workingDaysAway,
} from '../domain/timeOff'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, useScrollEdges } from '../design'
import '../components/management.css'
import '../rota.css'
import { StudioDateField } from '../components/StudioDateField'

/**
 * V2: the week's rota from everyone's usual hours, who is away, and each person's holiday
 * allowance. Time off stops people being booked; it never moves or cancels a visit already booked.
 */
export function Rota() {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const [monday, setMonday] = useState(mondayOf(today))
  const [adding, setAdding] = useState(false)
  const [allowanceFor, setAllowanceFor] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { commit } = useStore()
  const canEdit = !blocked && can(role, 'hours')
  const week = rotaWeek(state, monday)
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const year = Number(today.slice(0, 4))
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'
  // On a narrow screen the week scrolls sideways; the far edge fades while there is more to see.
  const scroller = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scroller)
  const away = [...(operations(state).timeOff ?? [])]
    .filter((t) => t.to >= addDays(today, -31))
    .sort((a, b) => a.from.localeCompare(b.from))

  async function cancel(t: TimeOff) {
    setError('')
    setNotice('')
    const result = await commit({ type: 'cancel-time-off', timeOffId: t.id })
    if (!result.ok) setError(result.error)
    else
      setNotice(`${name(t.staffId)}'s time off is cancelled. They can be booked those days again.`)
  }

  return (
    <div className="rota-page">
      <PageHeader
        variant="compact"
        eyebrow="Business"
        title="Who is in, and who is away."
        description="The week from everyone's usual hours, with holidays and sick days. Nobody is booked while they are away."
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setAdding(true)
                setNotice('')
              }}
            >
              <Plus size={16} aria-hidden="true" /> Add time off
            </Button>
          ) : undefined
        }
      />
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={error} />
      <section className="surface ops-panel" aria-labelledby="rota-heading">
        <header className="rota-head">
          <h2 id="rota-heading">Week of {dateLabel(monday, org.locale)}</h2>
          <div className="rota-nav">
            <Button
              variant="quiet"
              aria-label="Previous week"
              onClick={() => setMonday(addDays(monday, -7))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Button>
            <Button variant="secondary" onClick={() => setMonday(mondayOf(today))}>
              This week
            </Button>
            <Button
              variant="quiet"
              aria-label="Next week"
              onClick={() => setMonday(addDays(monday, 7))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div
          className="rota-scroll"
          ref={scroller}
          data-more-after={edges.after || undefined}
          role="region"
          aria-label="Rota for the week"
          tabIndex={0}
        >
          <table className="rota-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Person</span>
                </th>
                {dates.map((date) => (
                  <th scope="col" key={date} className={date === today ? 'rota-today' : ''}>
                    {dateLabel(date, org.locale, true)}
                    {date === today && (
                      <>
                        {' '}
                        <span className="rota-today-tag">Today</span>
                      </>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.map(({ person, days }) => (
                <tr key={person.id}>
                  <th scope="row">
                    <span className="rota-person">
                      <Avatar small identity={person.id} name={person.name} tone={person.tone} />
                      {person.name}
                    </span>
                  </th>
                  {days.map((day) => (
                    <td
                      key={day.date}
                      className={`rota-${day.state}${day.date === today ? ' rota-today' : ''}`}
                    >
                      {day.state === 'working' ? (
                        <>
                          <strong>
                            {timeLabel(day.open, org.locale)}–{timeLabel(day.close, org.locale)}
                          </strong>
                          {day.visits > 0 && (
                            <small>
                              {day.visits} {day.visits === 1 ? 'visit' : 'visits'}
                            </small>
                          )}
                        </>
                      ) : day.state === 'away' ? (
                        <>
                          <strong>{TIME_OFF_LABEL[day.away.kind]}</strong>
                          {day.away.note && <small>{day.away.note}</small>}
                        </>
                      ) : (
                        <span>{day.state === 'closed' ? 'Closed' : 'Off'}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle">
          Usual hours come from each person's weekly hours in Settings. Single breaks and venue
          closures are in Settings too.
        </p>
      </section>
      <div className="rota-columns">
        <section className="surface ops-panel" aria-labelledby="away-heading">
          <header>
            <div>
              <h2 id="away-heading">Time away</h2>
              <p>Recent and coming up. Cancelled time off stays on record.</p>
            </div>
            <CalendarOff size={21} aria-hidden="true" />
          </header>
          {away.length ? (
            <div className="ops-ledger">
              {away.map((t) => (
                <div className="ops-record" key={t.id}>
                  <div className="ops-record-copy">
                    <strong>
                      {name(t.staffId)} · {TIME_OFF_LABEL[t.kind]}
                    </strong>
                    <small>
                      {t.from === t.to
                        ? dateLabel(t.from, org.locale)
                        : `${dateLabel(t.from, org.locale, true)} to ${dateLabel(t.to, org.locale, true)}`}
                      {` · ${workingDaysAway(state, t)} working ${workingDaysAway(state, t) === 1 ? 'day' : 'days'}`}
                      {t.note ? ` · ${t.note}` : ''}
                      {t.cancelledAt ? ` · cancelled by ${t.cancelledBy ?? 'the studio'}` : ''}
                    </small>
                  </div>
                  {t.cancelledAt ? (
                    <span className="ops-tag">Cancelled</span>
                  ) : (
                    canEdit &&
                    t.to >= today && (
                      <Button
                        variant="secondary"
                        aria-label={`Cancel ${name(t.staffId)}'s ${TIME_OFF_LABEL[t.kind].toLowerCase()} from ${dateLabel(t.from, org.locale)}`}
                        onClick={() => void cancel(t)}
                      >
                        Cancel
                      </Button>
                    )
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle">Nobody has time off recorded.</p>
          )}
        </section>
        <section className="surface ops-panel" aria-labelledby="holiday-heading">
          <header>
            <div>
              <h2 id="holiday-heading">Holiday in {year}</h2>
              <p>Working days of holiday booked this year, taken or still to come.</p>
            </div>
            <Sun size={21} aria-hidden="true" />
          </header>
          <div className="ops-ledger">
            {state.staff
              .filter((person) => !person.archived)
              .map((person) => {
                const sum = holidaySummary(state, person.id, year)
                return (
                  <div className="ops-record" key={person.id}>
                    <div className="ops-record-copy">
                      <strong>{person.name}</strong>
                      <small>
                        {sum.booked} {sum.booked === 1 ? 'day' : 'days'} booked
                        {sum.allowance === undefined
                          ? ' · no allowance set'
                          : ` of ${sum.allowance}`}
                      </small>
                    </div>
                    {sum.left !== undefined && (
                      <span className={`ops-record-money ${sum.left < 0 ? 'rota-over' : ''}`}>
                        {sum.left < 0 ? `${-sum.left} over` : `${sum.left} left`}
                      </span>
                    )}
                    {canEdit && (
                      <Button
                        variant="secondary"
                        aria-label={`Allowance for ${person.name}`}
                        onClick={() => {
                          setAllowanceFor(person.id)
                          setNotice('')
                        }}
                      >
                        Allowance
                      </Button>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      </div>
      {adding && (
        <TimeOffDialog
          today={today}
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false)
            setNotice(message)
          }}
        />
      )}
      {allowanceFor && (
        <AllowanceDialog
          staffId={allowanceFor}
          onClose={() => setAllowanceFor(null)}
          onDone={(message) => {
            setAllowanceFor(null)
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}

function TimeOffDialog({
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
  const team = state.staff.filter((p) => !p.archived)
  const [staffId, setStaffId] = useState(team[0]?.id ?? '')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [kind, setKind] = useState<TimeOff['kind']>('holiday')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from
  const command: OperatingCommand = {
    type: 'time-off',
    input: { staffId, from, to, kind, ...(note.trim() ? { note: note.trim() } : {}) },
  }
  const clashes = valid ? scheduleImpact(state, command, new Date().toISOString()) : []
  const days = valid ? workingDaysAway(state, { staffId, from, to }) : 0
  const person = team.find((p) => p.id === staffId)?.name ?? 'They'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) {
      setError('Choose a last day on or after the first day.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else
        onDone(
          `${person} is away ${from === to ? `on ${dateLabel(from, org.locale)}` : `from ${dateLabel(from, org.locale)} to ${dateLabel(to, org.locale)}`}. Nobody can book them those days.`,
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
      title="Add time off"
      description="For a holiday, sickness or any whole days away. Visits already booked stay booked, so move them first."
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
            First day
            <StudioDateField
              value={from}
              required
              onChange={(day) => {
                setFrom(day)
                if (to < day) setTo(day)
              }}
            />
          </label>
          <label>
            Last day
            <StudioDateField value={to} min={from} required onChange={setTo} />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as TimeOff['kind'])}>
              {timeOffKinds.map((k) => (
                <option key={k} value={k}>
                  {TIME_OFF_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note (optional)
            <input value={note} maxLength={150} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {valid && (
          <p className="subtle">
            {days} working {days === 1 ? 'day' : 'days'} away
            {kind === 'holiday' ? ', counted against their holiday allowance' : ''}.
          </p>
        )}
        {clashes.length > 0 && (
          <div className="rota-clashes" role="alert">
            <strong>
              {clashes.length} {clashes.length === 1 ? 'visit is' : 'visits are'} booked with{' '}
              {person} then. Move {clashes.length === 1 ? 'it' : 'them'} first, then save.
            </strong>
            <ul>
              {clashes.map((v) => (
                <li key={v.appointmentId}>{describeVisit(v, org.locale)}</li>
              ))}
            </ul>
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || clashes.length > 0 || !staffId}>
            {pending ? 'Saving…' : 'Save time off'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AllowanceDialog({
  staffId,
  onClose,
  onDone,
}: {
  staffId: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const person = state.staff.find((p) => p.id === staffId)
  const current = operations(state).leaveAllowances?.find((a) => a.staffId === staffId)?.days
  const [days, setDays] = useState(current === undefined ? '' : String(current))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(days)
    if (!/^\d{1,3}(\.5)?$/.test(days.trim()) || value > 366) {
      setError('Enter whole or half days, such as 28 or 25.5.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'leave-allowance', staffId, days: value })
      if (!result.ok) setError(result.error)
      else onDone(`${person?.name ?? 'Their'} holiday allowance is ${value} days a year.`)
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
      title={`Holiday allowance for ${person?.name ?? 'them'}`}
      description="Working days of holiday a year, from January to December. Include bank holidays if they count against it."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label>
            Days a year
            <input
              inputMode="decimal"
              value={days}
              required
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the allowance'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Clock3, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can } from '../domain/operations'
import { addDays, dateLabel } from '../domain/format'
import {
  breakLabel,
  clockTime,
  clockValue,
  hoursLabel,
  hoursPeriod,
  needsFinish,
  shiftMinutes,
} from '../domain/hours'
import type { Shift } from '../domain/hoursSchema'
import { Avatar, Button, ErrorMessage, Modal, TimeField } from '../design'
import { StudioDateField } from './StudioDateField'
import { BreakField } from './Clock'
import { useClock } from '../state/clock'
import './clock.css'

/**
 * NEXT-07: hours worked in the period, from clocking in and out, less breaks. Owners and managers
 * add hours that were missed and put mistakes right, always with a reason; removed hours are kept
 * in the record with who removed them and why. SALEANE adds the hours up; it pays nobody.
 */
export function HoursPanel({ from, to }: { from: string; to: string }) {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const canFix = !blocked && can(role, 'shift-fix')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ shift?: Shift; staffId?: string } | null>(null)
  const [notice, setNotice] = useState('')
  const now = Date.parse(useClock())
  const summary = hoursPeriod(state, from, to)
  const people = state.staff.filter((p) => !p.archived || summary.has(p.id))
  const total = [...summary.values()].reduce((sum, row) => sum + row.minutes, 0)
  const missing = [...summary.values()]
    .flatMap((row) => row.shifts)
    .filter((x) => needsFinish(x, now))
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'

  return (
    <section className="surface ops-panel" aria-labelledby="hours-heading">
      <header>
        <div>
          <h2 id="hours-heading">Hours worked</h2>
          <p>
            From clocking in and out, less unpaid breaks: {hoursLabel(total)} in this period. Use
            them for anyone paid by the hour.
          </p>
        </div>
        <Clock3 size={21} aria-hidden="true" />
      </header>
      {canFix && (
        <div className="ops-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setEditing({})
              setNotice('')
            }}
          >
            <Plus size={16} aria-hidden="true" /> Add hours
          </Button>
        </div>
      )}
      {missing.length > 0 && (
        <p className="hours-missing">
          {missing.length === 1
            ? `${name(missing[0].staffId)} did not clock out on ${dateLabel(missing[0].date, org.locale)}.`
            : `${missing.length} shifts have no finish time.`}{' '}
          {canFix
            ? 'Set when they ended so the hours count.'
            : 'An owner or manager can set when they ended so the hours count.'}
        </p>
      )}
      {notice && (
        <p className="success-strip settle" role="status">
          {notice}
        </p>
      )}
      <ul className="hours-list" aria-label="Hours for each person">
        {people.map((person) => {
          const row = summary.get(person.id)
          const expanded = open === person.id
          const count = row?.shifts.length ?? 0
          const forgotten = row?.shifts.filter((x) => needsFinish(x, now)).length ?? 0
          const inNow = row?.shifts.some((x) => !x.end && !needsFinish(x, now))
          return (
            <li className="hours-person" key={person.id}>
              <div className="hours-row">
                <Avatar small identity={person.id} name={person.name} tone={person.tone} />
                <span className="clock-who">
                  <strong>{person.name}</strong>
                  <small>
                    {count ? `${count} ${count === 1 ? 'shift' : 'shifts'}` : 'No hours yet'}
                    {forgotten ? `, ${forgotten} with no finish time` : ''}
                    {inNow ? ', in now' : ''}
                  </small>
                </span>
                <span className="hours-total">{hoursLabel(row?.minutes ?? 0)}</span>
                {count > 0 && (
                  <Button
                    variant="secondary"
                    aria-label={`${expanded ? 'Hide shifts' : 'Shifts'} for ${person.name}`}
                    aria-expanded={expanded}
                    aria-controls={`hours-${person.id}`}
                    onClick={() => setOpen(expanded ? null : person.id)}
                  >
                    {expanded ? 'Hide' : 'Shifts'}
                  </Button>
                )}
              </div>
              {expanded && row && (
                <ul
                  className="hours-shifts settle"
                  id={`hours-${person.id}`}
                  aria-label={`Shifts for ${person.name}`}
                >
                  {row.shifts.map((shift) => {
                    const minutes = shiftMinutes(shift)
                    return (
                      <li key={shift.id}>
                        <span>
                          <strong>{dateLabel(shift.date, org.locale, true)}</strong>
                          <small>
                            {clockTime(state, shift.start)}
                            {shift.end ? ` to ${clockTime(state, shift.end)}` : ''}
                            {shift.breakMinutes ? `, ${breakLabel(shift.breakMinutes)} break` : ''}
                            {shift.byHand
                              ? `. ${shift.source === 'added' ? 'Added' : 'Changed'} by ${shift.byHand.actor}: ${shift.byHand.reason}`
                              : ''}
                          </small>
                        </span>
                        <span className={`hours-total ${minutes === null ? 'hours-missing' : ''}`}>
                          {minutes !== null
                            ? hoursLabel(minutes)
                            : needsFinish(shift, now)
                              ? 'No finish time'
                              : 'Still in'}
                        </span>
                        {canFix && (
                          <Button
                            variant="quiet"
                            aria-label={`Change hours for ${person.name} on ${dateLabel(shift.date, org.locale)}`}
                            onClick={() => {
                              setEditing({ shift })
                              setNotice('')
                            }}
                          >
                            Change
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <ShiftDialog
          shift={editing.shift}
          today={today}
          onClose={() => setEditing(null)}
          onDone={(message, staffId) => {
            setEditing(null)
            setNotice(message)
            setOpen(staffId)
          }}
        />
      )}
    </section>
  )
}

function ShiftDialog({
  shift,
  today,
  onClose,
  onDone,
}: {
  shift?: Shift
  today: string
  onClose: () => void
  onDone: (message: string, staffId: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const team = state.staff.filter((p) => !p.archived || p.id === shift?.staffId)
  const [staffId, setStaffId] = useState(shift?.staffId ?? '')
  const [date, setDate] = useState(shift?.date ?? today)
  const [start, setStart] = useState(shift ? clockValue(state, shift.start) : '')
  const [end, setEnd] = useState(shift?.end ? clockValue(state, shift.end) : '')
  const [breakMinutes, setBreakMinutes] = useState(shift?.breakMinutes ?? 0)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const who = state.staff.find((p) => p.id === staffId)

  async function run(remove: boolean) {
    if (reason.trim().length < 3) {
      setError(
        remove
          ? 'Say why these hours are being removed.'
          : 'Say why, such as "Forgot to clock out".',
      )
      return
    }
    if (!remove && (!staffId || !start || !end)) {
      setError('Choose the person, when they started and when they finished.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit(
        remove && shift
          ? { type: 'shift-remove', shiftId: shift.id, reason: reason.trim() }
          : {
              type: 'shift-save',
              ...(shift ? { id: shift.id } : {}),
              input: { staffId, date, start, end, breakMinutes, reason: reason.trim() },
            },
      )
      if (!result.ok) setError(result.error)
      else {
        const first = who?.name.split(' ')[0] ?? 'Their'
        onDone(
          remove
            ? `The hours for ${first} on ${dateLabel(date, org.locale)} are removed. The record keeps them, with your reason.`
            : `${first}: ${hoursLabel(
                shiftMinutes(
                  (result.state.operations?.shifts ?? []).find((x) => x.id === result.recordId)!,
                ) ?? 0,
              )} on ${dateLabel(date, org.locale)}.`,
          staffId,
        )
      }
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
      title={shift ? `Hours for ${who?.name ?? 'someone'}` : 'Add hours'}
      description={
        shift
          ? 'Change when they started or finished, or the break. The times it had before are kept with it.'
          : 'For a shift someone forgot to clock. A finish before the start is the next morning.'
      }
    >
      <form
        className="hours-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void run(false)
        }}
      >
        {!shift && (
          <label>
            Person
            <select
              value={staffId}
              aria-required="true"
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Choose someone</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Day
          <StudioDateField
            value={date}
            required
            min={addDays(today, -400)}
            max={today}
            onChange={setDate}
          />
        </label>
        <div className="hours-times">
          <label>
            Started
            <TimeField
              locale={org.locale}
              step={5}
              value={start}
              aria-required="true"
              onChange={setStart}
            />
          </label>
          <label>
            Finished
            <TimeField
              locale={org.locale}
              step={5}
              value={end}
              aria-required="true"
              onChange={setEnd}
            />
          </label>
          <BreakField id="hours-break" value={breakMinutes} onChange={setBreakMinutes} />
        </div>
        <label>
          Why
          <input
            value={reason}
            maxLength={200}
            aria-required="true"
            placeholder="Such as: forgot to clock out"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {shift?.earlier?.length ? (
          <div className="pay-history">
            <h3>Before</h3>
            <ul>
              {[...shift.earlier].reverse().map((was) => (
                <li key={was.at}>
                  {dateLabel(was.date, org.locale, true)}, {clockTime(state, was.start)}
                  {was.end ? ` to ${clockTime(state, was.end)}` : ''}
                  {was.breakMinutes ? `, ${breakLabel(was.breakMinutes)} break` : ''}
                  <small>
                    {was.reason ? `Set by ${was.actor}: ${was.reason}` : `Clocked by ${was.actor}`}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ErrorMessage error={error} />
        <div className="clock-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : shift ? 'Save the hours' : 'Add the hours'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {shift && (
            <Button
              variant="quiet"
              className="hours-remove"
              disabled={pending}
              onClick={() => void run(true)}
            >
              Remove these hours
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../state/context'
import { staffLocationOn } from '../domain/locations'
import { breakLabel, clockedIn, clockTime, hoursLabel, hoursPeriod } from '../domain/hours'
import { useClock } from '../state/clock'
import { BREAK_CHOICES } from '../domain/hoursSchema'
import type { Staff } from '../domain/model'
import { Avatar, Button, ErrorMessage, Modal, Select } from '../design'
import './clock.css'

/**
 * NEXT-07: clocking in and out. Each person does it on their own page, or the desk does it for
 * them from Today. The hours go to Pay for payroll; SALEANE adds them up and pays nobody.
 */
/** The unpaid break taken during a shift, chosen when clocking out or changing hours. */
export function BreakField({
  id,
  value,
  onChange,
}: {
  id: string
  value: number
  onChange: (minutes: number) => void
}) {
  // A break already saved off the usual choices (such as 20 minutes) is kept and offered too.
  const choices = (BREAK_CHOICES as readonly number[]).includes(value)
    ? BREAK_CHOICES
    : [...BREAK_CHOICES, value].sort((a, b) => a - b)
  return (
    <label htmlFor={id}>
      Unpaid break
      <Select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {choices.map((minutes) => (
          <option key={minutes} value={minutes}>
            {breakLabel(minutes)}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** The step of clocking out: the break taken, then one button. */
export function ClockOutForm({
  first,
  since,
  pending,
  error,
  onConfirm,
  onBack,
}: {
  /** Their first name, when the desk clocks someone out; none when people clock themselves out. */
  first?: string
  /** When they clocked in, on the studio's clock. */
  since: string
  pending: boolean
  error: string
  onConfirm: (breakMinutes: number) => void
  onBack: () => void
}) {
  const [minutes, setMinutes] = useState(0)
  return (
    <form
      className="clock-out"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        onConfirm(minutes)
      }}
    >
      <p>
        {first ?? 'You'} clocked in at {since}. Choose any unpaid break taken, so the hours are
        right.
      </p>
      <BreakField id="clock-out-break" value={minutes} onChange={setMinutes} />
      <ErrorMessage error={error} />
      <div className="clock-actions">
        <Button type="submit" disabled={pending}>
          {pending ? 'Clocking out…' : first ? `Clock ${first} out` : 'Clock out'}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  )
}

/** From Today: the desk clocks people in and out. */
export function TeamClock({ onClose }: { onClose: () => void }) {
  const { state, today, branch, commit } = useStore()
  const [leaving, setLeaving] = useState<Staff | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const now = Date.parse(useClock(30_000))
  const first = (person: Staff) => person.name.split(' ')[0]
  // A general manager clocks only the people working at their own location today.
  const team = state.staff.filter(
    (p) => !p.archived && (!branch || staffLocationOn(state, p.id, today) === branch),
  )
  const worked = hoursPeriod(state, today, today)

  async function run(person: Staff, breakMinutes?: number) {
    if (pending) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await commit(
        breakMinutes === undefined
          ? { type: 'clock-in', staffId: person.id }
          : { type: 'clock-out', staffId: person.id, breakMinutes },
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      const at = clockTime(result.state, new Date().toISOString())
      setLeaving(null)
      setNotice(
        breakMinutes === undefined
          ? `${first(person)} clocked in at ${at}.`
          : `${first(person)} clocked out at ${at}. Today: ${hoursLabel(
              hoursPeriod(result.state, today, today).get(person.id)?.minutes ?? 0,
            )} worked.`,
      )
    } catch {
      setError('This could not be saved. Try again.')
    } finally {
      setPending(false)
    }
  }

  const open = leaving && clockedIn(state, leaving.id, now)
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={open ? `Clock ${first(leaving)} out` : 'Clock in and out'}
      description={
        open
          ? 'The time is now, on the studio clock.'
          : 'For anyone starting or finishing work. People can also clock in on their own page.'
      }
    >
      {open ? (
        <ClockOutForm
          first={first(leaving)}
          since={clockTime(state, open.start)}
          pending={pending}
          error={error}
          onConfirm={(minutes) => void run(leaving, minutes)}
          onBack={() => {
            setLeaving(null)
            setError('')
          }}
        />
      ) : (
        <>
          {notice && (
            <p className="success-strip settle" role="status">
              {notice}
            </p>
          )}
          <ErrorMessage error={error} />
          <ul className="clock-team" aria-label="The team">
            {team.map((person) => {
              const shift = clockedIn(state, person.id, now)
              const minutes = worked.get(person.id)?.minutes ?? 0
              return (
                <li key={person.id}>
                  <Avatar small identity={person.id} name={person.name} tone={person.tone} />
                  <span className="clock-who">
                    <strong>{person.name}</strong>
                    <small>
                      {shift
                        ? `In since ${clockTime(state, shift.start)}`
                        : minutes
                          ? `${hoursLabel(minutes)} worked today`
                          : 'Not clocked in'}
                    </small>
                  </span>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    aria-label={`${shift ? 'Clock out' : 'Clock in'} ${person.name}`}
                    onClick={() => {
                      setNotice('')
                      setError('')
                      if (shift) setLeaving(person)
                      else void run(person)
                    }}
                  >
                    {shift ? 'Clock out' : 'Clock in'}
                  </Button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}

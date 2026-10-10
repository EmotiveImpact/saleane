import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import { useStore } from '../state/context'
import { addDays, dateLabel } from '../domain/format'
import { businessDate, can } from '../domain/operations'
import { placeOf } from '../domain/locations'
import { span } from '../domain/rota'
import { mondayOf } from '../domain/timeOff'
import {
  cancellable,
  comingMove,
  moveDestinations,
  moveFrom,
  movedWorkdays,
  moveWords,
  staffMovePreview,
  staffMoves,
  usualSites,
  weekdaysWords,
} from '../domain/staffMoves'
import type { StaffMoveCommand, StaffMovePreview } from '../domain/staffMoves'
import type { StaffMove } from '../domain/staffMovesSchema'
import { Button, ErrorMessage, Modal } from '../design'
import { StudioDateField } from './StudioDateField'
import { KeepChoice } from './RotaChanges'
import type { Keep } from './RotaChanges'
import '../rota.css'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const firstName = (name: string) => name.trim().split(/\s+/)[0]
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const list = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/**
 * Stage 4: moving someone to another location from a date. Their usual days and hours stay the
 * same and happen there from that day; days before it stay where they were. Before anything is
 * saved the dialog shows their week at the new location, any of their treatments it does not
 * offer, days already changed on the rota, and the booked visits the move would leave behind,
 * with the same choice as the rota: move them first, or keep them booked as they are.
 */
export function StaffMoveDialog({
  staffId: chosen,
  onClose,
  onDone,
}: {
  /** The person to move; without one, the dialog asks who. */
  staffId?: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const locale = org.locale
  const today = businessDate(state)
  const team = state.staff.filter((p) => !p.archived && moveDestinations(state, p.id).length > 0)
  const placeName = (id: string) => placeOf(state, id)?.name ?? 'a closed location'
  /** A fresh start for someone: the Monday after any move of theirs, and somewhere new. */
  const startFor = (id: string) => {
    const coming = comingMove(state, id, today)
    const sites = usualSites(state, id).map((site) => site.locationId)
    const destinations = moveDestinations(state, id)
    return {
      date: addDays(mondayOf(coming?.date ?? today), 7),
      to: (destinations.find((place) => !sites.includes(place.id)) ?? destinations[0])?.id ?? '',
    }
  }
  const [staffId, setStaffId] = useState(chosen ?? team[0]?.id ?? '')
  const [to, setTo] = useState(() => startFor(staffId).to)
  const [date, setDate] = useState(() => startFor(staffId).date)
  const [from, setFrom] = useState('')
  const [note, setNote] = useState('')
  const [keep, setKeep] = useState<Keep>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const person = state.staff.find((p) => p.id === staffId)
  const first = person ? firstName(person.name) : 'They'
  const destinations = moveDestinations(state, staffId)
  // Someone at more than one location chooses which of their days move.
  const sites = usualSites(state, staffId)
  const fromChoices = sites.filter((site) => site.locationId !== to)
  const coming = comingMove(state, staffId, today)

  const command: StaffMoveCommand | null =
    person && to && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? {
          type: 'staff-move',
          input: {
            staffId,
            date,
            to,
            ...(from && fromChoices.some((site) => site.locationId === from) ? { from } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }
      : null
  const key = JSON.stringify(command)
  // The same check the server makes, so the screen can say why before anyone saves.
  const preview = useMemo(
    () => (command ? staffMovePreview(state, command) : null),
    // The command is rebuilt each render; its words decide when to look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, key],
  )
  const affected = preview?.error ? [] : (preview?.affected ?? [])
  // Where the moving days are now: the location chosen, or everywhere but the new one.
  const fromNames = list(
    (from ? [from] : sites.map((site) => site.locationId).filter((id) => id !== to)).map(placeName),
  )
  const change = (apply: () => void) => {
    apply()
    setKeep(null)
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || !person || preview?.error || (affected.length && keep !== 'keep')) return
    setPending(true)
    setError('')
    try {
      const result = await commit(affected.length ? { ...command, keepBooked: true } : command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const kept = affected.length
        ? ` ${plural(affected.length, 'booked visit stays', 'booked visits stay')} at ${fromNames}, marked on the rota.`
        : ''
      onDone(
        `${person.name} moves to ${placeName(to)} on ${dateLabel(date, locale)}. Their usual days and hours stay the same, and days before it stay where they were.${kept}`,
      )
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
      title={chosen && person ? `Move ${person.name}` : 'Move someone to another location'}
      description="Their usual days and hours stay the same and happen at the new location from the day you choose. Days before it stay where they were, with their pay, hours worked and figures."
    >
      <form onSubmit={save} className="plan-form rota-day-form">
        <div className="ops-fields">
          {!chosen && (
            <label className="ops-wide">
              Who is moving
              <select
                value={staffId}
                onChange={(e) =>
                  change(() => {
                    const next = startFor(e.target.value)
                    setStaffId(e.target.value)
                    setTo(next.to)
                    setDate(next.date)
                    setFrom('')
                  })
                }
              >
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Moving to
            <select
              value={to}
              onChange={(e) =>
                change(() => {
                  setTo(e.target.value)
                  if (from === e.target.value) setFrom('')
                })
              }
            >
              {destinations.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <StudioDateField
              value={date}
              min={coming ? addDays(coming.date, 1) : today}
              max={addDays(today, 366)}
              required
              onChange={(day) => change(() => setDate(day))}
            />
          </label>
          {sites.length > 1 && (
            <label className="ops-wide">
              Which days move
              <select value={from} onChange={(e) => change(() => setFrom(e.target.value))}>
                <option value="">Every day not already at {placeName(to)}</option>
                {fromChoices.map((site) => (
                  <option key={site.locationId} value={site.locationId}>
                    Their {weekdaysWords(site.days)} at {placeName(site.locationId)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ops-wide">
            Note for the team (optional)
            <input
              value={note}
              maxLength={200}
              placeholder="Such as leading the new team"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        {coming && (
          <p className="subtle rota-day-was">
            {moveWords(state, coming, today)}. A new move starts after that.
          </p>
        )}
        {preview?.error ? (
          <p className="rota-why" role="status">
            {preview.error}
          </p>
        ) : (
          preview && (
            <MoveWeek
              preview={preview}
              title={`${first}'s week from ${dateLabel(date, locale)}`}
              placeName={placeName}
            />
          )
        )}
        {preview && !preview.error && preview.notOffered.length > 0 && (
          <p className="move-note">
            {placeName(to)} does not offer {list(preview.notOffered)}, so {first} cannot be booked
            for {preview.notOffered.length === 1 ? 'it' : 'them'} there. Change that in Treatments
            if it should.
          </p>
        )}
        {preview && !preview.error && preview.rotaDays.length > 0 && (
          <div className="move-part">
            <strong>
              {plural(preview.rotaDays.length, 'day already changed', 'days already changed')} on
              the rota {preview.rotaDays.length === 1 ? 'stays' : 'stay'} as{' '}
              {preview.rotaDays.length === 1 ? 'it is' : 'they are'}
            </strong>
            <ul className="rota-list">
              {preview.rotaDays.map((day) => (
                <li key={day.id}>
                  {dateLabel(day.date, locale)}
                  <span>
                    {span(day.open!, day.close!, locale)} at{' '}
                    {placeName(day.locationId ?? org.locationId)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="subtle">
              Change {preview.rotaDays.length === 1 ? 'it' : 'them'} on the{' '}
              <Link to="/business/rota">rota</Link> if {first} should be at {placeName(to)} instead.
            </p>
          </div>
        )}
        {affected.length > 0 && (
          <KeepChoice
            affected={affected}
            value={keep}
            onChange={setKeep}
            locale={locale}
            withDate
            where={`left at ${fromNames}`}
            back={`moving ${first}`}
          />
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          {affected.length > 0 && keep === 'move' ? (
            <Link className="button button-primary" to={`/calendar?date=${affected[0].date}`}>
              Open the calendar
            </Link>
          ) : (
            <Button
              type="submit"
              disabled={
                pending ||
                !command ||
                !preview ||
                !!preview.error ||
                (affected.length > 0 && keep !== 'keep')
              }
            >
              {pending ? 'Saving…' : `Move ${first}`}
            </Button>
          )}
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Back
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Their usual week from the move, day by day: hours and where, or why there are none. */
function MoveWeek({
  preview,
  title,
  placeName,
}: {
  preview: StaffMovePreview
  title: string
  placeName: (id: string) => string
}) {
  const { state } = useStore()
  const locale = state.organisation.locale
  return (
    <div className="move-part">
      <strong>{title}</strong>
      <ul className="rota-list">
        {preview.week.map((day) => (
          <li key={day.day}>
            {WEEKDAYS[day.day]}
            <span>
              {day.working
                ? `${span(day.open!, day.close!, locale)} at ${placeName(day.locationId)}`
                : day.closed
                  ? `${placeName(day.locationId)} is closed, so not working`
                  : 'Not working'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Cancelling a move still to come: their days go back to where they were. Booked visits already
 * made at the new location are named first, with the same choice as the rota.
 */
export function CancelMoveDialog({
  move,
  onClose,
  onDone,
}: {
  move: StaffMove
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const locale = state.organisation.locale
  const today = businessDate(state)
  const [keep, setKeep] = useState<Keep>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const person = state.staff.find((p) => p.id === move.staffId)
  const name = person?.name ?? 'Someone'
  const first = firstName(name)
  const placeName = (id: string) => placeOf(state, id)?.name ?? 'a closed location'
  const command: StaffMoveCommand = { type: 'staff-move-cancel', moveId: move.id }
  const preview = useMemo(() => staffMovePreview(state, command), [state, move.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const affected = preview.error ? [] : preview.affected
  const back = list(moveFrom(move).map(placeName))

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (preview.error || (affected.length && keep !== 'keep')) return
    setPending(true)
    setError('')
    try {
      const result = await commit(affected.length ? { ...command, keepBooked: true } : command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const kept = affected.length
        ? ` ${plural(affected.length, 'booked visit stays', 'booked visits stay')} at ${placeName(move.to)}, marked on the rota.`
        : ''
      onDone(
        `${name}'s move to ${placeName(move.to)} is cancelled. Their days stay at ${back}.${kept}`,
      )
    } catch {
      setError('This could not be saved. Try again.')
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
      title={`Cancel ${first}'s move?`}
      description={`${moveWords(state, move, today)}. Cancelling keeps their days at ${back}. The move stays on record as cancelled.`}
    >
      <form onSubmit={save} className="plan-form rota-day-form">
        {preview.error && (
          <p className="rota-why" role="status">
            {preview.error}
          </p>
        )}
        {affected.length > 0 && (
          <KeepChoice
            affected={affected}
            value={keep}
            onChange={setKeep}
            locale={locale}
            withDate
            where={`left at ${placeName(move.to)}`}
            back="cancelling the move"
          />
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          {affected.length > 0 && keep === 'move' ? (
            <Link className="button button-primary" to={`/calendar?date=${affected[0].date}`}>
              Open the calendar
            </Link>
          ) : (
            <Button
              type="submit"
              disabled={pending || !!preview.error || (affected.length > 0 && keep !== 'keep')}
            >
              {pending ? 'Saving…' : 'Cancel the move'}
            </Button>
          )}
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Keep the move
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * The rota's list of moves between locations: those still to come and those in the last month,
 * cancelled ones included. Owners and managers move someone or cancel a move still to come here.
 */
export function StaffMovesPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const { state, role, blocked } = useStore()
  const today = businessDate(state)
  const canMove = !blocked && can(role, 'staff-move')
  const [moving, setMoving] = useState(false)
  const [cancelling, setCancelling] = useState<StaffMove | null>(null)
  const placeName = (id: string) => placeOf(state, id)?.name ?? 'a closed location'
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'
  const shown = staffMoves(state)
    .filter((m) => m.date >= addDays(today, -31))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const someone = state.staff.some((p) => !p.archived && moveDestinations(state, p.id).length > 0)
  return (
    <section className="surface ops-panel rota-moves" aria-labelledby="moves-heading">
      <header>
        <div>
          <h2 id="moves-heading">Moving between locations</h2>
          <p>Usual days at another location from a date. Days before it stay where they were.</p>
        </div>
        {canMove && someone ? (
          <Button
            variant="secondary"
            onClick={() => {
              setMoving(true)
              onNotice('')
            }}
          >
            Move someone
          </Button>
        ) : (
          <ArrowLeftRight size={21} aria-hidden="true" />
        )}
      </header>
      {shown.length ? (
        <div className="ops-ledger">
          {shown.map((move) => {
            const days = movedWorkdays(state, move)
            return (
              <div className="ops-record" key={move.id}>
                <div className="ops-record-copy">
                  <strong>
                    {name(move.staffId)} · {moveWords(state, move, today)}
                  </strong>
                  <small>
                    {days.length ? weekdaysWords(days) : 'Their usual days'}
                    {move.note ? ` · ${move.note}` : ''}
                    {` · by ${move.actor}`}
                    {move.kept?.length
                      ? ` · ${plural(move.kept.length, 'booked visit', 'booked visits')} kept at ${list(moveFrom(move).map(placeName))}`
                      : ''}
                    {move.rotaKept?.length
                      ? ` · ${plural(move.rotaKept.length, 'changed day', 'changed days')} kept on the rota`
                      : ''}
                    {move.cancelled ? ` · cancelled by ${move.cancelled.actor}` : ''}
                  </small>
                </div>
                {move.cancelled ? (
                  <span className="ops-tag">Cancelled</span>
                ) : (
                  canMove &&
                  cancellable(state, move, today) && (
                    <Button
                      variant="secondary"
                      aria-label={`Cancel ${name(move.staffId)}'s move to ${placeName(move.to)}`}
                      onClick={() => {
                        setCancelling(move)
                        onNotice('')
                      }}
                    >
                      Cancel
                    </Button>
                  )
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="subtle">
          Nobody is moving.{' '}
          {canMove
            ? 'Move someone and their usual days follow them from the day you choose.'
            : 'An owner or manager can move someone from a date.'}
        </p>
      )}
      {moving && (
        <StaffMoveDialog
          onClose={() => setMoving(false)}
          onDone={(message) => {
            setMoving(false)
            onNotice(message)
          }}
        />
      )}
      {cancelling && (
        <CancelMoveDialog
          move={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(message) => {
            setCancelling(null)
            onNotice(message)
          }}
        />
      )}
    </section>
  )
}

/**
 * In someone's details in Settings: any move still to come, which the locations in their weekly
 * hours already show, and the way to move them from a date.
 */
export function StaffMoveEntry({
  staffId,
  allowed,
  onMove,
}: {
  staffId: string
  allowed: boolean
  onMove: () => void
}) {
  const { state } = useStore()
  const today = businessDate(state)
  const coming = comingMove(state, staffId, today)
  const possible = moveDestinations(state, staffId).length > 0
  if (!coming && !(allowed && possible)) return null
  return (
    <div className="ops-wide staff-move-entry">
      <p className="ops-help">
        {coming
          ? `${moveWords(state, coming, today)}. The locations above are from that day on; days before it stay where they were.`
          : 'Moving to another location from a date keeps their usual days and hours, and checks their booked visits first.'}
      </p>
      {allowed && possible && (
        <Button variant="quiet" onClick={onMove}>
          <ArrowLeftRight size={16} aria-hidden="true" /> Move to another location
        </Button>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { businessDate, hoursFor, rotaChangeOn } from '../domain/operations'
import { hasLocations, placeOf, places } from '../domain/locations'
import {
  outsideVisits,
  rotaPreview,
  span,
  usualDay,
  weekCopy,
  weekStillToCome,
} from '../domain/rota'
import type { RotaCommand } from '../domain/rota'
import type { AffectedVisit } from '../domain/schedule'
import { Button, ErrorMessage, Modal, SegmentedControl, TimeField } from '../design'

const clockValue = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const toMinutes = (time: string) =>
  /^\d{2}:\d{2}$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN
const weekdays = (date: string, locale: string) =>
  `${new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))}s`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Choice = 'usual' | 'hours' | 'off'
type Keep = 'move' | 'keep' | null

/**
 * Stage 3: one person's day on the rota, for that date only. As usual, different hours (or an
 * extra day when they do not usually work), or not working. Booked visits the change would leave
 * outside the hours are named, and nothing is saved until the person chooses what happens to them.
 * Stage 4: a general manager (`locationId`) plans the day at their own location only, and the
 * dialog says why when a choice is not theirs to make (src/domain/team.ts).
 */
export function RotaDayDialog({
  staffId,
  date,
  locationId,
  onClose,
  onDone,
}: {
  staffId: string
  date: string
  locationId?: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const locale = org.locale
  const multiSite = hasLocations(state)
  const person = state.staff.find((p) => p.id === staffId)
  const name = person?.name ?? 'They'
  const usual = usualDay(state, staffId, date)
  const existing = rotaChangeOn(state, staffId, date)
  const placeName = (id: string) => placeOf(state, id)?.name ?? ''
  const initialChoice: Choice = existing ? (existing.working ? 'hours' : 'off') : 'hours'
  const initialPlace =
    locationId ??
    (existing?.working && existing.locationId ? existing.locationId : usual.locationId)
  const venue = hoursFor(state, date, initialPlace)
  const initialHours = existing?.working
    ? { open: existing.open!, close: existing.close! }
    : usual.working
      ? { open: usual.open, close: usual.close }
      : venue.closed
        ? { open: 540, close: 1020 }
        : { open: venue.open, close: venue.close }
  const [choice, setChoice] = useState<Choice>(initialChoice)
  const [start, setStart] = useState(clockValue(initialHours.open))
  const [finish, setFinish] = useState(clockValue(initialHours.close))
  const [placeId, setPlaceId] = useState(initialPlace)
  const [note, setNote] = useState(existing?.note ?? '')
  const [keep, setKeep] = useState<Keep>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const there = hoursFor(state, date, placeId)

  const unchanged = existing
    ? choice === initialChoice &&
      (choice !== 'hours' ||
        (toMinutes(start) === initialHours.open &&
          toMinutes(finish) === initialHours.close &&
          placeId === initialPlace)) &&
      note.trim() === (existing.note ?? '')
    : choice === 'usual' ||
      (choice === 'hours' &&
        usual.working &&
        toMinutes(start) === usual.open &&
        toMinutes(finish) === usual.close &&
        placeId === usual.locationId)
  const command: RotaCommand | null = unchanged
    ? null
    : choice === 'usual'
      ? { type: 'rota-day-usual', staffId, date }
      : {
          type: 'rota-day',
          input: {
            staffId,
            date,
            working: choice === 'hours',
            ...(choice === 'hours'
              ? {
                  open: toMinutes(start),
                  close: toMinutes(finish),
                  ...(multiSite ? { locationId: placeId } : {}),
                }
              : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }
  const key = JSON.stringify(command)
  // The same check the server makes, so the screen can say why before anyone saves.
  const preview = useMemo(
    () => (command ? rotaPreview(state, command, undefined, locationId) : null),
    // The command is rebuilt each render; its words decide when to look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, key],
  )
  const affected = preview?.affected ?? []
  const already = outsideVisits(state, staffId, date)
  // A general manager is told where someone usually is on a day at another location, not when.
  const usualWords = !usual.working
    ? `Does not usually work on ${weekdays(date, locale)}.`
    : locationId && usual.locationId !== locationId
      ? `Usually at ${placeName(usual.locationId)} on ${weekdays(date, locale)}.`
      : `Usually ${span(usual.open, usual.close, locale)}${multiSite ? ` at ${placeName(usual.locationId)}` : ''}.`

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || preview?.error || (affected.length && keep !== 'keep')) return
    setPending(true)
    setError('')
    try {
      const result = await commit(affected.length ? { ...command, keepBooked: true } : command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const day = dateLabel(date, locale)
      const kept = affected.length
        ? ` ${plural(affected.length, 'booked visit stays', 'booked visits stay')} outside the hours, marked on the rota.`
        : ''
      onDone(
        choice === 'usual'
          ? `${name} is back to their usual hours on ${day}.${kept}`
          : choice === 'off'
            ? `${name} is not working on ${day}. Their usual hours stay as they are.${kept}`
            : `${name} works ${span(toMinutes(start), toMinutes(finish), locale)} on ${day}${multiSite ? ` at ${placeName(placeId)}` : ''}. Their usual hours stay as they are.${kept}`,
      )
    } catch {
      setError('This could not be saved. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  const options: { value: Choice; label: string }[] = [
    { value: 'usual', label: 'As usual' },
    { value: 'hours', label: usual.working ? 'Different hours' : 'Extra day' },
    ...(usual.working ? [{ value: 'off' as const, label: 'Not working' }] : []),
  ]
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`${name}, ${dateLabel(date, locale)}`}
      description={`${usualWords} A change here is for this day only.`}
    >
      <form onSubmit={save} className="plan-form rota-day-form">
        <SegmentedControl
          label="This day"
          appearance="pill"
          value={choice}
          onChange={(next) => {
            setChoice(next)
            setKeep(null)
            setError('')
          }}
          options={options}
        />
        {existing && (
          <p className="subtle rota-day-was">
            Changed for this day by {existing.actor}.{existing.note ? ` ${existing.note}` : ''}
          </p>
        )}
        {choice === 'usual' && (
          <p className="subtle">
            {existing
              ? `Back to their usual day. ${usualWords}`
              : 'This day follows their usual hours already.'}
          </p>
        )}
        {choice !== 'usual' && (
          <div className="ops-fields">
            {choice === 'hours' && (
              <>
                <label>
                  Starts
                  <TimeField
                    locale={locale}
                    value={start}
                    required
                    from={there.closed ? undefined : clockValue(there.open)}
                    until={there.closed ? undefined : clockValue(Math.min(there.close, 1425))}
                    onChange={(time) => {
                      setStart(time)
                      setKeep(null)
                    }}
                  />
                </label>
                <label>
                  Finishes
                  <TimeField
                    locale={locale}
                    value={finish}
                    required
                    from={there.closed ? undefined : clockValue(Math.min(there.open + 15, 1425))}
                    until={there.closed ? undefined : clockValue(Math.min(there.close, 1425))}
                    onChange={(time) => {
                      setFinish(time)
                      setKeep(null)
                    }}
                  />
                </label>
                {multiSite && locationId && (
                  <p className="subtle ops-wide">At {placeName(locationId)}.</p>
                )}
                {multiSite && !locationId && (
                  <label className="ops-wide">
                    At
                    <select
                      value={placeId}
                      onChange={(e) => {
                        setPlaceId(e.target.value)
                        setKeep(null)
                      }}
                    >
                      {places(state).map((place) => (
                        <option key={place.id} value={place.id}>
                          {place.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <label className="ops-wide">
              Note for the team (optional)
              <input
                value={note}
                maxLength={100}
                placeholder={choice === 'off' ? 'Such as a training day' : 'Such as covering'}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
        )}
        {preview?.error && (
          <p className="rota-why" role="status">
            {preview.error}
          </p>
        )}
        {affected.length > 0 ? (
          <KeepChoice affected={affected} value={keep} onChange={setKeep} locale={locale} />
        ) : (
          already.length > 0 && (
            <div className="rota-keep">
              <strong>
                {plural(already.length, 'booked visit is', 'booked visits are')} outside the hours
                now
              </strong>
              <ul>
                {already.map((a) => (
                  <li key={a.id}>
                    <Link to={`/calendar?date=${a.date}&appointment=${a.id}`}>
                      {timeLabel(a.startMinutes, locale)},{' '}
                      {state.clients
                        .find((c) => c.id === a.clientId)
                        ?.name.trim()
                        .split(/\s+/)[0] ?? 'A client'}
                      ,{' '}
                      {a.bookedServiceName ??
                        state.services.find((x) => x.id === a.serviceId)?.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="subtle">
                They were kept booked when the day changed. Move them in the calendar and this
                warning goes.
              </p>
            </div>
          )
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          {affected.length > 0 && keep === 'move' ? (
            <Link className="button button-primary" to={`/calendar?date=${date}`}>
              Open the calendar
            </Link>
          ) : (
            <Button
              type="submit"
              disabled={
                pending || !command || !!preview?.error || (affected.length > 0 && keep !== 'keep')
              }
            >
              {pending ? 'Saving…' : choice === 'usual' ? 'Put back to usual' : 'Save this day'}
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

/**
 * The booked visits a change would leave outside the hours, by time, first name and treatment,
 * and the choice that has to be made before saving: move them first, or keep them as they are.
 */
function KeepChoice({
  affected,
  value,
  onChange,
  locale,
  withDate = false,
}: {
  affected: AffectedVisit[]
  value: Keep
  onChange: (value: Keep) => void
  locale: string
  withDate?: boolean
}) {
  const one = affected.length === 1
  const shown = affected.slice(0, 8)
  return (
    <fieldset className="rota-keep">
      <legend>
        {one
          ? 'A booked visit would be outside the new hours'
          : `${affected.length} booked visits would be outside the new hours`}
      </legend>
      <ul>
        {shown.map((v) => (
          <li key={v.appointmentId}>
            <strong>
              {withDate ? `${dateLabel(v.date, locale, true)} ` : ''}
              {timeLabel(v.startMinutes, locale)}
            </strong>{' '}
            {v.clientFirstName}
            {v.serviceName ? `, ${v.serviceName}` : ''}
            {withDate ? ` with ${v.staffName}` : ''}
          </li>
        ))}
      </ul>
      {affected.length > shown.length && (
        <p className="subtle">And {affected.length - shown.length} more.</p>
      )}
      <label>
        <input
          type="radio"
          name="rota-keep"
          checked={value === 'move'}
          onChange={() => onChange('move')}
        />
        <span>
          <strong>Move {one ? 'it' : 'them'} first</strong>
          <small>
            Nothing is saved yet. Move {one ? 'it' : 'them'} in the calendar, then come back to this{' '}
            {withDate ? 'week' : 'day'}.
          </small>
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="rota-keep"
          checked={value === 'keep'}
          onChange={() => onChange('keep')}
        />
        <span>
          <strong>Keep {one ? 'it booked as it is' : 'them booked as they are'}</strong>
          <small>
            The rota shows a warning on the day until {one ? 'it is' : 'they are'} moved. Nobody is
            messaged and nothing is cancelled.
          </small>
        </span>
      </label>
    </fieldset>
  )
}

/**
 * Stage 3: a whole week at once. Copy last week's changed days onto the same days this week, or
 * put every change still to come this week back to usual hours. Shows exactly what will happen,
 * what is left out and why, and any booked visits affected, before anything is saved.
 * Stage 4: for a general manager (`locationId`), only their team's days at their location.
 */
export function RotaWeekDialog({
  action,
  monday,
  locationId,
  onClose,
  onDone,
}: {
  action: 'copy' | 'clear'
  monday: string
  locationId?: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const locale = state.organisation.locale
  const today = businessDate(state)
  const [keep, setKeep] = useState<Keep>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'
  const copy = action === 'copy' ? weekCopy(state, monday, today, locationId) : null
  const clearing = action === 'clear' ? weekStillToCome(state, monday, today, locationId) : []
  const rows = copy
    ? copy.copies.map((c) => ({
        key: c.from.id,
        staffId: c.from.staffId,
        date: c.date,
        words: c.plan.working ? span(c.plan.open, c.plan.close, locale) : 'not working',
      }))
    : clearing.map((c) => ({
        key: c.id,
        staffId: c.staffId,
        date: c.date,
        words: `back to usual from ${c.working ? span(c.open!, c.close!, locale) : 'not working'}`,
      }))
  const place = locationId ? { locationId } : {}
  const command: RotaCommand =
    action === 'copy'
      ? { type: 'rota-week-copy', monday, ...place }
      : { type: 'rota-week-clear', monday, ...place }
  const preview = useMemo(
    () => rotaPreview(state, command, undefined, locationId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, action, monday, locationId],
  )
  const affected = preview.affected

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rows.length || preview.error || (affected.length && keep !== 'keep')) return
    setPending(true)
    setError('')
    try {
      const result = await commit(affected.length ? { ...command, keepBooked: true } : command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const kept = affected.length
        ? ` ${plural(affected.length, 'booked visit stays', 'booked visits stay')} outside the hours, marked on the rota.`
        : ''
      onDone(
        action === 'copy'
          ? `${plural(rows.length, 'changed day', 'changed days')} copied from last week. Usual hours stay as they are.${kept}`
          : `${plural(rows.length, 'day is', 'days are')} back to usual hours this week.${kept}`,
      )
    } catch {
      setError('This could not be saved. Nothing has changed; try again.')
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
      title={action === 'copy' ? "Copy last week's changes" : "Clear this week's changes"}
      description={
        action === 'copy'
          ? `Each changed day from the week of ${dateLabel(addDays(monday, -7), locale)} goes onto the same day this week. Usual hours stay as they are.`
          : 'Each changed day still to come this week goes back to usual hours. Days that have passed stay as they were.'
      }
    >
      <form onSubmit={save} className="plan-form">
        {rows.length > 0 ? (
          <ul
            className="rota-list"
            aria-label={action === 'copy' ? 'Days to copy' : 'Days to clear'}
          >
            {rows.map((row) => (
              <li key={row.key}>
                <strong>{name(row.staffId)}</strong>
                <span>
                  {dateLabel(row.date, locale, true)}: {row.words}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">
            {action === 'copy'
              ? 'Nothing from last week can be copied into this week.'
              : 'This week has no changed days still to come.'}
          </p>
        )}
        {copy && copy.skipped.length > 0 && (
          <div className="rota-skipped">
            <strong>Left out</strong>
            <ul className="rota-list">
              {copy.skipped.map((skip) => (
                <li key={skip.from.id}>
                  <strong>{name(skip.from.staffId)}</strong>
                  <span>
                    {dateLabel(skip.date, locale, true)}: {skip.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {rows.length > 0 && preview.error && (
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
                !rows.length ||
                !!preview.error ||
                (affected.length > 0 && keep !== 'keep')
              }
            >
              {pending
                ? 'Saving…'
                : action === 'copy'
                  ? `Copy ${plural(rows.length, 'day', 'days')}`
                  : `Put ${plural(rows.length, 'day', 'days')} back to usual`}
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

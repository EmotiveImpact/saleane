import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarOff, ChevronLeft, ChevronRight, Plus, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations, timeOffKinds } from '../domain/operations'
import type { TimeOff } from '../domain/operations'
import type { OperatingCommand } from '../domain/commandSchema'
import { addDays, dateLabel } from '../domain/format'
import { describeVisit, scheduleImpact } from '../domain/schedule'
import { TIME_OFF_LABEL, holidaySummary, mondayOf, workingDaysAway } from '../domain/timeOff'
import { rotaChanges, rotaWeek, span, weekStillToCome } from '../domain/rota'
import type { RotaDay } from '../domain/rota'
import { hasLocations, placeOf } from '../domain/locations'
import {
  changePlace,
  dayHere,
  dayPlace,
  mayPlanDay,
  onTeam,
  timeOffRefusal,
  usuallyAt,
  weekTeam,
} from '../domain/team'
import {
  Avatar,
  Button,
  ErrorMessage,
  Modal,
  PageHeader,
  useScrollEdges,
  Select,
  Tip,
} from '../design'
import '../components/management.css'
import '../rota.css'
import { StudioDateField } from '../components/StudioDateField'
import { RotaDayDialog, RotaWeekDialog } from '../components/RotaChanges'
import { StaffMovesPanel } from '../components/StaffMove'
import { staffMoves } from '../domain/staffMoves'

/**
 * V2: the week's rota from everyone's usual hours, who is away, and each person's holiday
 * allowance. Time off stops people being booked; it never moves or cancels a visit already booked.
 * Stage 3: owners and managers change one day for one person, or add a day, straight from the week.
 * Stage 4: with more than one location, they move someone to another location from a date, and the
 * week marks the first day there.
 * Stage 4: a general manager sees their own location's team and changes their days there, and
 * their time off, with the same tools; days at another location show where only, and stay read
 * only. src/domain/team.ts decides which, and the server checks the same.
 */
export function Rota() {
  const { state, role, blocked, commit, branch } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const [monday, setMonday] = useState(mondayOf(today))
  const [adding, setAdding] = useState(false)
  // Time off being changed (Stage 4).
  const [editingAway, setEditingAway] = useState<TimeOff | null>(null)
  const [allowanceFor, setAllowanceFor] = useState<string | null>(null)
  // Stage 3: the day being changed, and a whole week being copied or cleared.
  const [changing, setChanging] = useState<{ staffId: string; date: string } | null>(null)
  const [weekly, setWeekly] = useState<'copy' | 'clear' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const canEdit = !blocked && can(role, 'rota')
  // Holiday allowances stay with the owner and managers.
  const canAllow = !blocked && can(role, 'hours')
  // Stage 4: a general manager's own location, whose team they plan.
  const own = role === 'general' && branch ? branch : undefined
  const ownName = own ? (placeOf(state, own)?.name ?? 'your location') : ''
  const team = own ? new Set(weekTeam(state, own, monday).map((p) => p.id)) : null
  const week = rotaWeek(state, monday).filter(({ person }) => !team || team.has(person.id))
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const multiSite = hasLocations(state)
  // Last week has changes to copy, and this week has changes still to come to clear.
  const lastWeek = rotaChanges(state).some(
    (c) =>
      c.date >= addDays(monday, -7) && c.date < monday && (!own || changePlace(state, c) === own),
  )
  const weekAhead = addDays(monday, 6) >= today
  const stillToCome = weekStillToCome(state, monday, today, own).length
  const editable = (staffId: string, day: RotaDay) =>
    canEdit &&
    day.date >= today &&
    (day.state === 'working' || day.state === 'off') &&
    (!own || mayPlanDay(state, own, staffId, day.date))
  /** A general manager's view of a day another location plans: where, and nothing more. */
  const elsewhere = (staffId: string, day: RotaDay) =>
    own &&
    (day.state === 'working' || day.state === 'off') &&
    !dayHere(state, staffId, day.date, own)
      ? (placeOf(state, dayPlace(state, staffId, day.date))?.name ?? 'Another location')
      : null
  /** Time off they may change or cancel: anyone's for owners and managers, their team's for a general manager. */
  const mayChangeAway = (t: TimeOff) =>
    canEdit && !t.cancelledAt && t.to >= today && (!own || !timeOffRefusal(state, own, t))
  const year = Number(today.slice(0, 4))
  const name = (id: string) => state.staff.find((p) => p.id === id)?.name ?? 'Someone'
  // On a narrow screen the week scrolls sideways; the far edge fades while there is more to see.
  const scroller = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scroller)
  // Stage 4: each person's first working day at a new location, when it falls in this week: a
  // weekday the move took, worked at the location it moved to.
  const firstDays = new Set<string>()
  for (const move of staffMoves(state)) {
    if (move.cancelled) continue
    const moved = new Set(move.days.map((d) => d.day))
    const first = week
      .find((row) => row.person.id === move.staffId)
      ?.days.find(
        (day) =>
          day.state === 'working' &&
          day.locationId === move.to &&
          day.date >= move.date &&
          day.date < addDays(move.date, 7) &&
          moved.has(new Date(`${day.date}T12:00:00Z`).getUTCDay()),
      )
    if (first) firstDays.add(`${move.staffId} ${first.date}`)
  }
  // Time off changed to new days shows once, as the newer record, saying who changed it.
  const allAway = operations(state).timeOff ?? []
  const away = allAway
    .filter((t) => t.to >= addDays(today, -31) && !t.changedTo)
    .sort((a, b) => a.from.localeCompare(b.from))
  const daysWords = (t: Pick<TimeOff, 'from' | 'to'>) =>
    t.from === t.to
      ? dateLabel(t.from, org.locale)
      : `${dateLabel(t.from, org.locale, true)} to ${dateLabel(t.to, org.locale, true)}`
  // A general manager's holiday figures are for the people who usually work at their location.
  const holidayTeam = state.staff.filter(
    (person) => !person.archived && (!own || usuallyAt(state, person.id, own, today)),
  )

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
        description={
          own && canEdit
            ? `Your team at ${ownName}. Each week starts from their usual hours. Change one of their days here and their usual hours stay as they are. Days at another location are planned there.`
            : canEdit
              ? "Each week starts from everyone's usual hours. Change one day here and their usual hours stay as they are. Nobody is booked while they are away."
              : "Each week starts from everyone's usual hours, with any day changed for that date marked. Nobody is booked while they are away."
        }
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
            <Tip label="Previous week">
              <Button
                variant="quiet"
                aria-label="Previous week"
                onClick={() => setMonday(addDays(monday, -7))}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
            </Tip>
            <Button variant="secondary" onClick={() => setMonday(mondayOf(today))}>
              This week
            </Button>
            <Tip label="Next week">
              <Button
                variant="quiet"
                aria-label="Next week"
                onClick={() => setMonday(addDays(monday, 7))}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </Tip>
          </div>
        </header>
        {canEdit && weekAhead && (lastWeek || stillToCome > 0) && (
          <details className="rota-more">
            <summary>Change the whole week</summary>
            <div className="rota-more-body">
              <p className="subtle">
                {own
                  ? `Repeat last week's changed days at ${ownName} on the same days this week, or put your team's changes still to come this week back to usual hours.`
                  : "Repeat last week's changed days on the same days this week, or put every change still to come this week back to usual hours."}
              </p>
              <div className="rota-more-actions">
                <Button
                  variant="secondary"
                  disabled={!lastWeek}
                  onClick={() => {
                    setWeekly('copy')
                    setNotice('')
                  }}
                >
                  Copy last week's changes
                </Button>
                <Button
                  variant="secondary"
                  disabled={!stillToCome}
                  onClick={() => {
                    setWeekly('clear')
                    setNotice('')
                  }}
                >
                  Clear this week's changes
                </Button>
              </div>
            </div>
          </details>
        )}
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
                  {days.map((day) => {
                    const there = elsewhere(person.id, day)
                    if (there)
                      return (
                        <td
                          key={day.date}
                          className={`rota-elsewhere${day.date === today ? ' rota-today' : ''}`}
                        >
                          <span>{there}</span>
                          <small>Planned there</small>
                        </td>
                      )
                    const changed = 'change' in day && !!day.change
                    const moved = firstDays.has(`${person.id} ${day.date}`)
                    const cell = (
                      <RotaCell
                        day={day}
                        moved={moved}
                        locale={org.locale}
                        place={
                          multiSite && day.state === 'working'
                            ? placeOf(state, day.locationId)?.name
                            : undefined
                        }
                      />
                    )
                    return (
                      <td
                        key={day.date}
                        className={`rota-${day.state}${changed ? ' rota-changed' : ''}${day.date === today ? ' rota-today' : ''}`}
                      >
                        {editable(person.id, day) ? (
                          <button
                            type="button"
                            className="rota-cell"
                            aria-label={`Change ${person.name}'s day, ${dateLabel(day.date, org.locale)}. ${cellWords(day, org.locale, moved, (id) => placeOf(state, id)?.name ?? 'another location')}`}
                            onClick={() => {
                              setChanging({ staffId: person.id, date: day.date })
                              setNotice('')
                            }}
                          >
                            {cell}
                          </button>
                        ) : (
                          cell
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {own && !week.length && <p className="subtle">Nobody usually works at {ownName} yet.</p>}
        <p className="subtle">
          {own && canEdit
            ? `Choose a day at ${ownName} to change it for that date only, or to add a day for someone on your team. Usual weekly hours are set in Settings by the owner or a manager.`
            : canEdit
              ? "Choose a day to change it for that date only, or to add a day someone does not usually work. Usual hours come from each person's weekly hours in Settings, with single breaks and venue closures."
              : "Usual hours come from each person's weekly hours in Settings. Changed days are marked."}
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
              {away.map((t) => {
                const was = t.changedFrom ? allAway.find((x) => x.id === t.changedFrom) : undefined
                const days = workingDaysAway(state, t)
                return (
                  <div className="ops-record" key={t.id}>
                    <div className="ops-record-copy">
                      <strong>
                        {name(t.staffId)} · {TIME_OFF_LABEL[t.kind]}
                      </strong>
                      <small>
                        {daysWords(t)}
                        {` · ${days} working ${days === 1 ? 'day' : 'days'}`}
                        {t.note ? ` · ${t.note}` : ''}
                        {t.changedFrom
                          ? ` · changed by ${t.actor}${was ? ` (was ${daysWords(was)})` : ''}`
                          : ` · added by ${t.actor}`}
                        {t.cancelledAt ? ` · cancelled by ${t.cancelledBy ?? 'the studio'}` : ''}
                      </small>
                    </div>
                    {t.cancelledAt ? (
                      <span className="ops-tag">Cancelled</span>
                    ) : (
                      mayChangeAway(t) && (
                        <div className="ops-record-controls">
                          <Button
                            variant="secondary"
                            aria-label={`Change ${name(t.staffId)}'s ${TIME_OFF_LABEL[t.kind].toLowerCase()} from ${dateLabel(t.from, org.locale)}`}
                            onClick={() => {
                              setEditingAway(t)
                              setNotice('')
                            }}
                          >
                            Change
                          </Button>
                          <Button
                            variant="quiet"
                            aria-label={`Cancel ${name(t.staffId)}'s ${TIME_OFF_LABEL[t.kind].toLowerCase()} from ${dateLabel(t.from, org.locale)}`}
                            onClick={() => void cancel(t)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="subtle">Nobody has time off recorded.</p>
          )}
        </section>
        <section className="surface ops-panel" aria-labelledby="holiday-heading">
          <header>
            <div>
              <h2 id="holiday-heading">Holiday in {year}</h2>
              <p>
                Working days of holiday booked this year, taken or still to come
                {own ? `, for the people who usually work at ${ownName}` : ''}.
              </p>
            </div>
            <Sun size={21} aria-hidden="true" />
          </header>
          <div className="ops-ledger">
            {holidayTeam.map((person) => {
              const sum = holidaySummary(state, person.id, year)
              return (
                <div className="ops-record" key={person.id}>
                  <div className="ops-record-copy">
                    <strong>{person.name}</strong>
                    <small>
                      {sum.booked} {sum.booked === 1 ? 'day' : 'days'} booked
                      {sum.allowance === undefined ? ' · no allowance set' : ` of ${sum.allowance}`}
                    </small>
                  </div>
                  {sum.left !== undefined && (
                    <span className={`ops-record-money ${sum.left < 0 ? 'rota-over' : ''}`}>
                      {sum.left < 0 ? `${-sum.left} over` : `${sum.left} left`}
                    </span>
                  )}
                  {canAllow && (
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
        {/* Moves are rare, so they come last and run the full width under the two panels. */}
        {(multiSite || staffMoves(state).length > 0) && <StaffMovesPanel onNotice={setNotice} />}
      </div>
      {(adding || editingAway) && (
        <TimeOffDialog
          today={today}
          editing={editingAway ?? undefined}
          locationId={own}
          onClose={() => {
            setAdding(false)
            setEditingAway(null)
          }}
          onDone={(message) => {
            setAdding(false)
            setEditingAway(null)
            setNotice(message)
          }}
        />
      )}
      {changing && (
        <RotaDayDialog
          staffId={changing.staffId}
          date={changing.date}
          locationId={own}
          onClose={() => setChanging(null)}
          onDone={(message) => {
            setChanging(null)
            setNotice(message)
          }}
        />
      )}
      {weekly && (
        <RotaWeekDialog
          action={weekly}
          monday={monday}
          locationId={own}
          onClose={() => setWeekly(null)}
          onDone={(message) => {
            setWeekly(null)
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

/**
 * Stage 4: the one other location where every booked visit outside a working day sits, such as
 * visits kept where someone worked before a move; null when they are outside the hours here.
 */
function keptAt(day: RotaDay) {
  if (day.state !== 'working' || !day.outside.length) return null
  const at = new Set(day.outside.map((a) => a.locationId))
  const [only] = at
  return at.size === 1 && only !== day.locationId ? only : null
}

/** Booked visits that do not fit a day, in words: outside its hours, or still at another location. */
function outsideWords(day: RotaDay, nameOf: (locationId: string) => string) {
  if (!('outside' in day) || !day.outside.length) return ''
  const count = `${day.outside.length} booked ${day.outside.length === 1 ? 'visit' : 'visits'}`
  const elsewhere = keptAt(day)
  if (elsewhere) return `${count} still at ${nameOf(elsewhere)}`
  return `${count} outside ${day.state === 'off' ? 'their hours' : 'these hours'}`
}

/** What one day of the rota shows: hours and where, off or away, and anything changed. */
function RotaCell({
  day,
  locale,
  place,
  moved = false,
}: {
  day: RotaDay
  locale: string
  place?: string
  /** Stage 4: their first working day at a new location. */
  moved?: boolean
}) {
  const tag =
    'kind' in day && day.kind ? (
      <span className="rota-tag">{day.kind === 'extra' ? 'Extra day' : 'Changed'}</span>
    ) : null
  const { state } = useStore()
  const words = outsideWords(day, (id) => placeOf(state, id)?.name ?? 'another location')
  const outside = words ? <small className="rota-warn">{words}</small> : null
  if (day.state === 'working') {
    // Visits kept at another location are counted there, in the warning, not as visits here.
    const here = day.visits - (keptAt(day) ? day.outside.length : 0)
    return (
      <>
        <strong>{span(day.open, day.close, locale)}</strong>
        {place && <small>{place}</small>}
        {here > 0 && (
          <small>
            {here} {here === 1 ? 'visit' : 'visits'}
          </small>
        )}
        {tag}
        {moved && <span className="rota-tag">Moved here</span>}
        {outside}
      </>
    )
  }
  if (day.state === 'away')
    return (
      <>
        <strong>{TIME_OFF_LABEL[day.away.kind]}</strong>
        {day.away.note && <small>{day.away.note}</small>}
      </>
    )
  if (day.state === 'off')
    return (
      <>
        <span>{day.kind ? 'Not working' : 'Off'}</span>
        {tag}
        {outside}
      </>
    )
  return <span>Closed</span>
}

/** A day in words, for the button that opens it. */
function cellWords(
  day: RotaDay,
  locale: string,
  moved: boolean,
  nameOf: (locationId: string) => string,
) {
  const changed =
    'kind' in day && day.kind ? (day.kind === 'extra' ? ' Extra day.' : ' Changed.') : ''
  const words = outsideWords(day, nameOf)
  const outside = words ? ` ${words}.` : ''
  const first = moved ? ' First day at a new location.' : ''
  if (day.state === 'working')
    return `${span(day.open, day.close, locale)}.${changed}${first}${outside}`
  return `Not working.${changed}${outside}`
}

/**
 * Adding time off, or (Stage 4) changing the days, kind or note of time off already recorded. A
 * change keeps the earlier record, cancelled, so who changed what stays on record. For a general
 * manager (`locationId`), only their own team, and only days at their location (team.ts).
 */
function TimeOffDialog({
  today,
  editing,
  locationId,
  onClose,
  onDone,
}: {
  today: string
  editing?: TimeOff
  locationId?: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  // A general manager chooses from people who usually work at their location, and anyone the
  // rota sends there on a day still to come.
  const team = state.staff.filter(
    (p) =>
      !p.archived &&
      (!locationId ||
        usuallyAt(state, p.id, locationId, today) ||
        rotaChanges(state).some(
          (c) => c.staffId === p.id && c.date >= today && onTeam(state, locationId, p.id, c.date),
        )),
  )
  const [staffId, setStaffId] = useState(editing?.staffId ?? team[0]?.id ?? '')
  const [from, setFrom] = useState(editing?.from ?? today)
  const [to, setTo] = useState(editing?.to ?? today)
  const [kind, setKind] = useState<TimeOff['kind']>(editing?.kind ?? 'holiday')
  const [note, setNote] = useState(editing?.note ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from
  const words = { from, to, kind, ...(note.trim() ? { note: note.trim() } : {}) }
  const command: OperatingCommand = editing
    ? { type: 'time-off-change', timeOffId: editing.id, input: words }
    : { type: 'time-off', input: { staffId, ...words } }
  const unchanged =
    !!editing &&
    from === editing.from &&
    to === editing.to &&
    kind === editing.kind &&
    note.trim() === (editing.note ?? '')
  const clashes = valid ? scheduleImpact(state, command, new Date().toISOString()) : []
  const days = valid ? workingDaysAway(state, { staffId, from, to }) : 0
  // The same check the server makes for a general manager, so the screen says why first.
  const refusal =
    locationId && valid && staffId
      ? (timeOffRefusal(state, locationId, { staffId, from, to }) ??
        (editing ? timeOffRefusal(state, locationId, editing) : null))
      : null
  const person =
    (editing
      ? state.staff.find((p) => p.id === editing.staffId)
      : team.find((p) => p.id === staffId)
    )?.name ?? 'They'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) {
      setError('Choose a last day on or after the first day.')
      return
    }
    if (unchanged || refusal) return
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else {
        const when =
          from === to
            ? `on ${dateLabel(from, org.locale)}`
            : `from ${dateLabel(from, org.locale)} to ${dateLabel(to, org.locale)}`
        onDone(
          editing
            ? `${person}'s time off is changed. They are away ${when}, and the earlier days are kept on record.`
            : `${person} is away ${when}. Nobody can book them those days.`,
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
      title={editing ? `Change ${person}'s time off` : 'Add time off'}
      description={
        editing
          ? 'New days, kind or note. The earlier days are kept on record as changed. Visits already booked stay booked, so move them first.'
          : 'For a holiday, sickness or any whole days away. Visits already booked stay booked, so move them first.'
      }
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          {!editing && (
            <label className="ops-wide">
              Who
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
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
            <Select value={kind} onChange={(e) => setKind(e.target.value as TimeOff['kind'])}>
              {timeOffKinds.map((k) => (
                <option key={k} value={k}>
                  {TIME_OFF_LABEL[k]}
                </option>
              ))}
            </Select>
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
        {refusal && (
          <p className="rota-why" role="status">
            {refusal}
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
          <Button
            type="submit"
            disabled={pending || clashes.length > 0 || !staffId || unchanged || !!refusal}
          >
            {pending ? 'Saving…' : editing ? 'Save the change' : 'Save time off'}
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

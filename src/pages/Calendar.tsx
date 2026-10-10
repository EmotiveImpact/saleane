import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, LayoutGrid, List, Repeat2, Users } from 'lucide-react'
import { useStore } from '../state/context'
import { useLiveRefresh } from '../state/useLive'
import { businessMinutes, can } from '../domain/operations'
import { dayAppointments, shownStatus, staffDay } from '../domain/selectors'
import { hasLocations, places, staffLocationOn } from '../domain/locations'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { Avatar, Button, Empty, Status, PageHeader, SegmentedControl } from '../design'
import { Agenda } from '../components/Agenda'
import { PeopleColumns } from '../components/PeopleColumns'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'
import { StudioDateField } from '../components/StudioDateField'
import { CalendarMonth } from '../components/CalendarMonth'
import { CalendarWeek } from '../components/CalendarWeek'
import { addMonths, shownHours, weekStart } from '../components/calendarDays'
import type { BookingDefaults } from '../components/BookingDialog'
import { everyLabel } from '../domain/repeat'
import { othersTogether } from '../domain/together'
import { FULLY_BOOKED_LINE, fullyBooked, pauses } from '../domain/moments'
import '../components/moments.css'

export function Calendar() {
  const { state, today, role, blocked, branch } = useStore()
  useLiveRefresh()
  const [params] = useSearchParams()
  const [date, setDate] = useState(() =>
    /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today,
  )
  const [staffFilter, setStaffFilter] = useState('all')
  // V2: with more than one location, the calendar can show one of them or all.
  const multiSite = hasLocations(state)
  // A general manager opens on their own location.
  const [locationFilter, setLocationFilter] = useState(branch ?? 'all')
  const atPlace = (a: { locationId: string }) =>
    locationFilter === 'all' || a.locationId === locationFilter
  // Calendar lands on today; the switch moves between a day, its week and its month.
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [layout, setLayout] = useState<'grid' | 'agenda'>('grid')
  const view = period === 'day' ? layout : period
  const [booking, setBooking] = useState<BookingDefaults | null>(null)
  // Links from elsewhere (such as affected visits in Manage) can open one visit directly.
  const [appointmentId, setAppointmentId] = useState(() => params.get('appointment') ?? '')
  const day = dayAppointments(state, date).filter(
    (a) => (staffFilter === 'all' || a.staffId === staffFilter) && atPlace(a),
  )
  const staff = state.staff.filter(
    (s) =>
      (!s.archived || day.some((a) => a.staffId === s.id)) &&
      (staffFilter === 'all' || s.id === staffFilter) &&
      (locationFilter === 'all' ||
        staffLocationOn(state, s.id, date) === locationFilter ||
        day.some((a) => a.staffId === s.id)),
  )
  const hours = shownHours(state, date, locationFilter)
  const start = Math.floor(Math.min(hours.open, ...day.map((a) => a.startMinutes)) / 60) * 60
  const end =
    Math.ceil(
      Math.max(
        hours.close,
        ...day.map((a) => a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes),
      ) / 60,
    ) * 60
  const hourCount = Math.max(1, (end - start) / 60)
  const locale = state.organisation.locale
  // The "now" line only belongs on today, inside the hours the grid shows.
  const [clock, setClock] = useState(() => businessMinutes(state))
  useEffect(() => {
    const timer = window.setInterval(() => setClock(businessMinutes(state)), 60_000)
    return () => window.clearInterval(timer)
  }, [state])
  const showNow = date === today && clock >= start && clock <= end
  const nowLine = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (showNow) nowLine.current?.scrollIntoView?.({ block: 'nearest' })
    // Only on arrival at today, not on every minute tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])
  const bookAt = (staffId: string, startMinutes: number) =>
    setBooking({ staffId, date, startMinutes })
  // Dragging a visit proposes a new person and time; the move dialog then checks and confirms it.
  const grid = useRef<HTMLDivElement | null>(null)
  const dragged = useRef(false)
  const [drag, setDrag] = useState<{
    id: string
    grabY: number
    x0: number
    y0: number
    moving: boolean
    staffId: string
    minute: number
    // A finger has to rest on a visit before it moves, so a swipe over the day still scrolls.
    touch?: boolean
    armed?: boolean
  } | null>(null)
  const held = useRef<number | undefined>(undefined)
  const armedNow = useRef(false)
  useEffect(() => {
    armedNow.current = !!drag?.armed
  }, [drag?.armed])
  useEffect(() => {
    const box = grid.current
    if (!box) return
    // Once a visit is held, the finger moves the visit and not the page.
    const stop = (e: TouchEvent) => {
      if (armedNow.current && e.cancelable) e.preventDefault()
    }
    box.addEventListener('touchmove', stop, { passive: false })
    return () => box.removeEventListener('touchmove', stop)
  }, [])
  useEffect(() => () => window.clearTimeout(held.current), [])
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const [proposal, setProposal] = useState<{
    date: string
    staffId: string
    startMinutes: number
  } | null>(null)
  const canDrag = !blocked && can(role, 'reschedule')
  function pointAt(x: number, y: number, grabY: number, length: number) {
    for (const lane of grid.current?.querySelectorAll<HTMLElement>('[data-lane]') ?? []) {
      const box = lane.getBoundingClientRect()
      if (x < box.left || x > box.right) continue
      const minute = start + Math.round(((y - box.top - grabY) / 82) * 4) * 15
      return {
        staffId: lane.dataset.lane!,
        minute: Math.min(Math.max(minute, start), end - Math.max(15, length)),
      }
    }
    return null
  }
  const move = (by: -1 | 1) =>
    setDate(
      period === 'month' ? addMonths(date, by) : addDays(date, period === 'week' ? 7 * by : by),
    )
  const openDay = (next: string) => {
    setDate(next)
    setPeriod('day')
  }
  const unit = period === 'day' ? 'day' : period
  const history = state.appointments
    .filter(
      (a) =>
        a.date === date &&
        (a.status === 'cancelled' || a.status === 'no_show') &&
        (staffFilter === 'all' || a.staffId === staffFilter) &&
        atPlace(a),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)
  // Stage 6: a day with no time left for anyone's shortest treatment says so, once. A general
  // manager's day counts only their own location.
  const full =
    period === 'day' &&
    fullyBooked(state, date, {
      today,
      locationId: branch ?? (locationFilter === 'all' ? undefined : locationFilter),
    })
  return (
    <>
      <PageHeader
        variant="compact"
        eyebrow="Calendar"
        title="Every visit, in its place."
        description="People, rooms and time, working together."
        actions={
          <Button onClick={() => setBooking({})}>
            <Plus size={17} />
            New visit
          </Button>
        }
      />
      <section className="surface calendar-surface">
        <div className="calendar-toolbar">
          <div className="date-controls">
            <button
              className="icon-button"
              aria-label={`Previous ${unit}`}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button className="icon-button" aria-label={`Next ${unit}`} onClick={() => move(1)}>
              <ChevronRight size={18} />
            </button>
            <h2>
              {period === 'week'
                ? `Week of ${dateLabel(weekStart(date), locale)}`
                : period === 'month'
                  ? monthLabel(date, locale)
                  : dateLabel(date, locale)}
            </h2>
          </div>
          <SegmentedControl
            label="Calendar period"
            appearance="pill"
            className="calendar-period"
            // Today reads as chosen only on today itself; another opened day leaves it free to press.
            value={period === 'day' ? (date === today ? 'day' : ('' as 'day')) : period}
            onChange={(next) => {
              if (next === 'day') setDate(today)
              setPeriod(next)
            }}
            options={[
              { value: 'day', label: 'Today' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
          <div className="calendar-filters">
            <label className="calendar-date-picker">
              Jump to date
              <StudioDateField className="date-field-compact" value={date} onChange={setDate} />
            </label>
            <label className="sr-only" htmlFor="staff-filter">
              Filter professional
            </label>
            <select
              id="staff-filter"
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
            >
              <option value="all">All professionals</option>
              {state.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {multiSite && (
              <>
                <label className="sr-only" htmlFor="location-filter">
                  Filter location
                </label>
                <select
                  id="location-filter"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="all">All locations</option>
                  {places(state).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {period === 'day' && (
              <SegmentedControl
                label="Day layout"
                appearance="icon"
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'grid', label: <LayoutGrid size={16} />, accessibleLabel: 'Grid view' },
                  { value: 'agenda', label: <List size={16} />, accessibleLabel: 'Agenda view' },
                ]}
              />
            )}
          </div>
          {full && (
            <p className="fully-booked-line settle-in" role="status">
              {FULLY_BOOKED_LINE}
            </p>
          )}
        </div>
        <div className="calendar-legend">
          <span className="legend-item">
            <span className="legend-dot sage" />
            Skin & wellbeing
          </span>
          <span className="legend-item">
            <span className="legend-dot blue" />
            Body & skin
          </span>
          <span className="legend-item">
            <span className="legend-dot sand" />
            Hair & styling
          </span>
          {/* Only the day's grid draws the turnaround; the week and month show the visits. */}
          {view === 'grid' && <small>Turnaround time shown beneath each visit</small>}
        </div>
        <div className={view === 'grid' ? 'calendar-grid-desktop' : 'hidden'}>
          {canDrag && day.some((a) => a.status === 'confirmed') && (
            <p className="calendar-hint">
              {coarse
                ? 'Hold an upcoming visit, then slide it to move it, or tap a free space to book.'
                : 'Drag an upcoming visit to move it, or click a free space to book.'}
            </p>
          )}
          <div
            className={`calendar-grid${full ? ' is-full' : ''}`}
            ref={grid}
            style={{
              gridTemplateColumns: `66px repeat(${Math.max(1, staff.length)}, minmax(160px, 1fr))`,
            }}
          >
            <div className="calendar-corner">Time</div>
            {staff.map((s) => (
              <div className="calendar-person" key={s.id}>
                <Avatar small identity={s.id} name={s.name} tone={s.tone} />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.role}</small>
                </span>
              </div>
            ))}
            <div className="time-axis" style={{ height: hourCount * 82 }}>
              {Array.from({ length: hourCount + 1 }, (_, i) => (
                <span key={i} style={{ top: i * 82 }}>
                  {timeLabel(start + i * 60, locale)}
                </span>
              ))}
              {showNow && (
                <span className="time-axis-now" style={{ top: ((clock - start) / 60) * 82 }}>
                  {timeLabel(clock, locale)}
                </span>
              )}
            </div>
            {staff.map((s) => (
              <div
                className="calendar-lane"
                style={{ height: hourCount * 82 }}
                key={s.id}
                data-lane={s.id}
                aria-label={`${s.name} visits`}
              >
                {Array.from({ length: hourCount }, (_, i) => (
                  <div className="hour-line" style={{ top: i * 82 }} key={i} />
                ))}
                {/* Stage 6: a gap between two of their visits is a pause, drawn under the free time. */}
                {(() => {
                  const segments = staffDay(state, s.id, date).segments
                  const between = pauses(segments)
                  return segments
                    .filter((segment) => segment.kind === 'free' && between.has(segment.from))
                    .map((segment) => (
                      <div
                        key={`pause-${segment.from}`}
                        className="calendar-pause"
                        aria-hidden="true"
                        style={{
                          top: ((segment.from - start) / 60) * 82,
                          height: ((segment.to - segment.from) / 60) * 82,
                        }}
                      >
                        <span>A pause</span>
                      </div>
                    ))
                })()}
                {date >= today &&
                  staffDay(state, s.id, date)
                    .segments.filter((segment) => segment.kind === 'free')
                    .map((segment) => {
                      // Times already gone today cannot be booked, so the gap starts from now.
                      const from =
                        date === today
                          ? Math.max(segment.from, Math.ceil(clock / 15) * 15)
                          : segment.from
                      // A gap shorter than a comfortable tap (24px) is booked from New visit instead.
                      if (segment.to - from < 15 || ((segment.to - from) / 60) * 82 < 24)
                        return null
                      return (
                        <button
                          type="button"
                          key={segment.from}
                          className="calendar-free"
                          style={{
                            top: ((from - start) / 60) * 82,
                            height: ((segment.to - from) / 60) * 82,
                          }}
                          aria-label={`Book with ${s.name} from ${timeLabel(from, locale)}`}
                          onMouseMove={(e) => {
                            const box = e.currentTarget.getBoundingClientRect()
                            const minute = from + Math.floor(((e.clientY - box.top) / 82) * 4) * 15
                            const shown = Math.min(minute, segment.to - 15)
                            e.currentTarget.dataset.time = timeLabel(shown, locale)
                            e.currentTarget.style.setProperty(
                              '--hover-y',
                              `${((shown - from) / 60) * 82}px`,
                            )
                          }}
                          onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect()
                            // A keyboard press has no pointer position, so it books the start of the gap.
                            const offset = e.detail ? e.clientY - box.top : 0
                            const minute = from + Math.floor((offset / 82) * 4) * 15
                            bookAt(s.id, Math.min(Math.max(minute, from), segment.to - 15))
                          }}
                        />
                      )
                    })}
                {drag?.moving && drag.staffId === s.id && (
                  <div
                    className="calendar-ghost"
                    aria-hidden
                    style={{
                      top: ((drag.minute - start) / 60) * 82,
                      height:
                        ((day.find((a) => a.id === drag.id)?.bookedDurationMinutes ?? 60) / 60) *
                          82 -
                        3,
                    }}
                  >
                    Move to {timeLabel(drag.minute, locale)}
                  </div>
                )}
                {showNow && (
                  <div
                    className="now-line"
                    ref={nowLine}
                    style={{ top: ((clock - start) / 60) * 82 }}
                    aria-hidden
                  />
                )}
                {day
                  .filter((a) => a.staffId === s.id)
                  .map((a) => {
                    const client = state.clients.find((c) => c.id === a.clientId)!
                    const service = state.services.find((service) => service.id === a.serviceId)!
                    return (
                      <div
                        key={a.id}
                        className="calendar-event-wrap"
                        style={{
                          top: ((a.startMinutes - start) / 60) * 82,
                          height: ((a.bookedDurationMinutes + a.bookedBufferMinutes) / 60) * 82,
                        }}
                      >
                        <button
                          className={`calendar-event tone-${s.tone} ${a.status === 'completed' ? 'event-completed' : ''} ${drag?.moving && drag.id === a.id ? 'event-dragging' : ''} ${drag?.touch && drag.armed && !drag.moving && drag.id === a.id ? 'event-held' : ''} ${canDrag && a.status === 'confirmed' ? 'event-movable' : ''}`}
                          style={{ height: (a.bookedDurationMinutes / 60) * 82 - 3 }}
                          onPointerDown={(e) => {
                            if (!canDrag || a.status !== 'confirmed' || e.button !== 0) return
                            const touch = e.pointerType === 'touch'
                            e.currentTarget.setPointerCapture?.(e.pointerId)
                            setDrag({
                              id: a.id,
                              grabY: e.clientY - e.currentTarget.getBoundingClientRect().top,
                              x0: e.clientX,
                              y0: e.clientY,
                              moving: false,
                              staffId: s.id,
                              minute: a.startMinutes,
                              touch,
                              armed: !touch,
                            })
                            window.clearTimeout(held.current)
                            if (touch)
                              held.current = window.setTimeout(() => {
                                setDrag((d) => (d?.id === a.id ? { ...d, armed: true } : d))
                                navigator.vibrate?.(8)
                              }, 320)
                          }}
                          onContextMenu={(e) => {
                            // A long press is how a finger picks a visit up, not a menu.
                            if (canDrag && a.status === 'confirmed') e.preventDefault()
                          }}
                          onPointerMove={(e) => {
                            if (drag?.id !== a.id) return
                            if (drag.touch && !drag.armed) {
                              // Moving before the hold is a swipe: let the page scroll.
                              if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= 8) {
                                window.clearTimeout(held.current)
                                setDrag(null)
                              }
                              return
                            }
                            if (
                              !drag.moving &&
                              Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6
                            )
                              return
                            const point = pointAt(
                              e.clientX,
                              e.clientY,
                              drag.grabY,
                              a.bookedDurationMinutes + a.bookedBufferMinutes,
                            )
                            if (point) setDrag({ ...drag, moving: true, ...point })
                          }}
                          onPointerUp={() => {
                            window.clearTimeout(held.current)
                            if (drag?.id !== a.id) return
                            if (drag.moving) {
                              dragged.current = true
                              if (drag.staffId !== a.staffId || drag.minute !== a.startMinutes) {
                                setProposal({
                                  date,
                                  staffId: drag.staffId,
                                  startMinutes: drag.minute,
                                })
                                setAppointmentId(a.id)
                              }
                            }
                            setDrag(null)
                          }}
                          onPointerCancel={() => {
                            window.clearTimeout(held.current)
                            setDrag(null)
                          }}
                          onClick={() => {
                            if (dragged.current) {
                              dragged.current = false
                              return
                            }
                            setAppointmentId(a.id)
                          }}
                          data-selected={appointmentId === a.id ? '' : undefined}
                          aria-haspopup="dialog"
                          aria-expanded={appointmentId === a.id}
                        >
                          <span>
                            {timeLabel(a.startMinutes, state.organisation.locale)}{' '}
                            <Status status={shownStatus(a)} />
                            {a.repeat && (
                              <Repeat2
                                className="block-repeat"
                                size={13}
                                role="img"
                                aria-label={`Repeats ${everyLabel(a.repeat.everyWeeks)}`}
                              />
                            )}
                            {a.together &&
                              (() => {
                                const others = othersTogether(state, a).length
                                return others > 0 ? (
                                  <Users
                                    className="block-together"
                                    size={13}
                                    role="img"
                                    aria-label={`Booked with ${others} ${others === 1 ? 'other' : 'others'}`}
                                  />
                                ) : null
                              })()}
                          </span>{' '}
                          <strong>{client.name}</strong> <small>{service.name}</small>
                        </button>
                        <span className="buffer-block">{a.bookedBufferMinutes} min turnaround</span>
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
        {view === 'week' ? (
          <CalendarWeek
            date={date}
            staffFilter={staffFilter}
            locationFilter={locationFilter}
            selectedId={appointmentId}
            now={clock}
            onOpen={setAppointmentId}
            onDay={openDay}
          />
        ) : view === 'month' ? (
          <CalendarMonth
            date={date}
            staffFilter={staffFilter}
            locationFilter={locationFilter}
            selectedId={appointmentId}
            onOpen={setAppointmentId}
            onDay={openDay}
          />
        ) : view === 'grid' ? (
          <div className="calendar-mobile-people">
            <PeopleColumns
              staff={staff}
              date={date}
              selectedId={appointmentId}
              onOpen={setAppointmentId}
              onBook={date >= today ? bookAt : undefined}
              notBefore={date === today ? Math.ceil(clock / 15) * 15 : 0}
            />
          </div>
        ) : (
          <Agenda appointments={day} selectedId={appointmentId} onOpen={setAppointmentId} />
        )}
        {!day.length && view === 'grid' && (
          <div className="calendar-grid-desktop">
            <Empty title="A clear day">Use New visit to reserve a time.</Empty>
          </div>
        )}
      </section>
      {period === 'day' && history.length > 0 && (
        <section className="surface calendar-history">
          <div className="section-heading">
            <div>
              <h2>Changes to this day</h2>
              <p>
                Cancelled and missed visits stay in the relationship history. Their reserved time is
                available again.
              </p>
            </div>
            <span>
              {history.length} {history.length === 1 ? 'visit' : 'visits'}
            </span>
          </div>
          <Agenda appointments={history} selectedId={appointmentId} onOpen={setAppointmentId} />
          <p className="history-note">
            Recorded deposits are retained for review. No automatic refund or fee has been applied.
          </p>
        </section>
      )}
      {booking && (
        <BookingDialog
          defaults={
            booking.staffId
              ? booking
              : {
                  date: date < today ? today : date,
                  staffId: staffFilter === 'all' ? undefined : staffFilter,
                  serviceId:
                    staffFilter === 'all'
                      ? undefined
                      : state.staff.find((s) => s.id === staffFilter)?.serviceIds[0],
                }
          }
          onClose={() => setBooking(null)}
        />
      )}
      {appointmentId && (
        <AppointmentDialog
          key={`${appointmentId}-${proposal ? `${proposal.staffId}-${proposal.startMinutes}` : ''}`}
          appointmentId={appointmentId}
          proposal={proposal ?? undefined}
          onClose={() => {
            setAppointmentId('')
            setProposal(null)
          }}
          onMoved={(nextDate, nextStaffId) => {
            setDate(nextDate)
            if (staffFilter !== 'all') setStaffFilter(nextStaffId)
          }}
          onOpenVisit={(id) => {
            setProposal(null)
            setAppointmentId(id)
          }}
        />
      )}
    </>
  )
}

function monthLabel(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 7)}-01T12:00:00Z`))
}

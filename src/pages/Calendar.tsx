import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, LayoutGrid, List } from 'lucide-react'
import { useStore } from '../state/context'
import { hoursFor } from '../domain/operations'
import { dayAppointments } from '../domain/selectors'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { Avatar, Button, Empty, Status, PageHeader, SegmentedControl } from '../design'
import { Agenda } from '../components/Agenda'
import { PeopleColumns } from '../components/PeopleColumns'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'

export function Calendar() {
  const { state, today } = useStore()
  const [params] = useSearchParams()
  const [date, setDate] = useState(() =>
    /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today,
  )
  const [staffFilter, setStaffFilter] = useState('all')
  const [view, setView] = useState<'grid' | 'agenda'>('grid')
  const [booking, setBooking] = useState(false)
  const [appointmentId, setAppointmentId] = useState('')
  const day = dayAppointments(state, date).filter(
    (a) => staffFilter === 'all' || a.staffId === staffFilter,
  )
  const staff = state.staff.filter(
    (s) =>
      (!s.archived || day.some((a) => a.staffId === s.id)) &&
      (staffFilter === 'all' || s.id === staffFilter),
  )
  const hours = hoursFor(state, date)
  const start =
    Math.floor(Math.min(hours?.open ?? 540, ...day.map((a) => a.startMinutes)) / 60) * 60
  const end =
    Math.ceil(
      Math.max(
        hours?.close ?? 1080,
        ...day.map((a) => a.startMinutes + a.bookedDurationMinutes + a.bookedBufferMinutes),
      ) / 60,
    ) * 60
  const hourCount = Math.max(1, (end - start) / 60)
  const history = state.appointments
    .filter(
      (a) =>
        a.date === date &&
        (a.status === 'cancelled' || a.status === 'no_show') &&
        (staffFilter === 'all' || a.staffId === staffFilter),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)
  return (
    <>
      <PageHeader
        variant="compact"
        title="Calendar"
        description="People, spaces and time, working together."
        actions={
          <Button onClick={() => setBooking(true)}>
            <Plus size={17} />
            New appointment
          </Button>
        }
      />
      <section className="surface calendar-surface">
        <div className="calendar-toolbar">
          <div className="date-controls">
            <button
              className="icon-button"
              aria-label="Previous day"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next day"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight size={18} />
            </button>
            <h2>{dateLabel(date, state.organisation.locale)}</h2>
            <Button variant="secondary" onClick={() => setDate(today)}>
              Today
            </Button>
          </div>
          <div className="calendar-filters">
            <label className="calendar-date-picker">
              Jump to date
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value)
                }}
              />
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
            <SegmentedControl
              label="Calendar display"
              appearance="icon"
              value={view}
              onChange={setView}
              options={[
                { value: 'grid', label: <LayoutGrid size={16} />, accessibleLabel: 'Grid view' },
                { value: 'agenda', label: <List size={16} />, accessibleLabel: 'Agenda view' },
              ]}
            />
          </div>
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
          <small>Turnaround time shown beneath each visit</small>
        </div>
        <div className={view === 'grid' ? 'calendar-grid-desktop' : 'hidden'}>
          <div
            className="calendar-grid"
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
                  {timeLabel(start + i * 60, state.organisation.locale)}
                </span>
              ))}
            </div>
            {staff.map((s) => (
              <div
                className="calendar-lane"
                style={{ height: hourCount * 82 }}
                key={s.id}
                aria-label={`${s.name} appointments`}
              >
                {Array.from({ length: hourCount }, (_, i) => (
                  <div className="hour-line" style={{ top: i * 82 }} key={i} />
                ))}
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
                          className={`calendar-event tone-${s.tone} ${a.status === 'completed' ? 'event-completed' : ''}`}
                          style={{ height: (a.bookedDurationMinutes / 60) * 82 - 3 }}
                          onClick={() => setAppointmentId(a.id)}
                          data-selected={appointmentId === a.id ? '' : undefined}
                          aria-haspopup="dialog"
                          aria-expanded={appointmentId === a.id}
                          aria-label={`${client.name}, ${service.name}, ${timeLabel(a.startMinutes, state.organisation.locale)}, ${s.name}, ${a.status}`}
                        >
                          <span>
                            {timeLabel(a.startMinutes, state.organisation.locale)}{' '}
                            <Status status={a.status} />
                          </span>
                          <strong>{client.name}</strong>
                          <small>{service.name}</small>
                        </button>
                        <span className="buffer-block">{a.bookedBufferMinutes} min turnaround</span>
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
        {view === 'grid' ? (
          <div className="calendar-mobile-people">
            <PeopleColumns
              staff={staff}
              date={date}
              selectedId={appointmentId}
              onOpen={setAppointmentId}
            />
          </div>
        ) : (
          <Agenda appointments={day} selectedId={appointmentId} onOpen={setAppointmentId} />
        )}
        {!day.length && view === 'grid' && (
          <div className="calendar-grid-desktop">
            <Empty title="A clear day">Use New appointment to reserve a time.</Empty>
          </div>
        )}
      </section>
      {history.length > 0 && (
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
          defaults={{
            date: date < today ? today : date,
            staffId: staffFilter === 'all' ? undefined : staffFilter,
            serviceId:
              staffFilter === 'all'
                ? undefined
                : state.staff.find((s) => s.id === staffFilter)?.serviceIds[0],
          }}
          onClose={() => setBooking(false)}
        />
      )}
      {appointmentId && (
        <AppointmentDialog
          key={appointmentId}
          appointmentId={appointmentId}
          onClose={() => setAppointmentId('')}
          onMoved={(nextDate, nextStaffId) => {
            setDate(nextDate)
            if (staffFilter !== 'all') setStaffFilter(nextStaffId)
          }}
        />
      )}
    </>
  )
}

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, LayoutGrid, List } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { dayAppointments } from '../domain/selectors'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { Avatar, Button, Empty, Status } from '../components/ui'
import { Agenda } from '../components/Agenda'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'

export function Calendar() {
  const { state } = useStore()
  const [date, setDate] = useState(DEMO_DATE)
  const [staffFilter, setStaffFilter] = useState('all')
  const [view, setView] = useState<'grid' | 'agenda'>('grid')
  const [booking, setBooking] = useState(false)
  const [appointmentId, setAppointmentId] = useState('')
  const day = dayAppointments(state, date).filter(
    (a) => staffFilter === 'all' || a.staffId === staffFilter,
  )
  const staff = state.staff.filter((s) => staffFilter === 'all' || s.id === staffFilter)
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="date-caption">A place for every appointment</p>
          <h1>Calendar</h1>
          <p>People, spaces and time, working together.</p>
        </div>
        <Button onClick={() => setBooking(true)}>
          <Plus size={17} />
          New appointment
        </Button>
      </div>
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
            <Button variant="secondary" onClick={() => setDate(DEMO_DATE)}>
              Today
            </Button>
          </div>
          <div className="calendar-filters">
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
            <div className="view-toggle" aria-label="Calendar display">
              <button
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
                aria-label="Grid view"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-pressed={view === 'agenda'}
                onClick={() => setView('agenda')}
                aria-label="Agenda view"
              >
                <List size={16} />
              </button>
            </div>
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
            style={{ gridTemplateColumns: `66px repeat(${staff.length}, minmax(160px, 1fr))` }}
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
            <div className="time-axis">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} style={{ top: i * 82 }}>
                  {timeLabel(540 + i * 60, state.organisation.locale)}
                </span>
              ))}
            </div>
            {staff.map((s) => (
              <div className="calendar-lane" key={s.id} aria-label={`${s.name} appointments`}>
                {Array.from({ length: 9 }, (_, i) => (
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
                          top: ((a.startMinutes - 540) / 60) * 82,
                          height: ((a.bookedDurationMinutes + a.bookedBufferMinutes) / 60) * 82,
                        }}
                      >
                        <button
                          className={`calendar-event tone-${s.tone} ${a.status === 'completed' ? 'event-completed' : ''}`}
                          style={{ height: (a.bookedDurationMinutes / 60) * 82 - 3 }}
                          onClick={() => setAppointmentId(a.id)}
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
        <div className={view === 'agenda' ? '' : 'calendar-mobile-agenda'}>
          <Agenda appointments={day} onOpen={setAppointmentId} />
        </div>
        {!day.length && view === 'grid' && (
          <Empty title="A clear day">Use New appointment to reserve a time.</Empty>
        )}
      </section>
      {booking && (
        <BookingDialog
          defaults={{
            date: date < DEMO_DATE ? DEMO_DATE : date,
            staffId: staffFilter === 'all' ? undefined : staffFilter,
            serviceId:
              staffFilter === 'all'
                ? undefined
                : state.staff.find((s) => s.id === staffFilter)!.serviceIds[0],
          }}
          onClose={() => setBooking(false)}
        />
      )}
      {appointmentId && (
        <AppointmentDialog
          key={appointmentId}
          appointmentId={appointmentId}
          onClose={() => setAppointmentId('')}
        />
      )}
    </>
  )
}

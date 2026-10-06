import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Plus, Leaf, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { dayAppointments, dueClients } from '../domain/selectors'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, Metric } from '../components/ui'
import { Agenda } from '../components/Agenda'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'
import type { BookingDefaults } from '../components/BookingDialog'

export function Today() {
  const { state } = useStore()
  const [appointmentId, setAppointmentId] = useState('')
  const [booking, setBooking] = useState<BookingDefaults | null>(null)
  const [hideCompleted, setHideCompleted] = useState(false)
  const day = dayAppointments(state)
  const due = dueClients(state)
  const tomorrow = addDays(DEMO_DATE, 1)
  const available = slots(state, 'service-facial', 'staff-maya', tomorrow)
  const booked = day.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
  const completed = day.filter((a) => a.status === 'completed').length
  const changed = state.appointments.filter(
    (a) => a.date === DEMO_DATE && (a.status === 'cancelled' || a.status === 'no_show'),
  )
  const utilisation = Math.round(
    (day.reduce((sum, a) => sum + a.bookedDurationMinutes, 0) / (state.staff.length * 540)) * 100,
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="date-caption">
            <Sun size={16} />
            {dateLabel(DEMO_DATE, state.organisation.locale)}
          </p>
          <h1>Good morning, Maya.</h1>
          <p>Everything you need to give today your best.</p>
        </div>
        <Button onClick={() => setBooking({ date: DEMO_DATE })}>
          <Plus size={17} />
          New appointment
        </Button>
      </div>
      <div className="metrics-band">
        <Metric
          label="Booked for today"
          value={money(booked, state.organisation)}
          detail="Service value, before tips"
        />
        <Metric
          label="Appointments"
          value={day.length}
          detail={`${completed} complete · ${day.length - completed} still to come`}
        />
        <Metric
          label="Time well filled"
          value={`${utilisation}%`}
          detail="Of available professional hours"
        />
        <Metric label="Ready to return" value={due.length} detail="Clients with no next visit" />
      </div>
      <div className="today-layout">
        <section className="surface schedule-surface">
          <div className="section-heading">
            <div>
              <h2>The day ahead</h2>
              <p>A welcome, a little care, a reason to come back.</p>
            </div>
            <Link className="text-link" to="/calendar">
              Open calendar <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="schedule-toolbar">
            <span>
              <span className="live-dot" />
              {day.filter((a) => a.status === 'arrived').length} in the studio
            </span>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
              />
              Hide completed
            </label>
          </div>
          <Agenda
            appointments={hideCompleted ? day.filter((a) => a.status !== 'completed') : day}
            selectedId={appointmentId}
            onOpen={setAppointmentId}
          />
          {changed.length > 0 && (
            <Link className="day-changes-link" to="/calendar">
              {changed.filter((a) => a.status === 'cancelled').length} cancelled ·{' '}
              {changed.filter((a) => a.status === 'no_show').length} missed. Review today’s changes{' '}
              <ArrowUpRight size={14} />
            </Link>
          )}
        </section>
        <aside className="today-aside">
          <section className="intelligence-panel">
            <div className="intelligence-symbol">
              <Leaf size={22} />
              <span>Saleane noticed</span>
            </div>
            <h2>
              Make room for
              <br /> a familiar face.
            </h2>
            <p>
              {due.length
                ? `${due.length} clients last visited at least four weeks ago and haven’t booked their next visit.`
                : 'Every returning client has a visit in the calendar. A good rhythm to keep.'}
            </p>
            <div className="insight-fact">
              <span>Tomorrow with Maya</span>
              <strong>
                {available.length
                  ? `${timeLabel(available[0], state.organisation.locale)} available`
                  : 'Fully booked'}
              </strong>
              <small>Skin Renewal Facial · 60 minutes</small>
            </div>
            {due.length > 0 && available.length > 0 && (
              <Button
                variant="light"
                onClick={() =>
                  setBooking({
                    clientId: due[0].id,
                    serviceId: 'service-facial',
                    staffId: 'staff-maya',
                    date: tomorrow,
                  })
                }
              >
                Review a return visit <ArrowRight size={16} />
              </Button>
            )}
            <small className="insight-source">
              Based on visit history and calendar availability. No outreach sent.
            </small>
          </section>
          <section className="team-panel">
            <div className="section-heading">
              <h2>Your people today</h2>
              <span>{state.staff.length} on the floor</span>
            </div>
            {state.staff.map((staff) => {
              const visits = day.filter((a) => a.staffId === staff.id)
              const percent = Math.round(
                (visits.reduce((sum, a) => sum + a.bookedDurationMinutes, 0) / 540) * 100,
              )
              return (
                <div className="team-row" key={staff.id}>
                  <Avatar identity={staff.id} name={staff.name} small tone={staff.tone} />
                  <div>
                    <strong>{staff.name.split(' ')[0]}</strong>
                    <small>
                      {visits.length} visits · {percent}% booked
                    </small>
                    <div className={`capacity-bar tone-${staff.tone}`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
          <Link className="booking-prompt" to="/booking">
            <span className="mini-wordmark">AH</span>
            <span>
              <strong>Your booking experience</strong>
              <small>See what your clients see</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        </aside>
      </div>
      {appointmentId && (
        <AppointmentDialog
          key={appointmentId}
          appointmentId={appointmentId}
          onClose={() => setAppointmentId('')}
        />
      )}
      {booking && <BookingDialog defaults={booking} onClose={() => setBooking(null)} />}
    </>
  )
}

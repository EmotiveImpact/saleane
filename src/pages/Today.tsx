import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Plus, Leaf, Printer, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { availableMinutes, bookedTimeShare, dayAppointments, dueClients } from '../domain/selectors'
import { bookedTimeDefinition } from '../components/definitions'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, Metric, PageHeader } from '../design'
import { Agenda } from '../components/Agenda'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'
import type { BookingDefaults } from '../components/BookingDialog'

export function Today() {
  const { state, today, session } = useStore()
  const [appointmentId, setAppointmentId] = useState('')
  const [booking, setBooking] = useState<BookingDefaults | null>(null)
  const [hideCompleted, setHideCompleted] = useState(false)
  const day = dayAppointments(state)
  const due = dueClients(state)
  const tomorrow = addDays(today, 1)
  const professional = state.staff.find(
    (p) =>
      !p.archived &&
      p.serviceIds.some((id) => state.services.some((s) => s.id === id && !s.archived)),
  )
  const service = state.services.find((s) => !s.archived && professional?.serviceIds.includes(s.id))
  const available =
    professional && service ? slots(state, service.id, professional.id, tomorrow) : []
  const booked = day.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
  const completed = day.filter((a) => a.status === 'completed').length
  const changed = state.appointments.filter(
    (a) => a.date === today && (a.status === 'cancelled' || a.status === 'no_show'),
  )
  const utilisation = Math.round(bookedTimeShare(state, today) * 100)
  return (
    <>
      <PageHeader
        variant="editorial"
        eyebrow={
          <>
            <Sun size={16} />
            {dateLabel(today, state.organisation.locale)}
          </>
        }
        title={session ? `Welcome, ${session.user.name.split(' ')[0]}.` : 'A good day begins here.'}
        description="Everything you need to give today your best."
        actions={
          <>
            <Link className="button button-secondary" to="/day-sheet">
              <Printer size={16} />
              Day sheet
            </Link>
            <Button onClick={() => setBooking({ date: today })}>
              <Plus size={17} />
              New appointment
            </Button>
          </>
        }
      />
      <div className="metrics-band">
        <Metric
          label="Booked for today"
          value={money(booked, state.organisation)}
          detail="Before discounts, tax adjustments and tips"
        />
        <Metric
          label="Appointments"
          value={day.length}
          detail={`${completed} complete · ${day.length - completed} still to come`}
        />
        <Metric
          label="Time booked"
          value={`${utilisation}%`}
          detail="Today, of open professional hours"
          definition={bookedTimeDefinition.map((line) => (
            <p key={line}>{line}</p>
          ))}
        />
        <Metric label="Ready to return" value={due.length} detail="Clients with no next visit" />
      </div>
      {!state.services.length && (
        <section className="surface setup-prompt">
          <h2>Let’s make this your studio.</h2>
          <p>
            Add your services, professionals and spaces, then set opening hours. Your first
            appointment brings the day to life.
          </p>
          <Link className="button button-primary" to="/business/manage">
            Set up your studio <ArrowRight size={16} />
          </Link>
        </section>
      )}
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
                : state.appointments.some((a) => a.status === 'completed')
                  ? 'Every returning client has a visit in the calendar. A good rhythm to keep.'
                  : 'No return visits to review yet. Relationship history will grow with each completed visit.'}
            </p>
            <div className="insight-fact">
              <span>
                {professional
                  ? `Tomorrow with ${professional.name.split(' ')[0]}`
                  : 'Your next opening'}
              </span>
              <strong>
                {available.length
                  ? `${timeLabel(available[0], state.organisation.locale)} available`
                  : 'No bookable times'}
              </strong>
              <small>
                {service
                  ? `${service.name} · ${service.durationMinutes} minutes`
                  : 'Add your services and people to begin'}
              </small>
            </div>
            {due.length > 0 && available.length > 0 && (
              <Button
                variant="light"
                onClick={() =>
                  setBooking({
                    clientId: due[0].id,
                    serviceId: service?.id,
                    staffId: professional?.id,
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
              <span>{state.staff.filter((p) => !p.archived).length} professionals</span>
            </div>
            {state.staff
              .filter((p) => !p.archived)
              .map((staff) => {
                const visits = day.filter((a) => a.staffId === staff.id)
                const percent = Math.round(
                  (visits.reduce((sum, a) => sum + a.bookedDurationMinutes, 0) /
                    (availableMinutes({ ...state, staff: [staff] }, today) || 1)) *
                    100,
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
            <span className="mini-wordmark">
              {state.organisation.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
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

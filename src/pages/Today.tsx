import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Plus, Printer } from 'lucide-react'
import { GetReady } from '../components/GetReady'
import { useStore } from '../state/context'
import { useLiveRefresh } from '../state/useLive'
import { bookedTimeShare, dayAppointments, dueClients } from '../domain/selectors'
import { bookedTimeDefinition } from '../components/definitions'
import { dateLabel, money } from '../domain/format'
import { Button, Metric, photos } from '../design'
import { businessMinutes } from '../domain/operations'
import type { Appointment, Client } from '../domain/model'
import { Agenda } from '../components/Agenda'
import { SmartInsights } from '../components/SmartInsights'
import { Specials } from '../components/Specials'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'
import { NeedsYou } from '../components/NeedsYou'
import { TeamToday } from '../components/TeamToday'
import type { BookingDefaults } from '../components/BookingDialog'

function greeting(minutes: number) {
  if (minutes < 12 * 60) return 'Good morning'
  if (minutes < 17 * 60) return 'Good afternoon'
  return 'Good evening'
}

const counts = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const spell = (n: number) => counts[n] ?? String(n)

/** One calm sentence about the day, built only from what the calendar records. */
function daySummary(day: Appointment[], clients: Client[], all: Appointment[]) {
  if (!day.length) return 'Nothing is booked today yet. Open time is ready for whoever comes next.'
  const guests = new Set(day.map((a) => a.clientId))
  const firstVisits = [...guests].filter(
    (id) => !all.some((a) => a.clientId === id && a.status === 'completed' && !day.includes(a)),
  ).length
  const inRoom = day.find((a) => a.status === 'arrived')
  const name = inRoom && clients.find((c) => c.id === inRoom.clientId)?.name.split(' ')[0]
  const people = `${spell(guests.size)} ${guests.size === 1 ? 'guest' : 'guests'} today`
  const fresh = firstVisits
    ? `, ${firstVisits === guests.size ? 'all' : spell(firstVisits).toLowerCase()} of them new`
    : ''
  const now = name ? ` ${name} is in the studio now.` : ''
  return `${people}${fresh}.${now}`
}

export function Today() {
  const { state, today, session } = useStore()
  useLiveRefresh()
  const [appointmentId, setAppointmentId] = useState('')
  const [booking, setBooking] = useState<BookingDefaults | null>(null)
  const [hideCompleted, setHideCompleted] = useState(false)
  const day = dayAppointments(state)
  const due = dueClients(state)
  const booked = day.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
  const completed = day.filter((a) => a.status === 'completed').length
  const changed = state.appointments.filter(
    (a) => a.date === today && (a.status === 'cancelled' || a.status === 'no_show'),
  )
  const utilisation = Math.round(bookedTimeShare(state, today) * 100)
  return (
    <>
      <section className="greeting" aria-labelledby="greeting-title">
        <div className="greeting-copy">
          <p className="eyebrow">{dateLabel(today, state.organisation.locale)}</p>
          <h1 id="greeting-title">
            {greeting(businessMinutes(state))}
            {session ? `, ${session.user.name.split(' ')[0]}.` : '.'}
          </h1>
          <p className="greeting-summary">{daySummary(day, state.clients, state.appointments)}</p>
          <div className="page-actions">
            <Button onClick={() => setBooking({ date: today })}>
              <Plus size={17} />
              New visit
            </Button>
            <Link className="button button-secondary" to="/calendar">
              Open calendar
            </Link>
            <Link className="button button-quiet" to="/day-sheet">
              <Printer size={16} />
              Day sheet
            </Link>
          </div>
        </div>
        <div
          className="greeting-photo"
          aria-hidden="true"
          style={{ backgroundImage: `url(${photos.sunlitRoom})` }}
        />
      </section>
      <div className="metrics-band">
        <Metric
          label="Booked for today"
          value={money(booked, state.organisation)}
          detail="Before discounts, tax adjustments and tips"
        />
        <Metric
          label="Visits"
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
      <GetReady />
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
            nowMinutes={businessMinutes(state)}
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
          <NeedsYou />
          <TeamToday />
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
        <div className="today-ideas">
          <SmartInsights onBook={setBooking} />
          <Specials />
        </div>
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

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  MessageSquare,
  Plus,
  Users,
  Check,
  Mail,
} from 'lucide-react'
import { useStore } from '../state/context'
import { clientStats } from '../domain/selectors'
import { groupTimeline } from '../domain/timeline'
import type { RelationshipEvent } from '../domain/model'
import { can, instantFor, operations } from '../domain/operations'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, Empty, ErrorMessage, Metric, SegmentedControl, Status } from '../design'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'

// A booking's detail opens with the service, date and time already shown in
// the visit heading; only the sentence after it (payment state) is new.
function stepDetail(event: RelationshipEvent) {
  return event.type === 'booked' ? event.detail.split('. ').slice(1).join('. ') : event.detail
}

export function ClientRelationship() {
  const { clientId } = useParams()
  const { state, commit, today, blocked, saving, role } = useStore()
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const [consentError, setConsentError] = useState('')
  const [filter, setFilter] = useState('all')
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [error, setError] = useState('')
  const [booking, setBooking] = useState(false)
  const [appointmentId, setAppointmentId] = useState('')
  const client = state.clients.find((c) => c.id === clientId)
  if (!client)
    return (
      <Empty title="This relationship wasn’t found">
        <Link to="/clients">Return to clients</Link>
      </Empty>
    )
  const stats = clientStats(state, client.id)
  const entries = groupTimeline(
    state.events.filter((e) => e.clientId === client.id),
    (id) => {
      const a = state.appointments.find((appointment) => appointment.id === id)
      if (!a) return undefined
      try {
        return instantFor(state, a.date, a.startMinutes)
      } catch {
        return undefined
      }
    },
  ).filter(
    (entry) =>
      filter === 'all' ||
      (filter === 'visits'
        ? entry.kind === 'visit'
        : entry.kind === 'event' &&
          (filter === 'notes'
            ? entry.event.type === 'note'
            : ['relationship', 'consent'].includes(entry.event.type))),
  )
  const longDate = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: state.organisation.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const shortDate = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: state.organisation.timeZone,
    day: 'numeric',
    month: 'short',
  })
  const edges = state.relationships.filter(
    (e) => e.fromClientId === client.id || e.toClientId === client.id,
  )
  const professionals = state.staff.filter((s) =>
    state.appointments.some(
      (a) => a.staffId === s.id && a.clientId === client.id && a.status === 'completed',
    ),
  )
  async function saveNote(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || blocked || !can(role, 'note')) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'note', clientId: client!.id, text: note })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNote('')
      setError('')
      setNoteSaved(true)
    } catch {
      setError('Could not save your note. Your writing is still here; try again.')
    } finally {
      setPending(false)
    }
  }
  async function changeConsent(consent: boolean) {
    if (busy || blocked || !can(role, 'consent')) return
    setPending(true)
    setConsentError('')
    try {
      const result = await commit({ type: 'consent', clientId: client!.id, consent })
      if (!result.ok) setConsentError(result.error)
    } catch {
      setConsentError('Could not update consent. The previous preference has been retained.')
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Link className="back-link" to="/clients">
        <ArrowLeft size={16} />
        Clients
      </Link>
      <div className="relationship-heading">
        <Avatar identity={client.id} name={client.name} />
        <div>
          <p className="date-caption">A relationship with {state.organisation.name}</p>
          <h1>{client.name}</h1>
          <p>
            {client.email}{' '}
            <span className="contact-divider" aria-hidden="true">
              /
            </span>{' '}
            {client.phone}
          </p>
        </div>
        <Button disabled={busy || blocked || !can(role, 'book')} onClick={() => setBooking(true)}>
          <Plus size={17} />
          Book next visit
        </Button>
      </div>
      <div className="metrics-band">
        <Metric
          label="Completed visits"
          value={stats.visits}
          detail="Time together at the studio"
        />
        <Metric
          label="Service spend"
          value={money(stats.spend, state.organisation)}
          detail="Completed services, excluding tips"
        />
        <Metric
          label="Last visit"
          value={
            stats.last
              ? dateLabel(stats.last.date, state.organisation.locale, true).split(',').pop()
              : 'New client'
          }
          detail={
            stats.last
              ? (stats.last.bookedServiceName ??
                state.services.find((s) => s.id === stats.last?.serviceId)?.name)
              : 'A new story to begin'
          }
        />
        <Metric
          label="Next visit"
          value={
            stats.next
              ? dateLabel(stats.next.date, state.organisation.locale, true).split(',').pop()
              : 'Not booked'
          }
          detail={
            stats.next
              ? timeLabel(stats.next.startMinutes, state.organisation.locale)
              : 'A good moment to make an invitation'
          }
        />
      </div>
      <div className="relationship-layout">
        <section className="surface timeline-surface">
          <div className="section-heading">
            <div>
              <h2>The relationship timeline</h2>
              <p>One story across visits, people and small details.</p>
            </div>
          </div>
          <SegmentedControl
            label="Timeline filters"
            className="timeline-tabs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'visits', label: 'Visits & money' },
              { value: 'notes', label: 'Notes' },
              { value: 'people', label: 'People & preferences' },
            ]}
          />
          <div className="timeline">
            {entries.map((entry) => {
              if (entry.kind === 'visit') {
                const appointment = state.appointments.find((a) => a.id === entry.appointmentId)
                const service = state.services.find((s) => s.id === appointment?.serviceId)
                const staff = state.staff.find((s) => s.id === appointment?.staffId)
                const sales = entry.events
                  .map((event) => state.sales.find((s) => s.id === event.saleId))
                  .filter((sale) => sale !== undefined)
                const sale = sales[sales.length - 1]
                const Icon = sale ? CreditCard : CalendarDays
                return (
                  <article className="timeline-event timeline-visit" key={entry.id}>
                    <span className={`timeline-icon ${sale ? 'timeline-checkout' : ''}`}>
                      <Icon size={17} />
                    </span>
                    <div>
                      {appointment && (
                        <time dateTime={appointment.date}>
                          {longDate.format(new Date(`${appointment.date}T12:00:00Z`))}
                          {' · '}
                          {timeLabel(appointment.startMinutes, state.organisation.locale)}
                        </time>
                      )}
                      <h3>
                        {appointment?.bookedServiceName ?? service?.name ?? 'Visit'}
                        {staff && <span> with {staff.name.split(' ')[0]}</span>}
                      </h3>
                      {appointment && <Status status={appointment.status} />}
                      <ol className="visit-steps" aria-label="What happened">
                        {entry.events.map((event) => (
                          <li key={event.id}>
                            <span className="visit-step-title">{event.title}</span>
                            <time dateTime={event.occurredAt}>
                              {shortDate.format(new Date(event.occurredAt))}
                            </time>
                            <small>{event.actor}</small>
                            {stepDetail(event) && <p>{stepDetail(event)}</p>}
                          </li>
                        ))}
                      </ol>
                      {sale && (
                        <div className="timeline-money">
                          <strong>{money(sale.serviceMinor, state.organisation)}</strong>
                          <span>Service · {money(sale.tipMinor, state.organisation)} tip</span>
                        </div>
                      )}
                      <div className="timeline-footer">
                        <span />
                        <button
                          className="text-link"
                          onClick={() => setAppointmentId(entry.appointmentId)}
                        >
                          View visit <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                )
              }
              const { event } = entry
              const Icon =
                event.type === 'note'
                  ? MessageSquare
                  : event.type === 'relationship'
                    ? Users
                    : event.type === 'consent'
                      ? Mail
                      : CalendarDays
              return (
                <article className="timeline-event" key={entry.id}>
                  <span className={`timeline-icon timeline-${event.type}`}>
                    <Icon size={17} />
                  </span>
                  <div>
                    <time dateTime={event.occurredAt}>
                      {longDate.format(new Date(event.occurredAt))}
                    </time>
                    <h3>{event.title}</h3>
                    <p>{event.detail}</p>
                    <div className="timeline-footer">
                      <small>{event.actor}</small>
                      {event.appointmentId && (
                        <button
                          className="text-link"
                          onClick={() => setAppointmentId(event.appointmentId!)}
                        >
                          View visit <ArrowUpRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
            {!entries.length && (
              <Empty title="This part of the story is still ahead">
                Add a note or book a visit to begin.
              </Empty>
            )}
          </div>
        </section>
        <aside className="relationship-aside">
          <section className="surface detail-panel">
            <h2>Good to remember</h2>
            <p>{client.preferences || 'No preferences recorded. Add something useful below.'}</p>
            <div className="detail-divider" />
            <h3>People in their story</h3>
            {edges.length ? (
              edges.map((edge) => {
                const other = state.clients.find(
                  (c) =>
                    c.id ===
                    (edge.fromClientId === client.id ? edge.toClientId : edge.fromClientId),
                )
                if (!other) return null
                return (
                  <Link className="connection-row" to={`/clients/${other.id}`} key={edge.id}>
                    <Avatar small identity={other.id} name={other.name} tone="sand" />
                    <span>
                      <strong>{other.name}</strong>
                      <small>
                        {edge.type === 'referral'
                          ? edge.fromClientId === client.id
                            ? 'Introduced by this client'
                            : 'Introduced this client'
                          : 'Household relationship'}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </Link>
                )
              })
            ) : (
              <p className="subtle">No client connections recorded yet.</p>
            )}
            {professionals.map((s) => (
              <div className="connection-row" key={s.id}>
                <Avatar small identity={s.id} name={s.name} tone={s.tone} />
                <span>
                  <strong>{s.name}</strong>
                  <small>A familiar professional</small>
                </span>
              </div>
            ))}
          </section>
          <section className="surface detail-panel">
            <h2>A small detail matters.</h2>
            <form onSubmit={saveNote} aria-busy={busy}>
              <label>
                Relationship note
                <textarea
                  maxLength={1000}
                  minLength={2}
                  required
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    setNoteSaved(false)
                  }}
                  placeholder="Preferences, occasions, the things worth remembering…"
                  rows={4}
                />
              </label>
              <p className="subtle">
                Ordinary service preferences only.{' '}
                {operations(state).mode === 'sandbox'
                  ? 'Use fictional information in this sandbox. '
                  : ''}
                Clinical records belong in a separate future product.
              </p>
              <ErrorMessage error={error} />
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || blocked || !can(role, 'note')}
              >
                {busy ? (
                  'Saving…'
                ) : noteSaved ? (
                  <>
                    <Check size={16} />
                    Added
                  </>
                ) : (
                  'Add to timeline'
                )}
              </Button>
              <span className="sr-only" role="status">
                {noteSaved ? 'Note added to timeline' : ''}
              </span>
            </form>
          </section>
          <section className="surface detail-panel">
            <h2>Communication preference</h2>
            <ErrorMessage error={consentError} />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={client.marketingConsent}
                disabled={busy || blocked || !can(role, 'consent')}
                onChange={(e) => {
                  void changeConsent(e.target.checked)
                }}
              />
              Email marketing enabled
            </label>
            <p className="subtle">
              Appointment updates are separate. Changing this preference records an event; it sends
              no message.
            </p>
          </section>
        </aside>
      </div>
      {booking && (
        <BookingDialog
          defaults={{ clientId: client.id, date: addDays(today, 1) }}
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

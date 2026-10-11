import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CreditCard,
  MessageSquare,
  Plus,
  Users,
  Check,
  Mail,
  PencilLine,
  Layers,
} from 'lucide-react'
import { useStore } from '../state/context'
import { clientStats, usualWeeks } from '../domain/selectors'
import { groupTimeline } from '../domain/timeline'
import type { RelationshipEvent } from '../domain/model'
import { can, instantFor, operations } from '../domain/operations'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, Empty, ErrorMessage, SegmentedControl, Status, Checkbox } from '../design'
import { AppointmentDialog } from '../components/AppointmentDialog'
import { BookingDialog } from '../components/BookingDialog'
import { ClientMessagePreferences, SentMessages } from '../components/AppointmentMessages'
import { ClientCards } from '../components/CardPayments'
import { CarriedBalances } from '../components/Switching'
import { ClientPlans } from '../components/Plans'
import { ClientWaitlist } from '../components/Waitlist'
import { ClientPatchTests } from '../components/PatchTests'
import { ClientPrivacy } from '../components/Privacy'
import { ClientBirthday } from '../components/ClientBirthday'
import { ClientArea } from '../components/ClientArea'
import { ConsentHistory } from '../components/EmailConsent'
import { ClientConsultations } from '../components/Consultations'
import { ClientInsight } from '../components/ClientInsight'

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
  const [openVisits, setOpenVisits] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [error, setError] = useState('')
  const [editingPreferences, setEditingPreferences] = useState(false)
  const [preferences, setPreferences] = useState('')
  const [preferencesError, setPreferencesError] = useState('')
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
  const summaryDate = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: state.organisation.timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const edges = state.relationships.filter(
    (e) => e.fromClientId === client.id || e.toClientId === client.id,
  )
  const professionals = state.staff.filter((s) =>
    state.appointments.some(
      (a) => a.staffId === s.id && a.clientId === client.id && a.status === 'completed',
    ),
  )
  const kept = state.appointments.filter(
    (a) => a.clientId === client.id && a.status !== 'cancelled' && a.status !== 'no_show',
  )
  const firstVisit = kept.map((a) => a.date).sort()[0]
  // As in the client list, someone in the studio today, or seen already, was last here today.
  const seenToday = kept.some(
    (a) => a.date === today && (a.status === 'arrived' || a.status === 'completed'),
  )
  const completedDates = kept.filter((a) => a.status === 'completed').map((a) => a.date)
  const rhythm = usualWeeks(completedDates)
  const monthYear = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
  const yearStart = addDays(today, -364)
  const yearVisits = kept
    .filter((a) => a.status === 'completed' && a.date >= yearStart && a.date <= today)
    .map((a) => {
      const service = state.services.find((s) => s.id === a.serviceId)
      const days = (Date.parse(a.date) - Date.parse(yearStart)) / 86_400_000
      return {
        id: a.id,
        date: a.date,
        name: a.bookedServiceName ?? service?.name ?? 'Visit',
        tone: ['Skin', 'Body'].includes(service?.category ?? '') ? 'year-brand' : 'year-rose',
        position: Math.min(100, Math.max(0, (days / 364) * 100)),
      }
    })
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
  async function savePreferences(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || blocked || !can(role, 'client-edit')) return
    setPending(true)
    setPreferencesError('')
    try {
      const { name, email, phone, marketingConsent } = client!
      const result = await commit({
        type: 'client-edit',
        clientId: client!.id,
        contact: { name, email, phone, marketingConsent },
        preferences: preferences.trim(),
      })
      if (!result.ok) {
        setPreferencesError(result.error)
        return
      }
      setEditingPreferences(false)
    } catch {
      setPreferencesError('Could not save. Your writing is still here; try again.')
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
        All clients
      </Link>
      <section className="surface relationship-hero" aria-labelledby="client-name">
        <div className="relationship-heading">
          <Avatar identity={client.id} name={client.name} />
          <div>
            <p className="eyebrow">
              {firstVisit
                ? `Client since ${monthYear.format(new Date(`${firstVisit}T12:00:00Z`))}`
                : `New to ${state.organisation.name}`}
              {rhythm ? `, usually every ${rhythm} weeks` : ''}
            </p>
            <h1 id="client-name">{client.name}</h1>
            <p>
              {client.email}{' '}
              <span className="contact-divider" aria-hidden="true">
                /
              </span>{' '}
              {client.phone}
            </p>
          </div>
          <div className="next-visit-panel">
            <p className="eyebrow">Next visit</p>
            {stats.next ? (
              <>
                <strong>
                  {dateLabel(stats.next.date, state.organisation.locale, true)} ·{' '}
                  {timeLabel(stats.next.startMinutes, state.organisation.locale)}
                </strong>
                <small>
                  {stats.next.bookedServiceName ??
                    state.services.find((s) => s.id === stats.next?.serviceId)?.name}
                </small>
                <Button variant="secondary" onClick={() => setAppointmentId(stats.next!.id)}>
                  Open visit
                </Button>
              </>
            ) : (
              <>
                <strong>Not booked</strong>
                <small>A good moment to make an invitation.</small>
                <Button
                  disabled={busy || blocked || !can(role, 'book')}
                  onClick={() => setBooking(true)}
                >
                  <Plus size={17} />
                  Book next visit
                </Button>
              </>
            )}
          </div>
        </div>
        <dl className="relationship-stats">
          <div>
            <dt>Completed visits</dt>
            <dd>{stats.visits}</dd>
          </div>
          <div>
            <dt>Spent with the studio</dt>
            <dd>{money(stats.spend, state.organisation)}</dd>
          </div>
          <div>
            <dt>Last visit</dt>
            <dd>
              {seenToday
                ? 'Today'
                : stats.last
                  ? dateLabel(stats.last.date, state.organisation.locale, true).split(',').pop()
                  : 'Not yet'}
            </dd>
          </div>
          <div>
            <dt>Friends introduced</dt>
            <dd>{edges.filter((e) => e.fromClientId === client.id).length}</dd>
          </div>
        </dl>
        <div className="relationship-year">
          <div className="relationship-year-heading">
            <h2>A year with the studio</h2>
            <span>One mark per visit</span>
          </div>
          <div
            className="year-track"
            role="img"
            aria-label={`${yearVisits.length} ${yearVisits.length === 1 ? 'visit' : 'visits'} in the last twelve months`}
          >
            {yearVisits.map((visit) => (
              <span
                key={visit.id}
                className={`year-mark ${visit.tone}`}
                style={{ left: `${visit.position}%` }}
                title={`${shortDate.format(new Date(`${visit.date}T12:00:00Z`))} · ${visit.name}`}
              />
            ))}
          </div>
          <div className="year-legend" aria-hidden="true">
            <span>{monthYear.format(new Date(`${addDays(today, -364)}T12:00:00Z`))}</span>
            <span className="year-key">
              <span className="year-mark year-brand" /> Skin and body
              <span className="year-mark year-rose" /> Hair, brows and other
            </span>
            <span>Today</span>
          </div>
        </div>
      </section>
      <ClientInsight key={`insight-${client.id}`} client={client} />
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
                const settled =
                  appointment !== undefined &&
                  ['completed', 'cancelled', 'no_show'].includes(appointment.status)
                const open = !settled || openVisits.includes(entry.id)
                return (
                  <article className="timeline-event timeline-visit" key={entry.id}>
                    <span className={`timeline-icon ${sale ? 'timeline-checkout' : ''}`}>
                      <Icon size={17} />
                    </span>
                    <div>
                      {settled ? (
                        <h3 className="visit-summary-heading">
                          <button
                            type="button"
                            className="visit-summary"
                            aria-expanded={open}
                            onClick={() =>
                              setOpenVisits((current) =>
                                current.includes(entry.id)
                                  ? current.filter((id) => id !== entry.id)
                                  : [...current, entry.id],
                              )
                            }
                          >
                            <time dateTime={appointment.date}>
                              {summaryDate.format(new Date(`${appointment.date}T12:00:00Z`))}
                            </time>
                            <span className="visit-summary-title">
                              <strong>
                                {appointment.bookedServiceName ?? service?.name ?? 'Visit'}
                              </strong>
                              {staff && <span> with {staff.name.split(' ')[0]}</span>}
                            </span>
                            <span className="visit-summary-end">
                              {sale && appointment.status === 'completed' ? (
                                money(sale.totalMinor, state.organisation)
                              ) : (
                                <Status status={appointment.status} />
                              )}
                            </span>
                            <ChevronDown size={16} />
                          </button>
                        </h3>
                      ) : (
                        <>
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
                        </>
                      )}
                      {open && (
                        <>
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
                              <span>
                                Treatment · {money(sale.tipMinor, state.organisation)} tip
                                {sale.retail
                                  ? ` · bought ${sale.retail.lines.map((line) => line.name).join(', ')}`
                                  : ''}
                              </span>
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
                        </>
                      )}
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
                      : event.type === 'plan'
                        ? Layers
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
            <div className="section-heading">
              <h2>Good to remember</h2>
              {!editingPreferences && can(role, 'client-edit') && (
                <button
                  className="text-link"
                  disabled={busy || blocked}
                  aria-label="Edit good to remember"
                  onClick={() => {
                    setPreferences(client.preferences)
                    setPreferencesError('')
                    setEditingPreferences(true)
                  }}
                >
                  <PencilLine size={14} />
                  Edit
                </button>
              )}
            </div>
            {editingPreferences ? (
              <form onSubmit={savePreferences} aria-busy={busy}>
                <label>
                  <span className="sr-only">Good to remember</span>
                  <textarea
                    autoFocus
                    maxLength={1000}
                    value={preferences}
                    onChange={(e) => setPreferences(e.target.value)}
                    placeholder="How they like their treatments, products they prefer, things to avoid…"
                    rows={4}
                  />
                </label>
                <p className="subtle">
                  Shown to everyone who looks after this client, including on the visit. Ordinary
                  service preferences only.{' '}
                  {operations(state).mode === 'sandbox'
                    ? 'This is a sample studio, so use made-up details.'
                    : ''}
                </p>
                <ErrorMessage error={preferencesError} />
                <div className="form-actions">
                  <Button type="submit" variant="secondary" disabled={busy || blocked}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      setEditingPreferences(false)
                      setPreferencesError('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <p>
                {client.preferences ||
                  (can(role, 'client-edit')
                    ? 'Nothing recorded yet. Use Edit to keep the details worth carrying into every visit.'
                    : 'Nothing recorded yet.')}
              </p>
            )}
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
                  ? 'This is a sample studio, so use made-up details. '
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
              <Checkbox
                checked={client.marketingConsent}
                disabled={busy || blocked || !can(role, 'consent')}
                onChange={(e) => {
                  void changeConsent(e.target.checked)
                }}
              />
              Email marketing enabled
            </label>
            <p className="subtle">
              Messages about their visits are separate. Changing this records the choice; it sends
              no message.
            </p>
            <ConsentHistory clientId={client.id} />
            <ClientMessagePreferences client={client} />
          </section>
          <ClientBirthday key={client.id} client={client} />
          <ClientArea key={`area-${client.id}`} client={client} />
          <ClientPlans clientId={client.id} />
          <ClientConsultations clientId={client.id} />
          <ClientPatchTests clientId={client.id} />
          <ClientWaitlist clientId={client.id} />
          <ClientCards clientId={client.id} />
          <CarriedBalances clientId={client.id} />
          <SentMessages clientId={client.id} />
          <ClientPrivacy clientId={client.id} />
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

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronRight, NotebookPen, Star, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { api, ApiError } from '../state/api'
import type { PractitionerWorkspace, RemoteWorkspace } from '../state/api'
import {
  PENDING_PRACTITIONER_KEY,
  readPendingKeys,
  requestFingerprint,
  writePendingKeys,
} from '../state/journal'
import { practitionerViewSchema } from '../domain/practitioner'
import type { PractitionerView } from '../domain/practitioner'
import type { Command } from '../domain/commands'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { firstName, nextUp, previousWithYou, untilLabel, venueMinutes } from '../domain/pocket'
import { PRACTITIONER_AVERAGE_MIN } from '../domain/feedback'
import { venueDate } from '../domain/tillCount'
import { Avatar, Button, Empty, ErrorMessage, PageHeader, Status } from '../design'
import '../practitioner.css'

/** Matches the single-column breakpoint in practitioner.css. */
const narrow = () => window.matchMedia?.('(max-width: 860px)').matches ?? false

/**
 * LOCAL-01: an assigned practitioner's own day. The server sends only their visits and the
 * minimal client details those visits need; this screen never holds the studio record.
 * On a phone it is a pocket view: "Next up" first, then the day, and a visit opens a short
 * "Before you begin" brief in place of the list.
 */
export function PractitionerDay() {
  const { orgId = '' } = useParams()
  const store = useStore()
  const navigate = useNavigate()
  const [record, setRecord] = useState<PractitionerView | null>(null)
  const [date, setDate] = useState('')
  const [selected, setSelected] = useState('')
  const [note, setNote] = useState('')
  const [tested, setTested] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [journal] = useState(() => readPendingKeys(PENDING_PRACTITIONER_KEY))
  const pending = useRef(journal.keys)
  const path = `/api/workspaces/${encodeURIComponent(orgId)}`
  // Pocket view: on a phone a chosen visit replaces the list until "Back to your day".
  const [open, setOpen] = useState(false)
  const opener = useRef('')
  const briefHeading = useRef<HTMLHeadingElement>(null)
  // The studio clock moves on between treatments, so "Next up" refreshes every half minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  async function load() {
    const next = await api<PractitionerWorkspace | RemoteWorkspace>(path)
    if (next.view === 'studio') {
      await store.openWorkspace(orgId)
      navigate('/today', { replace: true })
      return null
    }
    const view = practitionerViewSchema.parse(next.practitioner)
    setRecord(view)
    return view
  }
  useEffect(() => {
    let active = true
    ;(async () => {
      const session = store.session ?? (await store.refreshSession())
      if (!session) {
        navigate('/account', { replace: true })
        return
      }
      // OFF-01: keep this tab's read-only day sheet for the same studio while connected.
      void store.syncDaySheet(orgId).catch(() => {})
      const view = await load()
      if (active && view) setDate(view.today)
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : 'Your day could not be loaded.')
    })
    return () => {
      active = false
    }
    // The day loads once per studio; saves refresh it from their own responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])
  useEffect(() => {
    if (record) document.documentElement.lang = record.organisation.locale
  }, [record])

  async function save(command: Command, done: string) {
    if (!record || !store.session || saving) return false
    if (store.connection !== 'online') {
      setError('Offline. Changes are paused until SALEANE reconnects and checks your access.')
      return false
    }
    if (journal.error) {
      setError(journal.error)
      return false
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const fingerprint = await requestFingerprint(orgId, store.session.user.id, command)
      let key = pending.current.get(fingerprint)
      if (!key) {
        key = crypto.randomUUID()
        pending.current = writePendingKeys(
          pending.current,
          fingerprint,
          key,
          PENDING_PRACTITIONER_KEY,
        )
      }
      const forget = () => {
        try {
          pending.current = writePendingKeys(
            pending.current,
            fingerprint,
            undefined,
            PENDING_PRACTITIONER_KEY,
          )
        } catch {
          // A key left behind only replays this same receipt.
        }
      }
      try {
        const result = await api<PractitionerWorkspace>(`${path}/commands`, {
          method: 'POST',
          key,
          body: { revision: record.revision, command },
        })
        setRecord(practitionerViewSchema.parse(result.practitioner))
        forget()
        void store.syncDaySheet(orgId).catch(() => {})
        setNotice(done)
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status > 0 && e.status < 500) forget()
        if (e instanceof ApiError && e.status === 409) {
          await load().catch(() => null)
          setError('Your day changed at the studio. The latest visits are shown; try again.')
        } else if (e instanceof ApiError && (e.status === 401 || e.status === 404))
          setError('Your access to this studio has changed. Sign in again from your account.')
        else setError(e instanceof Error ? e.message : 'This change could not be saved.')
        return false
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This change could not be saved.')
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!record || !date)
    return (
      <main className="candidate-loading">
        <span className="wordmark">SALEANE</span>
        <h1>Opening your day…</h1>
        {error ? (
          <>
            <ErrorMessage error={error} />
            <Link className="text-link" to="/account">
              Back to your account
            </Link>
          </>
        ) : (
          <p role="status">Gathering the visits assigned to you.</p>
        )}
      </main>
    )

  const { organisation, staff, window } = record
  const locale = organisation.locale
  const isToday = date === record.today
  const visits = record.appointments.filter((a) => a.date === date)
  const visit = visits.find((a) => a.id === selected) ?? visits[0]
  const client = visit && record.clients.find((c) => c.id === visit.clientId)
  const minutes = venueMinutes(organisation.timeZone, now)
  const next = isToday ? nextUp(visits, minutes) : undefined
  const nextClient = next && record.clients.find((c) => c.id === next.clientId)
  const earlier = visit && client ? previousWithYou(record, visit, client) : null
  const clearLabel = (instant: string) =>
    `${dateLabel(venueDate(organisation.timeZone, instant), locale, true)}, ${timeLabel(
      venueMinutes(organisation.timeZone, Date.parse(instant)),
      locale,
    )}`
  const clientName = (id: string) => record.clients.find((c) => c.id === id)?.name ?? 'Client'

  function changeDay(target: string) {
    setDate(target)
    setSelected('')
    setOpen(false)
    setNotice('')
  }
  function openVisit(id: string) {
    setSelected(id)
    setOpen(true)
    setNotice('')
    opener.current = id
    // On a phone the visit replaces the list, so take focus to it; on a wide screen both stay.
    if (narrow()) requestAnimationFrame(() => briefHeading.current?.focus())
  }
  function closeVisit() {
    setOpen(false)
    const id = opener.current
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-visit="${CSS.escape(id)}"]`)?.focus(),
    )
  }

  return (
    <div className="practitioner-layout">
      <header className="practitioner-header">
        <Link to="/account" className="wordmark">
          SALEANE
        </Link>
        <span>
          <strong>{organisation.name}</strong>
          <small>
            {staff.name} · {organisation.locationName}
          </small>
        </span>
      </header>
      <main id="main-content" className="practitioner-main" data-open={open ? 'visit' : 'day'}>
        <div className="practitioner-day-heading">
          <PageHeader
            variant="editorial"
            eyebrow={
              <>
                <Sun size={16} />
                {dateLabel(date, locale)}
                {isToday ? ' · Today' : ''}
              </>
            }
            title={isToday ? `Your day, ${firstName(staff.name)}.` : 'Your visits'}
            description="Your own visits and the notes that help you look after each client."
            actions={
              <div className="practitioner-days" role="group" aria-label="Choose a day">
                <Button
                  variant="secondary"
                  aria-label="Previous day"
                  disabled={date <= window.from}
                  onClick={() => changeDay(addDays(date, -1))}
                >
                  <ArrowLeft size={18} />
                </Button>
                <Button
                  variant="secondary"
                  disabled={isToday}
                  onClick={() => changeDay(record.today)}
                >
                  Today
                </Button>
                <Button
                  variant="secondary"
                  aria-label="Next day"
                  disabled={date >= window.to}
                  onClick={() => changeDay(addDays(date, 1))}
                >
                  <ArrowRight size={18} />
                </Button>
              </div>
            }
          />
        </div>
        <ErrorMessage error={error} />
        {record.rating && (
          <p className="practitioner-rating">
            <Star size={16} aria-hidden="true" />
            {record.rating.average !== null
              ? `Guests rate how you look after them ${record.rating.average.toFixed(1)} out of 5, from ${record.rating.count} private ratings. New ratings are added once ${PRACTITIONER_AVERAGE_MIN} more guests have answered, so no one answer stands out.`
              : `Your average from guests' private ratings appears once ${PRACTITIONER_AVERAGE_MIN} guests have rated you.`}
          </p>
        )}
        {notice && (
          <p className="practitioner-notice" role="status">
            {notice}
          </p>
        )}
        {isToday && visits.length > 0 && (
          <section className="practitioner-next" aria-labelledby="next-heading">
            <h2 id="next-heading">Next up</h2>
            {next ? (
              <button
                className="practitioner-next-card"
                data-visit={next.id}
                onClick={() => openVisit(next.id)}
              >
                <span className="practitioner-next-when">
                  <strong>{timeLabel(next.startMinutes, locale)}</strong>
                  <span>{untilLabel(next.startMinutes, minutes)}</span>
                </span>
                <span className="practitioner-next-who">
                  <strong>{firstName(nextClient?.name ?? 'Client')}</strong>
                  <span>{next.serviceName}</span>
                  <small>
                    {[next.resourceName, `${next.durationMinutes} min`].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="practitioner-next-open">
                  Before you begin
                  <ChevronRight size={18} aria-hidden="true" />
                </span>
              </button>
            ) : (
              <p className="practitioner-next-done">
                That is everything assigned to you today. Thank you.
              </p>
            )}
          </section>
        )}
        <div className="practitioner-grid">
          <section className="surface practitioner-list" aria-labelledby="visits-heading">
            <div className="section-heading">
              <div>
                <h2 id="visits-heading">Assigned to you</h2>
                <p>
                  {visits.length
                    ? `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`
                    : 'No visits on this day'}
                </p>
              </div>
            </div>
            {visits.length ? (
              <ul className="practitioner-visits" aria-labelledby="visits-heading">
                {visits.map((a) => (
                  <li key={a.id}>
                    <button
                      className="practitioner-visit"
                      data-visit={a.id}
                      aria-pressed={visit?.id === a.id}
                      onClick={() => openVisit(a.id)}
                    >
                      <span className="agenda-time">
                        {timeLabel(a.startMinutes, locale)}
                        <small>{a.durationMinutes} min</small>
                      </span>
                      <span className="agenda-client">
                        <Avatar small identity={a.clientId} name={clientName(a.clientId)} />
                        <span>
                          <strong>{clientName(a.clientId)}</strong>
                          <small>
                            {a.serviceName}
                            {a.resourceName ? ` · ${a.resourceName}` : ''}
                          </small>
                        </span>
                      </span>
                      <Status status={a.guestHere ? 'here' : a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="A little breathing room">
                Nothing is assigned to you on this day. Reception manages bookings and changes.
              </Empty>
            )}
          </section>
          {visit && client && (
            <section className="surface practitioner-client" aria-labelledby="client-heading">
              <button className="practitioner-back" onClick={closeVisit}>
                <ArrowLeft size={18} aria-hidden="true" />
                Back to your day
              </button>
              <div className="section-heading">
                <div>
                  <p className="practitioner-eyebrow">Before you begin</p>
                  <h2 id="client-heading" ref={briefHeading} tabIndex={-1}>
                    {client.name}
                  </h2>
                  <p>
                    {timeLabel(visit.startMinutes, locale)} · {visit.serviceName}
                    {visit.resourceName ? ` · ${visit.resourceName}` : ''}
                  </p>
                </div>
                <Status status={visit.guestHere ? 'here' : visit.status} />
              </div>
              {visit.status === 'confirmed' && visit.date === record.today && (
                <Button
                  disabled={saving}
                  onClick={() =>
                    void save(
                      { type: 'arrive', appointmentId: visit.id },
                      `${firstName(client.name)} is marked as in the studio.`,
                    )
                  }
                >
                  Welcome {firstName(client.name)}
                </Button>
              )}
              <dl className="practitioner-brief">
                <div>
                  <dt>Good to remember</dt>
                  <dd>{client.preferences || 'Nothing recorded yet.'}</dd>
                </div>
                <div>
                  <dt>Last time with you</dt>
                  <dd>
                    {earlier
                      ? `${dateLabel(earlier.date, locale)} · ${earlier.serviceName}`
                      : earlier === null
                        ? 'No earlier visit with you on record.'
                        : 'Further back than this view reaches.'}
                  </dd>
                </div>
                {visit.patchTest && (
                  <div>
                    <dt>Patch test</dt>
                    <dd>{visit.patchTest.label}.</dd>
                  </div>
                )}
                {visit.consultation && (
                  <div>
                    <dt>Agreed at consultation</dt>
                    <dd>
                      {visit.consultation.plan}
                      {visit.consultation.wants && (
                        <small>They wanted: {visit.consultation.wants}</small>
                      )}
                      <small>
                        {dateLabel(visit.consultation.heldOn, locale)}, version{' '}
                        {visit.consultation.version}
                        {visit.consultation.changedSince ? '. Updated since this was booked.' : '.'}
                      </small>
                    </dd>
                  </div>
                )}
                {visit.forms?.flatMap((form) =>
                  form.answers.map((row) => (
                    <div key={`${form.title} ${row.question}`}>
                      <dt>{row.question}</dt>
                      <dd>{row.answer}</dd>
                    </div>
                  )),
                )}
              </dl>
              {(visit.patchTest || client.patchTests.length > 0) && (
                <>
                  <h3>Patch tests</h3>
                  {client.patchTests.length > 0 && (
                    <ul
                      className="practitioner-notes"
                      aria-label={`Patch tests for ${client.name}`}
                    >
                      {client.patchTests.map((t) => (
                        <li key={t.id}>
                          <p>
                            {t.product} ·{' '}
                            {t.outcome === 'clear'
                              ? 'clear'
                              : t.outcome === 'reaction'
                                ? 'a reaction'
                                : 'result to record'}
                          </p>
                          <small>
                            {dateLabel(venueDate(organisation.timeZone, t.testedAt), locale, true)}
                            {!t.outcome &&
                              now < Date.parse(t.clearFrom) &&
                              ` · can be called clear from ${clearLabel(t.clearFrom)}`}
                          </small>
                          {!t.outcome && t.yours && (
                            <span className="practitioner-actions">
                              <Button
                                variant="secondary"
                                disabled={saving || now < Date.parse(t.clearFrom)}
                                onClick={() =>
                                  void save(
                                    {
                                      type: 'patch-test-result',
                                      patchTestId: t.id,
                                      outcome: 'clear',
                                      notes: '',
                                    },
                                    'The patch test is recorded as clear.',
                                  )
                                }
                              >
                                Clear
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={saving}
                                onClick={() =>
                                  void save(
                                    {
                                      type: 'patch-test-result',
                                      patchTestId: t.id,
                                      outcome: 'reaction',
                                      notes: '',
                                    },
                                    'The reaction is recorded. Reception will see it before the visit.',
                                  )
                                }
                              >
                                A reaction
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="practitioner-note"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const product = tested.trim()
                      if (product.length < 2) return
                      if (
                        await save(
                          {
                            type: 'patch-test',
                            input: {
                              clientId: client.id,
                              testedAt: new Date().toISOString(),
                              product,
                              staffId: record.staff.id,
                              notes: '',
                            },
                          },
                          'Your patch test is recorded. Record the result once you check the skin.',
                        )
                      )
                        setTested('')
                    }}
                  >
                    <label htmlFor="practitioner-patch">Record a patch test you just did</label>
                    <input
                      id="practitioner-patch"
                      value={tested}
                      maxLength={150}
                      placeholder="Product or shade tested"
                      onChange={(e) => setTested(e.target.value)}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={saving || tested.trim().length < 2}
                    >
                      Save patch test
                    </Button>
                  </form>
                </>
              )}
              <h3>Notes</h3>
              <form
                className="practitioner-note"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const text = note.trim()
                  if (text.length < 2) return
                  if (
                    await save(
                      { type: 'note', clientId: client.id, text },
                      'Your note is saved to their history.',
                    )
                  )
                    setNote('')
                }}
              >
                <label htmlFor="practitioner-note">Add a note for the studio</label>
                <textarea
                  id="practitioner-note"
                  value={note}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={saving || note.trim().length < 2}
                >
                  <NotebookPen size={16} />
                  Save note
                </Button>
              </form>
              {client.notes.length ? (
                <ul className="practitioner-notes" aria-label={`Notes about ${client.name}`}>
                  {client.notes.map((n) => (
                    <li key={n.id}>
                      <p>{n.detail}</p>
                      <small>
                        {n.actor} · {dateLabel(n.occurredAt.slice(0, 10), locale, true)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle">No notes yet.</p>
              )}
            </section>
          )}
        </div>
        <p className="practitioner-footnote">
          Bookings, payments and client contact details stay with reception and managers.{' '}
          <Link className="text-link" to="/day-sheet">
            Your day sheet for offline use and printing
          </Link>
        </p>
      </main>
    </div>
  )
}

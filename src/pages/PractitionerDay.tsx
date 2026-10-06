import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, NotebookPen, Sun } from 'lucide-react'
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
import { Avatar, Button, Empty, ErrorMessage, Status } from '../components/ui'
import '../practitioner.css'

/**
 * LOCAL-01: an assigned practitioner's own day. The server sends only their visits and the
 * minimal client details those visits need; this screen never holds the studio record.
 */
export function PractitionerDay() {
  const { orgId = '' } = useParams()
  const store = useStore()
  const navigate = useNavigate()
  const [record, setRecord] = useState<PractitionerView | null>(null)
  const [date, setDate] = useState('')
  const [selected, setSelected] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [journal] = useState(() => readPendingKeys(PENDING_PRACTITIONER_KEY))
  const pending = useRef(journal.keys)
  const path = `/api/workspaces/${encodeURIComponent(orgId)}`

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
  const visits = record.appointments.filter((a) => a.date === date)
  const visit = visits.find((a) => a.id === selected) ?? visits[0]
  const client = visit && record.clients.find((c) => c.id === visit.clientId)
  const firstName = staff.name.split(' ')[0]
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
      <main id="main-content" className="practitioner-main">
        <div className="page-heading">
          <div>
            <p className="date-caption">
              <Sun size={16} />
              {dateLabel(date, locale)}
              {date === record.today ? ' · Today' : ''}
            </p>
            <h1>{date === record.today ? `Your day, ${firstName}.` : 'Your visits'}</h1>
            <p>Your own visits and the notes that help you look after each client.</p>
          </div>
          <div className="practitioner-days" role="group" aria-label="Choose a day">
            <Button
              variant="secondary"
              aria-label="Previous day"
              disabled={date <= window.from}
              onClick={() => setDate(addDays(date, -1))}
            >
              <ArrowLeft size={16} />
            </Button>
            <Button
              variant="secondary"
              disabled={date === record.today}
              onClick={() => setDate(record.today)}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              aria-label="Next day"
              disabled={date >= window.to}
              onClick={() => setDate(addDays(date, 1))}
            >
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
        <ErrorMessage error={error} />
        {notice && (
          <p className="practitioner-notice" role="status">
            {notice}
          </p>
        )}
        <div className="practitioner-grid">
          <section className="surface" aria-labelledby="visits-heading">
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
                {visits.map((a) => {
                  const person = record.clients.find((c) => c.id === a.clientId)
                  return (
                    <li key={a.id}>
                      <button
                        className="practitioner-visit"
                        aria-pressed={visit?.id === a.id}
                        onClick={() => {
                          setSelected(a.id)
                          setNotice('')
                        }}
                      >
                        <span className="agenda-time">
                          {timeLabel(a.startMinutes, locale)}
                          <small>{a.durationMinutes} min</small>
                        </span>
                        <span className="agenda-client">
                          <Avatar small identity={a.clientId} name={person?.name ?? 'Client'} />
                          <span>
                            <strong>{person?.name ?? 'Client'}</strong>
                            <small>
                              {a.serviceName}
                              {a.resourceName ? ` · ${a.resourceName}` : ''}
                            </small>
                          </span>
                        </span>
                        <Status status={a.status} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty title="A little breathing room">
                Nothing is assigned to you on this day. Reception manages bookings and changes.
              </Empty>
            )}
          </section>
          {visit && client && (
            <section className="surface practitioner-client" aria-labelledby="client-heading">
              <div className="section-heading">
                <div>
                  <h2 id="client-heading">{client.name}</h2>
                  <p>
                    {timeLabel(visit.startMinutes, locale)} · {visit.serviceName}
                  </p>
                </div>
              </div>
              {visit.status === 'confirmed' && visit.date === record.today && (
                <Button
                  disabled={saving}
                  onClick={() =>
                    void save(
                      { type: 'arrive', appointmentId: visit.id },
                      `${client.name.split(' ')[0]} is marked as in the studio.`,
                    )
                  }
                >
                  Welcome {client.name.split(' ')[0]}
                </Button>
              )}
              <h3>Preferences</h3>
              <p className="subtle">{client.preferences || 'No preferences recorded yet.'}</p>
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
                <ul className="practitioner-notes">
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
          Bookings, payments and client contact details stay with reception and managers.
        </p>
      </main>
    </div>
  )
}

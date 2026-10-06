import { useEffect, useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can } from '../domain/operations'
import {
  canPrivacy,
  clientExport,
  clientExportText,
  erasureReview,
  previewClientExport,
  previewStudioExport,
  studioExport,
} from '../domain/privacy'
import type { ClientExport, ErasureReview, ExportPreview, StudioExport } from '../domain/privacy'
import { Button, ErrorMessage, Modal } from '../design'
import './privacy.css'

// LOCAL-03. The server checks every role again; these screens only explain what each role can do.
type Requests = { occurredAt: number; actor: string | null }[]
const DEFAULTS_NOTE =
  'This scope is a default awaiting the owner’s confirmation with a privacy adviser.'

function save(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'export'

function PreviewList({ preview }: { preview: ExportPreview }) {
  return (
    <div className="privacy-preview">
      <section>
        <h3>Included</h3>
        <ul className="privacy-counts">
          {preview.sections.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <span className="ops-count">{s.count}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Not included</h3>
        <ul className="privacy-plain">
          {preview.excluded.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3>Before you send it</h3>
        <ul className="privacy-plain">
          {preview.notes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Data copy and erasure review for one client, on the relationship page. */
export function ClientPrivacy({ clientId }: { clientId: string }) {
  const { state, role, mode, session, commit, blocked, saving, today } = useStore()
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/privacy/clients/${encodeURIComponent(clientId)}`
  const client = state.clients.find((c) => c.id === clientId)
  const allowed = canPrivacy(role, 'client.export')
  const [open, setOpen] = useState<'' | 'export' | 'erasure'>('')
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [file, setFile] = useState<ClientExport | null>(null)
  const [review, setReview] = useState<ErasureReview | null>(null)
  const [requests, setRequests] = useState<Requests>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const by = session?.user.name ?? 'Browser demo'
  useEffect(() => {
    if (mode !== 'server' || !allowed) return
    let active = true
    api<{ requests: Requests }>(`${base}/erasure`)
      .then((r) => {
        if (active) setRequests(r.requests)
      })
      .catch(() => {
        /* The panel still offers the review, which reports its own error. */
      })
    return () => {
      active = false
    }
  }, [base, mode, allowed])
  if (!client) return null
  const first = client.name.split(' ')[0]
  async function openExport() {
    setOpen('export')
    setPreview(null)
    setFile(null)
    setError('')
    setDone('')
    try {
      setPreview(
        mode === 'server'
          ? (await api<{ preview: ExportPreview }>(`${base}/export`)).preview
          : previewClientExport(
              clientExport(state, clientId, {
                generatedAt: new Date().toISOString(),
                generatedBy: by,
              }),
            ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The preview could not be prepared.')
    }
  }
  async function download() {
    setPending(true)
    setError('')
    try {
      const next =
        mode === 'server'
          ? (await api<{ export: ClientExport }>(`${base}/export`, { method: 'POST', body: {} }))
              .export
          : clientExport(state, clientId, {
              generatedAt: new Date().toISOString(),
              generatedBy: by,
            })
      setFile(next)
      save(`${slug(client!.name)}-data.json`, JSON.stringify(next, null, 2), 'application/json')
      setDone(
        mode === 'server'
          ? 'Downloaded. This export is recorded in the studio’s audit log.'
          : 'Downloaded from the fictional demo. The browser demo keeps no audit log.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export could not be prepared.')
    } finally {
      setPending(false)
    }
  }
  async function openErasure() {
    setOpen('erasure')
    setReview(null)
    setError('')
    setDone('')
    try {
      if (mode === 'server') {
        const result = await api<{ review: ErasureReview; requests: Requests }>(`${base}/erasure`)
        setReview(result.review)
        setRequests(result.requests)
      } else setReview(erasureReview(state, clientId, today))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The review could not be prepared.')
    }
  }
  async function recordRequest() {
    setPending(true)
    setError('')
    try {
      const result = await api<{ requests: Requests }>(`${base}/erasure`, {
        method: 'POST',
        body: {},
      })
      setRequests(result.requests)
      setDone('Request recorded. Nothing has been deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be recorded.')
    } finally {
      setPending(false)
    }
  }
  async function withdrawMarketing() {
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'consent', clientId, consent: false })
      if (!result.ok) setError(result.error)
      else {
        setReview(erasureReview(result.state, clientId, today))
        setDone('Email marketing withdrawn. Queued marketing messages are now suppressed.')
      }
    } catch {
      setError('Consent could not be updated. The previous preference has been kept.')
    } finally {
      setPending(false)
    }
  }
  const dateFormat = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: state.organisation.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (
    <section className="surface detail-panel" aria-labelledby="client-privacy-heading">
      <h2 id="client-privacy-heading">Privacy and data</h2>
      {requests.map((r) => (
        <p className="privacy-request" key={r.occurredAt}>
          <strong>Erasure request recorded</strong> on {dateFormat.format(new Date(r.occurredAt))}
          {r.actor ? ` by ${r.actor}` : ''}. Waiting for a retention decision; nothing has been
          deleted.
        </p>
      ))}
      {allowed ? (
        <>
          <p>
            Prepare a copy of what the studio holds about {first}, or review what an erasure request
            would mean. Nothing is deleted here.
          </p>
          <div className="privacy-actions">
            <Button variant="secondary" onClick={() => void openExport()}>
              <Download size={16} />
              Prepare a data copy
            </Button>
            <Button variant="quiet" onClick={() => void openErasure()}>
              Review erasure
            </Button>
          </div>
        </>
      ) : (
        <p>An owner or manager can prepare a copy of this client’s data or review an erasure.</p>
      )}
      <Modal
        open={open === 'export'}
        wide
        onClose={() => setOpen('')}
        title={`A copy of ${client.name}’s data`}
        description="Check what is included before you download it."
      >
        {preview ? <PreviewList preview={preview} /> : !error && <p>Preparing the preview…</p>}
        <p className="privacy-default">{DEFAULTS_NOTE}</p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {done}
        </p>
        <div className="privacy-actions">
          <Button disabled={!preview || pending} onClick={() => void download()}>
            <Download size={16} />
            {pending ? 'Preparing…' : file ? 'Download again' : 'Download JSON file'}
          </Button>
          {file && (
            <Button
              variant="secondary"
              onClick={() =>
                save(
                  `${slug(client.name)}-data.txt`,
                  clientExportText(file, state.organisation.locale),
                  'text/plain',
                )
              }
            >
              Download readable summary
            </Button>
          )}
        </div>
      </Modal>
      <Modal
        open={open === 'erasure'}
        wide
        onClose={() => setOpen('')}
        title={`Erasure review for ${client.name}`}
        description="What a decided retention policy would remove, and what must stay. Nothing is deleted."
      >
        {review ? (
          <>
            <div className="privacy-preview">
              <section>
                <h3>Could be removed once you decide a policy</h3>
                <ul className="privacy-items">
                  {review.removable.map((item) => (
                    <li key={item.label}>
                      <strong>
                        {item.label}
                        {item.count !== null && <span className="ops-count">{item.count}</span>}
                      </strong>
                      <small>{item.reason}</small>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Must be kept, and why</h3>
                <ul className="privacy-items">
                  {review.kept.map((item) => (
                    <li key={item.label}>
                      <strong>
                        {item.label}
                        {item.count !== null && <span className="ops-count">{item.count}</span>}
                      </strong>
                      <small>{item.reason}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <h3 className="privacy-subheading">Decisions still needed</h3>
            <ul className="privacy-plain">
              {review.decisions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        ) : (
          !error && <p>Preparing the review…</p>
        )}
        <p className="privacy-default">
          SALEANE does not delete client records yet. Recording the request adds it to the audit log
          and shows it on this client.
        </p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {done}
        </p>
        <div className="privacy-actions">
          {mode === 'server' ? (
            <Button
              disabled={!review || pending || requests.length > 0}
              onClick={() => void recordRequest()}
            >
              {requests.length ? 'Request recorded' : 'Record erasure request'}
            </Button>
          ) : (
            <p className="subtle">
              The browser demo keeps no audit log, so requests are not recorded.
            </p>
          )}
          {client.marketingConsent && can(role, 'consent') && (
            <Button
              variant="secondary"
              disabled={pending || saving || blocked}
              onClick={() => void withdrawMarketing()}
            >
              Withdraw email marketing
            </Button>
          )}
        </div>
      </Modal>
    </section>
  )
}

type AuditEvent = {
  id: string
  action: string
  recordId: string
  occurredAt: number
  actor: string
}
const PRIVACY_ACTIONS: Record<string, string> = {
  'client.exported': 'Client data copy downloaded',
  'client.erasure_requested': 'Erasure request recorded',
  'studio.exported': 'Whole studio exported',
}

/** The whole-studio export and the privacy record, in Manage studio. */
export function StudioPrivacy() {
  const { state, role, mode, session } = useStore()
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}`
  const owner = canPrivacy(role, 'studio.export')
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const by = session?.user.name ?? 'Browser demo'
  const local = () =>
    studioExport(state, { generatedAt: new Date().toISOString(), generatedBy: by })
  async function refreshRecord() {
    if (mode !== 'server' || !['owner', 'manager'].includes(role)) return
    const audit = await api<{ events: AuditEvent[] }>(`${base}/audit`)
    setEvents(audit.events.filter((e) => e.action in PRIVACY_ACTIONS))
  }
  useEffect(() => {
    let active = true
    if (mode === 'server' && ['owner', 'manager'].includes(role))
      api<{ events: AuditEvent[] }>(`${base}/audit`)
        .then((audit) => {
          if (active) setEvents(audit.events.filter((e) => e.action in PRIVACY_ACTIONS))
        })
        .catch(() => {
          /* The record is supplementary; exports still work. */
        })
    return () => {
      active = false
    }
  }, [base, mode, role])
  async function prepare() {
    setError('')
    setDone('')
    try {
      setPreview(
        mode === 'server'
          ? (await api<{ preview: ExportPreview }>(`${base}/privacy/studio/export`)).preview
          : previewStudioExport(local()),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The preview could not be prepared.')
    }
  }
  async function download() {
    setPending(true)
    setError('')
    try {
      const file =
        mode === 'server'
          ? (
              await api<{ export: StudioExport }>(`${base}/privacy/studio/export`, {
                method: 'POST',
                body: {},
              })
            ).export
          : local()
      save(
        `${slug(state.organisation.name)}-studio-export.json`,
        JSON.stringify(file, null, 2),
        'application/json',
      )
      setDone(
        mode === 'server'
          ? 'Downloaded. This export is recorded in the studio’s audit log.'
          : 'Downloaded from the fictional demo. The browser demo keeps no audit log.',
      )
      await refreshRecord().catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export could not be prepared.')
    } finally {
      setPending(false)
    }
  }
  const clientName = (id: string) => state.clients.find((c) => c.id === id)?.name ?? 'A client'
  const when = new Intl.DateTimeFormat(state.organisation.locale, {
    timeZone: state.organisation.timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <>
      <section className="surface ops-panel">
        <header>
          <div>
            <h2>Export the whole studio</h2>
            <p>
              One file with this studio’s clients, visits, money and settings, for your own records.
            </p>
          </div>
          <ShieldCheck size={21} />
        </header>
        {owner ? (
          <>
            {preview ? (
              <PreviewList preview={preview} />
            ) : (
              <p className="ops-help">
                Prepare a preview to see exactly what the file holds and what stays out.
              </p>
            )}
            <p className="privacy-default">{DEFAULTS_NOTE}</p>
            <ErrorMessage error={error} />
            <p className="ops-save-note" role="status">
              {done}
            </p>
            <div className="ops-actions">
              {preview ? (
                <Button disabled={pending} onClick={() => void download()}>
                  <Download size={16} />
                  {pending ? 'Preparing…' : 'Download studio export'}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void prepare()}>
                  Preview the export
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="ops-help">Only the owner can export the whole studio.</p>
        )}
      </section>
      <section className="surface ops-panel">
        <header>
          <div>
            <h2>Privacy record</h2>
            <p>
              Exports and erasure requests, from the audit log. Contents are never logged, only who
              acted and when.
            </p>
          </div>
        </header>
        {mode === 'demo' ? (
          <p className="ops-help">The browser demo keeps no audit log.</p>
        ) : !['owner', 'manager'].includes(role) ? (
          <p className="ops-help">An owner or manager can see this record.</p>
        ) : events.length ? (
          <div className="ops-ledger">
            {events.map((e) => (
              <div className="ops-record" key={e.id}>
                <div className="ops-record-copy">
                  <strong>{PRIVACY_ACTIONS[e.action]}</strong>
                  <small>
                    {e.action === 'studio.exported'
                      ? state.organisation.name
                      : clientName(e.recordId)}{' '}
                    · {e.actor} · {when.format(new Date(e.occurredAt))}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="ops-help">No exports or erasure requests yet.</p>
        )}
        <p className="ops-help">
          Retention periods are proposals awaiting your decision with an adviser. SALEANE deletes
          nothing automatically.
        </p>
      </section>
    </>
  )
}

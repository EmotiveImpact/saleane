import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Plug } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { connectionEventLabels, connectionEventTypes } from '../domain/connectionEvents'
import type { ConnectionEventType } from '../domain/connectionEvents'
import { Button, ErrorMessage } from '../design'

type Connection = {
  id: string
  name: string
  url: string
  events: ConnectionEventType[]
  shareContact: boolean
  active: boolean
  createdBy: string
  createdAt: string
}
type Delivery = {
  id: string
  connectionId: string
  type: string
  status: 'pending' | 'delivered' | 'failed' | 'skipped' | 'unknown' | 'test'
  attempts: number
  responseStatus: number | null
  detail: string | null
  createdAt: string
  updatedAt: string
}
type Listing = {
  connections: Connection[]
  deliveries: Delivery[]
  apiVersion: string
  mode: 'test' | 'live'
  sample: boolean
  secret?: string
}

const statusLabel: Record<Delivery['status'], string> = {
  pending: 'Waiting to go',
  delivered: 'Delivered',
  failed: 'Not delivered',
  skipped: 'Not sent, turned off',
  unknown: 'May have arrived',
  test: 'Test mode, not sent',
}
const eventLabel = (type: string) =>
  type === 'connection.test'
    ? 'Test event'
    : (connectionEventLabels[type as ConnectionEventType] ?? type)
/**
 * V5: other software the owner connects, such as a Zapier hook or their own system. Each one
 * hears only the events chosen for it, guest details only when the owner says so, and every
 * delivery is listed. One switch turns them all off.
 */
export function Connections() {
  const { mode, session, state, role } = useStore()
  const orgId = state.organisation.id
  const signedIn = mode === 'server' && !!session
  const base = `/api/workspaces/${encodeURIComponent(orgId)}/connections`
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<ConnectionEventType[]>(['appointment.booked'])
  const [shareContact, setShareContact] = useState(false)

  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))
  const [refresh, setRefresh] = useState(0)
  const load = () => setRefresh((n) => n + 1)
  const allowed = signedIn && role === 'owner'
  useEffect(() => {
    if (!allowed) return
    let current = true
    api<Listing>(base)
      .then((next) => {
        if (current) setListing(next)
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'Connections could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [allowed, base, refresh])

  async function send(path: string, body: unknown, message: string) {
    setPending(true)
    setError('')
    setDone('')
    try {
      const next = await api<Listing>(`${base}${path}`, { method: 'POST', body })
      setListing(next)
      setDone(message)
      return next
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.')
      return null
    } finally {
      setPending(false)
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = await send('', { name, url, events, shareContact }, `Connected “${name.trim()}”.`)
    if (next?.secret) {
      setSecret({ name: name.trim(), value: next.secret })
      setAdding(false)
      setName('')
      setUrl('')
      setEvents(['appointment.booked'])
      setShareContact(false)
    }
  }
  async function renew(connection: Connection) {
    const next = await send(
      `/${connection.id}/secret`,
      {},
      `New signing secret made for “${connection.name}”. The old one no longer works.`,
    )
    if (next?.secret) setSecret({ name: connection.name, value: next.secret })
  }

  const intro = (
    <header>
      <div>
        <h2 id="connections-title">Connected software</h2>
        <p>
          Tell other software when something happens in your diary, such as a Zapier hook or your
          own system. You choose what each one hears, and you can turn any of them off at once.
        </p>
      </div>
      <Plug size={21} />
    </header>
  )
  if (!allowed)
    return (
      <section className="surface ops-panel settings-panel" aria-labelledby="connections-title">
        {intro}
        <p className="subtle">
          {!signedIn
            ? 'Connections need a signed-in studio of your own. This browser preview keeps everything on this device.'
            : 'Only the studio owner can connect other software, because it sends studio records outside SALEANE.'}
        </p>
      </section>
    )
  const active = listing?.connections.filter((c) => c.active).length ?? 0
  return (
    <section
      className="surface ops-panel settings-panel connections-panel"
      aria-labelledby="connections-title"
      aria-busy={pending}
    >
      {intro}
      {listing?.sample ? (
        <p className="subtle">
          A sample studio never sends anything outside SALEANE. Connect other software from a studio
          of your own.
        </p>
      ) : (
        listing?.mode === 'test' && (
          <p className="connections-mode">
            Test mode: each event is signed and listed below as it would be sent. Nothing leaves
            this computer.
          </p>
        )
      )}
      {secret && (
        <div className="connections-secret" role="status">
          <p>
            <strong>Signing secret for “{secret.name}”.</strong> Copy it into the other software
            now. It is shown only this once.
          </p>
          <code>{secret.value}</code>
          <Button variant="quiet" onClick={() => setSecret(null)}>
            I have copied it
          </Button>
        </div>
      )}
      {done && !secret && <p role="status">{done}</p>}
      <ErrorMessage error={error} />
      {listing && listing.connections.length > 0 && (
        <ul className="connections-list">
          {listing.connections.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <span className={`ops-tag${c.active ? ' is-active' : ''}`}>
                  {c.active ? 'On' : 'Off'}
                </span>
                <p className="connections-url">{c.url}</p>
                <p>
                  {c.events.map(eventLabel).join(', ')}.{' '}
                  {c.shareContact
                    ? 'Includes guest names, email and phone.'
                    : 'Guest names and contact details are left out.'}
                </p>
              </div>
              <div className="saved-reply-actions">
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() =>
                    void send(
                      `/${c.id}`,
                      { active: !c.active },
                      c.active ? `“${c.name}” is off.` : `“${c.name}” is on.`,
                    )
                  }
                >
                  {c.active ? 'Turn off' : 'Turn on'}
                  <span className="sr-only"> {c.name}</span>
                </Button>
                <Button
                  variant="quiet"
                  disabled={pending || !c.active}
                  onClick={() =>
                    void send(
                      `/${c.id}/test`,
                      {},
                      `Test event made for “${c.name}”. See the log below.`,
                    )
                  }
                >
                  Send a test<span className="sr-only"> to {c.name}</span>
                </Button>
                <Button variant="quiet" disabled={pending} onClick={() => void renew(c)}>
                  New secret<span className="sr-only"> for {c.name}</span>
                </Button>
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() =>
                    void send(
                      `/${c.id}/remove`,
                      {},
                      `Removed “${c.name}”. Nothing more goes to it; its log is kept.`,
                    )
                  }
                >
                  Remove<span className="sr-only"> {c.name}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {listing && !listing.sample && (
        <div className="ops-actions">
          {!adding && listing.connections.length < 10 && (
            <Button variant="secondary" disabled={pending} onClick={() => setAdding(true)}>
              Connect software
            </Button>
          )}
          {active > 0 && (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() =>
                void send('/pause-all', {}, 'Every connection is off. Nothing more is sent.')
              }
            >
              Turn all off
            </Button>
          )}
        </div>
      )}
      {adding && (
        <form className="saved-reply-form" onSubmit={(e) => void add(e)}>
          <label>
            Name
            <input
              required
              minLength={2}
              maxLength={60}
              value={name}
              placeholder="Zapier"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Address it should send to
            <input
              required
              type="url"
              inputMode="url"
              maxLength={500}
              value={url}
              placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <fieldset className="message-settings">
            <legend>Tell it when</legend>
            {connectionEventTypes.map((type) => (
              <label className="checkbox-label" key={type}>
                <input
                  type="checkbox"
                  checked={events.includes(type)}
                  onChange={(e) =>
                    setEvents((now) =>
                      e.target.checked ? [...now, type] : now.filter((x) => x !== type),
                    )
                  }
                />
                {connectionEventLabels[type]}
              </label>
            ))}
          </fieldset>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={shareContact}
              onChange={(e) => setShareContact(e.target.checked)}
            />
            Include guest names, email and phone. Leave this off unless the other software needs
            them.
          </label>
          <div className="ops-actions">
            <Button type="submit" disabled={pending || events.length === 0}>
              {pending ? 'Connecting…' : 'Connect'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {listing && !listing.sample && (
        <div className="connections-log">
          <h3>What was sent</h3>
          {listing.deliveries.length ? (
            <ul>
              {listing.deliveries.map((d) => (
                <li key={d.id}>
                  <span>
                    <strong>{eventLabel(d.type)}</strong> to{' '}
                    {listing.connections.find((c) => c.id === d.connectionId)?.name ??
                      'a removed connection'}
                  </span>
                  <span>{statusLabel[d.status]}</span>
                  <span className="subtle">
                    {when(d.updatedAt)}
                    {d.attempts > 1 ? `, ${d.attempts} tries` : ''}
                    {d.detail ? `. ${d.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">Nothing yet.</p>
          )}
          <Button variant="quiet" disabled={pending} onClick={load}>
            Refresh the log
          </Button>
        </div>
      )}
    </section>
  )
}

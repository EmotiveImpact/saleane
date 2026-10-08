import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'

type Scope = 'appointments:read' | 'clients:read' | 'services:read'
type AccessKey = {
  id: string
  name: string
  prefix: string
  scopes: Scope[]
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
}
type Listing = { keys: AccessKey[]; apiVersion: string; sample: boolean; key?: string }

const scopeLabel: Record<Scope, string> = {
  'appointments:read': 'Visits',
  'clients:read': 'Clients, with names, email and phone',
  'services:read': 'Treatments, prices and the team',
}
const scopes = Object.keys(scopeLabel) as Scope[]

/**
 * V5: read-only access keys. Other software (an accountant's tool, the studio's own reports)
 * can read what the owner allows and change nothing. Each key can be revoked at any time.
 */
export function AccessKeys() {
  const { mode, session, state, role } = useStore()
  const allowed = mode === 'server' && !!session && role === 'owner'
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/api-keys`
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [shown, setShown] = useState<{ name: string; value: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<Scope[]>(['appointments:read'])
  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))

  useEffect(() => {
    if (!allowed) return
    let current = true
    api<Listing>(base)
      .then((next) => {
        if (current) setListing(next)
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'Access keys could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [allowed, base])

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
    const next = await send('', { name, scopes: chosen }, `Made “${name.trim()}”.`)
    if (next?.key) {
      setShown({ name: name.trim(), value: next.key })
      setAdding(false)
      setName('')
      setChosen(['appointments:read'])
    }
  }

  if (!allowed || listing?.sample) return null
  return (
    <section
      className="surface ops-panel settings-panel connections-panel"
      aria-labelledby="access-keys-title"
      aria-busy={pending}
    >
      <header>
        <div>
          <h2 id="access-keys-title">Access keys</h2>
          <p>
            Let other software read from your studio, such as your accountant&rsquo;s tool or your
            own reports. A key can only read what you tick, never change anything, and stops working
            the moment you revoke it.
          </p>
        </div>
        <KeyRound size={21} />
      </header>
      {shown && (
        <div className="connections-secret" role="status">
          <p>
            <strong>Access key for “{shown.name}”.</strong> Copy it into the other software now. It
            is shown only this once.
          </p>
          <code>{shown.value}</code>
          <Button variant="quiet" onClick={() => setShown(null)}>
            I have copied it
          </Button>
        </div>
      )}
      {done && !shown && <p role="status">{done}</p>}
      <ErrorMessage error={error} />
      {listing && listing.keys.length > 0 && (
        <ul className="connections-list">
          {listing.keys.map((k) => (
            <li key={k.id}>
              <div>
                <strong>{k.name}</strong>
                <p>
                  Starts sal_{k.prefix}. Reads {k.scopes.map((s) => scopeLabel[s]).join('; ')}.
                </p>
                <p>
                  Made by {k.createdBy}, {when(k.createdAt)}.{' '}
                  {k.lastUsedAt ? `Last used ${when(k.lastUsedAt)}.` : 'Not used yet.'}
                </p>
              </div>
              <div className="saved-reply-actions">
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() =>
                    void send(`/${k.id}/revoke`, {}, `Revoked “${k.name}”. It no longer works.`)
                  }
                >
                  Revoke<span className="sr-only"> {k.name}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="saved-reply-form" onSubmit={(e) => void add(e)}>
          <label>
            What it is for
            <input
              required
              minLength={2}
              maxLength={60}
              value={name}
              placeholder="Accounts"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset className="message-settings">
            <legend>It may read</legend>
            {scopes.map((scope) => (
              <label className="checkbox-label" key={scope}>
                <input
                  type="checkbox"
                  checked={chosen.includes(scope)}
                  onChange={(e) =>
                    setChosen((now) =>
                      e.target.checked ? [...now, scope] : now.filter((x) => x !== scope),
                    )
                  }
                />
                {scopeLabel[scope]}
              </label>
            ))}
          </fieldset>
          <div className="ops-actions">
            <Button type="submit" disabled={pending || chosen.length === 0}>
              {pending ? 'Making…' : 'Make the key'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        listing &&
        listing.keys.length < 10 && (
          <div className="ops-actions">
            <Button variant="secondary" disabled={pending} onClick={() => setAdding(true)}>
              Make an access key
            </Button>
          </div>
        )
      )}
    </section>
  )
}

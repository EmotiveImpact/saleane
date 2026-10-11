import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage, Select } from '../design'
import { places } from '../domain/locations'
import { fullDateLabel } from '../domain/format'
import { StudioDateField } from './StudioDateField'
import {
  LOCATION_SCOPES,
  isWriteScope,
  keySummary,
  readScopes,
  scopeWords,
  writeScopes,
} from '../domain/accessKeys'
import type { ApiScope as Scope } from '../domain/accessKeys'

type AccessKey = {
  id: string
  name: string
  prefix: string
  scopes: Scope[]
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
  locationId: string | null
  endsOn: string | null
}
type Listing = { keys: AccessKey[]; apiVersion: string; sample: boolean; key?: string }

/**
 * V5 and Stage 5: access keys. Other software and partners (an accountant's tool, a booking tool,
 * a chain's own tills, the studio's own reports) can read what the owner allows and, when the
 * owner ticks it, send in visits, clients and till sales through the same checks as the desk. A
 * key can be kept to one location and stop on a chosen day, and can be revoked at any time.
 */
export function AccessKeys() {
  const { mode, session, state, role, today } = useStore()
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
  const [locationId, setLocationId] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const sites = places(state)
  const siteName = (id: string) => sites.find((p) => p.id === id)?.name ?? 'a closed location'
  const offered: readonly Scope[] = locationId ? LOCATION_SCOPES : [...readScopes, ...writeScopes]
  const changes = chosen.some((x) => offered.includes(x) && isWriteScope(x))
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
    const next = await send(
      '',
      {
        name,
        scopes: chosen.filter((x) => offered.includes(x)),
        ...(locationId ? { locationId } : {}),
        ...(endsOn ? { endsOn } : {}),
      },
      `Made “${name.trim()}”.`,
    )
    if (next?.key) {
      setShown({ name: name.trim(), value: next.key })
      setAdding(false)
      setName('')
      setChosen(['appointments:read'])
      setLocationId('')
      setEndsOn('')
    }
  }

  function choice(scope: Scope) {
    return (
      <label className="checkbox-label access-key-scope" key={scope}>
        <input
          type="checkbox"
          checked={chosen.includes(scope)}
          aria-describedby={`scope-${scope.replace(':', '-')}`}
          onChange={(e) =>
            setChosen((now) =>
              e.target.checked ? [...now, scope] : now.filter((x) => x !== scope),
            )
          }
        />
        <span>
          {scopeWords[scope].label}
          <small id={`scope-${scope.replace(':', '-')}`}>{scopeWords[scope].detail}</small>
        </span>
      </label>
    )
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
            own reports, or send things in, such as a booking tool or a chain&rsquo;s own tills. A
            key can only do what you tick, goes through the same checks as the desk, and stops
            working the moment you revoke it. A partner&rsquo;s key can be kept to one location and
            stop on a day you choose.
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
                  Starts sal_{k.prefix}. {keySummary(k.scopes)}
                  {k.locationId ? `, at ${siteName(k.locationId)} only` : ''}.
                </p>
                {k.scopes.some(isWriteScope) && (
                  <p>Its changes show in Who changed what under its name.</p>
                )}
                {k.endsOn && (
                  <p>
                    Works until the end of {fullDateLabel(k.endsOn, state.organisation.locale)}.
                  </p>
                )}
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
          {sites.length > 1 && (
            <label>
              Which locations
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">The whole studio</option>
                {sites.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} only
                  </option>
                ))}
              </Select>
            </label>
          )}
          {locationId && (
            <p className="ops-help">
              A key for one location reads and books its own visits, reads the treatments and team,
              and sends in its own till&rsquo;s sales. Clients and takings belong to the whole
              studio.
            </p>
          )}
          <fieldset className="message-settings">
            <legend>It may read</legend>
            {offered.filter((scope) => !isWriteScope(scope)).map(choice)}
          </fieldset>
          <details className="access-key-changes" open={changes || undefined}>
            <summary>It may also change things</summary>
            <fieldset className="message-settings">
              <legend className="sr-only">It may change</legend>
              {offered.filter(isWriteScope).map(choice)}
              <p className="ops-help">
                Every change goes through the same checks as the desk and shows in Who changed what
                under this key&rsquo;s name. Connected software is still told about it, marked as
                coming from this key.
              </p>
            </fieldset>
          </details>
          <label>
            Stops working after (optional)
            <StudioDateField value={endsOn} min={today} onChange={setEndsOn} />
          </label>
          <div className="ops-actions">
            <Button variant="quiet" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !chosen.some((x) => offered.includes(x))}>
              {pending ? 'Making…' : 'Make the key'}
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

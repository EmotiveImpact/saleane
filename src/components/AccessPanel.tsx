import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from './ui'

type Team = {
  members: { id: string; name: string; email: string; role: string }[]
  invitations: { email: string; role: string; expiresAt: number }[]
}
export function AccessPanel() {
  const { state, role, mode } = useStore()
  const base = `/api/workspaces/${state.organisation.id}`
  const [team, setTeam] = useState<Team | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const [email, setEmail] = useState(''),
    [inviteRole, setInviteRole] = useState('reception'),
    [link, setLink] = useState(''),
    [copied, setCopied] = useState(false)
  const [password, setPassword] = useState(''),
    [nextPassword, setNextPassword] = useState(''),
    [changed, setChanged] = useState(false)
  useEffect(() => {
    if (mode !== 'server' || role !== 'owner') return
    let active = true
    api<Team>(`${base}/team`)
      .then((t) => {
        if (active) setTeam(t)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [base, role, mode])
  if (mode === 'demo')
    return (
      <section className="surface manage-section">
        <h2>Workspace access</h2>
        <p>
          The fictional browser demo has no team accounts. Create a local account to manage a shared
          studio.
        </p>
        <a className="button button-secondary" href="/account">
          Open local accounts
        </a>
      </section>
    )
  async function changeMember(accountId: string, nextRole: string) {
    setPending(true)
    setError('')
    try {
      await api(`${base}/membership`, { method: 'POST', body: { accountId, role: nextRole } })
      setTeam(await api<Team>(`${base}/team`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Access could not be updated.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface manage-section">
      <h2>Workspace access</h2>
      <p>
        Each person signs in separately. Invitation links work on this local server; no email is
        sent.
      </p>
      {role === 'owner' ? (
        <>
          <div className="access-list">
            {team?.members.map((m) => (
              <div className="access-row" key={m.id}>
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </span>
                {m.role === 'owner' ? (
                  <span>Owner</span>
                ) : (
                  <>
                    <label>
                      <span className="sr-only">Role for {m.name}</span>
                      <select
                        disabled={pending}
                        value={m.role}
                        onChange={(e) => void changeMember(m.id, e.target.value)}
                      >
                        <option value="manager">Manager</option>
                        <option value="reception">Reception</option>
                      </select>
                    </label>
                    <Button
                      variant="quiet"
                      disabled={pending}
                      onClick={() => void changeMember(m.id, 'remove')}
                    >
                      Remove access
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setPending(true)
              setError('')
              setLink('')
              try {
                const result = await api<{ url: string }>(`${base}/invitations`, {
                  method: 'POST',
                  body: { email, role: inviteRole },
                })
                setLink(result.url)
                setCopied(false)
                setTeam(await api<Team>(`${base}/team`))
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Invitation could not be created.')
              } finally {
                setPending(false)
              }
            }}
          >
            <div className="form-grid">
              <label>
                Team email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Access
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="reception">Reception</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
            </div>
            <p className="subtle">
              Managers can configure the studio and review money. Reception can manage appointments,
              clients and checkout. Restricted practitioner accounts are a later release gate.
            </p>
            <Button type="submit" disabled={pending}>
              Create invitation link
            </Button>
          </form>
          {link && (
            <div className="copy-invitation">
              <label>
                Invitation link · expires in 48 hours
                <input readOnly value={link} onFocus={(e) => e.target.select()} />
              </label>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link)
                    setCopied(true)
                  } catch {
                    setError('Select and copy the invitation link above.')
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          )}
          {Boolean(team?.invitations.length) && (
            <details>
              <summary>Pending invitations ({team?.invitations.length})</summary>
              {team?.invitations.map((i) => (
                <p key={i.email}>
                  {i.email} · {i.role}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <p>Only the owner can invite people or change workspace access.</p>
      )}
      <details>
        <summary>Change your password</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setPending(true)
            setError('')
            setChanged(false)
            try {
              await api('/api/auth/password', {
                method: 'POST',
                body: { current: password, password: nextPassword },
              })
              setChanged(true)
              setPassword('')
              setNextPassword('')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Password could not be changed.')
            } finally {
              setPending(false)
            }
          }}
        >
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={pending}>
            {changed ? 'Password updated' : 'Update password'}
          </Button>
        </form>
      </details>
      <ErrorMessage error={error} />
    </section>
  )
}

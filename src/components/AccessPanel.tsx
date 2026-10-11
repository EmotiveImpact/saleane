import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage, Select } from '../design'
import { regions } from '../domain/group'
import { areaPlaces } from '../domain/area'
import { hasLocations, places } from '../domain/locations'
import { TwoStepSettings } from './TwoStepSettings'
import { TwoStepForEveryone } from './TwoStepForEveryone'
import { PasskeySettings } from './PasskeySettings'
import './accessPanel.css'

type Team = {
  members: {
    id: string
    name: string
    email: string
    role: string
    staffId: string | null
    areaId: string | null
    locationId?: string | null
    /** NEXT-04: whether this person has two-step sign-in on. */
    twoStep?: boolean
    /** NEXT-15: whether this person signs in with Face ID or a fingerprint on any device. */
    passkey?: boolean
  }[]
  invitations: {
    email: string
    role: string
    staffId: string | null
    areaId: string | null
    locationId?: string | null
    expiresAt: number
  }[]
}
export function AccessPanel() {
  const { state, role, mode } = useStore()
  const base = `/api/workspaces/${state.organisation.id}`
  const [team, setTeam] = useState<Team | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const [email, setEmail] = useState(''),
    [inviteRole, setInviteRole] = useState('reception'),
    [inviteStaff, setInviteStaff] = useState(''),
    [inviteArea, setInviteArea] = useState(''),
    [inviteBranch, setInviteBranch] = useState(''),
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
      <section className="surface ops-panel access-panel" aria-labelledby="access-title">
        <header>
          <div>
            <h2 id="access-title">Who can sign in</h2>
            <p>
              The fictional demo has no team accounts. Create a studio of your own to invite your
              team.
            </p>
          </div>
          <KeyRound size={21} aria-hidden="true" />
        </header>
        <a className="button button-secondary" href="/account">
          Create your studio
        </a>
      </section>
    )
  // A practitioner seat is always linked to one active professional: "practitioner:<staffId>".
  const professionals = state.staff.filter((person) => !person.archived)
  const professionalName = (staffId: string | null) =>
    state.staff.find((person) => person.id === staffId)?.name ?? 'an archived professional'
  // V5: a regional manager looks after one region: "regional:<regionId>".
  // Only a region with an open location can be looked after.
  const areas = regions(state).filter((r) => areaPlaces(state, r.id).ids.size > 0)
  const areaName = (areaId: string | null) =>
    regions(state).find((r) => r.id === areaId)?.name ?? 'a removed region'
  // V5: a general manager runs one open location: "general:<locationId>". Offered once there are
  // several locations.
  const branches = hasLocations(state) ? places(state) : []
  const branchName = (locationId: string | null | undefined) =>
    places(state, true).find((p) => p.id === locationId)?.name ?? 'a closed location'
  async function changeMember(accountId: string, choice: string) {
    const [nextRole, linked] = choice.split(':')
    setPending(true)
    setError('')
    try {
      await api(`${base}/membership`, {
        method: 'POST',
        body: {
          accountId,
          role: nextRole,
          ...(linked && nextRole === 'practitioner' ? { staffId: linked } : {}),
          ...(linked && nextRole === 'regional' ? { areaId: linked } : {}),
          ...(linked && nextRole === 'general' ? { locationId: linked } : {}),
        },
      })
      setTeam(await api<Team>(`${base}/team`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Access could not be updated.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface ops-panel access-panel" aria-labelledby="access-title">
      <header>
        <div>
          <h2 id="access-title">Who can sign in</h2>
          <p>
            Each person signs in with their own account. Invitation links open on this computer for
            now, and no email is sent.
          </p>
        </div>
        <KeyRound size={21} aria-hidden="true" />
      </header>
      {role === 'owner' ? (
        <>
          <div className="access-list">
            {team?.members.map((m) => (
              <div className="access-row" key={m.id}>
                <span>
                  <strong>{m.name}</strong>
                  <small>
                    {m.email}
                    {/* Stage 6: who has it on and who has not yet, never their key or codes. */}
                    {m.twoStep ? ' · Two-step sign-in on' : ' · No two-step sign-in yet'}
                    {m.twoStep ? ' · Two-step sign-in on' : ''}
                    {m.passkey ? ' · Face ID on' : ''}
                  </small>
                </span>
                {m.role === 'owner' ? (
                  <span>Owner</span>
                ) : (
                  <>
                    <label>
                      <span className="sr-only">Role for {m.name}</span>
                      <Select
                        disabled={pending}
                        value={
                          m.role === 'practitioner'
                            ? `practitioner:${m.staffId}`
                            : m.role === 'regional'
                              ? `regional:${m.areaId}`
                              : m.role === 'general'
                                ? `general:${m.locationId}`
                                : m.role
                        }
                        onChange={(e) => void changeMember(m.id, e.target.value)}
                      >
                        <option value="manager">Manager</option>
                        <option value="reception">Reception</option>
                        {m.role === 'practitioner' &&
                          !professionals.some((person) => person.id === m.staffId) && (
                            <option value={`practitioner:${m.staffId}`}>
                              Practitioner · {professionalName(m.staffId)}
                            </option>
                          )}
                        {professionals.map((person) => (
                          <option key={person.id} value={`practitioner:${person.id}`}>
                            Practitioner · {person.name}
                          </option>
                        ))}
                        {m.role === 'regional' && !areas.some((r) => r.id === m.areaId) && (
                          <option value={`regional:${m.areaId}`}>
                            Regional manager · {areaName(m.areaId)}
                          </option>
                        )}
                        {areas.map((r) => (
                          <option key={r.id} value={`regional:${r.id}`}>
                            Regional manager · {r.name}
                          </option>
                        ))}
                        {m.role === 'general' && !branches.some((p) => p.id === m.locationId) && (
                          <option value={`general:${m.locationId}`}>
                            General manager · {branchName(m.locationId)}
                          </option>
                        )}
                        {branches.map((p) => (
                          <option key={p.id} value={`general:${p.id}`}>
                            General manager · {p.name}
                          </option>
                        ))}
                      </Select>
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
            className="access-invite"
            aria-labelledby="invite-title"
            onSubmit={async (e) => {
              e.preventDefault()
              setPending(true)
              setError('')
              setLink('')
              try {
                const result = await api<{ url: string }>(`${base}/invitations`, {
                  method: 'POST',
                  body: {
                    email,
                    role: inviteRole,
                    ...(inviteRole === 'practitioner' ? { staffId: inviteStaff } : {}),
                    ...(inviteRole === 'regional' ? { areaId: inviteArea } : {}),
                    ...(inviteRole === 'general' ? { locationId: inviteBranch } : {}),
                  },
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
            <h3 id="invite-title" className="access-subtitle">
              Invite someone
            </h3>
            <div className="ops-fields">
              <label>
                Team email
                <input
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Access
                <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="reception">Reception</option>
                  <option value="manager">Manager</option>
                  <option value="practitioner">Practitioner</option>
                  {branches.length > 0 && <option value="general">General manager</option>}
                  {areas.length > 0 && <option value="regional">Regional manager</option>}
                </Select>
              </label>
              {inviteRole === 'general' && (
                <label>
                  Runs
                  <Select
                    required
                    value={inviteBranch}
                    onChange={(e) => setInviteBranch(e.target.value)}
                  >
                    <option value="">Choose a location</option>
                    {branches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {inviteRole === 'regional' && (
                <label>
                  Looks after
                  <Select
                    required
                    value={inviteArea}
                    onChange={(e) => setInviteArea(e.target.value)}
                  >
                    <option value="">Choose a region</option>
                    {areas.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {inviteRole === 'practitioner' && (
                <label>
                  Works as
                  <Select
                    required
                    value={inviteStaff}
                    onChange={(e) => setInviteStaff(e.target.value)}
                  >
                    <option value="">Choose a professional</option>
                    {professionals.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
            <p className="ops-help">
              Managers can configure the studio and review money. Reception can manage visits,
              clients and checkout. A practitioner sees only their own visits, with each client's
              name, preferences and notes, and can welcome their client and add notes. They see no
              contact details, prices, payments or other diaries.
              {branches.length > 0 &&
                ' A general manager runs one location as a manager would: its diary, takings, stock and orders, its team’s rota and time off, its rooms, messages to its clients for the owner to approve, branch visits and requests. They change nothing at other locations or for the whole business, such as treatments, prices, who works where, usual hours or settings, and do not see pay rates.'}
              {areas.length > 0 &&
                ' A regional manager sees only their region’s locations: how each is doing, what is booked today, their branch visits, which they can record, and requests for a sign-off, which they can raise and approve up to the owner’s limit. They see no clients, diaries, prices or settings.'}
            </p>
            <div className="ops-actions">
              <Button type="submit" disabled={pending}>
                Create invitation link
              </Button>
            </div>
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
                  {i.role === 'practitioner' ? ` · ${professionalName(i.staffId)}` : ''}
                  {i.role === 'regional' ? ` · ${areaName(i.areaId)}` : ''}
                  {i.role === 'general' ? ` · ${branchName(i.locationId)}` : ''}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <p className="ops-help">Only the owner can invite people or change who can sign in.</p>
      )}
      <details className="access-password">
        <summary>Change your password</summary>
        <form
          aria-label="Change your password"
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
          <div className="ops-fields">
            <div className="ops-field">
              <label htmlFor="access-current-password">Current password</label>
              <input
                id="access-current-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="ops-field">
              <label htmlFor="access-new-password">New password</label>
              <input
                id="access-new-password"
                type="password"
                autoComplete="new-password"
                aria-describedby="access-new-password-help"
                required
                minLength={12}
                maxLength={128}
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
              />
              <small id="access-new-password-help">At least 12 characters.</small>
            </div>
          </div>
          <p className="ops-save-note" role="status">
            {changed ? 'Your password is updated.' : ''}
          </p>
          <div className="ops-actions">
            <Button type="submit" disabled={pending}>
              Update password
            </Button>
          </div>
        </form>
      </details>
      <TwoStepSettings
        onChange={() => {
          // The owner's own row says whether two-step sign-in is on.
          if (role === 'owner')
            api<Team>(`${base}/team`)
              .then(setTeam)
              .catch(() => {})
        }}
      />
      <PasskeySettings />
      {role === 'owner' && <TwoStepForEveryone members={team?.members} />}
      <ErrorMessage error={error} />
    </section>
  )
}

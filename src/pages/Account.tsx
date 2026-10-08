import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { Session } from '../state/api'
import { Button, ErrorMessage } from '../design'
import '../account.css'

export function Account() {
  const store = useStore(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const invitation = params.get('invitation') ?? ''
  const [view, setView] = useState<'signin' | 'create' | 'workspace'>(
    invitation ? 'create' : 'signin',
  )
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [business, setBusiness] = useState(''),
    [location, setLocation] = useState('')
  const [region, setRegion] = useState<'UK' | 'US'>('UK'),
    [timeZone, setTimeZone] = useState('Europe/London')
  const [sample, setSample] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    store
      .refreshSession()
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
    // Session lookup is intentionally once per account-page visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /**
   * Practitioners open their own day and regional managers their area; every other role opens
   * the studio workspace.
   */
  async function open(id: string, current: Session | null) {
    const role = current?.workspaces.find((w) => w.id === id)?.role
    if (role === 'practitioner') {
      navigate(`/practice/${encodeURIComponent(id)}`)
      return
    }
    if (role === 'regional') {
      navigate(`/area/${encodeURIComponent(id)}`)
      return
    }
    await store.openWorkspace(id)
    navigate('/today')
  }
  async function enter(id: string, current = store.session) {
    setPending(true)
    setError('')
    try {
      await open(id, current)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workspace could not be opened.')
    } finally {
      setPending(false)
    }
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      let orgId = ''
      let current: Session | null = null
      if (view === 'signin') {
        await api('/api/auth/login', { method: 'POST', body: { email, password } })
        current = await store.refreshSession()
        if (invitation) {
          const joined = await api<{ orgId: string }>('/api/invitations/accept', {
            method: 'POST',
            body: { invitation },
          })
          orgId = joined.orgId
          current = await store.refreshSession()
        } else orgId = current?.workspaces[0]?.id ?? ''
      } else if (view === 'workspace') {
        const result = await api<{ orgId: string }>('/api/workspaces', {
          method: 'POST',
          body: { workspace: { name: business, region, locationName: location, timeZone, sample } },
        })
        orgId = result.orgId
        current = await store.refreshSession()
      } else {
        const result = await api<{ orgId: string }>('/api/auth/register', {
          method: 'POST',
          body: {
            name,
            email,
            password,
            ...(invitation
              ? { invitation }
              : {
                  workspace: { name: business, region, locationName: location, timeZone, sample },
                }),
          },
        })
        orgId = result.orgId
        current = await store.refreshSession()
      }
      setPassword('')
      if (orgId) await open(orgId, current)
      else setView('workspace')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This request could not be completed.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="account-layout">
      <aside className="account-story">
        <Link className="wordmark" to="/today">
          SALEANE
        </Link>
        <div>
          <span className="eyebrow">A considered way to run your business</span>
          <p className="account-story-title">
            A place for
            <br />
            every promise.
          </p>
          <p>Your people, appointments and client relationships, remembered together.</p>
        </div>
        <img
          src="/images/saleane-studio-warm.jpg"
          alt="A calm fictional studio with natural light"
        />
        <small>
          Local V1 workspace · payments and email not connected · <Link to="/pricing">Pricing</Link>
        </small>
      </aside>
      <main className="account-main">
        <Link className="back-link" to="/today">
          <ArrowLeft size={16} />
          Back to workspace
        </Link>
        {ready && store.session && view !== 'workspace' ? (
          <>
            <p className="date-caption">Welcome, {store.session.user.name}</p>
            <h1>Your studios</h1>
            <p className="subtle">Choose where to work today.</p>
            <div className="account-workspaces">
              {store.session.workspaces.map((w) => (
                <button disabled={pending} onClick={() => void enter(w.id)} key={w.id}>
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.region} · {w.role} ·{' '}
                      {w.mode === 'sandbox' ? 'Fictional sample' : 'Local business'}
                    </small>
                  </span>
                  <ArrowRight size={19} />
                </button>
              ))}
            </div>
            {!store.session.workspaces.length && (
              <p>You do not have an active studio membership.</p>
            )}
            {invitation && (
              <Button
                disabled={pending}
                onClick={async () => {
                  setPending(true)
                  try {
                    const result = await api<{ orgId: string }>('/api/invitations/accept', {
                      method: 'POST',
                      body: { invitation },
                    })
                    await enter(result.orgId, await store.refreshSession())
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Invitation could not be accepted.')
                  } finally {
                    setPending(false)
                  }
                }}
              >
                Accept studio invitation
              </Button>
            )}
            <div className="account-actions">
              <Button onClick={() => setView('workspace')}>Create another studio</Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  setPending(true)
                  try {
                    await store.logout()
                    setView('signin')
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Sign out could not be confirmed.')
                  } finally {
                    setPending(false)
                  }
                }}
              >
                Sign out
              </Button>
            </div>
            <ErrorMessage error={error} />
          </>
        ) : (
          <>
            <p className="date-caption">
              {invitation ? 'A place on the team' : 'Your local workspace'}
            </p>
            <h1>
              {view === 'signin'
                ? 'Welcome back.'
                : view === 'workspace'
                  ? 'Make room for your studio.'
                  : invitation
                    ? 'Join your studio.'
                    : 'Begin with your business.'}
            </h1>
            <p className="account-intro">
              {view === 'signin'
                ? 'Sign in to continue with the records saved on this computer.'
                : 'Accounts and studio records are saved by the local server. Card payments and email sending are not connected yet.'}
            </p>
            <form onSubmit={submit}>
              {view !== 'workspace' && (
                <>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {view === 'create' && (
                    <label>
                      Your name
                      <input
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete={view === 'signin' ? 'current-password' : 'new-password'}
                      required
                      minLength={view === 'signin' ? 1 : 12}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {view === 'create' && <small>Use at least 12 characters.</small>}
                  </label>
                </>
              )}
              {(view === 'workspace' || (view === 'create' && !invitation)) && (
                <>
                  <label>
                    Business name
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                    />
                  </label>
                  <label>
                    Location name
                    <input
                      required
                      maxLength={120}
                      placeholder="For example, Marylebone studio"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Market
                      <select
                        value={region}
                        onChange={(e) => {
                          const next = e.target.value as 'UK' | 'US'
                          setRegion(next)
                          setTimeZone(next === 'UK' ? 'Europe/London' : 'America/New_York')
                        }}
                      >
                        <option value="UK">United Kingdom · GBP</option>
                        <option value="US">United States · USD</option>
                      </select>
                    </label>
                    <label>
                      Venue time zone
                      <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                        {(region === 'UK'
                          ? ['Europe/London']
                          : [
                              'America/New_York',
                              'America/Chicago',
                              'America/Denver',
                              'America/Los_Angeles',
                              'America/Phoenix',
                              'Pacific/Honolulu',
                            ]
                        ).map((zone) => (
                          <option key={zone}>{zone}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={sample}
                      onChange={(e) => setSample(e.target.checked)}
                    />
                    Start with fictional sample appointments
                  </label>
                  <small className="subtle">
                    {sample
                      ? 'Sample appointments use the fixed demonstration day and simulated money.'
                      : 'Your studio begins with no client or payment records. Set up services, people and spaces before booking.'}
                  </small>
                </>
              )}
              <ErrorMessage error={error} />
              <Button type="submit" disabled={pending || !ready}>
                {pending
                  ? 'Saving…'
                  : view === 'signin'
                    ? 'Sign in'
                    : invitation
                      ? 'Join studio'
                      : 'Create local workspace'}
                <ArrowRight size={16} />
              </Button>
            </form>
            <div className="account-actions">
              {view === 'workspace' ? (
                <Button variant="quiet" onClick={() => setView('signin')}>
                  Back to studios
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setView(view === 'signin' ? 'create' : 'signin')
                    setError('')
                  }}
                >
                  {view === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
                </Button>
              )}
              <Button
                variant="quiet"
                onClick={() => {
                  store.enterDemo()
                  navigate('/today')
                }}
              >
                Explore the fictional demo
              </Button>
            </div>
            <div className="account-footnote">
              <ShieldCheck size={19} />
              <span>
                Local access only. There is no email verification or recovery provider configured.
                Use review accounts and fictional client information for this candidate.
              </span>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

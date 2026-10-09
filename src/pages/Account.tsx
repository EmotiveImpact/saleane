import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { Session } from '../state/api'
import { rememberStudio } from '../state/lastStudio'
import { roleNames } from '../domain/operations'
import { Button, ErrorMessage } from '../design'
import { BrandsTogether } from '../components/BrandsTogether'
import { InvitationSummary } from '../components/InvitationSummary'
import { TwoStepCode } from '../components/TwoStepCode'
import type { InvitationPreview } from '../components/InvitationSummary'
import '../account.css'

/** What the server says after it is asked for a password or confirmation link. */
type LinkAnswer = { emailConnected: boolean; linkInLog: boolean }

export function Account() {
  const store = useStore(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const invitation = params.get('invitation') ?? ''
  const [view, setView] = useState<'signin' | 'create' | 'workspace' | 'forgot'>(
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
  // NEXT-03: what happened after asking for a password link or a fresh confirmation link.
  const [linkSent, setLinkSent] = useState<LinkAnswer | null>(null)
  const [confirmSent, setConfirmSent] = useState<LinkAnswer | null>(null)
  const [confirmProblem, setConfirmProblem] = useState('')
  const [challenge, setChallenge] = useState('')
  const emailField = useRef<HTMLInputElement>(null),
    sentNote = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // The control that was pressed has gone, so the focus moves to what replaced it.
    if (view === 'forgot') (linkSent ? sentNote : emailField).current?.focus()
  }, [view, linkSent])
  // A team invitation names its studio and role before anyone signs in.
  const [invited, setInvited] = useState<InvitationPreview | null>(null)
  const [inviteProblem, setInviteProblem] = useState('')
  useEffect(() => {
    if (!invitation) return
    let active = true
    api<InvitationPreview>('/api/invitations/preview', { method: 'POST', body: { invitation } })
      .then((found) => {
        if (!active) return
        setInvited(found)
        // The invitation works only with the address it was sent to.
        setEmail((typed) => typed || found.email)
      })
      .catch((e) => {
        if (active)
          setInviteProblem(e instanceof Error ? e.message : 'This invitation could not be read.')
      })
    return () => {
      active = false
    }
  }, [invitation])
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
    // A new tab opens this studio again for them (the studio itself is noted once it opens).
    if (current && (role === 'practitioner' || role === 'regional'))
      rememberStudio(current.user.id, id)
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
      setError(e instanceof Error ? e.message : 'This studio could not be opened.')
    } finally {
      setPending(false)
    }
  }
  /** After the password (and the code, with two-step sign-in on): join or open a studio. */
  async function finishSignIn() {
    let current = await store.refreshSession()
    let orgId = current?.workspaces[0]?.id ?? ''
    if (invitation) {
      const joined = await api<{ orgId: string }>('/api/invitations/accept', {
        method: 'POST',
        body: { invitation },
      })
      orgId = joined.orgId
      current = await store.refreshSession()
    }
    if (orgId) await open(orgId, current)
    else setView('workspace')
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      let orgId = ''
      let current: Session | null = null
      if (view === 'forgot') {
        setLinkSent(
          await api<LinkAnswer>('/api/auth/forgot', {
            method: 'POST',
            body: { email },
          }),
        )
        return
      }
      if (view === 'signin') {
        const answer = await api<{ twoStep?: boolean; challenge?: string }>('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        })
        setPassword('')
        // NEXT-04: two-step sign-in asks for the code before anyone is signed in.
        if (answer.twoStep && answer.challenge) setChallenge(answer.challenge)
        else await finishSignIn()
        return
      }
      if (view === 'workspace') {
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
  // Joining works only with the address the invitation was sent to.
  const otherEmail = !!invited && !!store.session && store.session.user.email !== invited.email
  return (
    <div className="account-layout">
      <AccountStory />
      <main className="account-main">
        {/* Signed in with no studio open, the workspace would only bring them back here. */}
        {store.landing !== '/account' && (
          <Link className="back-link" to="/today">
            <ArrowLeft size={16} />
            Back to your studio
          </Link>
        )}
        {ready && store.session && view !== 'workspace' ? (
          <>
            <p className="date-caption">Welcome, {store.session.user.name}</p>
            <h1>Your studios</h1>
            <p className="subtle">Choose where to work today.</p>
            {store.session.user.emailConfirmed === false && (
              <div className="account-confirm" role="status">
                <p>
                  Please confirm your email, {store.session.user.email}, with the link we send to
                  it. Everything works in the meantime.
                </p>
                {confirmSent ? (
                  <p className="subtle">
                    {confirmSent.emailConnected
                      ? 'A link is on its way. If nothing arrives in a few minutes, look in your spam folder.'
                      : confirmSent.linkInLog
                        ? 'Email is not connected on this computer, so nothing was sent. The new link is written in the server log for whoever runs SALEANE here.'
                        : 'Email is not connected yet, so nothing was sent.'}
                  </p>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={async () => {
                      setPending(true)
                      setConfirmProblem('')
                      try {
                        const sent = await api<LinkAnswer & { confirmed: boolean }>(
                          '/api/auth/confirm/resend',
                          { method: 'POST', body: {} },
                        )
                        if (sent.confirmed) await store.refreshSession()
                        else setConfirmSent(sent)
                      } catch (e) {
                        setConfirmProblem(
                          e instanceof Error ? e.message : 'A link could not be made.',
                        )
                      } finally {
                        setPending(false)
                      }
                    }}
                  >
                    Send a confirmation link
                  </Button>
                )}
                <ErrorMessage error={confirmProblem} />
              </div>
            )}
            <div className="account-workspaces">
              {store.session.workspaces.map((w) => (
                <button disabled={pending} onClick={() => void enter(w.id)} key={w.id}>
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.region} · {roleNames[w.role] ?? w.role} ·{' '}
                      {w.mode === 'sandbox' ? 'Sample studio' : 'Your studio'}
                      {w.locked &&
                        (w.role === 'owner'
                          ? ' · Locked until you pay its SALEANE bill'
                          : ' · Locked until the owner pays its SALEANE bill')}
                    </small>
                  </span>
                  <ArrowRight size={19} />
                </button>
              ))}
            </div>
            <BrandsTogether
              owned={store.session.workspaces.filter((w) => w.role === 'owner').length}
              onOpen={(id) => void enter(id)}
            />
            {!store.session.workspaces.length && (
              <p>You do not have an active studio membership.</p>
            )}
            {invitation && invited && <InvitationSummary invitation={invited} />}
            {invitation && <ErrorMessage error={inviteProblem} />}
            {invitation && otherEmail && (
              <p className="subtle">
                This invitation was sent to {invited?.email}. Sign out, then sign in or create an
                account with that address to join.
              </p>
            )}
            {invitation && (
              <Button
                disabled={pending || otherEmail}
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
                {invited ? `Join ${invited.studio}` : 'Accept studio invitation'}
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
              {invitation ? 'A place on the team' : 'Your SALEANE account'}
            </p>
            <h1>
              {challenge
                ? 'One more step.'
                : view === 'signin'
                  ? 'Welcome back.'
                  : view === 'forgot'
                    ? 'Choose a new password.'
                    : view === 'workspace'
                      ? 'Make room for your studio.'
                      : invitation
                        ? `Join ${invited?.studio ?? 'your studio'}.`
                        : 'Begin with your business.'}
            </h1>
            {invitation && view !== 'workspace' && invited && (
              <InvitationSummary invitation={invited} />
            )}
            {invitation && view !== 'workspace' && <ErrorMessage error={inviteProblem} />}
            <p className="account-intro">
              {challenge
                ? `Two-step sign-in is on for ${email}, so signing in needs a code as well as the password.`
                : view === 'forgot'
                  ? 'Enter the email you sign in with. If it has an account, we will send a link to choose a new password. The link works for an hour.'
                  : view === 'signin'
                    ? invited
                      ? `Sign in with ${invited.email} to join ${invited.studio}.`
                      : 'Sign in to continue with the records saved on this computer.'
                    : invited && view === 'create'
                      ? 'Create your account with the email your invitation was sent to. Accounts and studio records are kept on this computer for now.'
                      : 'Accounts and studio records are kept on this computer for now. Card payments and emails are not connected yet.'}
            </p>
            {challenge ? (
              <TwoStepCode
                challenge={challenge}
                onSignedIn={async () => {
                  setChallenge('')
                  try {
                    await finishSignIn()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'This studio could not be opened.')
                  }
                }}
                onRestart={(message) => {
                  setChallenge('')
                  setError(message)
                }}
              />
            ) : view === 'forgot' && linkSent ? (
              <div className="account-confirm" role="status" tabIndex={-1} ref={sentNote}>
                <p>
                  {linkSent.emailConnected
                    ? `If ${email} has an account, a link is on its way. It works for an hour, and only once. If nothing arrives in a few minutes, look in your spam folder or ask again.`
                    : linkSent.linkInLog
                      ? `Email is not connected on this computer, so nothing was sent. If ${email} has an account, the link is written in the server log for whoever runs SALEANE here. It works for an hour, and only once.`
                      : 'Email is not connected yet, so nothing was sent and the password cannot be changed this way.'}
                </p>
              </div>
            ) : (
              <form onSubmit={submit}>
                {view !== 'workspace' && (
                  <>
                    <label>
                      Email
                      <input
                        ref={emailField}
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      {invited && (
                        <small>
                          {email.trim().toLowerCase() === invited.email
                            ? 'Your invitation was sent to this address.'
                            : `Your invitation was sent to ${invited.email}.`}
                        </small>
                      )}
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
                    {view !== 'forgot' && (
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
                    )}
                    {view === 'signin' && (
                      <button
                        type="button"
                        className="account-forgot"
                        onClick={() => {
                          setView('forgot')
                          setError('')
                          setLinkSent(null)
                        }}
                      >
                        Forgotten your password?
                      </button>
                    )}
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
                      Start with made-up sample clients and visits
                    </label>
                    <small className="subtle">
                      {sample
                        ? 'The sample is set on one fixed day, and its money is simulated.'
                        : 'Your studio starts empty. A short list on Today takes you through treatments, your team, rooms and opening hours.'}
                    </small>
                  </>
                )}
                <ErrorMessage error={error} />
                <Button type="submit" disabled={pending || !ready}>
                  {pending
                    ? 'Saving…'
                    : view === 'signin'
                      ? 'Sign in'
                      : view === 'forgot'
                        ? 'Send the link'
                        : invitation
                          ? 'Join studio'
                          : 'Create your studio'}
                  <ArrowRight size={16} />
                </Button>
              </form>
            )}
            <div className="account-actions">
              {view === 'workspace' ? (
                <Button variant="quiet" onClick={() => setView('signin')}>
                  Back to studios
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setView(view === 'signin' && !challenge ? 'create' : 'signin')
                    setError('')
                    setLinkSent(null)
                    setChallenge('')
                  }}
                >
                  {challenge
                    ? 'Back to sign in'
                    : view === 'signin'
                      ? 'Create an account'
                      : view === 'forgot'
                        ? 'Back to sign in'
                        : 'Already have an account? Sign in'}
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
                This preview runs on this computer only, so use made-up client details while you try
                it. Email is not connected yet, so password and confirmation links are written in
                the server log rather than sent.
              </span>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/** The photograph and words beside every account page. */
export function AccountStory() {
  return (
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
        <p>Your team, visits and clients, remembered together.</p>
      </div>
      <img src="/images/saleane-studio-warm.jpg" alt="A calm fictional studio with natural light" />
      <small>
        A preview on this computer · card payments and email not connected yet ·{' '}
        <Link to="/pricing">Pricing</Link>
      </small>
    </aside>
  )
}

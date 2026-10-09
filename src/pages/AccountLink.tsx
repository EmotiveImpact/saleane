import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api, setCsrf } from '../state/api'
import { Button, ErrorMessage } from '../design'
import { AccountStory } from './Account'
import '../account.css'

/**
 * NEXT-03: the pages an emailed link opens. /reset-password chooses a new password and signs in,
 * signing every other device out. /confirm-email confirms the address and needs no sign-in.
 */
export function AccountLink() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const reset = pathname === '/reset-password'
  const [password, setPassword] = useState(''),
    [again, setAgain] = useState('')
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false)
  // A confirmation link does its work as soon as it opens, once.
  const [confirm, setConfirm] = useState<{ done: boolean; error: string } | null>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (reset || !token || asked.current) return
    asked.current = true
    api('/api/auth/confirm', { method: 'POST', body: { token } })
      .then(() => setConfirm({ done: true, error: '' }))
      .catch((e) =>
        setConfirm({
          done: false,
          error: e instanceof Error ? e.message : 'This link could not be checked.',
        }),
      )
  }, [reset, token])
  const missing = token ? '' : 'This link is missing its code. Open it again from the email.'
  const confirmError = missing || (confirm?.error ?? '')
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== again) {
      setError('The two passwords are different. Type the same one twice.')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await api<{ csrf: string }>('/api/auth/reset', {
        method: 'POST',
        body: { token, password },
      })
      setCsrf(result.csrf)
      setPassword('')
      setAgain('')
      // The account page reads the new session when it opens; reading it here would move away.
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The new password could not be saved.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="account-layout">
      <AccountStory />
      <main className="account-main">
        <p className="date-caption">Your SALEANE account</p>
        {reset ? (
          done ? (
            <>
              <h1>Your new password is set.</h1>
              <p className="account-intro">
                You are signed in here. Anywhere else you were signed in has been signed out, so use
                the new password there.
              </p>
              <Button onClick={() => navigate('/account')}>
                Go to your studios
                <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <>
              <h1>Choose a new password.</h1>
              <p className="account-intro">
                Use at least 12 characters. Saving it signs you out everywhere else.
              </p>
              <form onSubmit={submit}>
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Type it again
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </label>
                <ErrorMessage error={error || missing} />
                <Button type="submit" disabled={pending || !token}>
                  {pending ? 'Saving…' : 'Save and sign in'}
                  <ArrowRight size={16} />
                </Button>
              </form>
            </>
          )
        ) : (
          <>
            <h1>{confirm?.done ? 'Your email is confirmed.' : 'Confirming your email.'}</h1>
            <p className="account-intro">
              {confirm?.done
                ? 'Thank you. Nothing else is needed.'
                : confirmError
                  ? 'This link could not be used.'
                  : 'Checking the link…'}
            </p>
            <ErrorMessage error={confirmError} />
          </>
        )}
        {!(reset && done) && (
          <div className="account-actions">
            <Link className="button button-quiet" to="/account">
              {reset ? 'Back to sign in' : 'Open SALEANE'}
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

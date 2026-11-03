import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'
import { TwoStepSettings } from './TwoStepSettings'
import { PasskeySettings } from './PasskeySettings'
import './accessPanel.css'

/**
 * How one person signs in: their password, two-step sign-in and Face ID. It is theirs alone, so
 * it sits under their own name ("You"), never in the studio's Settings or the Team page.
 */
export function YourSignIn({ signedIn }: { signedIn: boolean }) {
  const [password, setPassword] = useState(''),
    [nextPassword, setNextPassword] = useState(''),
    [changed, setChanged] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('')
  if (!signedIn)
    return (
      <section
        id="signing-in"
        className="surface ops-panel access-panel"
        aria-labelledby="sign-in-title"
      >
        <header>
          <div>
            <h2 id="sign-in-title">Signing in</h2>
            <p>
              Your password, two-step sign-in and Face ID live here once you have a studio of your
              own. The fictional demo has no accounts.
            </p>
          </div>
          <KeyRound size={21} aria-hidden="true" />
        </header>
      </section>
    )
  return (
    <section
      id="signing-in"
      className="surface ops-panel access-panel"
      aria-labelledby="sign-in-title"
    >
      <header>
        <div>
          <h2 id="sign-in-title">Signing in</h2>
          <p>Only you can change these, and they never change anyone else's.</p>
        </div>
        <KeyRound size={21} aria-hidden="true" />
      </header>
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
      <TwoStepSettings />
      <PasskeySettings />
      <ErrorMessage error={error} />
    </section>
  )
}

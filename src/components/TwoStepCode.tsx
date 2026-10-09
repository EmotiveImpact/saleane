import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { api, ApiError, setCsrf } from '../state/api'
import { Button, ErrorMessage } from '../design'

export type SignedIn = { csrf: string; recoveryLeft?: number }

/**
 * NEXT-04: the second step of signing in. The password has been checked; nobody is signed in
 * until the code from the authenticator app, or an unused recovery code, is right.
 */
export function TwoStepCode({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: string
  onSignedIn: (answer: SignedIn) => Promise<void> | void
  /** The sign-in step has timed out or had too many wrong codes. */
  onRestart: (message: string) => void
}) {
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [recovery])
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const answer = await api<SignedIn>('/api/auth/login/code', {
        method: 'POST',
        body: { challenge, code },
      })
      setCsrf(answer.csrf)
      await onSignedIn(answer)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The code could not be checked.'
      if (e instanceof ApiError && e.status === 410) onRestart(message)
      else setError(message)
      setCode('')
    } finally {
      setPending(false)
    }
  }
  return (
    <form className="two-step-code" onSubmit={submit}>
      <label>
        {recovery ? 'Recovery code' : 'Code from your authenticator app'}
        <input
          ref={field}
          key={recovery ? 'recovery' : 'app'}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby="two-step-code-help"
          {...(recovery
            ? { autoComplete: 'off', autoCapitalize: 'none', spellCheck: false, maxLength: 20 }
            : {
                inputMode: 'numeric' as const,
                autoComplete: 'one-time-code',
                pattern: '[0-9 ]{6,7}',
                maxLength: 7,
                placeholder: '123 456',
              })}
        />
        <small id="two-step-code-help">
          {recovery
            ? 'One of the codes you saved when you turned on two-step sign-in. Each works once.'
            : 'Open the app and type the six numbers shown for SALEANE. They change every 30 seconds.'}
        </small>
      </label>
      <ErrorMessage error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Sign in'}
        <ArrowRight size={16} />
      </Button>
      <button
        type="button"
        className="account-forgot"
        onClick={() => {
          setRecovery(!recovery)
          setCode('')
          setError('')
        }}
      >
        {recovery ? 'Use a code from the app instead' : 'Lost your phone? Use a recovery code'}
      </button>
    </form>
  )
}

import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { addPasskey, deviceName, passkeyProblem, passkeysInBrowser } from '../state/passkeys'
import type { Passkey } from '../state/passkeys'
import { Button, ErrorMessage } from '../design'

type Phase = { kind: 'idle' } | { kind: 'add' } | { kind: 'remove'; passkey: Passkey }

/**
 * NEXT-15: the devices that can sign in as this person with Face ID, Touch ID, Windows Hello or a
 * fingerprint. Adding or removing one asks for the password again, and the code too when
 * two-step sign-in is on, since a new way in skips both.
 */
export function PasskeySettings() {
  const store = useStore()
  const user = store.session?.user
  const here = store.session?.passkeysHere ?? false
  const locale = store.state.organisation.locale
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState('')
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState('')
  const browser = passkeysInBrowser()
  useEffect(() => {
    if (!user || !here) return
    let active = true
    api<{ passkeys: Passkey[] }>('/api/auth/passkeys')
      .then((answer) => {
        if (active) setPasskeys(answer.passkeys)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Your devices could not be read.')
      })
    return () => {
      active = false
    }
  }, [user, here])
  if (!user) return null
  const count = passkeys?.length ?? user.passkeys ?? 0
  function go(next: Phase) {
    setPhase(next)
    setPassword('')
    setCode('')
    setError('')
    if (next.kind === 'add') setName(deviceName())
  }
  async function run(work: () => Promise<void>, fallback: string) {
    setPending(true)
    setError('')
    setNote('')
    try {
      await work()
    } catch (e) {
      const problem = passkeyProblem(e, fallback)
      if (problem) setError(problem)
      else setNote('Nothing was changed.')
    } finally {
      setPending(false)
    }
  }
  const add = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    return run(async () => {
      const answer = await addPasskey({
        password,
        code: user.twoStep ? code : undefined,
        name: name.trim(),
      })
      setPasskeys(answer.passkeys)
      go({ kind: 'idle' })
      setNote(
        `${name.trim()} is set up. Next time, choose Sign in with Face ID or fingerprint on the sign-in page.`,
      )
      await store.refreshSession()
    }, 'This device could not be added.')
  }
  const remove = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (phase.kind !== 'remove') return
    const gone = phase.passkey
    return run(async () => {
      const answer = await api<{ passkeys: Passkey[] }>('/api/auth/passkeys/remove', {
        method: 'POST',
        body: { id: gone.id, password },
      })
      setPasskeys(answer.passkeys)
      go({ kind: 'idle' })
      setNote(`${gone.name} can no longer sign in.`)
      await store.refreshSession()
    }, 'This device could not be removed.')
  }
  const day = (time: number) =>
    new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const passwordField = (
    <div className="ops-field">
      <label htmlFor="passkey-password">Your password</label>
      <input
        id="passkey-password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
    </div>
  )
  const cancel = (
    <Button variant="quiet" disabled={pending} onClick={() => go({ kind: 'idle' })}>
      Cancel
    </Button>
  )
  return (
    <details className="access-password access-two-step access-passkeys">
      <summary>
        Face ID and fingerprint
        <span className={`access-two-step-state${count ? ' is-on' : ''}`}>
          {count === 0 ? 'Off' : count === 1 ? '1 device' : `${count} devices`}
        </span>
      </summary>
      <div className="access-two-step-body">
        {!here ? (
          <p className="ops-help">
            Signing in with Face ID or a fingerprint works once SALEANE is on its own secure web
            address. On this computer, open SALEANE at localhost to try it.
          </p>
        ) : phase.kind === 'add' ? (
          <form onSubmit={add} aria-label="Add this device">
            <p className="ops-help">
              Your device will ask for your face, fingerprint or screen lock. Enter your password
              {user.twoStep ? ' and a code from your app' : ''} first.
            </p>
            <div className="ops-fields">
              <div className="ops-field">
                <label htmlFor="passkey-name">Name this device</label>
                <input
                  id="passkey-name"
                  required
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              {passwordField}
              {user.twoStep && (
                <div className="ops-field">
                  <label htmlFor="passkey-code">Code from the app, or a recovery code</label>
                  <input
                    id="passkey-code"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={20}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="ops-actions">
              <Button type="submit" disabled={pending}>
                {pending ? 'Waiting for your device…' : 'Add this device'}
              </Button>
              {cancel}
            </div>
          </form>
        ) : phase.kind === 'remove' ? (
          <form onSubmit={remove} aria-label={`Remove ${phase.passkey.name}`}>
            <p className="ops-help">
              {phase.passkey.name} will no longer sign in with Face ID or a fingerprint. Enter your
              password to go on.
            </p>
            <div className="ops-fields">{passwordField}</div>
            <div className="ops-actions">
              <Button type="submit" variant="secondary" disabled={pending}>
                Remove {phase.passkey.name}
              </Button>
              {cancel}
            </div>
          </form>
        ) : (
          <>
            <p className="ops-help">
              Sign in with Face ID, Touch ID, Windows Hello or a fingerprint instead of your
              password. Your face or finger never leaves your device: SALEANE keeps only a key that
              proves the device is yours.
            </p>
            {passkeys && passkeys.length > 0 && (
              <ul className="passkey-list" aria-label="Devices that sign in">
                {passkeys.map((passkey) => (
                  <li key={passkey.id}>
                    <div>
                      <strong>{passkey.name}</strong>
                      <small>
                        Added {day(passkey.createdAt)} ·{' '}
                        {passkey.lastUsedAt
                          ? `last used ${day(passkey.lastUsedAt)}`
                          : 'not used yet'}
                        {passkey.shared ? ' · also on your other devices' : ''}
                      </small>
                    </div>
                    <Button
                      variant="quiet"
                      aria-label={`Remove ${passkey.name}`}
                      onClick={() => go({ kind: 'remove', passkey })}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {browser ? (
              <div className="ops-actions">
                <Button
                  variant={count ? 'secondary' : 'primary'}
                  disabled={pending}
                  onClick={() => go({ kind: 'add' })}
                >
                  {count ? 'Add another device' : 'Add this device'}
                </Button>
              </div>
            ) : (
              <p className="ops-help">
                This browser cannot use Face ID or a fingerprint. Open SALEANE in Safari, Chrome,
                Edge or Firefox to add this device.
              </p>
            )}
          </>
        )}
        <p className="ops-save-note" role="status">
          {note}
        </p>
        <ErrorMessage error={error} />
      </div>
    </details>
  )
}

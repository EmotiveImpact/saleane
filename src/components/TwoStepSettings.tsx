import { useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'
import { QrCode } from './QrCode'
import { studiosAsking } from '../domain/twoStepRule'

type Phase =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; uri: string }
  | { kind: 'codes'; codes: string[]; turnedOn: boolean }
  | { kind: 'renew' }
  | { kind: 'off' }

/** Recovery codes below this many get a nudge to make new ones. */
const FEW_LEFT = 3
/** In small letters and fours, so the letter o never reads as a zero (the key has no zeros). */
const grouped = (key: string) =>
  key
    .toLowerCase()
    .match(/.{1,4}/g)
    ?.join(' ') ?? key

function save(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * NEXT-04: turning two-step sign-in on and off for the person signed in. The key is shown once,
 * as a QR code and as text; recovery codes are shown once and kept only as hashes. Stage 6: for
 * everyone with an account, whatever their role, on their account page as well as in Settings.
 */
export function TwoStepSettings({
  onChange,
  startOpen,
  onBusy,
  plain,
  lead,
  onDone,
}: {
  onChange?: () => void
  /** Shown open, as on the welcome for someone who has just joined. */
  startOpen?: boolean
  /**
   * Inside a flow that has its own main button: setting up steps back to a secondary button, and
   * this says when setting up is under way so the flow's button can step back in turn.
   */
  onBusy?: (busy: boolean) => void
  /** Stage 6: the whole job of its page ("Protect your account"), so not folded away. */
  plain?: boolean
  /** Stage 6: setting up is the main job inside a flow, so its button stays the main one. */
  lead?: boolean
  /** Stage 6: two-step sign-in is on and the recovery codes are saved. */
  onDone?: () => void
}) {
  const store = useStore()
  const user = store.session?.user
  const on = user?.twoStep ?? null
  // Stage 6: the studios that ask everyone in them to use it.
  const asking = (store.session?.workspaces ?? [])
    .filter((w) => w.twoStepRequired)
    .map((w) => w.name)
  const locale = store.state.organisation.locale
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [code, setCode] = useState(''),
    [password, setPassword] = useState('')
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState('')
  if (!user) return null
  function go(next: Phase) {
    setPhase(next)
    onBusy?.(next.kind !== 'idle')
    setCode('')
    setPassword('')
    setError('')
  }
  async function run(work: () => Promise<void>, fallback: string) {
    setPending(true)
    setError('')
    setNote('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    } finally {
      setPending(false)
    }
  }
  const start = () =>
    run(async () => {
      go({
        kind: 'setup',
        ...(await api<{ secret: string; uri: string }>('/api/auth/two-step/start', {
          method: 'POST',
          body: {},
        })),
      })
    }, 'Two-step sign-in could not be set up.')
  const confirm = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    return run(async () => {
      const answer = await api<{ recoveryCodes: string[] }>('/api/auth/two-step/confirm', {
        method: 'POST',
        body: { code },
      })
      go({ kind: 'codes', codes: answer.recoveryCodes, turnedOn: true })
      await store.refreshSession()
      onChange?.()
    }, 'The code could not be checked.')
  }
  const renew = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    return run(async () => {
      const answer = await api<{ recoveryCodes: string[] }>('/api/auth/two-step/recovery', {
        method: 'POST',
        body: { password },
      })
      go({ kind: 'codes', codes: answer.recoveryCodes, turnedOn: false })
      await store.refreshSession()
    }, 'New recovery codes could not be made.')
  }
  const turnOff = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    return run(async () => {
      await api('/api/auth/two-step/off', { method: 'POST', body: { password, code } })
      await store.refreshSession()
      onChange?.()
      go({ kind: 'idle' })
      setNote('Two-step sign-in is off. Signing in needs only your password.')
    }, 'Two-step sign-in could not be turned off.')
  }
  const passwordField = (
    <div className="ops-field">
      <label htmlFor="two-step-password">Your password</label>
      <input
        id="two-step-password"
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
  const body = (
    <div className="access-two-step-body">
      {phase.kind === 'setup' ? (
        <form onSubmit={confirm} aria-label="Set up two-step sign-in">
          <ol className="two-step-steps">
            <li>
              Open an authenticator app on your phone, such as Google Authenticator, Microsoft
              Authenticator or 1Password, and add a new account.
            </li>
            <li>
              Scan this code with the app.
              <div className="two-step-scan">
                <QrCode text={phase.uri} label="QR code to add SALEANE to your authenticator app" />
                <div>
                  <p className="ops-help">Cannot scan it? Type this key into the app instead:</p>
                  <code className="two-step-key">{grouped(phase.secret)}</code>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(phase.secret)
                        .then(() => setNote('The key is copied.'))
                        .catch(() => setError('Copying did not work here. Type the key instead.'))
                    }
                  >
                    Copy the key
                  </Button>
                </div>
              </div>
            </li>
            <li>
              <div className="ops-field">
                <label htmlFor="two-step-setup-code">Type the six numbers the app shows</label>
                <input
                  id="two-step-setup-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
            </li>
          </ol>
          <div className="ops-actions">
            <Button type="submit" disabled={pending}>
              {pending ? 'Checking…' : 'Turn on two-step sign-in'}
            </Button>
            {cancel}
          </div>
        </form>
      ) : phase.kind === 'codes' ? (
        <div className="two-step-codes" aria-labelledby="two-step-codes-title">
          <h3 id="two-step-codes-title">Save your recovery codes</h3>
          <p className="ops-help">
            {phase.turnedOn
              ? 'Two-step sign-in is on, and anywhere else you were signed in has been signed out. '
              : 'Your old recovery codes no longer work. '}
            If you lose your phone, each code below lets you sign in once. Keep them somewhere safe
            away from your phone, such as a password manager. They will not be shown again.
          </p>
          <ul className="two-step-code-list">
            {phase.codes.map((recovery) => (
              <li key={recovery}>
                <code>{recovery}</code>
              </li>
            ))}
          </ul>
          <div className="ops-actions">
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(phase.codes.join('\n'))
                  .then(() => setNote('The codes are copied.'))
                  .catch(() => setError('Copying did not work here. Download them instead.'))
              }
            >
              Copy the codes
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                save(
                  'saleane-recovery-codes.txt',
                  `SALEANE recovery codes for ${user.email}\nEach code works once.\n\n${phase.codes.join('\n')}\n`,
                )
              }
            >
              Download them
            </Button>
            <Button
              onClick={() => {
                const turnedOn = phase.turnedOn
                go({ kind: 'idle' })
                if (turnedOn) onDone?.()
              }}
            >
              I have saved them
            </Button>
          </div>
        </div>
      ) : phase.kind === 'renew' ? (
        <form onSubmit={renew} aria-label="Make new recovery codes">
          <p className="ops-help">
            New codes replace all the old ones, used or not. Enter your password to go on.
          </p>
          <div className="ops-fields">{passwordField}</div>
          <div className="ops-actions">
            <Button type="submit" disabled={pending}>
              Make new codes
            </Button>
            {cancel}
          </div>
        </form>
      ) : phase.kind === 'off' ? (
        <form onSubmit={turnOff} aria-label="Turn off two-step sign-in">
          <p className="ops-help">
            Signing in will need only your password again. Enter it with a code from your app or a
            recovery code.
          </p>
          {asking.length > 0 && (
            <p className="two-step-warning">
              {studiosAsking(asking)} everyone to use two-step sign-in, so you will be asked to set
              it up again before you can open {asking.length > 1 ? 'them' : 'it'}. To move to a new
              phone, turn it off here and set it up again straight away.
            </p>
          )}
          <div className="ops-fields">
            {passwordField}
            <div className="ops-field">
              <label htmlFor="two-step-off-code">Code from the app, or a recovery code</label>
              <input
                id="two-step-off-code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          </div>
          <div className="ops-actions">
            <Button type="submit" variant="secondary" disabled={pending}>
              Turn off two-step sign-in
            </Button>
            {cancel}
          </div>
        </form>
      ) : on ? (
        <>
          <p className="ops-help">
            On since{' '}
            {new Date(on.since).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            . Signing in asks for a code from your authenticator app as well as your password.{' '}
            {on.recoveryLeft === 1
              ? 'One recovery code is left.'
              : `${on.recoveryLeft} recovery codes are left.`}
          </p>
          {on.recoveryLeft <= FEW_LEFT && (
            <p className="two-step-warning">
              You are running low on recovery codes. Make new ones so a lost phone never locks you
              out.
            </p>
          )}
          <div className="ops-actions">
            <Button variant="secondary" onClick={() => go({ kind: 'renew' })}>
              Make new recovery codes
            </Button>
            <Button variant="quiet" onClick={() => go({ kind: 'off' })}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="ops-help">
            {plain
              ? 'You need your phone and an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password. It takes about two minutes.'
              : asking.length > 0
                ? `${studiosAsking(asking)} everyone to use two-step sign-in. Signing in then asks for a code from an app on your phone as well as your password.`
                : 'Ask for a code from an app on your phone as well as your password, so a stolen password alone cannot open your studio. Recommended for everyone on the team.'}
          </p>
          <div className="ops-actions">
            <Button
              variant={onBusy && !lead ? 'secondary' : 'primary'}
              disabled={pending}
              onClick={() => void start()}
            >
              Set up two-step sign-in
            </Button>
          </div>
        </>
      )}
      <p className="ops-save-note" role="status">
        {note}
      </p>
      <ErrorMessage error={error} />
    </div>
  )
  if (plain) return <div className="access-two-step is-plain">{body}</div>
  return (
    <details className="access-password access-two-step" open={startOpen || undefined}>
      <summary>
        Two-step sign-in
        <span className={`access-two-step-state${on ? ' is-on' : ''}`}>{on ? 'On' : 'Off'}</span>
      </summary>
      {body}
    </details>
  )
}

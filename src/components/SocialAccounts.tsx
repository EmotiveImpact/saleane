import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from '../design'
import { socialChannels, socialLabel } from '../domain/inboxSchema'
import type { SocialChannel } from '../domain/inboxSchema'
import './management.css'

/** `confirmed` once the owner proved the account is theirs; until then its messages go nowhere. */
type Account = {
  channel: SocialChannel
  accountId: string
  confirmed: boolean
  connectedAt: string
}
type Status = { mode: 'off' | 'test'; sample: boolean; accounts: Account[] }

const what: Record<SocialChannel, string> = {
  instagram: 'Instagram account id',
  facebook: 'Facebook Page id',
  whatsapp: 'WhatsApp phone number id',
}

/**
 * V4: the owner connects the studio's Instagram account, Facebook Page and WhatsApp Business
 * number, so guests' messages there arrive in the inbox and the team can answer them. A typed id
 * proves nothing, so each account waits until the owner confirms it by signing in with Meta; in
 * test mode a labelled step stands in for that.
 */
export function SocialAccounts() {
  const { mode, session, state, role, blocked } = useStore()
  const allowed = mode === 'server' && !!session && role === 'owner'
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/social`
  const [status, setStatus] = useState<Status | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<SocialChannel, string>>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<SocialChannel | ''>('')

  useEffect(() => {
    if (!allowed) return
    let current = true
    api<Status>(base)
      .then((next) => current && setStatus(next))
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'This could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [allowed, base])

  async function save(channel: SocialChannel, accountId: string | null) {
    setPending(channel)
    setError('')
    setNotice('')
    try {
      const next = await api<Status>(base, {
        method: 'POST',
        body: { channel, accountId },
      })
      setStatus(next)
      setDrafts((d) => ({ ...d, [channel]: '' }))
      const now = next.accounts.find((a) => a.channel === channel)
      setNotice(
        !accountId
          ? `${socialLabel[channel]} removed. New messages there no longer arrive here.`
          : now?.confirmed
            ? `${socialLabel[channel]} is connected. Messages to it arrive in the Inbox.`
            : `${socialLabel[channel]} added. Confirm it is yours before its messages arrive.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.')
    } finally {
      setPending('')
    }
  }
  async function confirm(channel: SocialChannel) {
    setPending(channel)
    setError('')
    setNotice('')
    try {
      setStatus(await api<Status>(`${base}/confirm`, { method: 'POST', body: { channel } }))
      setNotice(`${socialLabel[channel]} confirmed. Messages to it now arrive in the Inbox.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be confirmed.')
    } finally {
      setPending('')
    }
  }

  if (!allowed || !status || status.sample) return error ? <ErrorMessage error={error} /> : null
  return (
    <section className="surface ops-panel" aria-labelledby="social-accounts-title">
      <header>
        <div>
          <h2 id="social-accounts-title">Instagram, Facebook and WhatsApp</h2>
          <p>
            Guests’ messages to your Instagram account, Facebook Page and WhatsApp Business number
            arrive in the Inbox beside their emails and texts. Your team can answer them there, up
            to a day after the guest’s last message, as the apps allow.
          </p>
        </div>
        <MessagesSquare size={21} aria-hidden="true" />
      </header>
      <p className="ops-help" role="status">
        {status.mode === 'test'
          ? 'Test mode: messages are read as Meta would send them, and answers are kept in the outbox. Nothing is sent to Instagram, Facebook or WhatsApp.'
          : 'SALEANE is waiting for Meta’s approval, so messages cannot arrive yet. You can add your accounts now, and they will connect once it is ready.'}
      </p>
      <p className="ops-help">
        {status.mode === 'test'
          ? 'Each account you add waits until you confirm it is yours, which is done by signing in with Meta. In test mode, the confirm button marked “(test)” stands in for that sign-in. Until then its messages do not arrive and the AI receptionist does not answer them.'
          : 'Each account you add waits until you confirm it is yours by signing in with Meta. Until then its messages do not arrive and the AI receptionist does not answer them.'}
      </p>
      <ul className="social-accounts">
        {socialChannels.map((channel) => {
          const account = status.accounts.find((a) => a.channel === channel)
          const label = socialLabel[channel]
          return (
            <li key={channel}>
              {account ? (
                <div className="ops-actions">
                  <span>
                    <strong>{label}</strong>{' '}
                    <span className={account.confirmed ? 'tag tag-brand' : 'tag'}>
                      {account.confirmed ? 'Connected' : 'Waiting to be confirmed'}
                    </span>{' '}
                    · {what[channel]} {account.accountId}
                  </span>
                  {!account.confirmed && status.mode === 'test' && (
                    <Button
                      variant="secondary"
                      disabled={blocked || !!pending}
                      onClick={() => void confirm(channel)}
                    >
                      {pending === channel ? 'Confirming…' : `Confirm ${label} (test)`}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={blocked || !!pending}
                    onClick={() => void save(channel, null)}
                  >
                    {pending === channel
                      ? 'Removing…'
                      : account.confirmed
                        ? `Disconnect ${label}`
                        : `Remove ${label}`}
                  </Button>
                </div>
              ) : (
                <form
                  className="ops-actions"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    const value = drafts[channel]?.trim()
                    if (value) void save(channel, value)
                  }}
                >
                  <label className="ops-field">
                    {what[channel]}
                    <input
                      value={drafts[channel] ?? ''}
                      inputMode="numeric"
                      autoComplete="off"
                      disabled={blocked || !!pending}
                      onChange={(e) => setDrafts((d) => ({ ...d, [channel]: e.target.value }))}
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={blocked || !!pending || !drafts[channel]?.trim()}
                  >
                    {pending === channel ? 'Adding…' : `Add ${label}`}
                  </Button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      <ErrorMessage error={error} />
      <p role="status" className="ops-help">
        {notice}
      </p>
    </section>
  )
}

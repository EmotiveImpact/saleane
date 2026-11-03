import { useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { consentHistory, currentWording, wordingFor, wordingVersions } from '../domain/consent'
import { CONSENT_TEXT_LIMIT } from '../domain/consentSchema'
import type { ConsentRecord } from '../domain/consentSchema'
import { localDate } from '../domain/patchTests'
import { dateLabel } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'

/**
 * V1.5: versioned consent. Settings holds the studio's own words for asking about email news; each
 * change is a new version. A client's page lists every time they agreed or stopped, with the
 * words they saw and where.
 */

export function EmailNewsWording() {
  const { state, role, blocked } = useStore()
  const current = currentWording(state)
  const [text, setText] = useState(current.text)
  const [saved, setSaved] = useState('')
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'consent-wording')
  const earlier = wordingVersions(state).slice(0, -1).reverse()
  const org = state.organisation
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved('')
    if (await run({ type: 'consent-wording', text }))
      setSaved(
        `Saved as version ${current.version + 1}. Guests who agreed before keep the words they saw.`,
      )
  }
  return (
    <section className="surface ops-panel settings-panel" aria-labelledby="email-news-wording">
      <header>
        <div>
          <h2 id="email-news-wording">Asking about email news</h2>
          <p>
            The words beside the optional box on your booking page. Each change is kept as a new
            version, so you can always show what a guest agreed to.
          </p>
        </div>
      </header>
      <form className="consent-wording" onSubmit={(e) => void save(e)}>
        <label>
          Words guests see (version {current.version}
          {current.publishedAt
            ? `, since ${dateLabel(localDate(state, current.publishedAt), org.locale, true)}`
            : ', SALEANE standard'}
          )
          <textarea
            rows={3}
            maxLength={CONSENT_TEXT_LIMIT}
            value={text}
            disabled={!allowed}
            onChange={(e) => {
              setText(e.target.value)
              setSaved('')
            }}
          />
        </label>
        <p className="subtle">
          Say plainly what they will get and that they can stop at any time. Booking never depends
          on it, and visit updates are separate.
        </p>
        <ErrorMessage error={error} />
        {saved && <p role="status">{saved}</p>}
        {allowed && (
          <div className="ops-actions">
            <Button type="submit" disabled={pending || text.trim() === current.text}>
              {pending ? 'Saving…' : `Save as version ${current.version + 1}`}
            </Button>
          </div>
        )}
      </form>
      {earlier.length > 0 && (
        <details className="consent-earlier">
          <summary>Earlier versions ({earlier.length})</summary>
          <ol>
            {earlier.map((w) => (
              <li key={w.version}>
                <strong>Version {w.version}</strong>
                {w.publishedAt &&
                  ` · ${dateLabel(localDate(state, w.publishedAt), org.locale, true)}${w.publishedBy ? ` by ${w.publishedBy}` : ''}`}
                <q>{w.text}</q>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

const where = (r: ConsentRecord) =>
  r.source === 'booking page'
    ? 'on the booking page'
    : r.source === 'guest link'
      ? 'from their visit link'
      : r.source === 'email link'
        ? 'from the stop link in a message to clients'
        : r.source === 'other software'
          ? `as ${r.actor} reported${r.how ? `: ${r.how}` : ''}`
          : r.source === 'previous system'
            ? `in their previous system, brought across by ${r.actor}`
            : `at the desk by ${r.actor}`

/** Every change to a client's email permission, newest first. */
export function ConsentHistory({ clientId }: { clientId: string }) {
  const { state } = useStore()
  const client = state.clients.find((c) => c.id === clientId)
  const rows = consentHistory(state, clientId)
  const org = state.organisation
  if (!rows.length)
    return client?.marketingConsent ? (
      <p className="subtle">Agreed before SALEANE kept a record of the words shown.</p>
    ) : null
  return (
    <ol className="consent-history" aria-label="Email permission history">
      {rows.map((r) => (
        <li key={r.id}>
          <span>
            {r.given ? 'Agreed' : 'Stopped'}{' '}
            {dateLabel(localDate(state, r.recordedAt), org.locale, true)} {where(r)}
          </span>
          {r.wordingVersion && (
            <small>
              Version {r.wordingVersion}: <q>{wordingFor(state, r.wordingVersion)?.text}</q>
            </small>
          )}
          {r.evidence && <small>{r.evidence}</small>}
        </li>
      ))}
    </ol>
  )
}

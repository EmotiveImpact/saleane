import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, Empty, ErrorMessage, PageHeader, Stat, Stats } from '../design'
import { can, operations } from '../domain/operations'
import { missYouDayChoices, reminderSettings } from '../domain/reminders'
import type { ReminderSettings } from '../domain/reminders'
import { clients, newsAudience, newsMessages, newsReasonLabel, newsSummary } from '../domain/news'
import type { NewsSummary } from '../domain/news'
import {
  BOOKED_WITHIN_DAYS,
  audienceChanges,
  automaticKinds,
  automaticLabel,
  automaticSetting,
  automaticWhen,
  emailsLeftWords,
  isAutomaticOn,
  tallyWords,
} from '../domain/marketing'
import type { AutomaticKind } from '../domain/marketing'
import { useMarketingResults } from './marketingResults'
import type { Results } from './marketingResults'
import { useClock } from '../state/clock'
import { EmailFrame } from '../components/EmailPreview'
import { EmailNewsWording } from '../components/EmailConsent'
import '../components/management.css'
import './marketing.css'

/**
 * NEXT-14: Marketing, its own section for the owner, managers and general managers. Campaigns are
 * the messages to clients (src/pages/News.tsx); here are the emails that go by themselves, who the
 * studio may write to, and what each message did. Every number is one SALEANE recorded itself:
 * nothing follows whether an email was opened.
 */

/** Says plainly whether anything really leaves SALEANE, so no number reads as more than it is. */
function SendingNote({ results }: { results: Results | null }) {
  const { mode } = useStore()
  if (mode !== 'server' || results?.mode === 'sandbox')
    return (
      <p className="marketing-note">
        This is a sample studio: nothing is sent, so there are no results to count.
      </p>
    )
  if (results && !results.providers.email.live)
    return (
      <p className="marketing-note">
        Email is in test mode: messages are written down, not sent, so none count as sent.
      </p>
    )
  return null
}

/** NEXT-14: the month's marketing emails, a hard stop like the AI allowances. */
function EmailsThisMonth({ emails }: { emails: { used: number; limit: number } }) {
  const n = (value: number) => value.toLocaleString('en-GB')
  return (
    <Stats className="marketing-stats">
      <Stat
        label="Marketing emails this month"
        value={`${n(emails.used)} of ${n(emails.limit)}`}
        detail={emailsLeftWords(emails.used, emails.limit)}
        definition="Campaign emails and the automatic due-back, birthday and we-miss-you emails count, once each when they go; a campaign sets its emails aside when approved. Aftercare, confirmations and reminders never count. Emails in test mode count for nothing. At the limit, campaigns wait for next month and automatic emails are not sent."
      />
    </Stats>
  )
}

const monthName = (month: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T12:00:00Z`),
  )

/** An email as a guest would get it, written for a made-up guest. */
function SampleEmail({ kind }: { kind: AutomaticKind }) {
  const { state } = useStore()
  const orgId = state.organisation.id
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<{ html: string }>(`/api/workspaces/${encodeURIComponent(orgId)}/outbox/sample?kind=${kind}`)
      .then((email) => {
        if (active) setHtml(email.html)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The email could not be shown.')
      })
    return () => {
      active = false
    }
  }, [orgId, kind, state.revision])
  if (error) return <ErrorMessage error={error} />
  if (!html) return <p className="subtle">Loading…</p>
  return (
    <EmailFrame
      html={html}
      title={`The ${automaticLabel[kind].toLowerCase()} email, as a guest gets it`}
    />
  )
}

/** The emails that go by themselves once switched on: what each says and how many went. */
export function MarketingAutomatic() {
  const { state, commit, blocked, role, mode, session } = useStore()
  const { results, error: resultsError } = useMarketingResults()
  const current = reminderSettings(state)
  const [draft, setDraft] = useState<ReminderSettings>(current)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [looking, setLooking] = useState<AutomaticKind | null>(null)
  const editable = can(role, 'reminders') && !blocked
  const changed = JSON.stringify(draft) !== JSON.stringify(current)
  const canLook = mode === 'server' && !!session
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !editable) return
    setPending(true)
    setError('')
    try {
      // Only these switches change here; the booking messages keep their own settings.
      const settings = { ...current }
      for (const kind of automaticKinds) {
        const key = automaticSetting[kind]
        settings[key] = draft[key] !== false
      }
      settings.missYouDays = draft.missYouDays ?? 90
      const result = await commit({ type: 'reminders', settings })
      if (!result.ok) setError(result.error)
      else setSaved('Saved. The next message due follows the new choices.')
    } catch {
      setError('The choices could not be saved. They are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  const went = (kind: AutomaticKind) => results?.automatic?.find((a) => a.kind === kind)
  return (
    <div className="marketing-page">
      <PageHeader
        eyebrow="Marketing"
        title="Automatic messages"
        description="Emails SALEANE writes and sends for you when they fall due, in your studio’s colours. Switch each one on or off."
      />
      <SendingNote results={results} />
      <ErrorMessage error={resultsError} />
      <form onSubmit={save} aria-busy={pending}>
        <fieldset className="marketing-automatic" disabled={!editable || pending}>
          <legend className="sr-only">Which emails go by themselves</legend>
          {automaticKinds.map((kind) => {
            const key = automaticSetting[kind]
            const on = isAutomaticOn(draft, kind)
            const count = went(kind)
            return (
              <section
                key={kind}
                className="surface marketing-card"
                aria-labelledby={`auto-${kind}`}
              >
                <div className="marketing-card-head">
                  <h2 id={`auto-${kind}`}>{automaticLabel[kind]}</h2>
                  <label className="marketing-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={on}
                      onChange={(e) => {
                        setDraft((before) => ({ ...before, [key]: e.target.checked }))
                        setSaved('')
                      }}
                    />
                    <span>{on ? 'On' : 'Off'}</span>
                    <span className="sr-only"> {automaticLabel[kind]} email</span>
                  </label>
                </div>
                <p>{automaticWhen[kind]}</p>
                {kind === 'miss_you' && (
                  <label className="marketing-gap">
                    A long gap is
                    <select
                      value={draft.missYouDays ?? 90}
                      disabled={!on}
                      onChange={(e) => {
                        setDraft((before) => ({
                          ...before,
                          missYouDays: Number(e.target.value) as ReminderSettings['missYouDays'],
                        }))
                        setSaved('')
                      }}
                    >
                      {missYouDayChoices.map((days) => (
                        <option key={days} value={days}>
                          {{ 60: 'Two months', 90: 'Three months', 120: 'Four months' }[
                            days as 60 | 90 | 120
                          ] ?? 'Six months'}{' '}
                          without a visit
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="marketing-count">
                  {count
                    ? count.lastThirtyDays
                      ? `${count.lastThirtyDays} sent in the last 30 days.`
                      : 'None sent in the last 30 days.'
                    : mode === 'server'
                      ? ''
                      : 'A sample studio sends none.'}
                </p>
                {canLook && (
                  <button
                    type="button"
                    className="marketing-look"
                    aria-expanded={looking === kind}
                    onClick={() => setLooking(looking === kind ? null : kind)}
                  >
                    {looking === kind ? 'Hide the email' : 'See what it says'}
                  </button>
                )}
                {looking === kind && <SampleEmail kind={kind} />}
              </section>
            )
          })}
        </fieldset>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {editable && (
          <div className="ops-actions">
            <Button type="submit" disabled={!changed || pending}>
              {pending ? 'Saving…' : 'Save automatic messages'}
            </Button>
          </div>
        )}
      </form>
      <p className="subtle marketing-foot">
        Booking confirmations, reminders and the request for feedback are about a visit, not
        marketing: they stay in{' '}
        <Link to="/settings?section=messages">Settings, Messages to guests</Link>. Each email shown
        is written for a made-up guest, Alex.
      </p>
    </div>
  )
}

/** How many clients a message to everyone would reach now, from the server where it can count. */
function useReach() {
  const { state, mode, branch } = useStore()
  const clock = useClock()
  const orgId = state.organisation.id
  const [remote, setRemote] = useState<NewsSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode !== 'server') return
    let active = true
    const query = new URLSearchParams({ by: 'either', ...(branch ? { locations: branch } : {}) })
    api<NewsSummary>(`/api/workspaces/${encodeURIComponent(orgId)}/news/audience?${query}`)
      .then((numbers) => {
        if (active) setRemote(numbers)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The numbers could not be counted.')
      })
    return () => {
      active = false
    }
  }, [mode, orgId, branch, state.revision])
  if (mode === 'server') return { reach: remote, error }
  return {
    reach: newsSummary(
      newsAudience(
        state,
        { by: 'either', ...(branch ? { locationIds: [branch] } : {}) },
        { now: clock },
      ),
    ),
    error: '',
  }
}

/** Who the studio may write to, who stopped and how, and the words they agreed to. */
export function MarketingAudience() {
  const { state } = useStore()
  const { reach, error } = useReach()
  const clock = useClock()
  const changes = audienceChanges(state, Date.parse(clock))
  const left = (reason: keyof typeof newsReasonLabel) =>
    reach?.leftOut.find((l) => l.reason === reason)?.count ?? 0
  const stopped = changes.stoppedBy
  return (
    <div className="marketing-page">
      <PageHeader
        eyebrow="Marketing"
        title="Audience"
        description="Who you may send news and offers to, counted the same way as a message to clients is counted before it goes. Only numbers, never a list."
      />
      <ErrorMessage error={error} />
      <Stats className="marketing-stats">
        <Stat
          label="Can hear from you"
          value={reach ? reach.total : '…'}
          detail="Agreed to news and offers, with a visit in the last 12 months or one booked"
        />
        <Stat
          label="By text too"
          value={reach ? reach.text : '…'}
          detail="Agreed to texts as well, with a mobile number"
        />
        <Stat
          label="Have not agreed"
          value={reach ? left('not-agreed') : '…'}
          detail="Never asked, or said no; booking never depends on it"
        />
        <Stat
          label="Stopped"
          value={stopped.link + stopped.desk + stopped.booking + stopped.software}
          detail="Agreed once, then asked to stop"
        />
      </Stats>
      <section className="surface ops-panel" aria-labelledby="audience-stopped">
        <header>
          <div>
            <h2 id="audience-stopped">How people stopped</h2>
            <p>Each guest counts once, by the last thing they asked for.</p>
          </div>
        </header>
        <ul className="marketing-lines">
          <li>
            <span>With the link in an email, or from their visit link</span>
            <span>{clients(stopped.link)}</span>
          </li>
          <li>
            <span>At the desk</span>
            <span>{clients(stopped.desk)}</span>
          </li>
          <li>
            <span>On the booking page</span>
            <span>{clients(stopped.booking)}</span>
          </li>
          {stopped.software > 0 && (
            <li>
              <span>In software you connected</span>
              <span>{clients(stopped.software)}</span>
            </li>
          )}
          <li>
            <span>{newsReasonLabel.stopped}</span>
            <span>{clients(left('stopped'))}</span>
          </li>
          <li>
            <span>{newsReasonLabel.erased}</span>
            <span>{clients(left('erased'))}</span>
          </li>
        </ul>
      </section>
      <section className="surface ops-panel" aria-labelledby="audience-months">
        <header>
          <div>
            <h2 id="audience-months">Month by month</h2>
            <p>Each time a guest agreed or asked to stop, on your studio’s calendar.</p>
          </div>
        </header>
        {changes.months.length ? (
          <table className="marketing-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Agreed</th>
                <th scope="col">Asked to stop</th>
              </tr>
            </thead>
            <tbody>
              {changes.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthName(m.month, state.organisation.locale)}</th>
                  <td>{m.agreed}</td>
                  <td>{m.stopped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="subtle marketing-empty-line">
            Nobody has agreed or stopped yet. Guests agree on the booking page, or at the desk on
            their page.
          </p>
        )}
      </section>
      <EmailNewsWording />
    </div>
  )
}

/** What each campaign and each automatic message did, month by month. */
export function MarketingResults() {
  const { state } = useStore()
  const { results, error } = useMarketingResults()
  const subjects = new Map(newsMessages(state).map((m) => [m.id, m.subject]))
  const locale = state.organisation.locale
  const months = results?.months ?? []
  return (
    <div className="marketing-page">
      <PageHeader
        eyebrow="Marketing"
        title="Results"
        description={`What each message did: how many went, how many could not and why, who stopped hearing from you, and who booked within ${BOOKED_WITHIN_DAYS / 7} weeks. Only what SALEANE records; nothing follows whether an email was opened.`}
      />
      <SendingNote results={results} />
      <ErrorMessage error={error} />
      {results?.emails && <EmailsThisMonth emails={results.emails} />}
      {months.length === 0 ? (
        <Empty title="No results yet" level={2}>
          Results appear here once a message to clients or an automatic email has gone.{' '}
          {operations(state).mode === 'sandbox' ? '' : 'Write one in Campaigns.'}
        </Empty>
      ) : (
        months.map((m) => (
          <section key={m.month} className="surface ops-panel" aria-labelledby={`month-${m.month}`}>
            <header>
              <div>
                <h2 id={`month-${m.month}`}>{monthName(m.month, locale)}</h2>
                {m.stoppedAll > 0 && (
                  <p>
                    {clients(m.stoppedAll)} asked to stop hearing from you this month, however they
                    asked.
                  </p>
                )}
              </div>
            </header>
            <ul className="marketing-lines">
              {m.campaigns.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{subjects.get(c.id) ?? 'A message to clients'}</strong>
                    <small>Campaign</small>
                  </span>
                  <span>{tallyWords(c, true) || 'Nothing yet'}</span>
                </li>
              ))}
              {m.automatic.map((a) => (
                <li key={a.kind}>
                  <span>
                    <strong>{automaticLabel[a.kind]}</strong>
                    <small>Automatic</small>
                  </span>
                  <span>{tallyWords(a, false) || 'Nothing yet'}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

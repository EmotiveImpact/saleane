import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarSync, Check, Copy } from 'lucide-react'
import { api } from '../state/api'
import { Button, ErrorMessage, Select } from '../design'
import { diaryDetailLabel } from '../domain/diary'
import type { DiaryDetail } from '../domain/diary'
import './diaries.css'

export type DiaryLinkView = {
  id: string
  who: string
  kind: 'person' | 'location' | 'studio'
  detail: DiaryDetail
  madeBy: string
  mine: boolean
  createdAt: string
  lastReadAt: string | null
  stoppedWorking?: string
}
export type DiaryListing = {
  links: DiaryLinkView[]
  sample: boolean
  locale: string
  timeZone: string
  daysAhead: number
  choices: {
    own: { staffId: string; name: string } | null
    people: { id: string; name: string }[]
    locations: { id: string; name: string }[]
    studio: boolean
  }
  link?: string
  created?: string
}
type Choice = { value: string; label: string; scope: Record<string, string> }

/** The ways of reaching the diary's address, from the address itself. */
const webcal = (link: string) => link.replace(/^https?:/, 'webcal:')
const onThisComputer = (link: string) => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(link).hostname)
  } catch {
    return false
  }
}

/**
 * NEXT-10: a private link that keeps Google Calendar or Apple Calendar up to date with visits.
 * Someone with visits of their own makes one for themselves; owners and managers also for another
 * professional, a location or the whole studio. The link is shown once, can be stopped at any
 * time, and only ever shows: every change is made in SALEANE.
 */
export function DiaryLinks({
  workspaceId,
  demo = false,
  inDialog = false,
}: {
  workspaceId: string
  /** The browser demo keeps everything on this device and has no server to read from. */
  demo?: boolean
  /** Inside a dialog, which carries the title and introduction itself. */
  inDialog?: boolean
}) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/diary-links`
  const [listing, setListing] = useState<DiaryListing | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [pending, setPending] = useState(false)
  const [whose, setWhose] = useState('')
  const [detail, setDetail] = useState<DiaryDetail>('names')
  const [shown, setShown] = useState<{ who: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState('')
  // Where focus goes once a step replaces the button that was pressed.
  const focusNext = useRef('')
  useEffect(() => {
    if (!focusNext.current) return
    document.querySelector<HTMLElement>(focusNext.current)?.focus()
    focusNext.current = ''
  })

  useEffect(() => {
    if (demo) return
    let current = true
    api<DiaryListing>(base)
      .then((next) => {
        if (current) setListing(next)
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'Diary links could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [demo, base])

  const choices: Choice[] = listing
    ? [
        ...(listing.choices.own
          ? [
              {
                value: 'own',
                label: inDialog
                  ? 'Your own visits'
                  : `Your own visits (${listing.choices.own.name})`,
                scope: { kind: 'person', staffId: listing.choices.own.staffId },
              },
            ]
          : []),
        ...listing.choices.people.map((p) => ({
          value: `person:${p.id}`,
          label: p.name,
          scope: { kind: 'person', staffId: p.id },
        })),
        ...listing.choices.locations.map((p) => ({
          value: `location:${p.id}`,
          label: `Everyone at ${p.name}`,
          scope: { kind: 'location', locationId: p.id },
        })),
        ...(listing.choices.studio
          ? [{ value: 'studio', label: 'Everyone at the studio', scope: { kind: 'studio' } }]
          : []),
      ]
    : []
  const chosen = choices.find((c) => c.value === whose) ?? choices[0]
  const weeks = Math.round((listing?.daysAhead ?? 28) / 7)
  const reach =
    listing && listing.daysAhead >= 180
      ? 'six months ahead'
      : `${['one week', 'two weeks', 'three weeks', 'four weeks'][weeks - 1] ?? `${weeks} weeks`} ahead`
  const when = (iso: string) =>
    new Intl.DateTimeFormat(listing?.locale ?? 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: listing?.timeZone,
    }).format(new Date(iso))

  async function make(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!chosen) return
    setPending(true)
    setError('')
    setDone('')
    setCopied(false)
    try {
      const next = await api<DiaryListing>(base, {
        method: 'POST',
        body: { scope: chosen.scope, detail },
      })
      setListing(next)
      const made = next.links.find((l) => l.id === next.created)
      if (next.link) {
        focusNext.current = '.diary-made button'
        setShown({ who: made?.who ?? chosen.label, link: next.link })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be made. Try again.')
    } finally {
      setPending(false)
    }
  }
  async function stop(link: DiaryLinkView) {
    setPending(true)
    setError('')
    setDone('')
    try {
      setListing(await api<DiaryListing>(`${base}/${link.id}/stop`, { method: 'POST', body: {} }))
      setStopping('')
      setDone(
        `Stopped the link to ${link.who}. Calendars that had it keep what they last read until it is removed there.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be stopped. Try again.')
    } finally {
      setPending(false)
    }
  }
  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Without the clipboard, the link stays selected for the person to copy.
      const range = document.createRange()
      const code = document.querySelector('.diary-made code')
      if (code) {
        range.selectNodeContents(code)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      }
      setError('Copying is not allowed here. The link is selected: copy it with your keyboard.')
    }
  }

  const intro = (
    <p>
      See visits in Google Calendar or Apple Calendar, on your phone or computer, through a private
      link. The calendar updates by itself as visits are booked, moved or cancelled. It only shows:
      every change is still made in SALEANE.
    </p>
  )
  const body = demo ? (
    <p className="ops-help">
      The browser demo keeps everything on this device, so it cannot share a diary. Sign in to a
      studio of your own to make a link.
    </p>
  ) : listing?.sample ? (
    <p className="ops-help">
      A sample studio never shares anything outside SALEANE. Make diary links in a studio of your
      own.
    </p>
  ) : (
    <>
      {shown && (
        <div className="diary-made" role="status">
          <p>
            <strong>Your link to {shown.who} is ready.</strong> Copy it now: it is shown only this
            once.
          </p>
          <code>{shown.link}</code>
          <div className="diary-made-actions">
            <Button onClick={() => void copy(shown.link)}>
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a className="button button-secondary" href={webcal(shown.link)}>
              Open in Apple Calendar
            </a>
            <Button
              variant="quiet"
              onClick={() => {
                focusNext.current = '.diary-form .select-trigger, .diary-form input'
                setShown(null)
              }}
            >
              Done
            </Button>
          </div>
          <dl className="diary-how">
            <div>
              <dt>Google Calendar</dt>
              <dd>
                On a computer, choose the plus beside Other calendars, then From URL. Paste the link
                and choose Add calendar; it shows on your phone too. Google checks for changes every
                few hours.
              </dd>
            </div>
            <div>
              <dt>Apple Calendar</dt>
              <dd>
                Choose Open in Apple Calendar on a Mac, iPhone or iPad, or in Calendar on a Mac
                choose File, then New Calendar Subscription, and paste the link. Apple checks as
                often as you choose, such as every hour.
              </dd>
            </div>
          </dl>
          {onThisComputer(shown.link) && (
            <p className="diary-local">
              This copy of SALEANE runs on this computer, so only calendar apps on this computer can
              read the link for now. Google Calendar reads from the internet, so it can use a link
              once your studio&rsquo;s SALEANE is online.
            </p>
          )}
        </div>
      )}
      {done && !shown && <p role="status">{done}</p>}
      <ErrorMessage error={error} />
      {listing && !choices.length ? (
        <p className="ops-help">
          You have no visits of your own to show. An owner or manager can make a diary of the
          studio&rsquo;s visits and share the link with you.
        </p>
      ) : (
        listing &&
        !shown && (
          <form className="diary-form" onSubmit={(e) => void make(e)}>
            {choices.length > 1 ? (
              <label className="diary-field">
                Whose visits
                <Select value={chosen?.value} onChange={(e) => setWhose(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="diary-whose">
                <strong>{chosen?.label}</strong>
              </p>
            )}
            <fieldset className="diary-detail">
              <legend>What each visit shows</legend>
              {(Object.keys(diaryDetailLabel) as DiaryDetail[]).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="diary-detail"
                    checked={detail === value}
                    onChange={() => setDetail(value)}
                  />
                  {diaryDetailLabel[value]}
                </label>
              ))}
            </fieldset>
            <p className="diary-note">
              From two weeks back to {reach}, with the time and room. Google or Apple keep a copy of
              what it shows, never a surname, phone number, email, note or price. Time off shows as
              Time off.
            </p>
            <div className="ops-actions">
              <Button type="submit" disabled={pending || !chosen}>
                {pending ? 'Making…' : 'Make the link'}
              </Button>
            </div>
          </form>
        )
      )}
      {listing && listing.links.length > 0 && (
        <div className="diary-links">
          <h3>{listing.links.every((l) => l.mine) ? 'Your links' : 'Links in use'}</h3>
          <ul>
            {listing.links.map((l) => (
              <li key={l.id}>
                <div>
                  <strong>{l.who}</strong>
                  <p>
                    {diaryDetailLabel[l.detail]}. Made by {l.mine ? 'you' : l.madeBy},{' '}
                    {when(l.createdAt)}.{' '}
                    {l.lastReadAt
                      ? `Last read by a calendar ${when(l.lastReadAt)}.`
                      : 'Not read by a calendar yet.'}
                  </p>
                  {l.stoppedWorking && (
                    <p className="diary-stopped">No longer works: {l.stoppedWorking}</p>
                  )}
                </div>
                <div className="diary-actions">
                  {stopping === l.id ? (
                    <>
                      <Button
                        variant="quiet"
                        disabled={pending}
                        onClick={() => {
                          focusNext.current = `[data-ask="${l.id}"]`
                          setStopping('')
                        }}
                      >
                        Keep it
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Stop it now for ${l.who}`}
                        data-confirm={l.id}
                        disabled={pending}
                        onClick={() => void stop(l)}
                      >
                        Stop it now
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="quiet"
                      aria-label={`Stop link for ${l.who}`}
                      data-ask={l.id}
                      disabled={pending}
                      onClick={() => {
                        focusNext.current = `[data-confirm="${l.id}"]`
                        setStopping(l.id)
                      }}
                    >
                      Stop link
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  if (inDialog)
    return (
      <div className="diary-panel" aria-busy={pending}>
        {body}
      </div>
    )
  return (
    <section
      className="surface ops-panel settings-panel diary-panel"
      aria-labelledby="diary-links-title"
      aria-busy={pending}
    >
      <header>
        <div>
          <h2 id="diary-links-title">Google &amp; Apple diaries</h2>
          {intro}
        </div>
        <CalendarSync size={21} aria-hidden="true" />
      </header>
      {body}
    </section>
  )
}

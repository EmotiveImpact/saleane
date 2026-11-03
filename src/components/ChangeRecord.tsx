import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, DateField, ErrorMessage, LoadingShapes, Select } from '../design'
import { venueDate } from '../domain/tillCount'
import { fullDateLabel } from '../domain/format'
import {
  capital,
  changeCsv,
  changeGroups,
  list,
  type ChangeEntry,
  type ChangeGroup,
} from '../domain/changeRecord'
import './changeRecord.css'

type Page = { entries: ChangeEntry[]; next: string | null; people?: { id: string; name: string }[] }
type Shown = { key: string; entries: ChangeEntry[]; next: string | null; error: string }
/** A download takes at most this many pages of 500, newest first. */
const DOWNLOAD_PAGES = 10

function save(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** NEXT-05: who changed what, newest first, for the owner. */
export function ChangeRecord() {
  const { state, mode } = useStore()
  const org = state.organisation
  // The record keeps real times, so its days are the real ones, even in a sample studio whose
  // diary stands still on its sample day.
  const [today] = useState(() => venueDate(org.timeZone, new Date().toISOString()))
  const base = `/api/workspaces/${encodeURIComponent(org.id)}/changes`
  const [who, setWho] = useState('')
  const [group, setGroup] = useState<ChangeGroup | ''>('')
  const [on, setOn] = useState('')
  const key = new URLSearchParams({
    ...(who ? { who } : {}),
    ...(group ? { group } : {}),
    ...(on ? { on } : {}),
  }).toString()
  const [shown, setShown] = useState<Shown | null>(null)
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode !== 'server') return
    let active = true
    api<Page>(`${base}?${key}`)
      .then((page) => {
        if (!active) return
        setShown({ key, entries: page.entries, next: page.next, error: '' })
        if (page.people) setPeople(page.people)
      })
      .catch((e) => {
        if (active)
          setShown({
            key,
            entries: [],
            next: null,
            error: e instanceof Error ? e.message : 'The change record could not be read.',
          })
      })
    return () => {
      active = false
    }
  }, [base, key, mode])
  const loading = shown?.key !== key
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(org.locale, {
        timeZone: org.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: org.locale === 'en-US',
      }),
    [org.locale, org.timeZone],
  )
  /** The entries under the studio's own days, newest first. */
  const days = useMemo(() => {
    const out: { date: string; entries: ChangeEntry[] }[] = []
    for (const entry of loading ? [] : (shown?.entries ?? [])) {
      const date = venueDate(org.timeZone, new Date(entry.at).toISOString())
      if (out.at(-1)?.date !== date) out.push({ date, entries: [] })
      out.at(-1)!.entries.push(entry)
    }
    return out
  }, [loading, shown, org.timeZone])

  async function more() {
    if (!shown?.next || loading) return
    const asked = shown
    setPending(true)
    setError('')
    try {
      const page = await api<Page>(
        `${base}?${asked.key}${asked.key ? '&' : ''}before=${asked.next}`,
      )
      // A filter changed while this page was on its way: it belongs to the old list, so drop it.
      setShown((now) =>
        now === asked
          ? { ...asked, entries: [...asked.entries, ...page.entries], next: page.next }
          : now,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Older changes could not be read.')
    } finally {
      setPending(false)
    }
  }
  async function download() {
    setPending(true)
    setError('')
    try {
      const all: ChangeEntry[] = []
      let next: string | null = null
      for (let n = 0; n < DOWNLOAD_PAGES; n++) {
        const page: Page = await api<Page>(
          `${base}?${key}${key ? '&' : ''}limit=500${next ? `&before=${next}` : ''}`,
        )
        all.push(...page.entries)
        next = page.next
        if (!next) break
      }
      save(`saleane-changes-${on || today}.csv`, changeCsv(state, all))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change record could not be downloaded.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface ops-panel change-record" aria-labelledby="change-record-title">
      <header>
        <div>
          <h2 id="change-record-title">Who changed what</h2>
          <p>
            Every change saved in this studio, newest first: who made it, when, and what changed.
            Prices, times and settings keep their old and new values. For clients, only which
            details changed is kept, never what they say.
          </p>
        </div>
      </header>
      {mode !== 'server' ? (
        <p className="ops-help">
          The browser demo keeps no change record. Sign in to a studio to see who changed what.
        </p>
      ) : (
        <>
          <div className="change-filters">
            <label className="ops-field">
              Who
              <Select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Everyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
                <option value="automatic">Guests and automatic changes</option>
              </Select>
            </label>
            <label className="ops-field">
              What
              <Select value={group} onChange={(e) => setGroup(e.target.value as ChangeGroup | '')}>
                <option value="">Everything</option>
                {Object.entries(changeGroups).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="ops-field">
              <span id="change-on-label">Up to</span>
              <DateField
                locale={org.locale}
                today={today}
                id="change-on"
                value={on}
                max={today}
                onChange={setOn}
                placeholder="Today"
                aria-labelledby="change-on-label change-on"
              />
            </div>
            {on && (
              <Button variant="quiet" className="change-filter-clear" onClick={() => setOn('')}>
                Back to today
              </Button>
            )}
          </div>
          {loading ? (
            <LoadingShapes rows={4} label="Reading the change record…" />
          ) : shown?.error ? (
            <ErrorMessage error={shown.error} />
          ) : !days.length ? (
            <p className="ops-help">
              {key
                ? 'No changes match. Try everyone, everything or a later day.'
                : 'No changes yet.'}
            </p>
          ) : (
            days.map((day) => (
              <div className="change-day" key={day.date}>
                <h3>{day.date === today ? 'Today' : fullDateLabel(day.date, org.locale)}</h3>
                <ol className="change-list">
                  {day.entries.map((entry) => (
                    <li className="change-entry" key={entry.id}>
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {time.format(new Date(entry.at))}
                      </time>
                      <div className="change-copy">
                        <strong>{entry.what}</strong>
                        {entry.about && <span className="change-about">{entry.about}</span>}
                        {(entry.lines.length > 0 || entry.others.length > 0) && (
                          <ul className="change-details">
                            {entry.lines.map((line) => (
                              <li key={line.what}>
                                {capital(line.what)}{' '}
                                {line.from === undefined ? (
                                  <b>{line.to}</b>
                                ) : (
                                  <>
                                    <s>{line.from}</s> became <b>{line.to}</b>
                                  </>
                                )}
                              </li>
                            ))}
                            {entry.others.length > 0 && (
                              <li>
                                {entry.lines.length ? 'Also changed' : 'Changed'}{' '}
                                {list(entry.others)}
                              </li>
                            )}
                          </ul>
                        )}
                        <small className={entry.person ? '' : 'change-automatic'}>
                          {entry.person ? `By ${entry.who}` : entry.who}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
          <ErrorMessage error={error} />
          {!loading && (shown?.next || days.length > 0) && (
            <div className="ops-actions">
              {shown?.next && (
                <Button variant="secondary" disabled={pending} onClick={() => void more()}>
                  Show older changes
                </Button>
              )}
              {days.length > 0 && (
                <Button variant="quiet" disabled={pending} onClick={() => void download()}>
                  Download as a spreadsheet
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

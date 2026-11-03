import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ListChecks } from 'lucide-react'
import { useStore } from '../state/context'
import { addDays, dateLabel } from '../domain/format'
import { can } from '../domain/operations'
import { dueTasks } from '../domain/tasks'
import { Button, Select } from '../design'
import { useSeeAll } from './seeAll'
import { SeeAllButton } from './SeeAllButton'
import { weekdayName } from './insightWords'
import './needsYou.css'

/**
 * Reminders the team left for today, with any from earlier days not yet done. A small card on
 * Today: the first two, the rest a tap away, and a reminder for today or the week ahead.
 */
export function Reminders() {
  const { state, today, role, commit } = useStore()
  const listId = useId()
  const titleId = useId()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reminders = dueTasks(state, today)
  const more = useSeeAll(reminders)
  const canRemind = can(role, 'task')
  if (!reminders.length && !canRemind) return null
  const locale = state.organisation.locale
  const week = Array.from({ length: 7 }, (_, n) => addDays(today, n))
  const dayName = (date: string) => {
    const n = week.indexOf(date)
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : weekdayName(date, locale)
  }

  async function done(taskId: string, what: string) {
    setError('')
    setNotice('')
    setBusy(true)
    const result = await commit({ type: 'task-done', taskId })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setNotice(`Done: ${what}`)
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const due = day || today
    setBusy(true)
    const result = await commit({ type: 'task-add', input: { text: text.trim(), dueDate: due } })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setText('')
    setDay('')
    setAdding(false)
    setNotice(
      due === today
        ? 'Added to today’s reminders.'
        : `Saved for ${due === week[1] ? 'tomorrow' : dayName(due)}.`,
    )
  }
  return (
    <section className="needs-card reminders-card" aria-labelledby={titleId}>
      <header className="needs-card-head">
        <ListChecks size={18} aria-hidden="true" />
        <h3 id={titleId}>Reminders</h3>
        <span className={`needs-card-count ${reminders.length ? '' : 'is-none'}`}>
          {reminders.length}
          <span className="sr-only"> for today</span>
        </span>
      </header>
      {reminders.length ? (
        <ul className="needs-list" id={listId}>
          {more.shown.map((r) => (
            <li key={r.id} className="needs-row">
              <div className="needs-who">
                <strong>{r.text}</strong>
                <small>
                  {r.dueDate < today ? `From ${dateLabel(r.dueDate, locale)}` : 'Today'}
                  {r.createdBy ? `, left by ${r.createdBy.split(' ')[0]}` : ''}
                </small>
              </div>
              {canRemind && (
                <div className="needs-actions">
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void done(r.id, r.text)}
                    aria-label={`Done: ${r.text}`}
                  >
                    <Check size={14} aria-hidden="true" /> Done
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="needs-empty">Nothing left for today.</p>
      )}
      {(more.hidden > 0 || (canRemind && !adding)) && (
        <div className="needs-card-links">
          <SeeAllButton list={listId} {...more} />
          {canRemind && !adding && (
            <button type="button" className="text-link" onClick={() => setAdding(true)}>
              Add a reminder
            </button>
          )}
        </div>
      )}
      {canRemind && adding && (
        <form className="reminder-form" onSubmit={(event) => void add(event)} aria-busy={busy}>
          <label className="reminder-text">
            Reminder
            <input
              required
              minLength={2}
              maxLength={200}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Day
            <Select value={day || today} onChange={(e) => setDay(e.target.value)}>
              {week.map((d) => (
                <option key={d} value={d}>
                  {dayName(d)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary" disabled={busy}>
            Add
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="needs-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="ops-save-note" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}

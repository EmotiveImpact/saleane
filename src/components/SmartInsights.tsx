import { useState } from 'react'
import { ArrowRight, Check, Leaf } from 'lucide-react'
import { useStore } from '../state/context'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { drifting, gapInvitation, gapSuggestions, morningBrief, unusual } from '../domain/insights'
import { can } from '../domain/operations'
import { dueTasks } from '../domain/tasks'
import { Button, photos } from '../design'
import type { BookingDefaults } from './BookingDialog'
import './smart-insights.css'

const hours = (minutes: number) => {
  const h = Math.round(minutes / 30) / 2
  return `${h} ${h === 1 ? 'hour' : 'hours'}`
}

/**
 * V3 Smart insights on Today: a short brief, anything unusual, and clients drifting away with an
 * open time to offer them. Everything is read from the studio record; nothing is sent or changed
 * until someone chooses to book.
 */
export function SmartInsights({ onBook }: { onBook: (defaults: BookingDefaults) => void }) {
  const { state, today, role, commit } = useStore()
  const [drafting, setDrafting] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [error, setError] = useState('')
  const [reminder, setReminder] = useState('')
  const [reminderDay, setReminderDay] = useState('')
  const locale = state.organisation.locale
  const managers = role === 'owner' || role === 'manager'
  const brief = morningBrief(state, today)
  const notices = unusual(state, today).filter((n) => managers || !n.managersOnly)
  const drifters = drifting(state, today)
  const offers = gapSuggestions(state, today)
  const weekday = dateLabel(today, locale).split(' ')[0]
  const reminders = dueTasks(state, today)
  const canRemind = can(role, 'task')

  const headline = notices.some((n) => n.kind === 'quiet-day')
    ? 'Tomorrow has room to fill.'
    : drifters.length
      ? 'Make room for a familiar face.'
      : brief.usualBookedMinutes && brief.bookedMinutes > brief.usualBookedMinutes * 1.25
        ? 'A fuller day than usual.'
        : 'A steady day ahead.'

  const day = brief.visits
    ? `${brief.visits} ${brief.visits === 1 ? 'visit' : 'visits'} and ${hours(brief.bookedMinutes)} booked today${
        brief.usualBookedMinutes
          ? `; a usual ${weekday} has about ${hours(brief.usualBookedMinutes)}`
          : ''
      }.`
    : 'Nothing is booked today yet.'
  const yesterday =
    managers && brief.yesterday.takingsMinor
      ? ` Yesterday took ${money(brief.yesterday.takingsMinor, state.organisation)}${
          brief.yesterday.usualTakingsMinor
            ? `, against about ${money(Math.round(brief.yesterday.usualTakingsMinor), state.organisation)} on a usual ${dateLabel(brief.yesterday.date, locale).split(' ')[0]}`
            : ''
        }.`
      : ''

  return (
    <section className="intelligence-panel" aria-labelledby="smart-insights-title">
      <div
        className="intelligence-photo"
        aria-hidden="true"
        style={{ backgroundImage: `url(${photos.tea})` }}
      />
      <div className="intelligence-symbol">
        <Leaf size={22} />
        <span>Saleane noticed</span>
      </div>
      <h2 id="smart-insights-title">{headline}</h2>
      <p>
        {day}
        {yesterday}
      </p>
      {notices.length > 0 && (
        <ul className="insight-notices">
          {notices.slice(0, 3).map((notice) => (
            <li key={notice.id}>
              <strong>{notice.title}</strong>
              <small>{notice.detail}</small>
            </li>
          ))}
        </ul>
      )}
      {(reminders.length > 0 || canRemind) && (
        <div className="insight-drifting insight-reminders">
          <h3>Reminders</h3>
          {reminders.length > 0 && (
            <ul>
              {reminders.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>{r.text}</strong>
                    <small>
                      {r.dueDate < today ? `From ${dateLabel(r.dueDate, locale)}` : 'Today'}
                      {r.createdBy ? `, left by ${r.createdBy.split(' ')[0]}` : ''}
                    </small>
                  </span>
                  {canRemind && (
                    <Button
                      variant="quiet"
                      onClick={async () => {
                        setError('')
                        const result = await commit({ type: 'task-done', taskId: r.id })
                        if (!result.ok) setError(result.error)
                      }}
                    >
                      <Check size={14} aria-hidden="true" /> Done
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canRemind && (
            <form
              className="insight-remind"
              onSubmit={async (event) => {
                event.preventDefault()
                setError('')
                const result = await commit({
                  type: 'task-add',
                  input: { text: reminder.trim(), dueDate: reminderDay || today },
                })
                if (!result.ok) return setError(result.error)
                setReminder('')
              }}
            >
              <label>
                <span className="sr-only">Reminder</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  placeholder="Add a reminder"
                  value={reminder}
                  onChange={(e) => setReminder(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Day</span>
                <select
                  value={reminderDay || today}
                  onChange={(e) => setReminderDay(e.target.value)}
                >
                  {Array.from({ length: 7 }, (_, n) => addDays(today, n)).map((d, n) => (
                    <option key={d} value={d}>
                      {n === 0
                        ? 'Today'
                        : n === 1
                          ? 'Tomorrow'
                          : dateLabel(d, locale).split(' ')[0]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="light">
                Add
              </Button>
            </form>
          )}
        </div>
      )}
      {drifters.length > 0 && (
        <div className="insight-drifting">
          <h3>Drifting away</h3>
          <ul>
            {drifters.slice(0, 3).map((d) => {
              const offer = offers.find((o) => o.clientId === d.clientId)
              return (
                <li key={d.clientId}>
                  <span>
                    <strong>{d.name}</strong>
                    <small>
                      Last visit {d.weeksSince} weeks ago
                      {d.usualWeeks ? `, usually every ${d.usualWeeks}` : ''}
                    </small>
                  </span>
                  {offer && offer.marketingConsent && drafting === d.clientId && (
                    <div className="insight-draft">
                      <p>{gapInvitation(state, offer, today, (m) => timeLabel(m, locale)).body}</p>
                      <div>
                        <Button
                          onClick={async () => {
                            setError('')
                            const result = await commit({
                              type: 'message',
                              input: {
                                clientId: offer.clientId,
                                purpose: 'marketing',
                                ...gapInvitation(state, offer, today, (m) => timeLabel(m, locale)),
                              },
                            })
                            if (!result.ok) return setError(result.error)
                            setSaved((list) => [...list, d.clientId])
                            setDrafting(null)
                          }}
                        >
                          Save as unsent draft
                        </Button>
                        <Button variant="quiet" onClick={() => setDrafting(null)}>
                          Not now
                        </Button>
                      </div>
                    </div>
                  )}
                  {saved.includes(d.clientId) && (
                    <small role="status" className="insight-saved">
                      <Check size={13} aria-hidden="true" /> Invitation saved in the Inbox, unsent.
                    </small>
                  )}
                  {offer &&
                    offer.marketingConsent &&
                    drafting !== d.clientId &&
                    !saved.includes(d.clientId) && (
                      <Button variant="quiet" onClick={() => setDrafting(d.clientId)}>
                        Prepare an invitation
                      </Button>
                    )}
                  {offer && (
                    <Button
                      variant="light"
                      onClick={() =>
                        onBook({
                          clientId: offer.clientId,
                          serviceId: offer.serviceId,
                          staffId: offer.staffId,
                          date: offer.date,
                          startMinutes: offer.startMinutes,
                        })
                      }
                    >
                      Offer {offer.date === today ? 'today' : 'tomorrow'}{' '}
                      {timeLabel(offer.startMinutes, locale)}
                      <ArrowRight size={16} />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {drifters.length > 3 && (
            <small className="insight-more">and {drifters.length - 3} more</small>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="insight-error">
          {error}
        </p>
      )}
      <small className="insight-source">
        Based on your visit history and calendar. Nothing is sent or changed until you choose to
        book or save an invitation.
      </small>
    </section>
  )
}

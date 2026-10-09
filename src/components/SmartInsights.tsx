import { useId, useState } from 'react'
import { ArrowRight, Check, Leaf } from 'lucide-react'
import { useStore } from '../state/context'
import { money, timeLabel } from '../domain/format'
import { drifting, gapInvitation, gapSuggestions, morningBrief, unusual } from '../domain/insights'
import { leads } from '../domain/operations'
import { Button, photos } from '../design'
import type { BookingDefaults } from './BookingDialog'
import { dayHeadline, daySentence, weekdayName } from './insightWords'
import { useSeeAll } from './seeAll'
import { SeeAllButton } from './SeeAllButton'
import './smart-insights.css'

/**
 * V3 Smart insights on Today: a short brief, anything unusual, and clients drifting away with an
 * open time to offer them. Everything is read from the studio record; nothing is sent or changed
 * until someone chooses to book. Reminders sit with what needs someone (see NeedsYou).
 */
export function SmartInsights({ onBook }: { onBook: (defaults: BookingDefaults) => void }) {
  const { state, today, role, commit } = useStore()
  const listId = useId()
  const [drafting, setDrafting] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [error, setError] = useState('')
  const locale = state.organisation.locale
  const managers = leads(role)
  const brief = morningBrief(state, today)
  const notices = unusual(state, today).filter((n) => managers || !n.managersOnly)
  const drifters = drifting(state, today)
  const more = useSeeAll(drifters)
  const offers = gapSuggestions(state, today)

  const headline = dayHeadline(
    brief,
    notices.some((n) => n.kind === 'quiet-day'),
  )
  const day = daySentence(brief, weekdayName(today, locale))
  const yesterday =
    managers && brief.yesterday.takingsMinor
      ? ` Yesterday took ${money(brief.yesterday.takingsMinor, state.organisation)}${
          brief.yesterday.usualTakingsMinor
            ? `, against about ${money(Math.round(brief.yesterday.usualTakingsMinor), state.organisation)} on a usual ${weekdayName(brief.yesterday.date, locale)}`
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
      {drifters.length > 0 && (
        <div className="insight-drifting">
          <h3 id={`${listId}-title`}>Drifting away</h3>
          <ul id={listId} aria-labelledby={`${listId}-title`}>
            {more.shown.map((d) => {
              const offer = offers.find((o) => o.clientId === d.clientId)
              const isSaved = saved.includes(d.clientId)
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
                  {isSaved && (
                    <small role="status" className="insight-saved">
                      <Check size={13} aria-hidden="true" /> Invitation saved in the Inbox, unsent.
                    </small>
                  )}
                  {offer && (
                    <div className="insight-drifting-actions">
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
                      {offer.marketingConsent && drafting !== d.clientId && !isSaved && (
                        <Button variant="quiet" onClick={() => setDrafting(d.clientId)}>
                          Prepare an invitation
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <SeeAllButton list={listId} {...more} />
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

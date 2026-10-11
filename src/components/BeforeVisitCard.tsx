import { useStore } from '../state/context'
import { Button } from '../design'
import { timeLabel } from '../domain/format'
import { beforeVisit, milestoneLine, nextToArrive } from '../domain/beforeVisit'
import './moments.css'

/**
 * Stage 6: "Before they arrive", at the top of Today's side column. The next guest still to come,
 * with what is good to remember, how their last visit went, any milestone this visit brings and
 * whether their next visit is booked, so the welcome is personal. It reads the record only; a
 * general manager sees their own location's next guest.
 */
export function BeforeVisitCard({
  nowMinutes,
  onOpen,
}: {
  /** Minutes past midnight on the studio clock. */
  nowMinutes: number
  onOpen: (appointmentId: string) => void
}) {
  const { state, today, role, branch } = useStore()
  const next = nextToArrive(state, today, nowMinutes, {
    locationId: role === 'general' ? (branch ?? undefined) : undefined,
  })
  const card = next && beforeVisit(state, next)
  if (!card) return null
  const locale = state.organisation.locale
  const first = card.milestones[0]?.kind === 'first-visit'
  const time = timeLabel(card.appointment.startMinutes, locale)
  return (
    // Keyed by the visit, so the card settles in afresh when the next guest changes.
    <section
      key={card.appointment.id}
      className="before-visit settle-in"
      aria-labelledby="before-visit-title"
    >
      <p className="eyebrow">Before they arrive · {time}</p>
      <h2 id="before-visit-title">{card.name}</h2>
      <p className="before-visit-what">
        {card.treatment} with {card.staffName}
      </p>
      {card.milestones.length > 0 && (
        <div className="before-visit-moments">
          <span className="before-visit-rule" aria-hidden="true" />
          {card.milestones.map((m) => (
            <p key={m.kind}>
              {milestoneLine(m, card.firstName, { visitDate: card.appointment.date, locale })}
            </p>
          ))}
        </div>
      )}
      <dl className="before-visit-lines">
        <div>
          <dt>Good to remember</dt>
          <dd>
            {card.remembered || 'Nothing written yet. Ask how they like things, then note it.'}
          </dd>
        </div>
        {!first && (
          <div>
            <dt>Last time</dt>
            <dd>{card.lastTime ?? 'Not on record.'}</dd>
          </div>
        )}
        {card.patchTest && (
          <div>
            <dt>Patch test</dt>
            <dd>{card.patchTest}.</dd>
          </div>
        )}
        {card.nothingAfter && (
          <div>
            <dt>Next visit</dt>
            <dd>Nothing booked yet. A good moment to offer one at checkout.</dd>
          </div>
        )}
      </dl>
      <Button variant="secondary" onClick={() => onOpen(card.appointment.id)}>
        Open {card.firstName}’s visit
      </Button>
    </section>
  )
}

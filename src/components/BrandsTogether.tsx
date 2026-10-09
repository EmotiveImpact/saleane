import { useEffect, useState } from 'react'
import { api } from '../state/api'
import { Button } from '../design'
import { money } from '../domain/format'
import { GROUP_WINDOW_DAYS } from '../domain/group'
import type { brandGroup } from '../domain/brandGroup'
import './group.css'

type Group = ReturnType<typeof brandGroup>

const pct = (n: number) => `${Math.round(n * 100)}%`
const changeLabel = (growth: number | null) =>
  growth === null
    ? 'Nothing to compare'
    : Math.round(growth * 100) === 0
      ? 'Level'
      : `${growth > 0 ? 'Up' : 'Down'} ${pct(Math.abs(growth))}`

/**
 * V5: an owner's brands side by side, on the page where they choose a studio. Each brand keeps
 * its own clients, team and money; this shows totals only. `owned` is how many studios the person
 * owns, so the view stays away until there are at least two to compare.
 */
export function BrandsTogether({ owned, onOpen }: { owned: number; onOpen: (id: string) => void }) {
  const [group, setGroup] = useState<Group | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (owned < 2) return
    let active = true
    api<Group>('/api/group')
      .then((g) => active && setGroup(g))
      .catch(() => active && setError('The brands could not be compared just now.'))
    return () => {
      active = false
    }
  }, [owned])
  if (owned < 2) return null
  return (
    <section className="brands-together" aria-labelledby="brands-together-title">
      <h2 id="brands-together-title">Your brands together</h2>
      <p className="subtle">
        Each brand keeps its own clients, team and money. These are totals only, over the last{' '}
        {GROUP_WINDOW_DAYS} days against the {GROUP_WINDOW_DAYS} before, from completed visits.
      </p>
      {error && <p role="alert">{error}</p>}
      {!group && !error && <p className="subtle">Adding up your brands…</p>}
      {group && (
        <>
          <div className="group-summary">
            {group.summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <ul className="group-places">
            {group.brands.map((b) => {
              const tag =
                b.id === group.best?.id
                  ? 'Doing best'
                  : b.id === group.weakest?.id
                    ? 'Needs a look'
                    : null
              return (
                <li key={b.id}>
                  <div className="group-place-name">
                    <strong>{b.name}</strong>
                    <small className="subtle">
                      {b.locations} {b.locations === 1 ? 'location' : 'locations'}
                      {b.sample ? ' · Fictional sample' : ''}
                    </small>
                    {tag && <span className="group-tag">{tag}</span>}
                    <Button
                      variant="quiet"
                      onClick={() => onOpen(b.id)}
                      aria-label={`Open ${b.name}`}
                    >
                      Open
                    </Button>
                  </div>
                  <dl>
                    <div>
                      <dt>Last {GROUP_WINDOW_DAYS} days</dt>
                      <dd>{money(b.takingsMinor, b)}</dd>
                    </div>
                    <div>
                      <dt>Change</dt>
                      <dd>{changeLabel(b.growth)}</dd>
                    </div>
                    <div>
                      <dt>Rebooked</dt>
                      <dd>{b.rebookRate === null ? 'No visits yet' : pct(b.rebookRate)}</dd>
                    </div>
                    <div>
                      <dt>This month</dt>
                      <dd>
                        {money(b.month.takenMinor, b)} taken
                        {b.month.targetMinor ? (
                          <small>
                            {' '}
                            ({pct(b.month.takenMinor / b.month.targetMinor)} of target)
                          </small>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Booked, not yet taken</dt>
                      <dd>{money(b.month.bookedMinor, b)}</dd>
                    </div>
                    <div>
                      <dt>Clients</dt>
                      <dd>{b.clients}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

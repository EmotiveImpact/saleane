import { useState } from 'react'
import type { FormEvent } from 'react'
import { Scale } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { houseRules, ruleBreaches } from '../domain/brandRules'
import { Button, ErrorMessage, Select } from '../design'

const bands = [5, 10, 15, 20, 25]

/**
 * V5: house rules every location follows, set by the owner: how far a location's price may differ
 * from the house price, and which treatments are on every menu. Treatments that do not meet a new
 * rule are listed, never changed; each must meet the rules the next time it is saved.
 */
export function HouseRules() {
  const { state, role, blocked, commit } = useStore()
  const rules = houseRules(state)
  const allowed = !blocked && can(role, 'house-rules')
  const menu = state.services.filter((x) => !x.archived)
  const [band, setBand] = useState(
    rules.priceBandPercent === undefined ? 'any' : String(rules.priceBandPercent),
  )
  const [core, setCore] = useState<string[]>(rules.coreServiceIds ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const breaches = ruleBreaches(state)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allowed || pending) return
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit({
        type: 'house-rules',
        priceBandPercent: band === 'any' ? null : Number(band),
        coreServiceIds: core.filter((id) => menu.some((x) => x.id === id)),
      })
      if (result.ok) setSaved('House rules saved.')
      else setError(result.error)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface ops-panel" aria-labelledby="house-rules-heading">
      <header>
        <div>
          <h2 id="house-rules-heading">House rules for every location</h2>
          <p>
            Your colours, treatments, messages and booking page are already the same everywhere.
            These rules keep prices and the menu in line when each location can differ.
          </p>
        </div>
        <Scale size={21} aria-hidden="true" />
      </header>
      <form className="plan-form" onSubmit={(event) => void save(event)} aria-busy={pending}>
        <div className="ops-fields">
          <label className="ops-wide">
            Prices at other locations
            <Select
              value={band}
              disabled={!allowed || pending}
              onChange={(e) => setBand(e.target.value)}
            >
              <option value="any">Any price each location chooses</option>
              <option value="0">The same price everywhere</option>
              {bands.map((n) => (
                <option key={n} value={String(n)}>
                  Within {n}% of the house price
                </option>
              ))}
            </Select>
          </label>
          <fieldset className="ops-checks ops-wide">
            <legend>Core treatments, on every location’s menu</legend>
            {menu.length === 0 && <p className="subtle">No treatments on the menu yet.</p>}
            {menu.map((service) => (
              <label key={service.id}>
                <input
                  type="checkbox"
                  checked={core.includes(service.id)}
                  disabled={!allowed || pending}
                  onChange={(e) =>
                    setCore((current) =>
                      e.target.checked
                        ? [...current, service.id]
                        : current.filter((id) => id !== service.id),
                    )
                  }
                />
                {service.name}
              </label>
            ))}
          </fieldset>
        </div>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {allowed ? (
          <div className="ops-actions">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save house rules'}
            </Button>
          </div>
        ) : (
          <p className="ops-help">Only the owner sets the house rules.</p>
        )}
      </form>
      <div className="house-rules-breaches">
        <h3>Not yet in line</h3>
        {breaches.length === 0 ? (
          <p className="subtle">Every treatment meets the house rules.</p>
        ) : (
          <>
            <p className="subtle">
              Nothing is changed for you. Each of these must meet the rules the next time it is
              saved under Treatments.
            </p>
            <ul>
              {breaches.map((b) => (
                <li key={b.serviceId}>
                  <strong>{b.service}</strong>
                  <span>{b.problem}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

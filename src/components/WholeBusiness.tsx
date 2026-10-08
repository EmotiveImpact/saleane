import { useState } from 'react'
import type { FormEvent } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, ErrorMessage, Modal } from '../design'
import { money } from '../domain/format'
import { places } from '../domain/locations'
import { can } from '../domain/operations'
import { GROUP_WINDOW_DAYS, regions, targets, wholeBusiness } from '../domain/group'
import type { PlaceFigures, RegionFigures } from '../domain/group'
import type { Command } from '../domain/commands'
import './group.css'

const pct = (n: number) => `${Math.round(n * 100)}%`
const changeLabel = (growth: number | null) =>
  growth === null
    ? 'Nothing to compare'
    : Math.round(growth * 100) === 0
      ? 'Level'
      : `${growth > 0 ? 'Up' : 'Down'} ${pct(Math.abs(growth))}`

/**
 * V5: the owner's view of every location at once, grouped by region, with each location's month
 * against its target. Figures come from completed visits; visits still to come are "booked".
 */
export function WholeBusiness() {
  const { state, today, role, blocked } = useStore()
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState('')
  const view = wholeBusiness(state, today)
  const org = state.organisation
  const allowed = !blocked && can(role, 'targets')
  const monthName = new Intl.DateTimeFormat(org.locale, {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${view.month}-15T12:00:00Z`))
  const groups: RegionFigures[] = view.regions.length ? view.regions : [view.total]
  const tag = (p: PlaceFigures) =>
    p.locationId === view.best?.locationId
      ? 'Doing best'
      : p.locationId === view.weakest?.locationId
        ? 'Needs a look'
        : null
  const monthLine = (m: RegionFigures['month']) =>
    `${money(m.takenMinor, org)} taken${m.targetMinor ? ` of ${money(m.targetMinor, org)}` : ''}`
  return (
    <section className="surface group-panel" aria-labelledby="whole-business-title">
      <header className="group-header">
        <div>
          <h2 id="whole-business-title">The whole business</h2>
          <p>
            Every location over the last {GROUP_WINDOW_DAYS} days against the {GROUP_WINDOW_DAYS}{' '}
            before, from completed visits. Visits still to come are shown as booked, not taken.
          </p>
        </div>
        {allowed && (
          <Button
            variant="secondary"
            onClick={() => {
              setSaved('')
              setEditing(true)
            }}
          >
            <MapIcon size={17} aria-hidden="true" />
            Regions and targets
          </Button>
        )}
      </header>
      <div className="group-summary">
        {view.summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <p role="status" className="ops-help">
        {saved}
      </p>
      {groups.map((group) => (
        <div className="group-region" key={group.id ?? group.name}>
          {view.regions.length > 0 && (
            <h3>
              {group.name}
              <span>
                {money(group.takingsMinor, org)} · {changeLabel(group.growth)} · {monthName}{' '}
                {monthLine(group.month)}
              </span>
            </h3>
          )}
          <ul className="group-places">
            {group.places.map((p) => (
              <li key={p.locationId}>
                <div className="group-place-name">
                  <strong>{p.name}</strong>
                  {tag(p) && <span className="group-tag">{tag(p)}</span>}
                </div>
                <dl>
                  <div>
                    <dt>Last {GROUP_WINDOW_DAYS} days</dt>
                    <dd>{money(p.takingsMinor, org)}</dd>
                  </div>
                  <div>
                    <dt>Change</dt>
                    <dd>{changeLabel(p.growth)}</dd>
                  </div>
                  <div>
                    <dt>Rebooked</dt>
                    <dd>{p.rebookRate === null ? 'No visits yet' : pct(p.rebookRate)}</dd>
                  </div>
                  <div>
                    <dt>{monthName}</dt>
                    <dd>
                      {monthLine(p.month)}
                      {p.month.targetMinor ? (
                        <small> ({pct(p.month.takenMinor / p.month.targetMinor)})</small>
                      ) : (
                        <small> · no target</small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Booked, not yet taken</dt>
                    <dd>{money(p.month.bookedMinor, org)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editing && (
        <GroupEditor
          month={view.month}
          monthName={monthName}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setSaved(message)
            setEditing(false)
          }}
        />
      )}
    </section>
  )
}

function GroupEditor({
  month,
  monthName,
  onClose,
  onSaved,
}: {
  month: string
  monthName: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { state, commit } = useStore()
  const org = state.organisation
  const sites = places(state)
  const current = (id: string) =>
    targets(state).find((t) => t.locationId === id && t.month === month)?.takingsMinor
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sites.map((p) => {
        const minor = current(p.id)
        return [p.id, minor ? String(minor / 100) : '']
      }),
    ),
  )
  const [regionId, setRegionId] = useState<string>(regions(state)[0]?.id ?? 'new')
  const region = regions(state).find((r) => r.id === regionId)
  const [name, setName] = useState(region?.name ?? '')
  const [chosen, setChosen] = useState<string[]>(region?.locationIds ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  function pick(id: string) {
    setRegionId(id)
    const r = regions(state).find((x) => x.id === id)
    setName(r?.name ?? '')
    setChosen(r?.locationIds ?? [])
    setError('')
  }
  async function run(command: Command, message: string) {
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else onSaved(message)
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  function saveTargets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const set: { locationId: string; takingsMinor: number | null }[] = []
    for (const p of sites) {
      const typed = amounts[p.id]?.trim().replace(/,/g, '') ?? ''
      const minor = typed ? Math.round(Number(typed) * 100) : null
      if (minor !== null && !(Number.isFinite(minor) && minor >= 1)) {
        setError(`Enter the target for ${p.name} as an amount, such as 12000.`)
        return
      }
      if (minor !== (current(p.id) ?? null)) set.push({ locationId: p.id, takingsMinor: minor })
    }
    if (!set.length) return onSaved('Nothing changed.')
    void run({ type: 'targets', month, set }, `Targets for ${monthName} saved.`)
  }
  function saveRegion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(
      {
        type: 'region',
        ...(region ? { id: region.id } : {}),
        input: { name: name.trim(), locationIds: chosen },
      },
      `${name.trim()} saved.`,
    )
  }
  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Regions and targets"
      description="Only you, as the owner, can change these. They change no booking, price or pay."
    >
      <form onSubmit={saveTargets} className="plan-form">
        <h3 className="group-form-title">Targets for {monthName}</h3>
        <p className="ops-help">
          What each location aims to take from completed visits this month, in {org.currency}. Leave
          one empty for no target.
        </p>
        <div className="ops-fields">
          {sites.map((p) => (
            <label key={p.id}>
              {p.name}
              <input
                inputMode="decimal"
                value={amounts[p.id] ?? ''}
                disabled={pending}
                onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            Save targets
          </Button>
        </div>
      </form>
      <form onSubmit={saveRegion} className="plan-form group-region-form">
        <h3 className="group-form-title">Regions</h3>
        <p className="ops-help">
          Group locations to see their figures together. Each location belongs to one region.
        </p>
        <div className="ops-fields">
          <label>
            Region
            <select value={regionId} disabled={pending} onChange={(e) => pick(e.target.value)}>
              {regions(state).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value="new">Add a region</option>
            </select>
          </label>
          <label>
            Name
            <input
              value={name}
              required
              minLength={2}
              maxLength={60}
              placeholder="London"
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset className="ops-checks ops-wide">
            <legend>Locations in it</legend>
            {sites.map((p) => {
              const other = regions(state).find(
                (r) => r.id !== regionId && r.locationIds.includes(p.id),
              )
              return (
                <label className="ops-check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    disabled={pending || !!other}
                    onChange={(e) =>
                      setChosen((list) =>
                        e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name}
                  {other && <small> (in {other.name})</small>}
                </label>
              )
            })}
          </fieldset>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !chosen.length || name.trim().length < 2}>
            {region ? 'Save region' : 'Add region'}
          </Button>
          {region && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void run(
                  { type: 'region-remove', regionId: region.id },
                  `${region.name} removed. Its locations are kept.`,
                )
              }
            >
              Remove {region.name}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

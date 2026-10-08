import { useState } from 'react'
import { useStore } from '../state/context'
import { businessDate } from '../domain/operations'
import { hasLocations, places } from '../domain/locations'
import { AREA_MIN_GROUP, clientAreas } from '../domain/clientAreas'
import { Empty, Metric, PageHeader } from '../design'
import '../components/management.css'
import '../components/clientAreas.css'

const percent = (share: number) => `${Math.round(share * 100)}%`

/**
 * V5: where clients come from, by postcode area. Only areas with enough clients are named; the
 * rest are counted together, so no one person can be picked out. Nobody is shown on a map.
 */
export function ClientAreas() {
  const { state, branch } = useStore()
  const org = state.organisation
  const multiSite = hasLocations(state)
  const sites = places(state).filter((p) => !branch || p.id === branch)
  const [where, setWhere] = useState(branch ?? 'all')
  const view = clientAreas(state, businessDate(state), multiSite ? where : 'all')
  const recorded = view.total - view.unknown
  const word = org.region === 'UK' ? 'postcode area' : 'ZIP area'

  return (
    <div className="areas-page">
      <PageHeader
        title="Where clients come from."
        description={`Clients with a visit in the past year or booked ahead, grouped by ${word}. Record a client’s area on their page.`}
      />
      {multiSite && (
        <label className="areas-where">
          Location
          <select value={where} onChange={(e) => setWhere(e.target.value)}>
            {!branch && <option value="all">All locations</option>}
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="areas-metrics">
        <Metric
          label="Clients counted"
          value={view.total}
          detail="A visit in the past year or one booked"
        />
        <Metric
          label="Area recorded"
          value={recorded}
          detail={view.total ? `${percent(recorded / view.total)} of clients counted` : 'None yet'}
        />
        <Metric
          label="Named areas"
          value={view.groups.length}
          detail={`Each with at least ${AREA_MIN_GROUP} clients`}
        />
      </div>
      <section className="surface ops-panel" aria-labelledby="areas-list">
        <header>
          <div>
            <h2 id="areas-list">By area</h2>
            <p>
              Shares are of every client counted, including those with no area recorded. An area
              with fewer than {AREA_MIN_GROUP} clients is counted under “Other areas”.
            </p>
          </div>
        </header>
        {view.total === 0 ? (
          <Empty title="No clients to count yet">
            Clients appear here once they have a visit in the past year or one booked.
          </Empty>
        ) : (
          <ul className="areas-list">
            {view.groups.map((g) => (
              <li key={g.area}>
                <span className="areas-name">{g.area}</span>
                <span className="areas-bar" aria-hidden="true">
                  <span style={{ width: percent(g.share) }} />
                </span>
                <span className="areas-count">
                  {g.clients} clients · {percent(g.share)}
                </span>
              </li>
            ))}
            {view.other > 0 && (
              <li className="areas-quiet">
                <span className="areas-name">Other areas</span>
                <span className="areas-bar" aria-hidden="true">
                  <span style={{ width: percent(view.other / view.total) }} />
                </span>
                <span className="areas-count">
                  {view.other} {view.other === 1 ? 'client' : 'clients'} ·{' '}
                  {percent(view.other / view.total)}
                </span>
              </li>
            )}
            {view.unknown > 0 && (
              <li className="areas-quiet">
                <span className="areas-name">No area recorded</span>
                <span className="areas-bar" aria-hidden="true">
                  <span style={{ width: percent(view.unknown / view.total) }} />
                </span>
                <span className="areas-count">
                  {view.unknown} {view.unknown === 1 ? 'client' : 'clients'} ·{' '}
                  {percent(view.unknown / view.total)}
                </span>
              </li>
            )}
          </ul>
        )}
        <p className="areas-privacy">
          Only the first half of a postcode is ever kept, never an address, and no one is shown on a
          map.
        </p>
      </section>
    </div>
  )
}

import { useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { businessDate } from '../domain/operations'
import { hasLocations, places } from '../domain/locations'
import { money } from '../domain/format'
import { AREA_MIN_GROUP, clientAreas } from '../domain/clientAreas'
import { areaChange, mapAreas, mapFeatures, mapReady, milesBetween } from '../domain/areaMap'
import type { MapArea } from '../domain/areaMap'
import { AreaMap } from '../components/AreaMap'
import type { MapMeasure } from '../components/AreaMap'
import { Empty, Metric, PageHeader, SegmentedControl, Select, photos } from '../design'
import '../components/management.css'
import '../components/clientAreas.css'

const percent = (share: number) => `${Math.round(share * 100)}%`
type Period = '365' | '90'

/**
 * V5: where clients come from, by postcode area, on a map and as a list. Only areas with enough
 * clients are named or drawn; the rest are counted together, so no one person can be picked out.
 */
export function ClientAreas() {
  const { state, branch } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const multiSite = hasLocations(state)
  const sites = places(state).filter((p) => !branch || p.id === branch)
  const [where, setWhere] = useState(branch ?? 'all')
  const [period, setPeriod] = useState<Period>('365')
  const [measure, setMeasure] = useState<MapMeasure>('clients')
  const [selected, setSelected] = useState<string | null>(null)
  const place = multiSite ? where : 'all'
  const days = Number(period)
  const view = clientAreas(state, today, place, days)
  const map = mapAreas(state, today, place, days)
  const recorded = view.total - view.unknown
  const word = org.region === 'UK' ? 'postcode area' : 'ZIP area'
  const spanWords = period === '365' ? 'the past year' : 'the past 90 days'
  const chosen = map.areas.find((a) => a.area === selected) ?? null
  const ready = mapReady(state)

  // Before any client has a visit there is nothing to group, so the page says what it will show.
  if (clientAreas(state, today, branch ?? 'all', 365).total === 0)
    return (
      <Empty
        photo={photos.entrance}
        photoPosition="center 40%"
        eyebrow="Business"
        level={1}
        title="See where your clients come from."
        action={
          <Link className="button button-secondary" to="/clients">
            Open your clients
          </Link>
        }
      >
        Record a client’s {word} on their page. Once clients have visits, this groups them by area
        on a map and as a list.{' '}
        {org.region === 'UK'
          ? 'Only the first half of a postcode is kept, never an address.'
          : 'Only the first three digits of a ZIP code are kept, never an address.'}
      </Empty>
    )

  return (
    <div className="areas-page">
      <PageHeader
        eyebrow="Business"
        title="Where clients come from."
        description={`Clients with a visit in ${spanWords} or booked ahead, grouped by ${word}. Record a client’s area on their page.`}
      />
      <div className="areas-controls">
        {multiSite && (
          <label className="areas-where">
            Location
            <Select
              value={where}
              onChange={(e) => {
                setWhere(e.target.value)
                setSelected(null)
              }}
            >
              {!branch && <option value="all">All locations</option>}
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <SegmentedControl
          label="Period"
          appearance="pill"
          value={period}
          onChange={(value) => {
            setPeriod(value)
            setSelected(null)
          }}
          options={[
            { value: '365', label: 'Past year' },
            { value: '90', label: 'Past 90 days' },
          ]}
        />
      </div>
      <div className="areas-metrics">
        <Metric
          label="Clients counted"
          value={view.total}
          detail={`A visit in ${spanWords} or one booked`}
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
      <section className="surface ops-panel" aria-labelledby="areas-map">
        <header>
          <div>
            <h2 id="areas-map">On the map</h2>
            <p>Each circle is a whole area. Choose one to see how it is doing.</p>
          </div>
          {ready && (
            <SegmentedControl
              label="Circle size"
              appearance="pill"
              value={measure}
              onChange={setMeasure}
              options={[
                { value: 'clients', label: 'Clients' },
                { value: 'sales', label: 'Sales' },
              ]}
            />
          )}
        </header>
        <div className="areas-map-layout">
          {ready ? (
            <AreaMap
              org={org}
              areas={map.areas}
              places={map.places}
              features={mapFeatures(state)}
              measure={measure}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <div className="areas-map-off">
              <MapIcon size={22} aria-hidden="true" />
              <div>
                <strong>The map appears once a map service is connected.</strong>
                <p>
                  It draws the streets under each area. Until then, choose an area in the list below
                  for its numbers. Sample studios show a sample map.
                </p>
              </div>
            </div>
          )}
          <AreaDetail area={chosen} areas={map.areas} map={map} org={org} />
        </div>
        {ready && (
          <p className="areas-privacy">
            Sample map: approximate area centres with no streets. A real studio’s map draws the
            streets once a map service is connected.
          </p>
        )}
      </section>
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
            Clients appear here once they have a visit in {spanWords} or one booked.
          </Empty>
        ) : (
          <ul className="areas-list">
            {view.groups.map((g) => (
              <li key={g.area} className={selected === g.area ? 'areas-chosen' : undefined}>
                <button
                  type="button"
                  className="areas-name"
                  aria-pressed={selected === g.area}
                  onClick={() => setSelected(selected === g.area ? null : g.area)}
                >
                  {g.area}
                </button>
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
          {org.region === 'UK'
            ? 'Only the first half of a postcode is ever kept'
            : 'Only the first three digits of a ZIP code are ever kept'}
          , never an address, and no one person is ever placed on the map.
        </p>
      </section>
    </div>
  )
}

/** The chosen area's numbers, or a few plain observations when none is chosen. */
function AreaDetail({
  area,
  areas,
  map,
  org,
}: {
  area: MapArea | null
  areas: MapArea[]
  map: ReturnType<typeof mapAreas>
  org: Parameters<typeof money>[1]
}) {
  if (area) {
    const change = areaChange(area)
    return (
      <aside className="areas-detail" aria-live="polite">
        <span className="areas-detail-eyebrow">Area</span>
        <h3>{area.area}</h3>
        <dl>
          <div>
            <dt>Clients</dt>
            <dd>
              {area.clients} · {percent(area.share)} of all
            </dd>
          </div>
          <div>
            <dt>Visits so far</dt>
            <dd>{area.visits}</dd>
          </div>
          <div>
            <dt>Treatment sales</dt>
            <dd>{money(area.salesMinor, org)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>{change.label}</dd>
          </div>
        </dl>
        <p className="subtle">Sales are before any refunds.</p>
      </aside>
    )
  }
  const strongest = areas[0]
  const growing = areas
    .filter((a) => a.before !== null && a.seen > a.before)
    .sort((a, b) => b.seen - b.before! - (a.seen - a.before!))[0]
  const home = map.places.find((p) => p.centre)
  const near =
    home && map.total
      ? areas
          .filter((a) => a.centre && milesBetween(a.centre, home.centre!) <= 1)
          .reduce((sum, a) => sum + a.clients, 0)
      : null
  return (
    <aside className="areas-detail" aria-live="polite">
      <span className="areas-detail-eyebrow">At a glance</span>
      {!strongest ? (
        <p>No named areas yet.</p>
      ) : (
        <ul>
          <li>
            Most clients come from <strong>{strongest.area}</strong> ({percent(strongest.share)}).
          </li>
          {growing && (
            <li>
              <strong>{growing.area}</strong> is growing fastest:{' '}
              {areaChange(growing).label.toLowerCase()}.
            </li>
          )}
          {near !== null && home && (
            <li>
              {percent(near / map.total)} of clients come from areas centred within a mile of{' '}
              {home.name}.
            </li>
          )}
        </ul>
      )}
      <p className="subtle">Choose an area for its numbers.</p>
    </aside>
  )
}

import { MapPin, TrendingUp } from 'lucide-react'
import type { BusinessState } from '../domain/model'
import { money } from '../domain/format'
import { areaChange, milesAcross, project } from '../domain/areaMap'
import type { MapArea, MapFeature, MapPlace } from '../domain/areaMap'

const W = 640
const H = 400
const PAD = 70
const MAX_R = 54
const MIN_R = 18

export type MapMeasure = 'clients' | 'sales'

/**
 * V5: named client areas as circles on a map, sized by clients or sales, with every location
 * pinned and rings at one and three miles. Only grouped areas appear; no client is placed.
 */
export function AreaMap({
  org,
  areas,
  places,
  features,
  measure,
  selected,
  onSelect,
}: {
  org: BusinessState['organisation']
  areas: MapArea[]
  places: MapPlace[]
  features: MapFeature[]
  measure: MapMeasure
  selected: string | null
  onSelect: (area: string | null) => void
}) {
  const shown = areas.filter((a) => a.centre)
  const pins = places.filter((p) => p.centre)
  const points = [...shown.map((a) => a.centre!), ...pins.map((p) => p.centre!)]
  if (!points.length)
    return (
      <p className="subtle area-map-empty">
        No named areas to draw yet. Areas appear once three or more clients share one.
      </p>
    )
  // Fit every circle and pin, keeping the map's proportions.
  const world = 1
  const xy = points.map((c) => project(c, world))
  const minX = Math.min(...xy.map((p) => p.x))
  const maxX = Math.max(...xy.map((p) => p.x))
  const minY = Math.min(...xy.map((p) => p.y))
  const maxY = Math.max(...xy.map((p) => p.y))
  const centreLat = points.reduce((sum, c) => sum + c[0], 0) / points.length
  const span = Math.max(maxX - minX, ((maxY - minY) * W) / H, milesAcross(4, centreLat, world))
  const scale = (W - PAD * 2) / span
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const at = (c: [number, number]) => {
    const p = project(c, world)
    return { x: W / 2 + (p.x - midX) * scale, y: H / 2 + (p.y - midY) * scale }
  }
  const mile = milesAcross(1, centreLat, world) * scale
  const value = (a: MapArea) => (measure === 'sales' ? a.salesMinor : a.clients)
  const top = Math.max(1, ...shown.map(value))
  const radius = (a: MapArea) => MIN_R + (MAX_R - MIN_R) * Math.sqrt(value(a) / top)
  const home = pins[0] ? at(pins[0].centre!) : null

  return (
    <figure className="area-map">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Map of named client areas, sized by ${measure === 'sales' ? 'sales' : 'clients'}`}
      >
        <defs>
          <pattern
            id="area-map-grid"
            width={mile / 2}
            height={mile / 2}
            patternUnits="userSpaceOnUse"
          >
            <path d={`M ${mile / 2} 0 L 0 0 0 ${mile / 2}`} className="area-map-gridline" />
          </pattern>
          <radialGradient id="area-map-glow">
            <stop offset="0%" className="area-map-glow-in" />
            <stop offset="100%" className="area-map-glow-out" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} className="area-map-ground" />
        <rect width={W} height={H} fill="url(#area-map-grid)" />
        <g aria-hidden="true">
          {features.map((f) => {
            const path = f.points
              .map((c, i) => {
                const p = at(c)
                return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
              })
              .join(' ')
            const mid = at(f.points[Math.floor(f.points.length / 2)])
            const centre = f.points.reduce(
              (sum, c) => [sum[0] + c[0] / f.points.length, sum[1] + c[1] / f.points.length],
              [0, 0],
            ) as [number, number]
            const label = f.kind === 'park' ? at(centre) : mid
            return (
              <g key={f.name} className={`area-map-${f.kind}`}>
                <path d={f.kind === 'park' ? `${path} Z` : path} />
                <text x={label.x} y={label.y + (f.kind === 'water' ? 16 : 4)}>
                  {f.name}
                </text>
              </g>
            )
          })}
        </g>
        {home && (
          <g className="area-map-rings" aria-hidden="true">
            <circle cx={home.x} cy={home.y} r={mile * 3} />
            <circle cx={home.x} cy={home.y} r={mile} />
            <text x={home.x + mile * 0.72} y={home.y - mile * 0.72}>
              1 mile
            </text>
            <text x={home.x + mile * 2.15} y={home.y - mile * 2.15}>
              3 miles
            </text>
          </g>
        )}
        {shown.map((a) => {
          const p = at(a.centre!)
          const r = radius(a)
          const change = areaChange(a)
          const active = selected === a.area
          // Keep the area's words clear of a location pin inside its circle.
          const pinned = pins.some((pin) => {
            const q = at(pin.centre!)
            return Math.hypot(q.x - p.x, q.y - p.y) < r
          })
          const ty = pinned ? p.y + r * 0.38 : p.y - 2
          return (
            <g
              key={a.area}
              className={`area-map-area${change.growing ? ' growing' : ''}${active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`${a.area} ${measure === 'sales' ? `${money(a.salesMinor, org)} in sales` : `${a.clients} clients`}, ${Math.round(a.share * 100)}% of clients. ${change.label}.`}
              onClick={() => onSelect(active ? null : a.area)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(active ? null : a.area)
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r={r * 1.35} fill="url(#area-map-glow)" />
              <circle cx={p.x} cy={p.y} r={r} className="area-map-circle" />
              <text x={p.x} y={ty} className="area-map-name">
                {a.area}
                <tspan x={p.x} dy="1.2em" className="area-map-value">
                  {` ${measure === 'sales' ? money(a.salesMinor, org) : a.clients}`}
                </tspan>
              </text>
            </g>
          )
        })}
        {pins.map((place) => {
          const p = at(place.centre!)
          return (
            <g key={place.id} className="area-map-pin" aria-hidden="true">
              <circle cx={p.x} cy={p.y} r={8} />
              <circle cx={p.x} cy={p.y} r={3} className="area-map-pin-dot" />
              <text x={p.x + 12} y={p.y - 6}>
                {place.name}
              </text>
            </g>
          )
        })}
        <g
          className="area-map-scale"
          aria-hidden="true"
          transform={`translate(${W - 24 - mile} ${H - 26})`}
        >
          <path d={`M0 0 L${mile} 0`} />
          <path d={`M0 -4 L0 4 M${mile} -4 L${mile} 4`} />
          <text x={mile / 2} y={-8}>
            1 mile
          </text>
        </g>
        <g className="area-map-north" aria-hidden="true" transform="translate(30 34)">
          <path d="M0 -14 L6 6 L0 2 L-6 6 Z" />
          <text y={20}>N</text>
        </g>
      </svg>
      <figcaption>
        <span>
          <MapPin size={14} aria-hidden="true" /> Your locations
        </span>
        <span>
          <span className="area-map-key" aria-hidden="true" /> Larger circle, more{' '}
          {measure === 'sales' ? 'sales' : 'clients'}
        </span>
        <span>
          <TrendingUp size={14} aria-hidden="true" /> Deeper colour, growing
        </span>
      </figcaption>
    </figure>
  )
}

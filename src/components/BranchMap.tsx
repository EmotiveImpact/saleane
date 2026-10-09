import { MapPin } from 'lucide-react'
import type { BusinessState } from '../domain/model'
import { money } from '../domain/format'
import { milesAcross, project } from '../domain/areaMap'
import type { MapFeature } from '../domain/areaMap'
import type { BranchPin } from '../domain/branchMap'
import './clientAreas.css'
import './group.css'

const W = 640
const H = 360
const PAD = 90
const MAX_R = 30
const MIN_R = 11

const trendLabel = (p: BranchPin) =>
  p.growth === null
    ? 'nothing to compare yet'
    : p.trend === 'level'
      ? 'level with the 28 days before'
      : `${p.trend === 'up' ? 'up' : 'down'} ${Math.round(Math.abs(p.growth) * 100)}% on the 28 days before`

/**
 * V5: every location on one map. Each pin is sized by its last 28 days' takings and coloured by
 * how they compare with the 28 days before; the list below the map carries the same figures.
 */
export function BranchMap({
  org,
  pins,
  features,
}: {
  org: Pick<BusinessState['organisation'], 'locale' | 'currency'>
  pins: BranchPin[]
  features: MapFeature[]
}) {
  const world = 1
  const xy = pins.map((p) => project(p.centre, world))
  const minX = Math.min(...xy.map((p) => p.x))
  const maxX = Math.max(...xy.map((p) => p.x))
  const minY = Math.min(...xy.map((p) => p.y))
  const maxY = Math.max(...xy.map((p) => p.y))
  const centreLat = pins.reduce((n, p) => n + p.centre[0], 0) / pins.length
  const span = Math.max(maxX - minX, ((maxY - minY) * W) / H, milesAcross(3, centreLat, world))
  const scale = (W - PAD * 2) / span
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const at = (c: [number, number]) => {
    const p = project(c, world)
    return { x: W / 2 + (p.x - midX) * scale, y: H / 2 + (p.y - midY) * scale }
  }
  const mile = milesAcross(1, centreLat, world) * scale
  const top = Math.max(1, ...pins.map((p) => p.takingsMinor))
  const radius = (p: BranchPin) => MIN_R + (MAX_R - MIN_R) * Math.sqrt(p.takingsMinor / top)
  const description = pins
    .map(
      (p) =>
        `${p.name}: ${money(p.takingsMinor, org)}, ${trendLabel(p)}${p.tag ? `, ${p.tag.toLowerCase()}` : ''}.`,
    )
    .join(' ')

  return (
    <figure className="area-map branch-map">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Map of your locations, sized by takings over the last 28 days. ${description}`}
      >
        <rect width={W} height={H} className="area-map-ground" />
        <g aria-hidden="true">
          {features.map((f) => {
            const path = f.points
              .map((c, i) => {
                const p = at(c)
                return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
              })
              .join(' ')
            const n = f.points.length
            const label =
              f.kind === 'park'
                ? at([
                    f.points.reduce((sum, c) => sum + c[0], 0) / n,
                    f.points.reduce((sum, c) => sum + c[1], 0) / n,
                  ])
                : at(f.points[Math.floor(n / 2)])
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
        {pins.map((pin) => {
          const p = at(pin.centre)
          const r = radius(pin)
          // Labels sit on the side with more room, so the outermost pins stay readable.
          const left = p.x > W / 2
          const x = left ? p.x - r - 8 : p.x + r + 8
          return (
            <g key={pin.locationId} className={`branch-pin branch-${pin.trend}`} aria-hidden="true">
              <circle cx={p.x} cy={p.y} r={r * 1.5} className="branch-halo" />
              <circle cx={p.x} cy={p.y} r={r} className="branch-dot" />
              <text x={x} y={p.y - 4} textAnchor={left ? 'end' : 'start'} className="branch-name">
                {pin.name}
              </text>
              <text x={x} y={p.y + 13} textAnchor={left ? 'end' : 'start'} className="branch-value">
                {money(pin.takingsMinor, org)} ·{' '}
                {pin.growth === null
                  ? 'new'
                  : pin.trend === 'level'
                    ? 'level'
                    : `${pin.trend === 'up' ? '+' : '−'}${Math.round(Math.abs(pin.growth) * 100)}%`}
                {pin.tag ? ` · ${pin.tag}` : ''}
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
      </svg>
      <figcaption>
        <span>
          <MapPin size={14} aria-hidden="true" /> Larger pin, more taken in the last 28 days
        </span>
        <span>
          <span className="branch-key branch-up" aria-hidden="true" /> Up
        </span>
        <span>
          <span className="branch-key branch-level" aria-hidden="true" /> Level or new
        </span>
        <span>
          <span className="branch-key branch-down" aria-hidden="true" /> Down
        </span>
      </figcaption>
    </figure>
  )
}

import type { BusinessState } from './model'
import { addDays, money } from './format'
import { renterVisit, serviceRevenue } from './takings'

/**
 * V5: how a studio compares with similar studios, without anyone seeing anyone else. A studio
 * only joins in when its owner chooses to share, and only a studio that shares sees the
 * comparison. Each studio is reduced to a few rates and averages (never totals, names, clients or
 * receipts), and a comparison is shown only when at least BENCHMARK_MIN_STUDIOS other owners in
 * the same market have enough visits to count. Only rounded spreads come back.
 */

/**
 * At least this many other owners must share. Studios with the same owner count once (their
 * measures are averaged), so no one can surround a peer with studios of their own.
 */
export const BENCHMARK_MIN_STUDIOS = 10
/** The window each studio's measures are taken over. */
export const BENCHMARK_DAYS = 90
/** A studio with fewer completed visits than this in the window is left out of every measure. */
export const BENCHMARK_MIN_VISITS = 20

export type MeasureKey = 'averageVisit' | 'rebookRate' | 'noShowRate' | 'returnRate'
export type Measures = Record<MeasureKey, number>

export const MEASURES: {
  key: MeasureKey
  label: string
  money?: boolean
  lowerIsBetter?: boolean
}[] = [
  { key: 'averageVisit', label: 'Average treatment sale', money: true },
  { key: 'rebookRate', label: 'Visits rebooked before leaving' },
  { key: 'returnRate', label: 'Clients who came more than once' },
  { key: 'noShowRate', label: 'Missed visits', lowerIsBetter: true },
]

/** One studio's measures over the last 90 days, or null when it has too few visits to count. */
export function studioMeasures(s: BusinessState, today: string): Measures | null {
  const from = addDays(today, 1 - BENCHMARK_DAYS)
  const inWindow = s.appointments.filter((a) => a.date >= from && a.date <= today)
  const completed = inWindow.filter((a) => a.status === 'completed')
  if (completed.length < BENCHMARK_MIN_VISITS) return null
  // Stage 3: the average treatment sale is the studio's own; a renter's takings are theirs.
  const own = completed.filter((a) => !renterVisit(s, a))
  const ids = new Set(own.map((a) => a.id))
  const revenue = s.sales
    .filter((sale) => ids.has(sale.appointmentId))
    .reduce((n, sale) => n + serviceRevenue(sale), 0)
  const rebooked = completed.filter((a) =>
    s.appointments.some(
      (next) =>
        next.rebookedFromId === a.id && next.status !== 'cancelled' && next.status !== 'no_show',
    ),
  ).length
  const missed = inWindow.filter((a) => a.status === 'no_show').length
  const visitsByClient = new Map<string, number>()
  for (const a of completed)
    visitsByClient.set(a.clientId, (visitsByClient.get(a.clientId) ?? 0) + 1)
  const clients = [...visitsByClient.values()]
  return {
    averageVisit: own.length ? Math.round(revenue / own.length) : 0,
    rebookRate: rebooked / completed.length,
    noShowRate: missed / (completed.length + missed),
    returnRate: clients.filter((n) => n > 1).length / clients.length,
  }
}

/**
 * Reported spreads are rounded (to £5 or $5, and to 5 percentage points), so no figure handed
 * back is any one studio's exact value.
 */
export function coarse(key: MeasureKey, value: number) {
  return key === 'averageVisit' ? Math.round(value / 500) * 500 : Math.round(value * 20) / 20
}

/** One owner's studios as one entry: the average of their measures. */
export function perOwner(groups: Measures[][]): Measures[] {
  return groups
    .filter((g) => g.length)
    .map((g) => {
      const mean = (key: MeasureKey) => g.reduce((n, m) => n + m[key], 0) / g.length
      return {
        averageVisit: mean('averageVisit'),
        rebookRate: mean('rebookRate'),
        noShowRate: mean('noShowRate'),
        returnRate: mean('returnRate'),
      }
    })
}

function quantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low)
}

export type Comparison = {
  key: MeasureKey
  label: string
  own: number
  /** The middle quarter-to-three-quarters of the other studios, and their middle value. */
  low: number
  median: number
  high: number
  /** Where this studio sits, in the direction that is better for a studio. */
  position: 'ahead' | 'typical' | 'behind'
}

/**
 * Compares a studio's measures with the other sharing studios' measures. Returns null when there
 * are too few others to compare with, so no figure about a handful of studios is ever shown.
 */
export function compare(own: Measures | null, others: Measures[]): Comparison[] | null {
  if (!own || others.length < BENCHMARK_MIN_STUDIOS) return null
  return MEASURES.map((m) => {
    const values = others.map((o) => o[m.key]).sort((a, b) => a - b)
    // Where this studio sits is judged on the exact spread; only rounded figures are returned.
    const low = quantile(values, 0.25)
    const high = quantile(values, 0.75)
    const value = own[m.key]
    const above = value > high
    const below = value < low
    const position = above
      ? m.lowerIsBetter
        ? 'behind'
        : 'ahead'
      : below
        ? m.lowerIsBetter
          ? 'ahead'
          : 'behind'
        : 'typical'
    return {
      key: m.key,
      label: m.label,
      own: value,
      low: coarse(m.key, low),
      median: coarse(m.key, quantile(values, 0.5)),
      high: coarse(m.key, high),
      position,
    }
  })
}

/** A measure as a person reads it: money for the average sale, otherwise a whole percentage. */
export function measureLabel(
  key: MeasureKey,
  value: number,
  org: Pick<BusinessState['organisation'], 'locale' | 'currency'>,
) {
  return key === 'averageVisit'
    ? money(Math.round(value / 100) * 100, org)
    : `${Math.round(value * 100)}%`
}

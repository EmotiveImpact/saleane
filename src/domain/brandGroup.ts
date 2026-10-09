import type { BusinessState } from './model'
import { money } from './format'
import { businessDate, operations } from './operations'
import { GROUP_WINDOW_DAYS, wholeBusiness } from './group'

/**
 * V5: one owner, several brands. Each brand stays its own studio with its own clients, team and
 * money; nothing is shared between them. This puts the owner's brands side by side from totals
 * only (never a client, never a receipt), and adds them up only where they can honestly be added:
 * the same currency, and sample studios never mixed with real ones.
 */

export type BrandFigures = {
  id: string
  slug: string
  name: string
  currency: BusinessState['organisation']['currency']
  locale: BusinessState['organisation']['locale']
  sample: boolean
  today: string
  locations: number
  clients: number
  takingsMinor: number
  previousMinor: number
  /** Change on the previous 28 days, or null with nothing then to compare with. */
  growth: number | null
  visits: number
  rebookRate: number | null
  month: { takenMinor: number; bookedMinor: number; targetMinor: number | null }
}

/** One brand's totals, from the same figures as its own Business page. */
export function brandFigures(
  org: { id: string; slug: string; state: BusinessState },
  now = new Date().toISOString(),
): BrandFigures {
  const s = org.state
  const today = businessDate(s, now)
  const whole = wholeBusiness(s, today)
  const rated = whole.places.filter((p) => p.rebookRate !== null && p.visits)
  const ratedVisits = rated.reduce((n, p) => n + p.visits, 0)
  return {
    id: org.id,
    slug: org.slug,
    name: s.organisation.name,
    currency: s.organisation.currency,
    locale: s.organisation.locale,
    sample: operations(s).mode === 'sandbox',
    today,
    locations: whole.places.length,
    clients: s.clients.length,
    takingsMinor: whole.total.takingsMinor,
    previousMinor: whole.total.previousMinor,
    growth: whole.total.growth,
    visits: whole.total.places.reduce((n, p) => n + p.visits, 0),
    rebookRate: ratedVisits
      ? rated.reduce((n, p) => n + p.rebookRate! * p.visits, 0) / ratedVisits
      : null,
    month: whole.total.month,
  }
}

export type GroupTotal = {
  currency: BusinessState['organisation']['currency']
  locale: BusinessState['organisation']['locale']
  sample: boolean
  brands: string[]
  takingsMinor: number
  previousMinor: number
  growth: number | null
  month: { takenMinor: number; bookedMinor: number }
}

const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null)
const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`
const upDown = (n: number) =>
  Math.round(n * 100) === 0 ? 'level with' : n > 0 ? `up ${pct(n)} on` : `down ${pct(n)} on`

/** The owner's brands together: totals that can be added, the one ahead, the one behind. */
export function brandGroup(brands: BrandFigures[]) {
  const totals: GroupTotal[] = []
  for (const b of brands) {
    let t = totals.find((x) => x.currency === b.currency && x.sample === b.sample)
    if (!t)
      totals.push(
        (t = {
          currency: b.currency,
          locale: b.locale,
          sample: b.sample,
          brands: [],
          takingsMinor: 0,
          previousMinor: 0,
          growth: null,
          month: { takenMinor: 0, bookedMinor: 0 },
        }),
      )
    t.brands.push(b.id)
    t.takingsMinor += b.takingsMinor
    t.previousMinor += b.previousMinor
    t.month.takenMinor += b.month.takenMinor
    t.month.bookedMinor += b.month.bookedMinor
  }
  for (const t of totals) t.growth = change(t.takingsMinor, t.previousMinor)
  // Real studios first, then samples; pounds before dollars.
  totals.sort((a, b) => Number(a.sample) - Number(b.sample) || a.currency.localeCompare(b.currency))
  // Growth is a share, so brands in different currencies can still be compared on it.
  const ranked = brands.filter((b) => b.growth !== null).sort((a, b) => b.growth! - a.growth!)
  const whole = (b: BrandFigures) => Math.round(b.growth! * 100)
  // Named only when clearly ahead or behind the rest, and only "needs a look" when it fell.
  const best =
    ranked.length > 1 && whole(ranked[0]) > whole(ranked[1]) && whole(ranked[0]) > 0
      ? ranked[0]
      : null
  const weakest =
    ranked.length > 1 && whole(ranked.at(-1)!) < whole(ranked.at(-2)!) && whole(ranked.at(-1)!) < 0
      ? ranked.at(-1)!
      : null
  const lines = totals.map((t) => {
    const n = t.brands.length
    const what = `${n} ${t.sample ? 'sample ' : ''}${n === 1 ? 'brand' : 'brands'}`
    return `Across ${what}, completed visits took ${money(t.takingsMinor, t)} in the last ${GROUP_WINDOW_DAYS} days${
      t.growth === null ? '.' : `, ${upDown(t.growth)} the ${GROUP_WINDOW_DAYS} days before.`
    }`
  })
  const ranking = [
    best && `${best.name} is doing best (${upDown(best.growth!).replace(' on', '')}).`,
    weakest && `${weakest.name} needs a look (${upDown(weakest.growth!).replace(' on', '')}).`,
  ].filter(Boolean)
  if (ranking.length) lines.push(ranking.join(' '))
  return { brands, totals, best, weakest, summary: lines }
}

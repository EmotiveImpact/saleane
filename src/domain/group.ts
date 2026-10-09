import type { z } from 'zod'
import type { BusinessState } from './model'
import { addDays, money } from './format'
import { places } from './locations'
import { businessDate, operations } from './operations'
import { serviceRevenue } from './selectors'
import { REGION_LIMIT, TARGET_LIMIT } from './groupSchema'
import type { Region, Target, groupCommandSchemas } from './groupSchema'

/**
 * V5: the whole business at a glance. The owner groups locations into regions and sets each
 * location a monthly target; this works out, from completed visits only, how each location is
 * doing, which is growing fastest and which needs a look, and says so in plain words. A booked
 * visit is counted as booked, never as money taken.
 */

export type GroupCommand = z.infer<(typeof groupCommandSchemas)[number]>

export const regions = (s: BusinessState): Region[] => operations(s).regions ?? []
export const targets = (s: BusinessState): Target[] => operations(s).targets ?? []

export function runGroupCommand(next: BusinessState, command: GroupCommand, makeId: () => string) {
  const o = next.operations!
  const known = new Set(places(next, true).map((p) => p.id))
  if (command.type === 'region') {
    const list = (o.regions ??= [])
    const old = command.id ? list.find((r) => r.id === command.id) : undefined
    if (command.id && !old) throw new Error('That region is not in this business.')
    if (!old && list.length >= REGION_LIMIT) throw new Error('Too many regions to keep.')
    const name = command.input.name.toLowerCase()
    if (list.some((r) => r.id !== command.id && r.name.toLowerCase() === name))
      throw new Error('Another region already has that name.')
    const locationIds = [...new Set(command.input.locationIds)]
    if (locationIds.some((l) => !known.has(l)))
      throw new Error('A location in this region is not in this business.')
    // Each location answers to one region, so figures are never counted twice.
    const elsewhere = list.find(
      (r) => r.id !== command.id && r.locationIds.some((l) => locationIds.includes(l)),
    )
    if (elsewhere) throw new Error(`A location here is already in ${elsewhere.name}.`)
    const record = { id: command.id ?? makeId(), name: command.input.name, locationIds }
    if (old) Object.assign(old, record)
    else list.push(record)
    return record.id
  }
  if (command.type === 'region-remove') {
    if (!(o.regions ?? []).some((r) => r.id === command.regionId))
      throw new Error('That region is not in this business.')
    o.regions = o.regions!.filter((r) => r.id !== command.regionId)
    return command.regionId
  }
  const named = command.set.map((t) => t.locationId)
  if (named.some((l) => !known.has(l))) throw new Error('That location is not in this business.')
  if (new Set(named).size !== named.length) throw new Error('Each location has one target.')
  const kept = (o.targets ?? []).filter(
    (t) => !(t.month === command.month && named.includes(t.locationId)),
  )
  for (const t of command.set)
    if (t.takingsMinor !== null)
      kept.push({ locationId: t.locationId, month: command.month, takingsMinor: t.takingsMinor })
  if (kept.length > TARGET_LIMIT) throw new Error('Too many targets to keep.')
  o.targets = kept
  return command.month
}

/** Ledger check: regions and targets name real locations, and no location is in two regions. */
export function groupProblem(s: BusinessState) {
  const known = new Set(places(s, true).map((p) => p.id))
  const seen = new Set<string>()
  for (const r of regions(s))
    for (const l of r.locationIds) {
      if (!known.has(l)) return 'A region names a location that is not in this business.'
      if (seen.has(l)) return 'A location is in two regions.'
      seen.add(l)
    }
  if (targets(s).some((t) => !known.has(t.locationId)))
    return 'A target names a location that is not in this business.'
  return null
}

/** The comparison window: the last 28 days against the 28 before. */
export const GROUP_WINDOW_DAYS = 28

/** Completed service takings at one location between two dates, both included. */
function takings(s: BusinessState, locationId: string, from: string, to: string) {
  const visits = new Map(
    s.appointments
      .filter(
        (a) =>
          a.locationId === locationId && a.status === 'completed' && a.date >= from && a.date <= to,
      )
      .map((a) => [a.id, a]),
  )
  const sales = s.sales.filter((sale) => visits.has(sale.appointmentId))
  return { minor: sales.reduce((sum, sale) => sum + serviceRevenue(sale), 0), visits: visits.size }
}

export type PlaceFigures = {
  locationId: string
  name: string
  takingsMinor: number
  previousMinor: number
  /** Change on the previous 28 days, or null when there was nothing then to compare with. */
  growth: number | null
  visits: number
  /** Completed visits linked to a next visit, or null with none completed. */
  rebookRate: number | null
  month: {
    takenMinor: number
    /** Visits still to come this month, at their booked prices: booked, not taken. */
    bookedMinor: number
    targetMinor: number | null
    /**
     * An estimate of the month's end: taken so far, plus the larger of what is booked and the
     * last 28 days' daily pace over the days left. Never money taken.
     */
    forecastMinor: number
  }
}
export type RegionFigures = {
  id: string | null
  name: string
  places: PlaceFigures[]
  takingsMinor: number
  previousMinor: number
  growth: number | null
  month: {
    takenMinor: number
    bookedMinor: number
    targetMinor: number | null
    forecastMinor: number
  }
}

const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null)

/** `only` narrows the view to some locations, for a regional manager's area. */
export function wholeBusiness(
  s: BusinessState,
  today = businessDate(s),
  only?: ReadonlySet<string>,
) {
  const from = addDays(today, 1 - GROUP_WINDOW_DAYS)
  const before = { from: addDays(from, -GROUP_WINDOW_DAYS), to: addDays(from, -1) }
  const month = today.slice(0, 7)
  const monthEnd = addDays(`${addMonth(month)}-01`, -1)
  // Days after today to the month's end, for the pace estimate.
  const daysLeft = Number(monthEnd.slice(8)) - Number(today.slice(8))
  const rebooked = (id: string) =>
    s.appointments.some(
      (next) =>
        next.rebookedFromId === id && next.status !== 'cancelled' && next.status !== 'no_show',
    )
  const figures: PlaceFigures[] = places(s)
    .filter((p) => !only || only.has(p.id))
    .map((p) => {
      const now = takings(s, p.id, from, today)
      const then = takings(s, p.id, before.from, before.to)
      const completed = s.appointments.filter(
        (a) =>
          a.locationId === p.id && a.status === 'completed' && a.date >= from && a.date <= today,
      )
      const ahead = s.appointments.filter(
        (a) =>
          a.locationId === p.id &&
          (a.status === 'confirmed' || a.status === 'arrived') &&
          a.date >= today &&
          a.date <= monthEnd,
      )
      const takenMinor = takings(s, p.id, `${month}-01`, today).minor
      const bookedMinor = ahead.reduce((sum, a) => sum + a.bookedPriceMinor, 0)
      return {
        locationId: p.id,
        name: p.name,
        takingsMinor: now.minor,
        previousMinor: then.minor,
        growth: change(now.minor, then.minor),
        visits: now.visits,
        rebookRate: completed.length
          ? completed.filter((a) => rebooked(a.id)).length / completed.length
          : null,
        month: {
          takenMinor,
          bookedMinor,
          forecastMinor:
            takenMinor +
            Math.max(bookedMinor, Math.round((now.minor / GROUP_WINDOW_DAYS) * daysLeft)),
          targetMinor:
            targets(s).find((t) => t.locationId === p.id && t.month === month)?.takingsMinor ??
            null,
        },
      }
    })
  const sum = (list: PlaceFigures[], name: string, id: string | null): RegionFigures => {
    const takingsMinor = list.reduce((n, p) => n + p.takingsMinor, 0)
    const previousMinor = list.reduce((n, p) => n + p.previousMinor, 0)
    const withTarget = list.filter((p) => p.month.targetMinor !== null)
    return {
      id,
      name,
      places: list,
      takingsMinor,
      previousMinor,
      growth: change(takingsMinor, previousMinor),
      month: {
        takenMinor: list.reduce((n, p) => n + p.month.takenMinor, 0),
        bookedMinor: list.reduce((n, p) => n + p.month.bookedMinor, 0),
        forecastMinor: list.reduce((n, p) => n + p.month.forecastMinor, 0),
        // A total target only when every location in it has one.
        targetMinor:
          withTarget.length === list.length && list.length
            ? withTarget.reduce((n, p) => n + p.month.targetMinor!, 0)
            : null,
      },
    }
  }
  const grouped = regions(s)
    .map((r) =>
      sum(
        figures.filter((f) => r.locationIds.includes(f.locationId)),
        r.name,
        r.id,
      ),
    )
    .filter((r) => r.places.length)
  const inRegion = new Set(grouped.flatMap((r) => r.places.map((p) => p.locationId)))
  const rest = figures.filter((f) => !inRegion.has(f.locationId))
  if (grouped.length && rest.length) grouped.push(sum(rest, 'Not in a region', null))
  const total = sum(figures, 'Whole business', null)
  const compared = figures.filter((f) => f.growth !== null)
  const ranked = [...compared].sort((a, b) => b.growth! - a.growth!)
  // Named only when clearly ahead or behind: locations level with each other are never ranked.
  const whole = (p: PlaceFigures) => Math.round(p.growth! * 100)
  const best = ranked.length > 1 && whole(ranked[0]) > whole(ranked[1]) ? ranked[0] : null
  const weakest =
    ranked.length > 1 && whole(ranked.at(-1)!) < whole(ranked.at(-2)!) ? ranked.at(-1)! : null
  return {
    from,
    to: today,
    month,
    places: figures,
    regions: grouped,
    total,
    best,
    weakest,
    summary: summary(s, total, best, weakest),
  }
}

/** The weekly few lines: the last 7 days against the 7 before, from completed visits only. */
export function weekInBrief(s: BusinessState, today = businessDate(s), only?: ReadonlySet<string>) {
  const org = s.organisation
  const ids = places(s)
    .filter((p) => !only || only.has(p.id))
    .map((p) => p.id)
  const from = addDays(today, -6)
  const before = { from: addDays(today, -13), to: addDays(today, -7) }
  const all = ids.map((id) => ({
    id,
    name: places(s).find((p) => p.id === id)!.name,
    now: takings(s, id, from, today),
    then: takings(s, id, before.from, before.to),
  }))
  const now = all.reduce((n, p) => n + p.now.minor, 0)
  const then = all.reduce((n, p) => n + p.then.minor, 0)
  const visits = all.reduce((n, p) => n + p.now.visits, 0)
  const growth = change(now, then)
  const completed = s.appointments.filter(
    (a) => a.status === 'completed' && ids.includes(a.locationId ?? '') && a.date <= today,
  )
  // A client is new this week when their first completed visit falls in it.
  const first = new Map<string, string>()
  for (const a of s.appointments)
    if (a.status === 'completed' && a.date <= today && (first.get(a.clientId) ?? '9999') > a.date)
      first.set(a.clientId, a.date)
  const fresh = new Set(
    completed
      .filter((a) => a.date >= from && first.get(a.clientId) === a.date)
      .map((a) => a.clientId),
  ).size
  const lines = [
    `This week, completed visits took ${money(now, org)} from ${visits} ${visits === 1 ? 'visit' : 'visits'}${
      growth === null ? '.' : `, ${upDown(growth)} the week before.`
    }`,
    fresh
      ? `${fresh} ${fresh === 1 ? 'client' : 'clients'} came for the first time.`
      : 'No one new came this week.',
  ]
  const ranked = all
    .filter((p) => p.then.minor > 0)
    .map((p) => ({ name: p.name, growth: change(p.now.minor, p.then.minor)! }))
    .sort((a, b) => b.growth - a.growth)
  if (ranked.length > 1 && Math.round(ranked[0].growth * 100) > Math.round(ranked[1].growth * 100))
    lines.push(
      `${ranked[0].name} had the best week (${upDown(ranked[0].growth).replace(' on', '')}).`,
    )
  return { from, to: today, lines }
}

/** The month-end estimate for one row, rounded to whole pounds or dollars: never money taken. */
export function monthEstimate(
  m: RegionFigures['month'],
  org: Pick<BusinessState['organisation'], 'locale' | 'currency'>,
) {
  const near = money(Math.round(m.forecastMinor / 100) * 100, org)
  if (!m.targetMinor) return `About ${near}`
  return `About ${near}, ${m.forecastMinor >= m.targetMinor ? 'on course' : 'short of target'}`
}

function addMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`
const upDown = (n: number) =>
  Math.round(n * 100) === 0 ? 'level with' : n > 0 ? `up ${pct(n)} on` : `down ${pct(n)} on`

/** The week's few lines for the owner, in plain words, from the same figures. */
function summary(
  s: BusinessState,
  total: RegionFigures,
  best: PlaceFigures | null,
  weakest: PlaceFigures | null,
) {
  const org = s.organisation
  const lines = [
    `Across ${total.places.length} ${total.places.length === 1 ? 'location' : 'locations'}, completed visits took ${money(total.takingsMinor, org)} in the last ${GROUP_WINDOW_DAYS} days${
      total.growth === null
        ? '.'
        : `, ${upDown(total.growth)} the ${GROUP_WINDOW_DAYS} days before.`
    }`,
  ]
  const ranked = [
    best && `${best.name} is doing best (${upDown(best.growth!).replace(' on', '')}).`,
    weakest && `${weakest.name} needs a look (${upDown(weakest.growth!).replace(' on', '')}).`,
  ].filter(Boolean)
  if (ranked.length) lines.push(ranked.join(' '))
  const month = total.month
  lines.push(
    `This month so far: ${money(month.takenMinor, org)} taken${
      month.targetMinor
        ? ` of a ${money(month.targetMinor, org)} target (${pct(month.takenMinor / month.targetMinor)})`
        : ''
    }, with ${money(month.bookedMinor, org)} more booked but not yet taken.`,
  )
  if (month.forecastMinor > month.takenMinor)
    lines.push(
      `At the recent pace the month could end near ${money(Math.round(month.forecastMinor / 100) * 100, org)}${
        month.targetMinor
          ? `, ${month.forecastMinor >= month.targetMinor ? 'on course for' : 'short of'} the target`
          : ''
      }. This is an estimate, not money taken.`,
    )
  return lines
}

import type { BusinessState } from './model'
import { addDays, dateLabel, money } from './format'
import { operations } from './operations'
import { places } from './locations'
import { takings, wholeBusiness } from './group'
import { checklists, lastVisits } from './branchVisits'
import { requests } from './approvals'
import { GROUP_CHECK_DEFAULTS } from './groupSchema'

/**
 * V5: checks that run by themselves across every location, so the owner and regional managers
 * hear about a branch slipping without looking for it. Each check is worked out from the
 * business's own records each time the page is read; nothing is changed and no one is contacted.
 */

export type GroupCheckKey = keyof typeof GROUP_CHECK_DEFAULTS
export type GroupAlert = {
  id: string
  kind: 'takings-drop' | 'target-short' | 'visit-due' | 'request-waiting'
  locationId: string
  title: string
  detail: string
}

/** The owner's settings, with the default for any not chosen. Null means switched off. */
export function groupCheckSettings(s: BusinessState): Record<GroupCheckKey, number | null> {
  const chosen = operations(s).groupChecks ?? {}
  const value = (key: GroupCheckKey) =>
    chosen[key] === undefined ? GROUP_CHECK_DEFAULTS[key] : chosen[key]
  return {
    takingsDropPct: value('takingsDropPct'),
    targetShortPct: value('targetShortPct'),
    visitDueDays: value('visitDueDays'),
    requestWaitDays: value('requestWaitDays'),
  }
}

/** Days from one date to another, both as YYYY-MM-DD. */
const between = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * What the checks find today, for every open location or only those in `only`. A check needs
 * something to compare with, so a new location with no history raises nothing.
 */
export function groupAlerts(
  s: BusinessState,
  today: string,
  only?: ReadonlySet<string>,
): GroupAlert[] {
  const set = groupCheckSettings(s)
  const org = s.organisation
  const sites = places(s).filter((p) => !only || only.has(p.id))
  const name = new Map(places(s, true).map((p) => [p.id, p.name]))
  const alerts: GroupAlert[] = []

  if (set.takingsDropPct !== null) {
    const from = addDays(today, -6)
    for (const p of sites) {
      const now = takings(s, p.id, from, today).minor
      const before = takings(s, p.id, addDays(from, -7), addDays(from, -1)).minor
      if (before <= 0) continue
      const drop = Math.round((1 - now / before) * 100)
      if (drop >= set.takingsDropPct)
        alerts.push({
          id: `takings-drop-${p.id}-${today}`,
          kind: 'takings-drop',
          locationId: p.id,
          title: `${p.name} is down ${drop}% this week`,
          detail: `${money(now, org)} from completed visits in the last 7 days, against ${money(before, org)} the 7 days before.`,
        })
    }
  }

  // Early in a month the estimate rests on too little, so this check starts on the 7th.
  if (set.targetShortPct !== null && Number(today.slice(8)) >= 7) {
    const view = wholeBusiness(s, today, only)
    for (const p of view.places) {
      const target = p.month.targetMinor
      if (!target) continue
      const short = Math.round((1 - p.month.forecastMinor / target) * 100)
      if (short >= set.targetShortPct)
        alerts.push({
          id: `target-short-${p.locationId}-${view.month}`,
          kind: 'target-short',
          locationId: p.locationId,
          title: `${p.name} may finish short of its target`,
          detail: `The month-end estimate is about ${money(Math.round(p.month.forecastMinor / 100) * 100, org)} against a target of ${money(target, org)}. This is an estimate, not money taken.`,
        })
    }
  }

  // Branch visits are only expected once the business has a checklist to visit with.
  if (set.visitDueDays !== null && checklists(s).some((c) => !c.archived)) {
    for (const { place, visit } of lastVisits(s)) {
      if (only && !only.has(place.id)) continue
      if (visit && between(visit.date, today) < set.visitDueDays) continue
      alerts.push({
        id: `visit-due-${place.id}-${today}`,
        kind: 'visit-due',
        locationId: place.id,
        title: `${place.name} is due a branch visit`,
        detail: visit
          ? `Last visited ${dateLabel(visit.date, org.locale, true)}, ${between(visit.date, today)} days ago.`
          : 'Not visited yet.',
      })
    }
  }

  if (set.requestWaitDays !== null) {
    for (const r of requests(s)) {
      if (r.decision || (only && !only.has(r.locationId))) continue
      const waited = between(r.raisedAt.slice(0, 10), today)
      if (waited < set.requestWaitDays) continue
      alerts.push({
        id: `request-waiting-${r.id}`,
        kind: 'request-waiting',
        locationId: r.locationId,
        title: `A request at ${name.get(r.locationId) ?? 'a closed location'} has waited ${waited} ${waited === 1 ? 'day' : 'days'}`,
        detail: `“${r.title}”, waiting for ${r.routedTo.level === 'regional' ? 'the regional manager' : 'the owner'}.`,
      })
    }
  }
  return alerts
}

/** How each check reads in settings: what it watches and its number. */
export const CHECK_WORDS: Record<GroupCheckKey, { label: string; unit: string; help: string }> = {
  takingsDropPct: {
    label: 'Takings fall',
    unit: '%',
    help: 'A location’s last 7 days are down by at least this much on the 7 days before.',
  },
  targetShortPct: {
    label: 'Short of target',
    unit: '%',
    help: 'From the 7th of the month, a location’s month-end estimate is short of its target by at least this much.',
  },
  visitDueDays: {
    label: 'Branch visit due',
    unit: 'days',
    help: 'A location has not had a branch visit for this many days. Only once you have a checklist.',
  },
  requestWaitDays: {
    label: 'Request waiting',
    unit: 'days',
    help: 'A request for a sign-off has waited this many days for a decision.',
  },
}

import { z } from 'zod'
import { organisationSchema } from './model'
import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays, dateLabel } from './format'
import { places } from './locations'
import { regions, wholeBusiness } from './group'
import { branchVisits, checklists } from './branchVisits'
import { branchVisitSchema, checklistSchema } from './branchVisitSchema'
import { approvalRequestSchema } from './approvalsSchema'
import { regionalLimit, requests } from './approvals'

/**
 * V5: what a regional manager may read and change.
 *
 * Read: for the locations in their region only, the whole-business figures (takings, change,
 * rebooking, the month against target, booked but not taken), how many visits each has booked
 * today, the checklists in use and the branch visits recorded there. No clients, diaries, staff,
 * prices, payments, settings or other locations.
 * Write: record a branch visit at one of their locations, and mark a line from one put right.
 * Raise a request for sign-off at one of their locations, and decide the ones routed to their
 * region (those over their limit pass up to the owner).
 */
const AREA_COMMANDS = [
  'branch-visit',
  'branch-visit-fix',
  'request-raise',
  'request-decide',
] as const
/** A location not visited for this long is named in the morning summary. */
export const AREA_VISIT_DUE_DAYS = 30

const id = z.string().min(1)
const month = z.object({
  takenMinor: z.number().int(),
  bookedMinor: z.number().int(),
  targetMinor: z.number().int().nullable(),
})
const placeFigures = z
  .object({
    locationId: id,
    name: z.string(),
    takingsMinor: z.number().int(),
    previousMinor: z.number().int(),
    growth: z.number().nullable(),
    visits: z.number().int(),
    rebookRate: z.number().nullable(),
    month,
  })
  .strict()
export const areaViewSchema = z
  .object({
    view: z.literal('area'),
    revision: z.number().int().nonnegative(),
    today: z.iso.date(),
    organisation: organisationSchema
      .pick({ id: true, name: true, region: true, locale: true, currency: true, timeZone: true })
      .strict(),
    area: z.object({ id, name: z.string() }).strict(),
    window: z.object({ from: z.iso.date(), to: z.iso.date(), month: z.string() }).strict(),
    places: z.array(
      z
        .object({
          id,
          name: z.string(),
          address: z.string(),
          bookedToday: z.number().int().nonnegative(),
          figures: placeFigures,
          tag: z.enum(['best', 'weakest']).nullable(),
        })
        .strict(),
    ),
    total: z
      .object({ takingsMinor: z.number().int(), growth: z.number().nullable(), month })
      .strict(),
    summary: z.array(z.string()),
    checklists: z.array(checklistSchema),
    visits: z.array(branchVisitSchema),
    /** Requests at their locations, and what they may approve. */
    requests: z.array(approvalRequestSchema),
    regionalLimitMinor: z.number().int().nonnegative(),
  })
  .strict()
export type AreaView = z.infer<typeof areaViewSchema>

/** The open locations in a region, or none when the region has gone or is empty. */
export function areaPlaces(s: BusinessState, regionId: string) {
  const region = regions(s).find((r) => r.id === regionId)
  if (!region) return { region: null, ids: new Set<string>() }
  const open = new Set(places(s).map((p) => p.id))
  return { region, ids: new Set(region.locationIds.filter((l) => open.has(l))) }
}

export function areaView(s: BusinessState, regionId: string, today: string): AreaView {
  const { region, ids } = areaPlaces(s, regionId)
  if (!region || !ids.size) throw new Error('This area has no open locations.')
  const org = s.organisation
  const view = wholeBusiness(s, today, ids)
  const visits = branchVisits(s).filter((v) => ids.has(v.locationId))
  const booked = (locationId: string) =>
    s.appointments.filter(
      (a) =>
        a.locationId === locationId &&
        a.date === today &&
        (a.status === 'confirmed' || a.status === 'arrived'),
    ).length
  const list = places(s).filter((p) => ids.has(p.id))
  const lastVisit = (locationId: string) =>
    visits
      .filter((v) => v.locationId === locationId)
      .reduce<string | null>((latest, v) => (!latest || v.date > latest ? v.date : latest), null)
  const bookedToday = list.reduce((n, p) => n + booked(p.id), 0)
  const open = visits.flatMap((v) => v.answers.filter((a) => a.answer === 'no' && !a.fixed)).length
  const due = list.filter((p) => {
    const last = lastVisit(p.id)
    return !last || last < addDays(today, -AREA_VISIT_DUE_DAYS)
  })
  const areaRequests = requests(s).filter((r) => ids.has(r.locationId))
  const forYou = areaRequests.filter(
    (r) => !r.decision && r.routedTo.level === 'regional' && r.routedTo.regionId === region.id,
  ).length
  const morning = [
    `Today, ${bookedToday === 1 ? 'one visit is' : `${bookedToday} visits are`} booked across ${region.name}.`,
    open
      ? `${open} ${open === 1 ? 'thing' : 'things'} from branch visits still to put right.`
      : 'Nothing from branch visits is waiting to be put right.',
    ...(forYou
      ? [`${forYou} ${forYou === 1 ? 'request is' : 'requests are'} waiting for your sign-off.`]
      : []),
    ...(due.length
      ? [
          `Due a branch visit: ${due
            .map((p) => {
              const last = lastVisit(p.id)
              return last
                ? `${p.name} (last ${dateLabel(last, org.locale, true)})`
                : `${p.name} (not yet visited)`
            })
            .join(', ')}.`,
        ]
      : []),
  ]
  return {
    view: 'area',
    revision: s.revision,
    today,
    organisation: {
      id: org.id,
      name: org.name,
      region: org.region,
      locale: org.locale,
      currency: org.currency,
      timeZone: org.timeZone,
    },
    area: { id: region.id, name: region.name },
    window: { from: view.from, to: view.to, month: view.month },
    places: list.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      bookedToday: booked(p.id),
      figures: view.places.find((f) => f.locationId === p.id)!,
      tag:
        view.best?.locationId === p.id
          ? 'best'
          : view.weakest?.locationId === p.id
            ? 'weakest'
            : null,
    })),
    total: {
      takingsMinor: view.total.takingsMinor,
      growth: view.total.growth,
      month: view.total.month,
    },
    summary: [...view.summary, ...morning],
    checklists: checklists(s).filter((c) => !c.archived),
    visits,
    requests: areaRequests,
    regionalLimitMinor: regionalLimit(s),
  }
}

/** Why a regional manager may not make this change, or null when they may. */
export function areaRefusal(s: BusinessState, regionId: string, command: Command) {
  if (!(AREA_COMMANDS as readonly string[]).includes(command.type))
    return 'Your role cannot make this change.'
  const { ids } = areaPlaces(s, regionId)
  if (command.type === 'branch-visit')
    return ids.has(command.input.locationId) ? null : 'That location is not in your area.'
  if (command.type === 'branch-visit-fix') {
    const visit = branchVisits(s).find((v) => v.id === command.visitId)
    return visit && ids.has(visit.locationId) ? null : 'That visit is not in your area.'
  }
  if (command.type === 'request-raise')
    return ids.has(command.input.locationId) ? null : 'That location is not in your area.'
  if (command.type === 'request-decide') {
    const request = requests(s).find((r) => r.id === command.requestId)
    if (!request || !ids.has(request.locationId)) return 'That request is not in your area.'
    if (request.routedTo.level !== 'regional' || request.routedTo.regionId !== regionId)
      return 'This request has passed up to the owner.'
    return null
  }
  return 'Your role cannot make this change.'
}

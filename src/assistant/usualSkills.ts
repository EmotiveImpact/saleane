import { z } from 'zod'
import { readSkill, SkillRefusal } from '../../lumane'
import type { Skill } from '../../lumane'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { dateLabel, timeLabel } from '../domain/format'
import { can } from '../domain/operations'
import { bookablePlaces, hasLocations, offeredAt, staffPlaces } from '../domain/locations'
import { guestUsual, PART_TIMES } from '../domain/usual'
import type { GuestUsual, UsualChange } from '../domain/usual'
import type { AskContext } from './saleane'
import type { ReceptionContext, ReceptionEffect } from './receptionist'

/**
 * Stage 5: "my usual" for the AI receptionist and for Ask SALEANE. Both read the same usual
 * (src/domain/usual.ts): the guest's own completed visits, across every record with their email.
 *
 * The receptionist offers `my_usual` only to a guest the server knows by the number they wrote
 * from, and it says only what the guest could see for themselves: the treatment, who they see,
 * where and when, never another client, a price or a note. Ask SALEANE's `client_usual` is for the
 * team, who already read the whole client record, so it also says how many visits it counted.
 */

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** A day of the week by name, in the studio's language: "Saturday". */
export function weekdayName(s: BusinessState, weekday: number) {
  // 4 October 2026 is a Sunday.
  const date = new Date(Date.UTC(2026, 9, 4 + weekday, 12))
  return new Intl.DateTimeFormat(s.organisation.locale, {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date)
}

/** When they like to come: "on Saturday mornings", "on Tuesdays", "usually in the evening". */
export function usualWhen(s: BusinessState, usual: Pick<GuestUsual, 'weekday' | 'partOfDay'>) {
  const day = usual.weekday === undefined ? null : weekdayName(s, usual.weekday)
  if (day && usual.partOfDay) return `on ${day} ${usual.partOfDay}s`
  if (day) return `on ${day}s`
  if (usual.partOfDay) return `usually in the ${usual.partOfDay}`
  return ''
}

/** What their usual is, in one sentence that starts "Your usual is" or "Amelia Carter's usual is". */
function usualSentence(s: BusinessState, usual: GuestUsual, whose: string) {
  const when = usualWhen(s, usual)
  return `${whose} usual is ${usual.treatment!.name}${
    usual.professional ? ` with ${usual.professional.name}` : ''
  }${usual.location ? ` at ${usual.location.name}` : ''}${when ? `, ${when}` : ''}.`
}

/** What changed since, to the guest. */
function guestChange(usual: GuestUsual, change: UsualChange) {
  switch (change.kind) {
    case 'professional-away':
      return `${change.name}, who you usually see, is not taking bookings now.`
    case 'professional-not-doing':
      return `${change.name}, who you usually see, does not offer it now.`
    case 'professional-moved':
      return change.location
        ? `${change.name}, who you usually see, now works at ${change.location}.`
        : `${change.name}, who you usually see, does not work at ${usual.location?.name ?? 'that location'} now.`
    case 'location-closed':
      return `${change.location}, where you usually go, is not open now.`
    case 'location-not-offered':
      return `${change.location}, where you usually go, does not offer it now.`
  }
}

/** What changed since, to the team. */
function teamChange(usual: GuestUsual, change: UsualChange) {
  const treatment = usual.treatment?.name ?? 'it'
  switch (change.kind) {
    case 'professional-away':
      return `${change.name}, who they usually see, no longer takes bookings.`
    case 'professional-not-doing':
      return `${change.name}, who they usually see, no longer does ${treatment}.`
    case 'professional-moved':
      return change.location
        ? `${change.name}, who they usually see, now works at ${change.location}.`
        : `${change.name}, who they usually see, no longer works at ${usual.location?.name ?? 'that location'}.`
    case 'location-closed':
      return `${change.location}, where they usually go, is closed.`
    case 'location-not-offered':
      return `${change.location}, where they usually go, no longer offers ${treatment}.`
  }
}

/** The guest's usual in the receptionist's words: the line it starts with, and what changed. */
export function guestUsualWords(s: BusinessState, usual: GuestUsual) {
  if (usual.none === 'new' || !usual.treatment)
    return {
      summary:
        usual.none === 'no-clear-treatment'
          ? 'Your visits do not point to one usual treatment.'
          : 'I cannot see a usual from your visits yet.',
      notes: [] as string[],
    }
  if (usual.none === 'treatment-gone')
    return { summary: `Your usual, ${usual.treatment.name}, is not on the menu now.`, notes: [] }
  return {
    summary: usualSentence(s, usual, 'Your'),
    notes: usual.changes.map((change) => guestChange(usual, change)),
  }
}

/** The client's usual in the team's words. */
export function teamUsualWords(s: BusinessState, usual: GuestUsual, name: string) {
  const counted = `From ${usual.visits} completed ${usual.visits === 1 ? 'visit' : 'visits'} in the last 12 months${
    usual.clientIds.length > 1
      ? `, across ${usual.clientIds.length} client records with the same email`
      : ''
  }.`
  if (usual.none === 'new' || usual.none === 'no-clear-treatment' || !usual.treatment)
    return {
      summary:
        usual.none === 'no-clear-treatment'
          ? `${name} has no clear usual: no one treatment stands out from their visits.`
          : `${name} has no usual yet: it takes three completed visits in the last 12 months.`,
      notes: [counted],
    }
  if (usual.none === 'treatment-gone')
    return {
      summary: `${name}'s usual, ${usual.treatment.name}, is no longer on the menu.`,
      notes: [counted],
    }
  const time = usual.startMinutes !== undefined && usual.weekday !== undefined
  return {
    summary: `${usualSentence(s, usual, `${name}'s`).slice(0, -1)}${
      time ? `, usually at ${timeLabel(usual.startMinutes!, s.organisation.locale)}` : ''
    }.`,
    notes: [...usual.changes.map((change) => teamChange(usual, change)), counted],
  }
}

/** Who does the treatment where a guest can book it, as the treatments skill lists them. */
function whoDoes(s: BusinessState, serviceId: string, now: string) {
  const service = s.services.find((x) => x.id === serviceId)!
  return s.staff
    .filter(
      (p) =>
        !p.archived &&
        p.serviceIds.includes(serviceId) &&
        staffPlaces(s, p.id, now).some((id) => offeredAt(service, id)),
    )
    .map((p) => ({ id: p.id, name: p.name }))
}

/** The receptionist's skill. */
export function myUsualSkill(): Skill<ReceptionContext, ReceptionEffect> {
  return readSkill<ReceptionContext, Record<string, never>>({
    name: 'my_usual',
    description:
      "The known guest's usual visit, worked out from their own completed visits in the last 12 months: the treatment, who they usually see, where, the day and part of the day they like, and the next usual day to look on. Pass its treatment, professional, location, nextDate, after and before to find_times. Says plainly when there is no clear usual, and what changed, such as someone who no longer takes bookings. Only offered when the guest is known by the number they wrote from.",
    input: z.object({}).strict(),
    allowed: (ctx) => !!ctx.guestId,
    run: (ctx) => {
      const s = ctx.state
      const usual = guestUsual(s, ctx.guestId!, ctx.today)
      const words = guestUsualWords(s, usual)
      if (usual.none || !usual.treatment) return { usual: false, ...words }
      const service = s.services.find((x) => x.id === usual.treatment!.serviceId)!
      const several = hasLocations(s)
      return {
        usual: true,
        ...words,
        treatment: { id: service.id, name: service.name },
        ...(usual.professional
          ? { professional: { id: usual.professional.staffId, name: usual.professional.name } }
          : {}),
        ...(several && usual.location
          ? { location: { id: usual.location.locationId, name: usual.location.name } }
          : {}),
        ...(usual.weekday !== undefined ? { day: weekdayName(s, usual.weekday) } : {}),
        ...(usual.partOfDay ? { partOfDay: usual.partOfDay, ...PART_TIMES[usual.partOfDay] } : {}),
        ...(usual.nextDate
          ? { nextDate: usual.nextDate, nextDay: dateLabel(usual.nextDate, s.organisation.locale) }
          : {}),
        ...(usual.onlineStop ? { onlineStop: usual.onlineStop } : {}),
        professionals: whoDoes(s, service.id, ctx.now),
        // With several locations, where it can be booked, as the treatments skill lists them.
        ...(several
          ? { locations: bookablePlaces(s, service).map((p) => ({ id: p.id, name: p.name })) }
          : {}),
      }
    },
  })
}

/** Ask SALEANE's skill, for owners, managers, general managers and reception. */
export function clientUsualSkill(
  allowed: (ctx: AskContext) => boolean,
): Skill<AskContext, Command> {
  return readSkill<AskContext, { clientId: string }>({
    name: 'client_usual',
    description:
      "One client's usual visit, from their completed visits in the last 12 months across every record with the same email: treatment, professional, location, day, part of the day, typical start time (minutes after midnight) and the next usual day. Says what changed, such as someone who has left. Use with free_times and book_visit to book their usual.",
    input: z.object({ clientId: z.string().min(1) }).strict(),
    allowed: (ctx) => allowed(ctx) && can(ctx.role, 'read'),
    run(ctx, { clientId }) {
      const s = ctx.state
      const client = s.clients.find((c) => c.id === clientId)
      if (!client) throw new SkillRefusal('There is no client with that id.')
      const usual = guestUsual(s, client.id, ctx.today)
      const words = teamUsualWords(s, usual, client.name)
      const has = !usual.none && !!usual.treatment
      return {
        clientId: client.id,
        name: client.name,
        usual: has,
        ...words,
        ...(has
          ? {
              serviceId: usual.treatment!.serviceId,
              treatment: usual.treatment!.name,
              ...(usual.professional
                ? { staffId: usual.professional.staffId, professional: usual.professional.name }
                : {}),
              ...(usual.location
                ? { locationId: usual.location.locationId, location: usual.location.name }
                : {}),
            }
          : {}),
        ...(usual.weekday !== undefined ? { day: weekdayName(s, usual.weekday) } : {}),
        ...(usual.partOfDay ? { partOfDay: usual.partOfDay } : {}),
        ...(usual.startMinutes !== undefined
          ? { startMinutes: usual.startMinutes, time: hhmm(usual.startMinutes) }
          : {}),
        ...(usual.nextDate
          ? { nextDate: usual.nextDate, nextDay: dateLabel(usual.nextDate, s.organisation.locale) }
          : {}),
        visitsCounted: usual.visits,
        records: usual.clientIds.length,
      }
    },
  })
}

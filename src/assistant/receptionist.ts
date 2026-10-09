import { z } from 'zod'
import { SkillRefusal, actionSkill, readSkill, runTurn } from '../../lumane'
import type { Allowance, BrainMessage, Skill, TurnResult, Usage } from '../../lumane'
import type { BusinessState, Service } from '../domain/model'
import { slots } from '../domain/commands'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { operations } from '../domain/operations'
import { priceSentence } from '../domain/priceSentence'
import { healthWordIn } from '../domain/forms'
import { defaultReceptionist } from '../domain/receptionistSchema'
import { visitStart } from '../domain/guest'
import {
  bookablePlaces,
  hasLocations,
  listPrice,
  serviceAt,
  staffPlaces,
} from '../domain/locations'
import { ALLOWANCES } from './saleane'
import { receptionistBrain } from './receptionistBrain'
import type { ReceptionChannel } from './receptionistBrain'

/**
 * V4: the AI receptionist, the guest-facing side of Lumane. It answers from the studio's own
 * records, finds free times, and offers one for the guest to book through the ordinary booking
 * steps. It never books, moves, cancels or takes a payment by itself, and anything it cannot
 * answer goes to the team as a message in the inbox, only once the guest says to send it. A
 * guest writing from the number on their booking can have their visit's private link sent back to
 * that number, where they move or cancel it under the studio's usual rules.
 */

export type ReceptionContext = {
  /** The studio record with times other guests are holding taken out. */
  state: BusinessState
  today: string
  now: string
  sample: boolean
  handOver: boolean
  /**
   * The client writing, only when the server knows it for sure: a text or WhatsApp message from
   * the one number on their record. Nobody else can see or change a visit through the receptionist.
   */
  guestId?: string
}

/** What the guest can say yes to: a time to book, or a message for the team. */
export type ReceptionEffect =
  | { kind: 'time'; serviceId: string; staffId: string; date: string; startMinutes: number }
  | { kind: 'message'; name: string; contact: string; message: string }
  /** Send the guest the private link to their own visit, to the number they wrote from. */
  | { kind: 'manage'; appointmentId: string }

/** How far ahead the receptionist looks for free times. */
export const LOOK_AHEAD_DAYS = 90
/** The most one chat message could cost with a real AI, in pence or cents. */
export const CHAT_WORST_CASE_MINOR = 4
export const CHAT_HISTORY_TURNS = 8

export const RECEPTION_INSTRUCTIONS = `You are the AI receptionist for a beauty, spa or wellness studio, chatting with a guest on its booking page.
Say you are an AI if asked, and never pretend to be a person. Write in warm, plain British English. Keep it short.
Only state facts the skills return: treatments, prices, opening hours and free times. Never guess.
You cannot book, move or cancel a visit or take a payment. You can offer a free time, which the guest finishes booking on the page.
When the guest is known, you can send them the private link to one of their own visits, where they move or cancel it themselves.
Never give health or medical advice and never ask about health. Offer to pass a message to the team instead.
Never share anything about other guests.`

export const isOn = (s: BusinessState) =>
  (operations(s).receptionist ?? defaultReceptionist).enabled && operations(s).bookingEnabled
/** Whether it also answers texts to the studio's line. */
export const answersTexts = (s: BusinessState) =>
  isOn(s) && !!(operations(s).receptionist ?? defaultReceptionist).texts
/** Whether it also answers messages to the studio's Instagram, Facebook and WhatsApp. */
export const answersSocial = (s: BusinessState) =>
  isOn(s) && !!(operations(s).receptionist ?? defaultReceptionist).social

export function receptionContext(
  state: BusinessState,
  today: string,
  now: string,
  guestId?: string,
): ReceptionContext {
  const settings = operations(state).receptionist ?? defaultReceptionist
  return {
    state,
    today,
    now,
    sample: operations(state).mode === 'sandbox',
    handOver: settings.handOver,
    ...(guestId ? { guestId } : {}),
  }
}

/** How many of a guest's coming visits the receptionist lists. */
export const VISITS_LISTED = 5
/** The known guest's own visits still to come, soonest first. */
function comingVisits(ctx: ReceptionContext) {
  const now = Date.parse(ctx.now)
  return ctx.state.appointments
    .filter((a) => a.clientId === ctx.guestId && a.status === 'confirmed')
    .map((a) => ({ a, start: visitStart(ctx.state, a.id) }))
    .filter((v) => v.start > now)
    .sort((x, y) => x.start - y.start)
}
/** One visit in the receptionist's words. The outbox checks it again before a link goes with it. */
export function visitSummary(state: BusinessState, a: BusinessState['appointments'][number]) {
  const service =
    state.services.find((x) => x.id === a.serviceId)?.name ?? a.bookedServiceName ?? 'Visit'
  const person = state.staff.find((p) => p.id === a.staffId)?.name
  const locale = state.organisation.locale
  return `${service}${person ? ` with ${person}` : ''}, ${dateLabel(a.date, locale)} at ${timeLabel(a.startMinutes, locale)}`
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const services = (s: BusinessState) => s.services.filter((x) => !x.archived)
const team = (s: BusinessState) => s.staff.filter((p) => !p.archived)
const day = (ctx: ReceptionContext, date: string) => dateLabel(date, ctx.state.organisation.locale)
const clock = (ctx: ReceptionContext, minutes: number) =>
  timeLabel(minutes, ctx.state.organisation.locale)

/**
 * A treatment's price in one sentence, at one location's price. `from` marks the lowest of
 * several, which the sentence then says.
 */
function priceFor(ctx: ReceptionContext, x: Service, priceMinor: number, from = false) {
  const said = priceSentence(
    { ...x, priceMinor, depositMinor: ctx.sample ? x.depositMinor : 0 },
    ctx.state.organisation,
    { tax: operations(ctx.state).tax, simulated: ctx.sample },
  )
  return from ? `From ${said[0].toLowerCase()}${said.slice(1)}` : said
}

function treatment(ctx: ReceptionContext, id: string) {
  const service = services(ctx.state).find((x) => x.id === id)
  if (!service) throw new SkillRefusal('That treatment is not on the menu.')
  return service
}
function professional(ctx: ReceptionContext, serviceId: string, id?: string) {
  if (!id || id === 'any') return null
  const person = team(ctx.state).find((p) => p.id === id)
  if (!person || !person.serviceIds.includes(serviceId))
    throw new SkillRefusal('That person does not offer this treatment.')
  return person
}
function bookableDate(ctx: ReceptionContext, date: string) {
  if (date < ctx.today) throw new SkillRefusal('That date has passed.')
  if (date > addDays(ctx.today, LOOK_AHEAD_DAYS))
    throw new SkillRefusal(`I can look up to ${LOOK_AHEAD_DAYS} days ahead.`)
}
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

const isoDate = z.iso.date()
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const contactPattern = /^(\+?[\d\s().-]{7,20}|[^\s@]+@[^\s@]+\.[^\s@]+)$/

export function receptionistSkills(): Skill<ReceptionContext, ReceptionEffect>[] {
  return [
    readSkill<ReceptionContext, { search?: string }>({
      name: 'treatments',
      description:
        'The treatments the studio offers: name, kind, what it is, length, full price and who does it. With several locations, also each location that offers it and its price there; the price shown first is the lowest of them. Optionally narrowed by a word.',
      input: z.object({ search: z.string().max(60).optional() }).strict(),
      allowed: () => true,
      run: (ctx, { search }) => {
        const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        const several = hasLocations(ctx.state)
        return (
          services(ctx.state)
            .filter((x) => words.every((w) => `${x.name} ${x.category}`.toLowerCase().includes(w)))
            // V2: only what a guest can book: on the menu at an open location, with someone there.
            .map((x) => ({ x, where: bookablePlaces(ctx.state, x) }))
            .filter(({ where }) => where.length > 0)
            .slice(0, 20)
            .map(({ x, where }) => {
              const { priceMinor, from } = listPrice(
                x,
                where.map((p) => p.id),
              )
              return {
                id: x.id,
                name: x.name,
                kind: x.category,
                about: x.description,
                durationMinutes: x.durationMinutes,
                price: priceFor(ctx, x, priceMinor, from),
                ...(several
                  ? {
                      locations: where.map((p) => ({
                        id: p.id,
                        name: p.name,
                        price: priceFor(ctx, x, serviceAt(x, p.id).priceMinor),
                      })),
                    }
                  : {}),
                professionals: team(ctx.state)
                  .filter(
                    (p) =>
                      p.serviceIds.includes(x.id) &&
                      staffPlaces(ctx.state, p.id).some((id) => where.some((w) => w.id === id)),
                  )
                  .map((p) => ({ id: p.id, name: p.name })),
              }
            })
        )
      },
    }),
    readSkill<ReceptionContext, Record<string, never>>({
      name: 'studio_info',
      description:
        "The studio's name, address, opening hours for each day of the week, and days it is closed in the next month.",
      input: z.object({}).strict(),
      allowed: () => true,
      run: (ctx) => {
        const o = operations(ctx.state)
        const weekday = (n: number) =>
          new Intl.DateTimeFormat(ctx.state.organisation.locale, {
            weekday: 'long',
            timeZone: 'UTC',
          }).format(new Date(Date.UTC(2026, 0, 4 + n)))
        const soon = addDays(ctx.today, 31)
        return {
          name: ctx.state.organisation.name,
          address: ctx.state.organisation.address || null,
          hours: [1, 2, 3, 4, 5, 6, 0].map((n) => {
            const h = o.hours.find((x) => x.day === n)
            return {
              day: weekday(n),
              open: h && !h.closed ? `${clock(ctx, h.open)} to ${clock(ctx, h.close)}` : 'Closed',
            }
          }),
          closedDays: [
            ...new Set(
              o.closures
                .filter((c) => !c.staffId && c.date >= ctx.today && c.date <= soon)
                .map((c) => day(ctx, c.date)),
            ),
          ],
          bookingOpen: o.bookingEnabled,
        }
      },
    }),
    readSkill<ReceptionContext, { treatmentId: string; date: string; professionalId?: string }>({
      name: 'find_times',
      description:
        'Free start times for one treatment on one date, with anyone or with one professional.',
      input: z
        .object({
          treatmentId: z.string().min(1).max(150),
          date: isoDate,
          professionalId: z.string().min(1).max(150).optional(),
        })
        .strict(),
      allowed: () => true,
      run: (ctx, input) => {
        const service = treatment(ctx, input.treatmentId)
        const person = professional(ctx, service.id, input.professionalId)
        bookableDate(ctx, input.date)
        const times = slots(ctx.state, service.id, person?.id ?? 'any', input.date, ctx.now)
        return {
          treatment: service.name,
          professional: person?.name ?? 'anyone',
          date: input.date,
          day: day(ctx, input.date),
          times: times.slice(0, 12).map((m) => ({ time: hhmm(m), label: clock(ctx, m) })),
          more: Math.max(0, times.length - 12),
        }
      },
    }),
    actionSkill<
      ReceptionContext,
      { treatmentId: string; date: string; time: string; professionalId?: string },
      ReceptionEffect
    >({
      name: 'offer_time',
      description:
        'Offer the guest one free time to book. They finish booking on the page with their details; nothing is booked until they confirm there.',
      input: z
        .object({
          treatmentId: z.string().min(1).max(150),
          date: isoDate,
          time,
          professionalId: z.string().min(1).max(150).optional(),
        })
        .strict(),
      allowed: () => true,
      propose: (ctx, input) => {
        const service = treatment(ctx, input.treatmentId)
        const person = professional(ctx, service.id, input.professionalId)
        bookableDate(ctx, input.date)
        const start = minutes(input.time)
        if (!slots(ctx.state, service.id, person?.id ?? 'any', input.date, ctx.now).includes(start))
          throw new SkillRefusal('That time is not free. Look for another.')
        return {
          summary: `${service.name}${person ? ` with ${person.name}` : ''}, ${day(ctx, input.date)} at ${clock(ctx, start)}`,
          effect: {
            kind: 'time',
            serviceId: service.id,
            staffId: person?.id ?? 'any',
            date: input.date,
            startMinutes: start,
          },
        }
      },
    }),
    actionSkill<
      ReceptionContext,
      { name: string; contact: string; message: string },
      ReceptionEffect
    >({
      name: 'pass_to_team',
      description:
        "Prepare a message for the studio's team, with the guest's name and an email or phone number to answer on. The guest sends it.",
      input: z
        .object({
          name: z.string().trim().min(2).max(100),
          contact: z.string().trim().min(5).max(200),
          message: z.string().trim().min(2).max(1000),
        })
        .strict(),
      allowed: (ctx) => ctx.handOver,
      propose: (_ctx, input) => {
        if (!contactPattern.test(input.contact))
          throw new SkillRefusal('Ask for an email address or a phone number to answer on.')
        if (healthWordIn(`${input.message}`))
          throw new SkillRefusal(
            'Messages here cannot hold health details. Ask the guest to leave them out; the team will ask what they need.',
          )
        return {
          summary: `Send to the team: “${input.message}” from ${input.name}, to answer on ${input.contact}`,
          effect: { kind: 'message', ...input },
        }
      },
    }),
    readSkill<ReceptionContext, Record<string, never>>({
      name: 'my_visits',
      description:
        "The guest's own coming visits, soonest first. Only offered when the guest is known by the number they wrote from.",
      input: z.object({}).strict(),
      allowed: (ctx) => !!ctx.guestId,
      run: (ctx) =>
        comingVisits(ctx)
          .slice(0, VISITS_LISTED)
          .map(({ a }) => ({ id: a.id, date: a.date, summary: visitSummary(ctx.state, a) })),
    }),
    actionSkill<ReceptionContext, { visitId: string }, ReceptionEffect>({
      name: 'send_manage_link',
      description:
        "Send the guest the private link to one of their own coming visits, to the number they wrote from. They move or cancel it there under the studio's usual rules.",
      input: z.object({ visitId: z.string().min(1).max(150) }).strict(),
      allowed: (ctx) => !!ctx.guestId,
      propose: (ctx, { visitId }) => {
        const visit = comingVisits(ctx).find(({ a }) => a.id === visitId)
        if (!visit) throw new SkillRefusal('That is not one of this guest’s coming visits.')
        return {
          summary: visitSummary(ctx.state, visit.a),
          effect: { kind: 'manage', appointmentId: visit.a.id },
        }
      },
    }),
  ]
}

export type ReceptionTurn = { from: 'guest' | 'receptionist'; text: string }

export type ReceptionInput = {
  state: BusinessState
  today: string
  now: string
  /** Who is chatting: the visitor's own anonymous id, for the hourly limit. */
  visitorId: string
  text: string
  history?: ReceptionTurn[]
  /** The booking page's chat (the default) or a text to the studio's line. */
  channel?: ReceptionChannel
  /** True for a later message in a chat already counted against the month's guest chats. */
  continuing?: boolean
  /** The client writing, when the server matched the number they wrote from to their record. */
  guestId?: string
  usage: Usage | undefined
  allowance?: Allowance
}

/**
 * One guest message to the receptionist. Only the test-mode brain exists so far: it calls no AI
 * supplier, costs nothing and sends nothing.
 */
export function askReceptionist(input: ReceptionInput): Promise<TurnResult<ReceptionEffect>> {
  const ctx = receptionContext(input.state, input.today, input.now, input.guestId)
  return runTurn({
    brain: receptionistBrain(ctx.today, input.state.organisation.locale, input.channel),
    skills: receptionistSkills(),
    ctx,
    instructions: RECEPTION_INSTRUCTIONS,
    history: (input.history ?? [])
      .slice(-CHAT_HISTORY_TURNS)
      .map((turn): BrainMessage =>
        turn.from === 'guest'
          ? { role: 'user', text: turn.text.slice(0, 1000) }
          : { role: 'assistant', text: turn.text.slice(0, 2000), calls: [] },
      ),
    text: input.text,
    meter: {
      allowance: input.allowance ?? ALLOWANCES.included,
      usage: input.usage,
      personId: input.visitorId,
      at: input.now,
      kind: 'guestChats',
      amount: input.continuing ? 0 : 1,
      worstCaseMinor: CHAT_WORST_CASE_MINOR,
    },
  }) as Promise<TurnResult<ReceptionEffect>>
}

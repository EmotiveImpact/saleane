import { roomWithPlace } from './locations'
import { clockedIn, hoursPeriod } from './hours'
import { z } from 'zod'
import { appointmentSchema, organisationSchema } from './model'
import type { Appointment, BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays } from './format'
import { ownRating } from './feedback'
import { clearFrom, patchTests, visitPatchTest } from './patchTests'
import { answerText, versionOf, visitForms } from './forms'
import { visitConsultation } from './consultations'
import { ownPlan } from './rota'
import { targetProgress } from './pay'
import { milestoneLine, visitMilestones } from './beforeVisit'

/**
 * LOCAL-01: what an assigned practitioner may read and change.
 *
 * Read: their own visits from two weeks back to four weeks ahead, and for the clients in those
 * visits only a name, service preferences, relationship notes and the date and treatment of
 * their last completed visit with this practitioner. No email, phone, consent,
 * prices, deposits, receipts, payments, other professionals' diaries, catalogue or settings.
 * Write: welcome their own client on the day (`arrive`) and add a note for a client they serve.
 * V1.5: see and record patch tests for the clients in their visits, as the one who did them.
 * Stage 3: their own monthly target and how far they are towards it, when they have one; never
 * anyone else's, and never their rates or what they have earned.
 * Everything else stays with reception, managers and owners.
 */
export const PRACTITIONER_DAYS_BEFORE = 14
export const PRACTITIONER_DAYS_AFTER = 28
export const PRACTITIONER_NOTES = 20
export const PRACTITIONER_PATCH_TESTS = 5
const PRACTITIONER_COMMANDS = [
  'arrive',
  'note',
  'visit-write-up',
  'patch-test',
  'patch-test-result',
  'clock-in',
  'clock-out',
] as const

const id = z.string().min(1)
export const practitionerViewSchema = z
  .object({
    view: z.literal('practitioner'),
    revision: z.number().int().nonnegative(),
    today: z.iso.date(),
    window: z.object({ from: z.iso.date(), to: z.iso.date() }).strict(),
    organisation: organisationSchema
      .pick({
        id: true,
        name: true,
        region: true,
        locale: true,
        timeZone: true,
        locationName: true,
      })
      .strict(),
    staff: z.object({ id, name: z.string(), role: z.string() }).strict(),
    /** NEXT-07: their own clock: when they clocked in, while they are in, and today's hours. */
    hours: z
      .object({
        since: z.iso.datetime().nullable(),
        todayMinutes: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    /**
     * Stage 3: their own days as planned, across the window: hours and where, and whether the
     * rota changed the day from their usual week. Nobody else's days, and no notes.
     */
    plan: z
      .array(
        z
          .object({
            date: z.iso.date(),
            working: z.boolean(),
            open: z.number().int().min(0).max(1440).optional(),
            close: z.number().int().min(0).max(1440).optional(),
            place: z.string().optional(),
            change: z.enum(['hours', 'extra', 'off']).optional(),
            away: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(PRACTITIONER_DAYS_BEFORE + PRACTITIONER_DAYS_AFTER + 1)
      .optional(),
    /** V1.5: how guests rate this practitioner, as an average only and never single answers. */
    rating: z
      .object({ count: z.number().int().nonnegative(), average: z.number().nullable() })
      .strict()
      .optional(),
    /** Stage 3: their own target for this month and their takings towards it so far. */
    target: z
      .object({
        month: z.string(),
        currency: z.enum(['GBP', 'USD']),
        targetMinor: z.number().int().nonnegative(),
        takenMinor: z.number().int(),
        treatmentsTargetMinor: z.number().int().nonnegative().optional(),
        productsTargetMinor: z.number().int().nonnegative().optional(),
        treatmentsMinor: z.number().int(),
        productsMinor: z.number().int(),
      })
      .strict()
      .optional(),
    appointments: z.array(
      z
        .object({
          id,
          clientId: id,
          serviceName: z.string(),
          resourceName: z.string(),
          date: z.iso.date(),
          startMinutes: z.number().int().min(0).max(1439),
          durationMinutes: z.number().int().positive(),
          bufferMinutes: z.number().int().nonnegative(),
          status: appointmentSchema.shape.status,
          /** V1.5: the guest tapped "I've arrived" and has not been welcomed yet. */
          guestHere: z.literal(true).optional(),
          /**
           * Stage 6: one quiet milestone for an upcoming visit ("Amelia’s tenth visit."), counted
           * from the visits the guest came to. A sentence only, never the visits behind it.
           */
          moment: z.string().max(200).optional(),
          /** NEXT-16: their own aftercare for this visit, sent with its aftercare email. */
          aftercare: z.string().optional(),
          /** V1.5: for a treatment that needs one, where the guest's patch test stands. */
          patchTest: z
            .object({
              state: z.enum(['clear', 'waiting', 'too-close', 'reaction', 'needed']),
              label: z.string(),
            })
            .strict()
            .nullable(),
          /**
           * V1.5: what the guest said on the studio's forms for an upcoming visit: questions and
           * answers only, not the name they typed to agree.
           */
          forms: z
            .array(
              z
                .object({
                  title: z.string(),
                  answers: z
                    .array(z.object({ question: z.string(), answer: z.string() }).strict())
                    .max(20),
                })
                .strict(),
            )
            .optional(),
          /** V1.5: what was agreed at the consultation this visit was booked from. */
          consultation: z
            .object({
              heldOn: z.iso.date(),
              version: z.number().int(),
              wants: z.string(),
              plan: z.string(),
              changedSince: z.boolean(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    clients: z.array(
      z
        .object({
          id,
          name: z.string(),
          preferences: z.string(),
          // Pocket view: "Last time with you" before a treatment. The visit window only reaches
          // two weeks back and regulars often return every four to eight weeks, so the window alone
          // would usually miss it. Only this practitioner's own completed visits count, and only
          // a date and treatment name leave the server: no room, price, receipt or other
          // professional's visit. Null when they have not completed a visit together.
          previousVisit: z
            .object({ date: z.iso.date(), serviceName: z.string() })
            .strict()
            .nullable(),
          notes: z.array(
            z
              .object({ id, detail: z.string(), occurredAt: z.iso.datetime(), actor: z.string() })
              .strict(),
          ),
          /** V1.5: the client's latest patch tests: what, when and the result, nothing more. */
          patchTests: z.array(
            z
              .object({
                id,
                testedAt: z.iso.datetime(),
                product: z.string(),
                outcome: z.enum(['clear', 'reaction']).nullable(),
                /** Whether this practitioner did the test, so they can record its result. */
                yours: z.boolean(),
                /** The earliest moment the test can be called clear. */
                clearFrom: z.iso.datetime(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
export type PractitionerView = z.infer<typeof practitionerViewSchema>

function windowFor(today: string) {
  return {
    from: addDays(today, -PRACTITIONER_DAYS_BEFORE),
    to: addDays(today, PRACTITIONER_DAYS_AFTER),
  }
}
function assigned(s: BusinessState, staffId: string, today: string) {
  const { from, to } = windowFor(today)
  return s.appointments.filter((a) => a.staffId === staffId && a.date >= from && a.date <= to)
}

/** The answers a guest gave on forms for an upcoming visit, for the person looking after them. */
function formsForVisit(s: BusinessState, a: Appointment) {
  if (a.status !== 'confirmed' && a.status !== 'arrived') return {}
  const forms = visitForms(s, a).flatMap(({ form, answer }) => {
    if (!answer) return []
    const content = versionOf(form, answer.version)!.content
    return [
      {
        title: content.title,
        answers: content.questions.flatMap((q) => {
          const value = answer.answers.find((x) => x.questionId === q.id)?.value
          return value ? [{ question: q.label, answer: answerText(value, q.kind) }] : []
        }),
      },
    ]
  })
  return forms.length ? { forms } : {}
}

/** Stage 6: the first milestone of a visit still to come, as one sentence, or nothing. */
function momentFor(s: BusinessState, a: Appointment) {
  if (a.status !== 'confirmed' && a.status !== 'arrived') return {}
  const first = visitMilestones(s, a)[0]
  const name = s.clients.find((c) => c.id === a.clientId)?.name.split(' ')[0]
  return first && name
    ? { moment: milestoneLine(first, name, { visitDate: a.date, locale: s.organisation.locale }) }
    : {}
}

/** Builds the practitioner's read model from the studio record. The server is the only caller. */
export function practitionerView(
  s: BusinessState,
  staffId: string,
  today: string,
  now = Date.now(),
): PractitionerView {
  const person = s.staff.find((p) => p.id === staffId && !p.archived)
  if (!person) throw new Error('This practitioner is not an active professional in the studio.')
  const visits = assigned(s, staffId, today).sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes,
  )
  const clientIds = new Set(visits.map((a) => a.clientId))
  const serviceName = (a: BusinessState['appointments'][number]) =>
    a.bookedServiceName ??
    s.services.find((service) => service.id === a.serviceId)?.name ??
    'Treatment'
  /** The latest visit this practitioner completed with the client before today, if any. */
  const previousVisit = (clientId: string) => {
    const done = s.appointments
      .filter(
        (a) =>
          a.staffId === staffId &&
          a.clientId === clientId &&
          a.status === 'completed' &&
          a.date < today,
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)[0]
    return done ? { date: done.date, serviceName: serviceName(done) } : null
  }
  const patchFor = (a: BusinessState['appointments'][number]) => {
    const standing = visitPatchTest(s, a)
    return standing ? { state: standing.state, label: standing.label } : null
  }
  return practitionerViewSchema.parse({
    view: 'practitioner',
    revision: s.revision,
    today,
    window: windowFor(today),
    organisation: {
      id: s.organisation.id,
      name: s.organisation.name,
      region: s.organisation.region,
      locale: s.organisation.locale,
      timeZone: s.organisation.timeZone,
      locationName: s.organisation.locationName,
    },
    staff: { id: person.id, name: person.name, role: person.role },
    hours: {
      since: clockedIn(s, staffId, now)?.start ?? null,
      todayMinutes: hoursPeriod(s, today, today).get(staffId)?.minutes ?? 0,
    },
    plan: ownPlan(s, staffId, windowFor(today).from, windowFor(today).to),
    rating: ownRating(s, staffId),
    ...(() => {
      const target = targetProgress(s, staffId, today.slice(0, 7), today)
      return target ? { target: { ...target, currency: s.organisation.currency } } : {}
    })(),
    appointments: visits.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      serviceName: serviceName(a),
      resourceName: roomWithPlace(s, a),
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      bufferMinutes: a.bookedBufferMinutes,
      status: a.status,
      ...(a.status === 'confirmed' && a.guestHereAt ? { guestHere: true as const } : {}),
      ...momentFor(s, a),
      ...(a.aftercare ? { aftercare: a.aftercare.text } : {}),
      patchTest: patchFor(a),
      ...formsForVisit(s, a),
      ...(() => {
        const carried = visitConsultation(s, a)
        return carried
          ? {
              consultation: {
                heldOn: carried.consultation.heldOn,
                version: carried.version.version,
                wants: carried.version.wants,
                plan: carried.version.plan,
                changedSince: carried.changedSince,
              },
            }
          : {}
      })(),
    })),
    clients: s.clients
      .filter((c) => clientIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        preferences: c.preferences,
        previousVisit: previousVisit(c.id),
        notes: s.events
          .filter((e) => e.clientId === c.id && e.type === 'note')
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, PRACTITIONER_NOTES)
          .map((e) => ({ id: e.id, detail: e.detail, occurredAt: e.occurredAt, actor: e.actor })),
        patchTests: patchTests(s)
          .filter((t) => t.clientId === c.id)
          .sort((a, b) => b.testedAt.localeCompare(a.testedAt))
          .slice(0, PRACTITIONER_PATCH_TESTS)
          .map((t) => ({
            id: t.id,
            testedAt: t.testedAt,
            product: t.product,
            outcome: t.result?.outcome ?? null,
            yours: t.staffId === staffId,
            clearFrom: clearFrom(s, t.testedAt),
          })),
      })),
  })
}

/**
 * The scope check the server runs after the role permission check. Returns a refusal message,
 * or null when the command only touches this practitioner's own visit or client.
 */
export function practitionerRefusal(
  s: BusinessState,
  staffId: string,
  command: Command,
  today: string,
): string | null {
  if (!(PRACTITIONER_COMMANDS as readonly string[]).includes(command.type))
    return 'Your role cannot make this change.'
  const visits = assigned(s, staffId, today)
  if (command.type === 'arrive')
    return visits.some((a) => a.id === command.appointmentId)
      ? null
      : 'This visit is not assigned to you.'
  // NEXT-16: only for their own visits, and only once the guest has come in.
  if (command.type === 'visit-write-up') {
    const visit = visits.find((a) => a.id === command.appointmentId)
    if (!visit) return 'This visit is not assigned to you.'
    return visit.status === 'arrived' || visit.status === 'completed'
      ? null
      : 'Write up a visit once the guest has arrived.'
  }
  if (command.type === 'note')
    return visits.some((a) => a.clientId === command.clientId)
      ? null
      : 'This client is not in your assigned visits.'
  if (command.type === 'patch-test') {
    if (!visits.some((a) => a.clientId === command.input.clientId))
      return 'This client is not in your assigned visits.'
    return command.input.staffId === staffId ? null : 'Record only the patch tests you did.'
  }
  if (command.type === 'clock-in' || command.type === 'clock-out')
    return command.staffId === staffId ? null : 'Clock in and out only for yourself.'
  if (command.type === 'patch-test-result') {
    const test = patchTests(s).find((t) => t.id === command.patchTestId)
    if (!test || !visits.some((a) => a.clientId === test.clientId))
      return 'This client is not in your assigned visits.'
    return test.staffId === staffId ? null : 'Record results only for the patch tests you did.'
  }
  return 'Your role cannot make this change.'
}

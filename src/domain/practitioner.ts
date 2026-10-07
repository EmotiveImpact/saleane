import { z } from 'zod'
import { appointmentSchema, organisationSchema } from './model'
import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays } from './format'
import { ownRating } from './feedback'
import { clearFrom, patchTests, visitPatchTest } from './patchTests'

/**
 * LOCAL-01: what an assigned practitioner may read and change.
 *
 * Read: their own visits from two weeks back to four weeks ahead, and for the clients in those
 * visits only a name, service preferences, relationship notes and the date and treatment of
 * their last completed visit with this practitioner. No email, phone, consent,
 * prices, deposits, receipts, payments, other professionals' diaries, catalogue or settings.
 * Write: welcome their own client on the day (`arrive`) and add a note for a client they serve.
 * V1.5: see and record patch tests for the clients in their visits, as the one who did them.
 * Everything else stays with reception, managers and owners.
 */
export const PRACTITIONER_DAYS_BEFORE = 14
export const PRACTITIONER_DAYS_AFTER = 28
export const PRACTITIONER_NOTES = 20
export const PRACTITIONER_PATCH_TESTS = 5
const PRACTITIONER_COMMANDS = ['arrive', 'note', 'patch-test', 'patch-test-result'] as const

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
    /** V1.5: how guests rate this practitioner, as an average only and never single answers. */
    rating: z
      .object({ count: z.number().int().nonnegative(), average: z.number().nullable() })
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
          /** V1.5: for a treatment that needs one, where the guest's patch test stands. */
          patchTest: z
            .object({
              state: z.enum(['clear', 'waiting', 'too-close', 'reaction', 'needed']),
              label: z.string(),
            })
            .strict()
            .nullable(),
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

/** Builds the practitioner's read model from the studio record. The server is the only caller. */
export function practitionerView(
  s: BusinessState,
  staffId: string,
  today: string,
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
    'Service'
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
    rating: ownRating(s, staffId),
    appointments: visits.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      serviceName: serviceName(a),
      resourceName: s.resources.find((r) => r.id === a.resourceId)?.name ?? '',
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      bufferMinutes: a.bookedBufferMinutes,
      status: a.status,
      patchTest: patchFor(a),
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
  if (command.type === 'note')
    return visits.some((a) => a.clientId === command.clientId)
      ? null
      : 'This client is not in your assigned visits.'
  if (command.type === 'patch-test') {
    if (!visits.some((a) => a.clientId === command.input.clientId))
      return 'This client is not in your assigned visits.'
    return command.input.staffId === staffId ? null : 'Record only the patch tests you did.'
  }
  if (command.type === 'patch-test-result') {
    const test = patchTests(s).find((t) => t.id === command.patchTestId)
    if (!test || !visits.some((a) => a.clientId === test.clientId))
      return 'This client is not in your assigned visits.'
    return test.staffId === staffId ? null : 'Record results only for the patch tests you did.'
  }
  return 'Your role cannot make this change.'
}

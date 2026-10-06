import { z } from 'zod'
import { appointmentSchema, organisationSchema } from './model'
import type { BusinessState } from './model'
import type { Command } from './commandSchema'
import { addDays } from './format'

/**
 * LOCAL-01: what an assigned practitioner may read and change.
 *
 * Read: their own visits from two weeks back to four weeks ahead, and for the clients in those
 * visits only a name, service preferences and relationship notes. No email, phone, consent,
 * prices, deposits, receipts, payments, other professionals' diaries, catalogue or settings.
 * Write: welcome their own client on the day (`arrive`) and add a note for a client they serve.
 * Everything else stays with reception, managers and owners.
 */
export const PRACTITIONER_DAYS_BEFORE = 14
export const PRACTITIONER_DAYS_AFTER = 28
export const PRACTITIONER_NOTES = 20
const PRACTITIONER_COMMANDS = ['arrive', 'note'] as const

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
        })
        .strict(),
    ),
    clients: z.array(
      z
        .object({
          id,
          name: z.string(),
          preferences: z.string(),
          notes: z.array(
            z
              .object({ id, detail: z.string(), occurredAt: z.iso.datetime(), actor: z.string() })
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
    appointments: visits.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      serviceName:
        a.bookedServiceName ??
        s.services.find((service) => service.id === a.serviceId)?.name ??
        'Service',
      resourceName: s.resources.find((r) => r.id === a.resourceId)?.name ?? '',
      date: a.date,
      startMinutes: a.startMinutes,
      durationMinutes: a.bookedDurationMinutes,
      bufferMinutes: a.bookedBufferMinutes,
      status: a.status,
    })),
    clients: s.clients
      .filter((c) => clientIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        preferences: c.preferences,
        notes: s.events
          .filter((e) => e.clientId === c.id && e.type === 'note')
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, PRACTITIONER_NOTES)
          .map((e) => ({ id: e.id, detail: e.detail, occurredAt: e.occurredAt, actor: e.actor })),
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
  return 'Your role cannot make this change.'
}

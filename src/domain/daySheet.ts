import { roomWithPlace } from './locations'
import { z } from 'zod'
import { appointmentSchema, organisationSchema } from './model'
import type { BusinessState } from './model'
import { businessDate, hoursFor, instantFor } from './operations'
import type { Role } from './operations'
import { addDays } from './format'

/**
 * OFF-01: the read-only day sheet a signed-in member may keep while the studio is offline.
 *
 * Owner, manager and reception: today's visits for the studio with the time, service,
 * professional, room, status, client name and phone. A practitioner: only their own visits, with
 * the client's name and no phone (their LOCAL-01 scope). Never email, consent, prices, deposits,
 * receipts, payments, notes, exports or marketing lists. Cancelled visits are left out.
 *
 * The sheet expires at the venue's closing time today (or the end of the day once closed), and
 * never more than DAY_SHEET_MAX_HOURS after it was made. Revoking access on the server cannot
 * reach a copy already held offline before it expires; reconnecting replaces or clears it.
 */
export const DAY_SHEET_MAX_HOURS = 12

const id = z.string().min(1)
const visitSchema = z
  .object({
    id,
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().positive(),
    serviceName: z.string(),
    professionalName: z.string(),
    roomName: z.string(),
    status: appointmentSchema.shape.status.exclude(['cancelled']),
    clientName: z.string(),
    clientPhone: z.string().optional(),
  })
  .strict()
export const daySheetSchema = z
  .object({
    view: z.literal('day-sheet'),
    audience: z.enum(['studio', 'practitioner']),
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
    professional: z.object({ id, name: z.string() }).strict().optional(),
    date: z.iso.date(),
    generatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    visits: z.array(visitSchema),
  })
  .strict()
  .refine(
    (sheet) =>
      sheet.audience === 'studio' || sheet.visits.every((v) => v.clientPhone === undefined),
    'A practitioner day sheet never carries client phone numbers.',
  )
  .refine(
    (sheet) =>
      Date.parse(sheet.expiresAt) > Date.parse(sheet.generatedAt) &&
      Date.parse(sheet.expiresAt) - Date.parse(sheet.generatedAt) <= DAY_SHEET_MAX_HOURS * 3600000,
    'A day sheet must expire within its bounded window.',
  )
export type DaySheet = z.infer<typeof daySheetSchema>
export type DaySheetReader = { role: Role; staffId: string | null }

/** Closing time today, or the end of the civil day once closed, capped at the maximum window. */
export function daySheetExpiry(s: BusinessState, date: string, now: string) {
  const made = Date.parse(now)
  const cap = made + DAY_SHEET_MAX_HOURS * 3600000
  const at = (day: string, minute: number) => {
    try {
      return Date.parse(instantFor(s, day, minute))
    } catch {
      return Number.NaN
    }
  }
  const hours = hoursFor(s, date)
  const closing = hours.closed || hours.close >= 1440 ? Number.NaN : at(date, hours.close)
  const midnight = at(addDays(date, 1), 0)
  // The fictional sandbox keeps a fixed date, so its closing time may already have passed.
  const end = [closing, midnight].find((value) => Number.isFinite(value) && value > made) ?? cap
  return new Date(Math.min(end, cap)).toISOString()
}

/** Builds the reader's day sheet from the studio record. The server is the only caller for signed-in studios. */
export function daySheet(s: BusinessState, reader: DaySheetReader, now: string): DaySheet {
  const date = businessDate(s, now)
  const practitioner = reader.role === 'practitioner'
  const person = practitioner
    ? s.staff.find((p) => p.id === reader.staffId && !p.archived)
    : undefined
  if (practitioner && !person)
    throw new Error('This practitioner is not an active professional in the studio.')
  const visits = s.appointments
    .filter(
      (a) =>
        a.date === date && a.status !== 'cancelled' && (!practitioner || a.staffId === person!.id),
    )
    .map((a) => {
      const client = s.clients.find((c) => c.id === a.clientId)
      return {
        id: a.id,
        startMinutes: a.startMinutes,
        endMinutes: a.startMinutes + a.bookedDurationMinutes,
        serviceName:
          a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? 'Service',
        professionalName: s.staff.find((p) => p.id === a.staffId)?.name ?? '',
        roomName: roomWithPlace(s, a),
        status: a.status as Exclude<typeof a.status, 'cancelled'>,
        clientName: client?.name ?? 'Client',
        ...(practitioner ? {} : { clientPhone: client?.phone ?? '' }),
      }
    })
    .sort(
      (a, b) =>
        a.startMinutes - b.startMinutes || a.professionalName.localeCompare(b.professionalName),
    )
  return daySheetSchema.parse({
    view: 'day-sheet',
    audience: practitioner ? 'practitioner' : 'studio',
    organisation: {
      id: s.organisation.id,
      name: s.organisation.name,
      region: s.organisation.region,
      locale: s.organisation.locale,
      timeZone: s.organisation.timeZone,
      locationName: s.organisation.locationName,
    },
    ...(person ? { professional: { id: person.id, name: person.name } } : {}),
    date,
    generatedAt: new Date(Date.parse(now)).toISOString(),
    expiresAt: daySheetExpiry(s, date, now),
    visits,
  })
}

import type { Appointment, BusinessState, Client } from '../domain/model'
import { composeClientMessage, composeMessage } from '../domain/reminders'

/**
 * NEXT-13: the emails a studio can look at before any guest gets one, written by the same
 * functions as the real ones, for a made-up guest on the studio's own first treatment with its
 * first professional, tomorrow at 10:00.
 */
export const sampleKinds = ['confirmation', 'reminder', 'feedback', 'birthday'] as const
export type SampleKind = (typeof sampleKinds)[number]
export const sampleKindLabel: Record<SampleKind, string> = {
  confirmation: 'Booking confirmation',
  reminder: 'Reminder',
  feedback: 'After the visit',
  birthday: 'Birthday',
}

const GUEST = 'sample-guest'
const VISIT = 'sample-visit'

/** The day after a "YYYY-MM-DD" date. */
function nextDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

/** `today` is the studio's own date; `now` an instant, for the made-up records. */
export function sampleMessage(s: BusinessState, kind: SampleKind, today: string, now: string) {
  const org = s.organisation
  const service = s.services.find((item) => !item.archived)
  const person = s.staff.find((item) => !item.archived)
  const guest: Client = {
    id: GUEST,
    organisationId: org.id,
    name: 'Alex Morgan',
    email: 'alex@example.com',
    phone: '',
    preferences: '',
    marketingConsent: true,
    createdAt: now,
  }
  const visit: Appointment = {
    id: VISIT,
    organisationId: org.id,
    locationId: org.locationId,
    clientId: GUEST,
    serviceId: service?.id ?? 'sample-treatment',
    staffId: person?.id ?? 'sample-person',
    resourceId: s.resources[0]?.id ?? 'sample-room',
    date: nextDay(today),
    startMinutes: 600,
    status: 'confirmed',
    source: 'online',
    createdAt: now,
    bookedPriceMinor: service?.priceMinor ?? 0,
    bookedDepositMinor: 0,
    bookedDurationMinutes: service?.durationMinutes ?? 60,
    bookedBufferMinutes: 0,
    ...(service ? {} : { bookedServiceName: 'Your treatment' }),
  }
  // A birthday email to a guest with nothing booked, so it shows the invitation to book.
  const sample: BusinessState = {
    ...s,
    clients: [...s.clients, guest],
    appointments: kind === 'birthday' ? s.appointments : [...s.appointments, visit],
  }
  return kind === 'birthday'
    ? composeClientMessage(sample, guest, 'birthday')
    : composeMessage(sample, visit, kind, 'email')
}

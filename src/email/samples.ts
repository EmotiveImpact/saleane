import type { Appointment, BusinessState, Client } from '../domain/model'
import { composeClientMessage, composeMessage } from '../domain/reminders'

/**
 * NEXT-13: the emails a studio can look at before any guest gets one, written by the same
 * functions as the real ones, for a made-up guest on the studio's own first treatment with its
 * first professional, tomorrow at 10:00.
 */
export const sampleKinds = [
  'confirmation',
  'reminder',
  'feedback',
  'birthday',
  // NEXT-14: the automatic messages in Marketing.
  'aftercare',
  'due_back',
  'miss_you',
] as const
export type SampleKind = (typeof sampleKinds)[number]
export const sampleKindLabel: Record<SampleKind, string> = {
  confirmation: 'Booking confirmation',
  reminder: 'Reminder',
  feedback: 'After the visit',
  birthday: 'Birthday',
  aftercare: 'Aftercare',
  due_back: 'Due back',
  miss_you: 'We miss you',
}
/** The emails about a visit, which Settings shows; the automatic ones are shown in Marketing. */
export const lookKinds = ['confirmation', 'reminder', 'feedback'] as const

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
  const offered = s.services.filter((item) => !item.archived)
  // Aftercare shows a treatment that has advice to give, when the studio has written some.
  const service =
    (kind === 'aftercare' ? offered.find((item) => item.aftercareNote?.trim()) : undefined) ??
    offered[0]
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
    // Aftercare and due back are about a visit that is over.
    date: kind === 'aftercare' || kind === 'due_back' ? today : nextDay(today),
    startMinutes: 600,
    status: kind === 'aftercare' || kind === 'due_back' ? 'completed' : 'confirmed',
    source: 'online',
    createdAt: now,
    bookedPriceMinor: service?.priceMinor ?? 0,
    bookedDepositMinor: 0,
    bookedDurationMinutes: service?.durationMinutes ?? 60,
    bookedBufferMinutes: 0,
    ...(service ? {} : { bookedServiceName: 'Your treatment' }),
  }
  // A birthday or "we miss you" email to a guest with nothing booked, so it shows the invitation
  // to book.
  const aboutGuest = kind === 'birthday' || kind === 'miss_you'
  const sample: BusinessState = {
    ...s,
    clients: [...s.clients, guest],
    appointments: aboutGuest ? s.appointments : [...s.appointments, visit],
  }
  return aboutGuest
    ? composeClientMessage(sample, guest, kind)
    : composeMessage(sample, visit, kind, 'email')
}

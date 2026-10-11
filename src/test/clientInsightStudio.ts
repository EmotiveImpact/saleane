import { addDays } from '../domain/format'
import type { Appointment, BusinessState, Client, Sale } from '../domain/model'
import type { Holding, Offer } from '../domain/plansSchema'
import type { PatchTest } from '../domain/patchTestsSchema'
import { createWorkspace } from '../domain/workspace'

/**
 * A small fictional studio and client histories for the "At a glance" tests (clientInsight.ts and
 * ClientInsight.tsx). Records are written directly, as a studio record holds them, so each test
 * can set up years of visits in a line or two.
 */

/** A Friday. The regulars below come on Saturday mornings. */
export const TODAY = '2026-10-09'
export const SATURDAY = '2026-10-03'

let n = 0
export const at = (date: string, time = '09:00') => `${date}T${time}:00.000Z`

/** A small studio: a facial, a massage and a colour that needs a patch test; Maya and Theo. */
export function studio(options: { region?: 'UK' | 'US'; timeZone?: string } = {}) {
  const s = createWorkspace({
    name: 'Fernleaf Rooms',
    region: options.region ?? 'UK',
    timeZone: options.timeZone,
  })
  const org = s.organisation.id
  const service = (id: string, name: string, priceMinor: number, extra = {}) => ({
    id,
    organisationId: org,
    name,
    description: 'A fictional treatment',
    category: 'Skin' as const,
    durationMinutes: 60,
    bufferMinutes: 0,
    priceMinor,
    depositMinor: 0,
    resourceType: 'treatment' as const,
    ...extra,
  })
  s.services = [
    service('facial', 'Restorative Facial', 9500),
    service('massage', 'Deep Massage', 8000),
    service('colour', 'Gloss Colour', 6000, { patchTest: true }),
  ]
  s.staff = [
    {
      id: 'maya',
      organisationId: org,
      name: 'Maya Lind',
      role: 'Facialist',
      serviceIds: ['facial', 'massage', 'colour'],
      tone: 'sage',
    },
    {
      id: 'theo',
      organisationId: org,
      name: 'Theo Grant',
      role: 'Therapist',
      serviceIds: ['facial', 'massage', 'colour'],
      tone: 'blue',
    },
  ]
  s.resources = [{ id: 'room', organisationId: org, name: 'Room One', type: 'treatment' }]
  return s
}

export function addClient(s: BusinessState, name: string, changes: Partial<Client> = {}): Client {
  const client: Client = {
    id: `client-${++n}`,
    organisationId: s.organisation.id,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    phone: '+447700900123',
    preferences: '',
    marketingConsent: true,
    createdAt: '2025-01-01T09:00:00.000Z',
    ...changes,
  }
  s.clients.push(client)
  return client
}

/** A visit; a completed one gets a receipt for its price plus a tip unless `receipt` is false. */
export function addVisit(
  s: BusinessState,
  clientId: string,
  date: string,
  changes: Partial<Appointment> = {},
  receipt: Partial<Sale> | false = {},
): Appointment {
  const price = s.services.find((x) => x.id === (changes.serviceId ?? 'facial'))!.priceMinor
  const visit: Appointment = {
    id: `visit-${++n}`,
    organisationId: s.organisation.id,
    locationId: s.organisation.locationId,
    clientId,
    serviceId: 'facial',
    staffId: 'maya',
    resourceId: 'room',
    date,
    startMinutes: 10 * 60,
    status: 'completed',
    source: 'desk',
    createdAt: at(addDays(date, -28)),
    bookedPriceMinor: price,
    bookedDepositMinor: 0,
    bookedDurationMinutes: 60,
    bookedBufferMinutes: 0,
    ...changes,
  }
  s.appointments.push(visit)
  if (visit.status === 'completed' && receipt !== false)
    s.sales.push({
      id: `sale-${visit.id}`,
      organisationId: s.organisation.id,
      appointmentId: visit.id,
      currency: s.organisation.currency,
      serviceMinor: visit.bookedPriceMinor,
      tipMinor: 1000,
      depositAppliedMinor: 0,
      totalMinor: visit.bookedPriceMinor + 1000,
      balanceMinor: 0,
      paidAt: at(date, '11:00'),
      method: 'cash',
      ...receipt,
    })
  return visit
}

/** Every four weeks on Saturday mornings at 10:00, each booked at the checkout of the one before. */
export function monthlyRegular(
  s: BusinessState,
  clientId: string,
  last: string,
  visits: number,
  changes: Partial<Appointment> = {},
) {
  let before: Appointment | undefined
  const list: Appointment[] = []
  for (let k = visits - 1; k >= 0; k--) {
    before = addVisit(s, clientId, addDays(last, -28 * k), {
      ...changes,
      ...(before ? { rebookedFromId: before.id, source: 'rebook' } : {}),
    })
    list.push(before)
  }
  return list
}

export function addOffer(s: BusinessState, changes: Partial<Offer> = {}): Offer {
  const offer = {
    id: `offer-${++n}`,
    organisationId: s.organisation.id,
    createdAt: at('2026-01-01'),
    kind: 'membership',
    name: 'Glow Membership',
    serviceIds: ['facial'],
    visits: 1,
    priceMinor: 7900,
    discountPercent: 10,
    validMonths: 1,
    archived: false,
    ...changes,
  } as Offer
  s.offers = [...(s.offers ?? []), offer]
  return offer
}

export function addMembership(
  s: BusinessState,
  clientId: string,
  startedOn: string,
  paidUntil: string,
  changes: Partial<Holding> = {},
) {
  const offer = addOffer(s)
  const holding: Holding = {
    id: `holding-${++n}`,
    organisationId: s.organisation.id,
    clientId,
    offerId: offer.id,
    kind: 'membership',
    name: offer.name,
    serviceIds: offer.serviceIds,
    visits: offer.visits,
    priceMinor: offer.priceMinor,
    discountPercent: offer.discountPercent,
    startedOn,
    paidUntil,
    status: 'active',
    soldAt: at(startedOn),
    actor: 'Maya Lind',
    payments: [
      {
        id: `pay-${++n}`,
        amountMinor: offer.priceMinor,
        method: 'cash',
        recordedAt: at(startedOn),
        periodStart: startedOn,
      },
    ],
    uses: [],
    refunds: [],
    ...changes,
  }
  s.holdings = [...(s.holdings ?? []), holding]
  return holding
}

export function cancelled(s: BusinessState, visit: Appointment, occurredAt: string) {
  visit.status = 'cancelled'
  s.events.push({
    id: `event-${++n}`,
    organisationId: s.organisation.id,
    clientId: visit.clientId,
    appointmentId: visit.id,
    type: 'cancelled',
    title: 'Visit cancelled',
    detail: '',
    occurredAt,
    actor: 'Front desk',
  })
}

export function patchTest(s: BusinessState, clientId: string, testedAt: string, outcome?: 'clear') {
  const test: PatchTest = {
    id: `patch-${++n}`,
    organisationId: s.organisation.id,
    clientId,
    testedAt,
    product: 'Gloss toner',
    notes: '',
    recordedAt: testedAt,
    actor: 'Theo Grant',
    ...(outcome ? { result: { outcome, notes: '', at: testedAt, actor: 'Theo Grant' } } : {}),
  }
  s.patchTests = [...(s.patchTests ?? []), test]
}

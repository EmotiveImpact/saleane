import type { WaitlistTime } from './waitlistSchema'
import { DEMO_DATE, parseState } from './model'
import type { Appointment, BusinessState, Region } from './model'
import { addDays, dateLabel, timeLabel } from './format'
import { DEMO_MINUTES, defaultOperations, hoursFor, instantFor } from './operations'
import { standardWording } from './consent'
import { STARTER_CHECKLIST } from './branchVisits'
import { sampleShifts } from './hours'
import { Diary, planRegulars, sampleRegulars, seeded } from './sampleDiary'
import type { PlannedVisit, Random } from './sampleDiary'

/** The first day of the sample's everyday records; a few named clients go back further. */
export const SAMPLE_FROM = '2026-09-01'
/** The last day of the sample's bookings, apart from next visits booked at checkout. */
export const SAMPLE_UNTIL = '2026-10-31'
const REBOOKED_UNTIL = '2026-12-04'
/** Fictional regular clients around the fifteen named ones. */
const REGULARS = 300

let regularsByDefault = true
/**
 * Leaves the fictional regulars out of the samples built from now on, or brings them back. The test
 * suites leave them out: the named clients carry every story the tests check, and a quieter diary
 * keeps the times the tests book free and the suites quick.
 */
export function sampleWithRegulars(on: boolean) {
  regularsByDefault = on
}

const built = new Map<string, BusinessState>()

/**
 * The fictional sample studio, Atelier House: fifteen named clients whose stories the demo tells,
 * fictional regulars around them, and a diary that agrees with itself. It is the same every time;
 * each caller gets its own copy to change.
 */
export function seed(region: Region, options: { regulars?: boolean } = {}): BusinessState {
  const regulars = options.regulars ?? regularsByDefault
  const key = `${region}${regulars ? ' with regulars' : ''}`
  let sample = built.get(key)
  if (!sample) {
    sample = build(region, regulars ? REGULARS : 0)
    built.set(key, sample)
  }
  return structuredClone(sample)
}

/** Weekly hours: open 09:00 to 18:00 on the given weekdays (0 is Sunday) and closed on the rest. */
const week = (days: number[]) =>
  Array.from({ length: 7 }, (_, day) => ({
    day,
    open: 540,
    close: 1080,
    closed: !days.includes(day),
  }))
/** Each person's own room or chair. */
const ROOM: Record<string, string> = {
  'staff-maya': 'room-one',
  'staff-sophia': 'room-two',
  'staff-theo': 'chair-one',
}
/** How a visit was booked: at the checkout of the visit before, or on a day and time. */
type Booked = 'rebook' | [on: string, minutes: number, source: 'online' | 'desk']
/** One earlier visit: its day, how it was booked, and the treatment and person if not the usual. */
type Past = [date: string, booked: Booked, other?: [serviceId: string, staffId: string]]

/**
 * Each named client's earlier visits, oldest first, at their usual time. Most book their next
 * visit as they pay. Charlotte, Emily and Jamie came every four weeks until the summer and have
 * nothing booked since, so they are the ones ready to return.
 */
const HISTORIES: [n: number, name: string, serviceId: string, start: number, Past[]][] = [
  [
    1,
    'amelia',
    'service-facial',
    570,
    [
      ['2026-03-24', ['2026-03-12', 1215, 'online']],
      ['2026-04-21', 'rebook'],
      ['2026-05-19', 'rebook'],
      ['2026-06-16', 'rebook'],
      ['2026-07-14', 'rebook'],
      ['2026-08-18', 'rebook'],
      ['2026-09-15', 'rebook'],
    ],
  ],
  [
    2,
    'olivia',
    'service-lymphatic',
    540,
    [
      ['2026-07-21', ['2026-07-15', 660, 'desk']],
      ['2026-08-18', 'rebook'],
      ['2026-09-15', 'rebook'],
    ],
  ],
  [
    3,
    'ellie',
    'service-cut',
    540,
    [
      ['2026-04-14', ['2026-04-02', 1170, 'online']],
      ['2026-05-26', 'rebook'],
      ['2026-07-07', 'rebook'],
      ['2026-08-18', 'rebook'],
    ],
  ],
  [
    4,
    'noor',
    'service-facial',
    660,
    [
      ['2026-06-23', ['2026-06-10', 1260, 'online']],
      ['2026-07-28', 'rebook'],
      ['2026-08-25', 'rebook'],
      // A massage with Sophia in between her facials.
      ['2026-09-17', ['2026-09-03', 1110, 'online'], ['service-restore', 'staff-sophia']],
    ],
  ],
  [
    5,
    'ava',
    'service-lymphatic',
    660,
    [
      ['2026-07-14', ['2026-07-02', 855, 'desk']],
      ['2026-08-11', 'rebook'],
      ['2026-09-08', 'rebook'],
    ],
  ],
  [
    6,
    'grace',
    'service-cut',
    660,
    [
      ['2026-07-14', ['2026-07-01', 1245, 'online']],
      ['2026-08-25', 'rebook'],
    ],
  ],
  [
    7,
    'zoe',
    'service-facial',
    810,
    [
      ['2026-07-28', ['2026-07-20', 790, 'online']],
      ['2026-09-01', 'rebook'],
    ],
  ],
  [8, 'nina', 'service-restore', 840, [['2026-09-08', ['2026-08-30', 1270, 'online']]]],
  [
    9,
    'luca',
    'service-cut',
    840,
    [
      ['2026-07-28', ['2026-07-21', 990, 'desk']],
      ['2026-09-01', 'rebook'],
    ],
  ],
  [
    10,
    'ruby',
    'service-restore',
    900,
    [
      ['2026-08-25', ['2026-08-16', 1100, 'online']],
      ['2026-09-22', 'rebook'],
    ],
  ],
  [11, 'isabel', 'service-restore', 960, [['2026-09-08', ['2026-08-28', 1325, 'online']]]],
  [
    12,
    'sophie',
    'service-cut',
    960,
    [
      ['2026-07-14', ['2026-07-06', 760, 'desk']],
      ['2026-08-25', 'rebook'],
    ],
  ],
  [
    13,
    'charlotte',
    'service-facial',
    930,
    [
      ['2026-06-23', ['2026-06-14', 1230, 'online']],
      ['2026-07-21', 'rebook'],
      ['2026-08-18', 'rebook'],
    ],
  ],
  [
    14,
    'emily',
    'service-restore',
    600,
    [
      ['2026-06-10', ['2026-06-03', 620, 'desk']],
      ['2026-07-08', 'rebook'],
      ['2026-08-05', 'rebook'],
    ],
  ],
  [
    15,
    'jamie',
    'service-cut',
    900,
    [
      ['2026-06-04', ['2026-05-28', 1140, 'online']],
      ['2026-07-02', 'rebook'],
      ['2026-07-30', 'rebook'],
    ],
  ],
]
/** The sample day itself: twelve guests, two already finished and Amelia in the studio now. */
const TODAY: [string, number, string, number, Appointment['status'], Booked][] = [
  ['visit-olivia', 2, 'service-lymphatic', 540, 'completed', ['2026-09-22', 615, 'desk']],
  ['visit-ellie', 3, 'service-cut', 540, 'completed', 'rebook'],
  ['visit-amelia', 1, 'service-facial', 570, 'arrived', ['2026-09-20', 581, 'online']],
  ['visit-noor', 4, 'service-facial', 660, 'confirmed', 'rebook'],
  ['visit-ava', 5, 'service-lymphatic', 660, 'confirmed', 'rebook'],
  ['visit-grace', 6, 'service-cut', 660, 'confirmed', 'rebook'],
  ['visit-zoe', 7, 'service-facial', 810, 'confirmed', 'rebook'],
  ['visit-nina', 8, 'service-restore', 840, 'confirmed', 'rebook'],
  ['visit-luca', 9, 'service-cut', 840, 'confirmed', 'rebook'],
  ['visit-ruby', 10, 'service-restore', 900, 'confirmed', 'rebook'],
  ['visit-isabel', 11, 'service-facial', 960, 'confirmed', ['2026-09-27', 1290, 'online']],
  ['visit-sophie', 12, 'service-cut', 960, 'confirmed', 'rebook'],
]
const STAFF_OF: Record<string, string> = {
  'service-facial': 'staff-maya',
  'service-lymphatic': 'staff-sophia',
  'service-restore': 'staff-maya',
  'service-cut': 'staff-theo',
  'service-gloss': 'staff-theo',
}
/** Who looks after each named client, where it differs from the treatment's usual person. */
const NAMED_STAFF: Record<number, string> = {
  2: 'staff-sophia',
  5: 'staff-sophia',
  8: 'staff-sophia',
  11: 'staff-sophia',
}

function build(region: Region, regularCount: number): BusinessState {
  const uk = region === 'UK'
  const organisationId = uk ? 'org-atelier-london' : 'org-atelier-new-york'
  const scope = { organisationId }
  const random: Random = seeded(uk ? 20261006 : 20261007)
  const state: BusinessState = {
    schemaVersion: 1,
    revision: 0,
    organisation: {
      id: organisationId,
      name: 'Atelier House',
      region,
      currency: uk ? 'GBP' : 'USD',
      locale: uk ? 'en-GB' : 'en-US',
      timeZone: uk ? 'Europe/London' : 'America/New_York',
      locationId: uk ? 'loc-london' : 'loc-nyc',
      locationName: uk ? 'Marylebone, London' : 'SoHo, New York',
      address: uk ? '24 Devonshire Place, London W1G' : '48 Mercer Street, New York, NY',
      // V1.5: a fictional public review page, offered to every guest after their visit.
      reviewUrl: 'https://reviews.example.com/atelier-house',
    },
    clients: [
      ['Amelia Carter', 'Prefers the quiet treatment room. Usually visits on Tuesdays.'],
      ['Olivia James', 'Likes an early appointment. Introduced by Amelia.'],
      ['Ellie Brooks', 'A regular cut and finish with Theo.'],
      ['Noor Ahmed', 'Prefers appointment updates by email.'],
      ['Ava Williams', 'Usually books a longer body treatment.'],
      ['Grace Chen', 'Prefers a late morning appointment.'],
      ['Zoe Miller', 'Enjoys a calm, unhurried visit.'],
      ['Nina Patel', 'Interested in a monthly visit.'],
      ['Luca Evans', 'Prefers afternoons with Theo.'],
      ['Ruby Taylor', 'Likes a mid-afternoon visit.'],
      ['Isabel Wilson', 'Would like to return for a facial.'],
      ['Sophie Martin', 'Prefers the same professional each visit.'],
      ['Charlotte Hayes', 'Usually chooses a facial with Maya.'],
      ['Emily Clarke', 'Prefers midweek appointments.'],
      ['Jamie Morgan', 'Likes an afternoon appointment.'],
    ].map(([name, preferences], i) => ({
      ...scope,
      id: `client-${i + 1}`,
      name,
      email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
      phone: uk
        ? `+44 7700 900${String(i + 1).padStart(3, '0')}`
        : `+1 212 555 ${String(100 + i).padStart(4, '0')}`,
      preferences,
      marketingConsent: i % 4 !== 3,
      // Replaced below by the moment of their first booking.
      createdAt: '2026-03-01T09:00:00.000Z',
      // V1.5: a few guests shared their birthday, month and day only.
      ...(i === 0 ? { birthday: '10-09' } : i === 4 ? { birthday: '03-14' } : {}),
      // V5: most guests gave the first half of their postcode; two did not.
      ...(i < 13
        ? {
            postcodeArea: (uk
              ? [
                  'W1G',
                  'W1G',
                  'NW1',
                  'W1G',
                  'W2',
                  'NW1',
                  'NW8',
                  'W2',
                  'W1G',
                  'NW1',
                  'W2',
                  'N1',
                  'NW8',
                ]
              : [
                  '100',
                  '100',
                  '112',
                  '100',
                  '070',
                  '112',
                  '100',
                  '113',
                  '112',
                  '100',
                  '070',
                  '104',
                  '100',
                ])[i],
          }
        : {}),
    })),
    services: [
      {
        ...scope,
        id: 'service-facial',
        name: 'Skin Renewal Facial',
        category: 'Skin',
        description: 'A considered reset for your skin. Cleanse, massage and a restorative finish.',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: uk ? 9500 : 12500,
        depositMinor: 2500,
        resourceType: 'treatment',
        aftercareNote:
          'Skip make-up, exfoliants and very hot water for the rest of today, and wear sun cream tomorrow.',
      },
      {
        ...scope,
        id: 'service-lymphatic',
        name: 'Lymphatic Massage',
        category: 'Body',
        description: 'A gentle, rhythmic body treatment with time to unwind.',
        durationMinutes: 75,
        bufferMinutes: 15,
        priceMinor: uk ? 12000 : 14500,
        depositMinor: 3000,
        resourceType: 'treatment',
      },
      {
        ...scope,
        id: 'service-restore',
        name: 'Deep Restore Massage',
        category: 'Body',
        description: 'An hour to let go. A bespoke, restorative body massage.',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: uk ? 9000 : 11500,
        depositMinor: 2500,
        resourceType: 'treatment',
      },
      {
        ...scope,
        id: 'service-cut',
        name: 'Signature Cut & Finish',
        category: 'Hair',
        description: 'Thoughtful shaping, a personal consultation and a polished finish.',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: uk ? 7500 : 9500,
        depositMinor: 2000,
        resourceType: 'chair',
      },
      {
        ...scope,
        id: 'service-gloss',
        name: 'Gloss & Tone',
        category: 'Hair',
        description: 'A soft, glossy refresh of your colour, with a blow-dry to finish.',
        durationMinutes: 45,
        bufferMinutes: 15,
        priceMinor: uk ? 6500 : 8500,
        depositMinor: 1500,
        resourceType: 'chair',
        patchTest: true,
        aftercareNote:
          'Wait two days before washing your hair, then use a colour-safe shampoo and cool water.',
        returnWeeks: 6,
      },
    ],
    // Each person works five days a week; the studio is closed on Sundays.
    staff: [
      {
        ...scope,
        id: 'staff-maya',
        name: 'Maya Lewis',
        role: 'Skin & wellbeing',
        serviceIds: ['service-facial', 'service-restore'],
        tone: 'sage',
        hours: week([1, 2, 3, 4, 5]),
      },
      {
        ...scope,
        id: 'staff-sophia',
        name: 'Sophia Reed',
        role: 'Body & skin',
        serviceIds: ['service-lymphatic', 'service-restore', 'service-facial'],
        tone: 'blue',
        hours: week([2, 3, 4, 5, 6]),
      },
      {
        ...scope,
        id: 'staff-theo',
        name: 'Theo Bennett',
        role: 'Hair & styling',
        serviceIds: ['service-cut', 'service-gloss'],
        tone: 'sand',
        hours: week([2, 3, 4, 5, 6]),
      },
    ],
    resources: [
      { ...scope, id: 'room-one', name: 'Treatment room 1', type: 'treatment' },
      // NEXT-08: a room for two, so a couple can be booked side by side.
      { ...scope, id: 'room-two', name: 'Treatment room 2', type: 'treatment', forTwo: true },
      { ...scope, id: 'chair-one', name: 'Styling chair', type: 'chair' },
    ],
    appointments: [],
    sales: [],
    payments: [],
    events: [],
    relationships: [],
  }
  const o = (state.operations = defaultOperations('sandbox'))
  o.hours = week([1, 2, 3, 4, 5, 6])
  seedTimeOff(state, uk)
  const at = (date: string, minutes: number) => instantFor(state, date, minutes)
  const diary = new Diary(state)
  const service = (id: string) => state.services.find((s) => s.id === id)!
  const clientOf = (id: string) => state.clients.find((c) => c.id === id)!

  /** One visit with its deposit, booking and, once complete, its receipt and payment. */
  function visit(v: {
    id: string
    clientId: string
    serviceId: string
    staffId: string
    date: string
    start: number
    status: Appointment['status']
    source: Appointment['source']
    rebookedFromId?: string
    bookedAt: string
    /** Already placed in the diary by the regulars' planner. */
    placed?: boolean
  }) {
    const treatment = service(v.serviceId)
    const resourceId = ROOM[v.staffId]
    if (!v.placed)
      diary.take(
        v.staffId,
        resourceId,
        v.date,
        v.start,
        treatment.durationMinutes + treatment.bufferMinutes,
      )
    const appointment: Appointment = {
      ...scope,
      id: v.id,
      clientId: v.clientId,
      locationId: state.organisation.locationId,
      serviceId: v.serviceId,
      staffId: v.staffId,
      resourceId,
      date: v.date,
      startMinutes: v.start,
      status: v.status,
      source: v.source,
      createdAt: v.bookedAt,
      ...(v.rebookedFromId ? { rebookedFromId: v.rebookedFromId } : {}),
      bookedPriceMinor: treatment.priceMinor,
      bookedDepositMinor: treatment.depositMinor,
      bookedDurationMinutes: treatment.durationMinutes,
      bookedBufferMinutes: treatment.bufferMinutes,
    }
    state.appointments.push(appointment)
    // A sample studio simulates each deposit when the visit is booked.
    state.payments.push({
      ...scope,
      id: `deposit-${v.id}`,
      appointmentId: v.id,
      amountMinor: treatment.depositMinor,
      currency: state.organisation.currency,
      kind: 'deposit',
      method: 'demo_card',
      recordedAt: v.bookedAt,
    })
    state.events.push({
      ...scope,
      id: `event-booked-${v.id}`,
      clientId: v.clientId,
      appointmentId: v.id,
      type: 'booked',
      title: v.source === 'rebook' ? 'Next visit booked' : 'Visit booked',
      detail: `${treatment.name} · ${dateLabel(v.date, state.organisation.locale)} at ${timeLabel(v.start, state.organisation.locale)}`,
      occurredAt: v.bookedAt,
      actor: v.source === 'online' ? 'Guest booking' : 'Front desk',
    })
    if (v.status !== 'completed') return appointment
    // Paid as the treatment ends. The named clients pay by card, adding a fifth in New York; among
    // the regulars some UK guests add a tip, most US guests do, and a few pay in cash.
    const fifth = Math.round((treatment.priceMinor * 0.2) / 100) * 100
    const tip = !v.placed
      ? uk
        ? 0
        : fifth
      : uk
        ? random() < 0.3
          ? random() < 0.6
            ? 500
            : 1000
          : 0
        : random() < 0.85
          ? random() < 0.5
            ? Math.round((treatment.priceMinor * 0.18) / 100) * 100
            : fifth
          : 0
    const method = v.placed && random() >= 0.88 ? 'demo_cash' : 'demo_card'
    const paidAt = at(v.date, v.start + treatment.durationMinutes)
    const saleId = `sale-${v.id}`
    state.sales.push({
      ...scope,
      id: saleId,
      appointmentId: v.id,
      currency: state.organisation.currency,
      serviceMinor: treatment.priceMinor,
      tipMinor: tip,
      depositAppliedMinor: treatment.depositMinor,
      totalMinor: treatment.priceMinor + tip,
      balanceMinor: treatment.priceMinor + tip - treatment.depositMinor,
      paidAt,
      method,
    })
    state.payments.push({
      ...scope,
      id: `settlement-${v.id}`,
      appointmentId: v.id,
      saleId,
      amountMinor: treatment.priceMinor + tip - treatment.depositMinor,
      currency: state.organisation.currency,
      kind: 'settlement',
      method,
      recordedAt: paidAt,
    })
    state.events.push({
      ...scope,
      id: `event-checkout-${v.id}`,
      clientId: v.clientId,
      appointmentId: v.id,
      saleId,
      type: 'checkout',
      title: 'Visit completed',
      detail: `${treatment.name}. Demo receipt recorded.`,
      occurredAt: paidAt,
      actor: 'Front desk',
    })
    return appointment
  }
  /** When a visit was booked: just after the visit before ended, or on its own day and time. */
  const bookedAt = (booked: Booked, previous?: Appointment) =>
    booked === 'rebook'
      ? at(previous!.date, previous!.startMinutes + previous!.bookedDurationMinutes + 5)
      : at(booked[0], booked[1])
  const sourceOf = (booked: Booked) => (booked === 'rebook' ? 'rebook' : booked[2])

  // The named clients' earlier visits, then the sample day and the colour visits later this week.
  const last = new Map<string, Appointment>()
  for (const [n, name, usual, start, visits] of HISTORIES) {
    const clientId = `client-${n}`
    visits.forEach(([date, booked, other], k) => {
      const previous = last.get(clientId)
      const id =
        n >= 13 && k === visits.length - 1 ? `history-return-${n}` : `history-${name}-${k + 1}`
      const serviceId = other?.[0] ?? usual
      last.set(
        clientId,
        visit({
          id,
          clientId,
          serviceId,
          staffId: other?.[1] ?? NAMED_STAFF[n] ?? STAFF_OF[serviceId],
          date,
          start,
          status: 'completed',
          source: sourceOf(booked),
          ...(booked === 'rebook' ? { rebookedFromId: previous!.id } : {}),
          bookedAt: bookedAt(booked, previous),
        }),
      )
    })
  }
  for (const [id, n, serviceId, start, status, booked] of TODAY) {
    const clientId = `client-${n}`
    const previous = last.get(clientId)
    last.set(
      clientId,
      visit({
        id,
        clientId,
        serviceId,
        staffId: NAMED_STAFF[n] ?? STAFF_OF[serviceId],
        date: DEMO_DATE,
        start,
        status,
        source: sourceOf(booked),
        ...(booked === 'rebook' ? { rebookedFromId: previous!.id } : {}),
        bookedAt: bookedAt(booked, previous),
      }),
    )
  }
  // V1.5: three colour visits later this week: one guest is clear, one is waiting for the result
  // and one has no patch test yet, so the desk and the reminder have something to show.
  const colour: [string, number, string, [string, number, 'online' | 'desk']][] = [
    ['visit-gloss-ellie', 3, addDays(DEMO_DATE, 2), ['2026-09-25', 555, 'desk']],
    ['visit-gloss-grace', 6, addDays(DEMO_DATE, 3), ['2026-10-05', 640, 'desk']],
    ['visit-gloss-luca', 9, addDays(DEMO_DATE, 4), ['2026-10-03', 1290, 'online']],
  ]
  for (const [id, n, date, booked] of colour)
    visit({
      id,
      clientId: `client-${n}`,
      serviceId: 'service-gloss',
      staffId: 'staff-theo',
      date,
      start: 600,
      status: 'confirmed',
      source: booked[2],
      bookedAt: at(booked[0], booked[1]),
    })
  for (const client of state.clients) {
    const first = state.appointments
      .filter((a) => a.clientId === client.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (first) client.createdAt = first.createdAt
  }

  // Fictional regulars fill the rest of the diary, from September to the end of October.
  const workdays = Object.fromEntries(
    state.staff.map((p) => [p.id, (p.hours ?? []).filter((h) => !h.closed).map((h) => h.day)]),
  )
  const regulars = sampleRegulars(
    region,
    regularCount,
    random,
    organisationId,
    state.clients.map((c) => c.name),
    workdays,
  )
  const planned = planRegulars(
    state,
    diary,
    regulars,
    random,
    { from: SAMPLE_FROM, today: DEMO_DATE, until: SAMPLE_UNTIL, rebookUntil: REBOOKED_UNTIL },
    (staffId) => ROOM[staffId],
    (staffId, date) => {
      const most = staffId === 'staff-theo' ? 6 : 5
      // Further ahead, fewer people have booked yet.
      const ahead = (Date.parse(date) - Date.parse(DEMO_DATE)) / 86_400_000
      return ahead <= 14 ? most : ahead <= 21 ? most - 1 : most - 2
    },
  )
  const byDay = (a: PlannedVisit, b: PlannedVisit) =>
    a.date.localeCompare(b.date) || a.start - b.start || a.staffId.localeCompare(b.staffId)
  for (const p of [...planned].sort(byDay))
    visit({
      id: p.id,
      clientId: p.clientId,
      serviceId: p.serviceId,
      staffId: p.staffId,
      date: p.date,
      start: p.start,
      status: p.date < DEMO_DATE ? 'completed' : 'confirmed',
      source: p.source,
      ...(p.rebookedFromId ? { rebookedFromId: p.rebookedFromId } : {}),
      bookedAt: at(p.bookedOn, p.bookedMinutes),
      placed: true,
    })
  for (const { client } of regulars) {
    const first = planned
      .filter((p) => p.clientId === client.id)
      .map((p) => at(p.bookedOn, p.bookedMinutes))
      .sort()[0]
    if (first) state.clients.push({ ...client, createdAt: first })
  }
  state.appointments.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)

  // Amelia introduced Olivia at her July visit; Maya noted how Amelia likes to be looked after.
  const introduced = at('2026-07-14', 640)
  state.relationships.push({
    ...scope,
    id: 'relationship-amelia-olivia',
    fromClientId: 'client-1',
    toClientId: 'client-2',
    type: 'referral',
    createdAt: introduced,
  })
  state.events.push(
    {
      ...scope,
      id: 'event-amelia-referral',
      clientId: 'client-1',
      type: 'relationship',
      title: 'Introduced Olivia to the studio',
      detail: 'Referral relationship recorded with both client records.',
      occurredAt: introduced,
      actor: 'Front desk',
    },
    {
      ...scope,
      id: 'event-amelia-note',
      clientId: 'client-1',
      type: 'note',
      title: 'A familiar rhythm',
      detail: 'Amelia prefers Maya and the quiet room. Offer her a Tuesday when rebooking.',
      occurredAt: at('2026-09-15', 650),
      actor: 'Maya Lewis',
    },
    {
      ...scope,
      id: 'event-arrived-visit-amelia',
      clientId: 'client-1',
      appointmentId: 'visit-amelia',
      type: 'arrived',
      title: 'Welcomed to the studio',
      detail: 'Arrival recorded by the front desk.',
      occurredAt: at(DEMO_DATE, 566),
      actor: 'Front desk',
    },
  )
  seedFeedback(state, random, at)
  seedStock(state, uk, random, at)
  seedSuppliers(state)
  seedPay(state)
  // NEXT-07: a fortnight of clocked hours, so Pay shows hours worked.
  ;(state.operations ??= defaultOperations('sandbox')).shifts = sampleShifts(state, DEMO_DATE)
  seedBranchVisits(state)
  seedRent(state, uk)
  seedAccounting(state, uk)
  seedArrivals(state, uk, at)
  // V1.5: a few clients waiting for a time, so the waitlist shows openings straight away.
  const wishes: [string, string, string | undefined, string, string, WaitlistTime[], string][] = [
    [
      'client-13',
      'service-facial',
      'staff-maya',
      DEMO_DATE,
      addDays(DEMO_DATE, 14),
      ['afternoon', 'evening'],
      'Works until 3pm on weekdays.',
    ],
    [
      'client-14',
      'service-restore',
      undefined,
      addDays(DEMO_DATE, 1),
      addDays(DEMO_DATE, 8),
      ['morning'],
      '',
    ],
    [
      'client-15',
      'service-cut',
      'staff-theo',
      addDays(DEMO_DATE, 2),
      addDays(DEMO_DATE, 25),
      [],
      'Happy to take a cancellation at short notice.',
    ],
  ]
  state.waitlist = wishes.map(
    ([clientId, serviceId, staffId, fromDate, toDate, times, note], n) => ({
      ...scope,
      id: `waitlist-${n + 1}`,
      clientId,
      serviceId,
      ...(staffId ? { staffId } : {}),
      fromDate,
      toDate,
      times,
      note,
      source: 'desk' as const,
      status: 'waiting' as const,
      createdAt: at(addDays(DEMO_DATE, -1), 600),
    }),
  )
  // V1.5: two gift cards on sale already, so the desk can try spending one at checkout. Olivia
  // bought one for her sister as she paid for her massage on 15 September; Luca bought a facial
  // for his partner after his cut on 1 September.
  const years = region === 'US' ? 5 : 2
  const lastDay = (soldOn: string) => `${Number(soldOn.slice(0, 4)) + years}${soldOn.slice(4)}`
  state.giftCards = [
    {
      ...scope,
      id: 'gift-1',
      code: 'LAKE-7K4M-2QHN',
      kind: 'money' as const,
      valueMinor: uk ? 7500 : 10000,
      clientId: 'client-2',
      purchaserName: clientOf('client-2').name,
      recipientName: 'Hannah James',
      message: 'For a quiet hour just for you.',
      issuedOn: '2026-09-15',
      expiresOn: lastDay('2026-09-15'),
      soldAt: at('2026-09-15', 620),
      actor: 'Front desk',
      payment: {
        id: 'gift-pay-1',
        amountMinor: uk ? 7500 : 10000,
        method: 'demo_card' as const,
        recordedAt: at('2026-09-15', 620),
      },
      redemptions: [],
      extensions: [],
      status: 'active' as const,
      refunds: [],
    },
    {
      ...scope,
      id: 'gift-2',
      code: 'SAGE-9P3T-XW5C',
      kind: 'service' as const,
      serviceId: 'service-facial',
      serviceName: 'Skin Renewal Facial',
      valueMinor: uk ? 9500 : 12500,
      clientId: 'client-9',
      purchaserName: clientOf('client-9').name,
      recipientName: 'Marta Ruiz',
      message: 'Happy anniversary.',
      issuedOn: '2026-09-01',
      expiresOn: lastDay('2026-09-01'),
      soldAt: at('2026-09-01', 905),
      actor: 'Front desk',
      payment: {
        id: 'gift-pay-2',
        amountMinor: uk ? 9500 : 12500,
        method: 'demo_cash' as const,
        recordedAt: at('2026-09-01', 905),
      },
      redemptions: [],
      extensions: [],
      status: 'active' as const,
      refunds: [],
    },
  ]
  // Ellie's patch test was on the Saturday after her consultation, and Theo recorded it clear when
  // he was next in. Grace's was on Saturday, and its result is still to record.
  state.patchTests = [
    {
      ...scope,
      id: 'patch-1',
      clientId: 'client-3',
      testedAt: at(addDays(DEMO_DATE, -10), 630),
      product: 'Gloss toner 9.1 with 2% developer',
      staffId: 'staff-theo',
      notes: '',
      recordedAt: at(addDays(DEMO_DATE, -10), 630),
      actor: 'Theo Bennett',
      result: {
        outcome: 'clear' as const,
        notes: 'No redness after 48 hours.',
        at: at(addDays(DEMO_DATE, -7), 660),
        actor: 'Theo Bennett',
      },
    },
    {
      ...scope,
      id: 'patch-2',
      clientId: 'client-6',
      testedAt: at(addDays(DEMO_DATE, -3), 630),
      product: 'Gloss toner 8.3 with 2% developer',
      staffId: 'staff-theo',
      notes: 'Behind the left ear.',
      recordedAt: at(addDays(DEMO_DATE, -3), 630),
      actor: 'Theo Bennett',
    },
  ]
  // Regulars who have colour were patch tested at the visit before their first, and rang to say
  // it was clear once the 48 hours had passed.
  const tested = (serviceId: string) => !!state.services.find((x) => x.id === serviceId)?.patchTest
  const toners = ['9.1', '8.3', '7.1', '10.12', '6.0']
  for (const { client } of regulars) {
    const own = planned.filter((p) => p.clientId === client.id).sort(byDay)
    const colour = own.findIndex((p) => tested(p.serviceId))
    if (colour < 1) continue
    const before = own[colour - 1]
    const testedAt = at(before.date, before.start + 50)
    let heard = addDays(before.date, 2)
    while (hoursFor(state, heard).closed) heard = addDays(heard, 1)
    const clear = at(heard, before.start + 50)
    state.patchTests.push({
      ...scope,
      id: `patch-${client.id}`,
      clientId: client.id,
      testedAt,
      product: `Gloss toner ${toners[state.patchTests.length % toners.length]} with 2% developer`,
      staffId: before.staffId,
      notes: '',
      recordedAt: testedAt,
      actor: state.staff.find((p) => p.id === before.staffId)!.name,
      ...(clear <= at(DEMO_DATE, DEMO_MINUTES)
        ? {
            result: {
              outcome: 'clear' as const,
              notes: 'No reaction after 48 hours.',
              at: clear,
              actor: 'Front desk',
            },
          }
        : {}),
    })
  }
  // V1.5: an ordinary form for haircuts, and one guest who has filled it in already.
  state.forms = [
    {
      ...scope,
      id: 'form-cut',
      serviceIds: ['service-cut'],
      when: 'every_visit',
      versions: [
        {
          version: 1,
          publishedAt: at(addDays(DEMO_DATE, -28), 540),
          publishedBy: 'Theo Bennett',
          content: {
            title: 'Before your cut',
            intro: 'A few quick questions so your stylist is ready for you.',
            questions: [
              {
                id: 'q-change',
                kind: 'choice',
                label: 'What would you like this time?',
                required: true,
                options: ['The same again', 'A small change', 'Something new'],
              },
              {
                id: 'q-ideas',
                kind: 'long',
                label: 'Anything you would like us to know?',
                required: false,
              },
              {
                id: 'q-quiet',
                kind: 'yes_no',
                label: 'Would you like a quiet appointment, with little conversation?',
                required: false,
              },
            ],
            agreement: '',
          },
        },
      ],
    },
  ]
  state.formResponses = [
    {
      ...scope,
      id: 'form-answer-1',
      formId: 'form-cut',
      version: 1,
      appointmentId: 'visit-grace',
      clientId: 'client-6',
      answers: [
        { questionId: 'q-change', value: 'A small change' },
        { questionId: 'q-ideas', value: 'Keeping the length, just tidier at the front.' },
        { questionId: 'q-quiet', value: 'yes' },
      ],
      agreedName: '',
      submittedAt: at(addDays(DEMO_DATE, -1), 1152),
    },
  ]
  // V1.5: Amelia agreed to email news on the booking page when she booked today's visit; Noor
  // agreed at the desk on her last visit and later stopped it from her visit link. The others were
  // recorded before these records began. Version 1, SALEANE's standard wording, is kept in the
  // studio's name so a rename cannot rewrite it.
  state.consentWording = [{ version: 1, text: standardWording(state.organisation.name) }]
  state.consentRecords = [
    {
      ...scope,
      id: 'consent-1',
      clientId: 'client-1',
      channel: 'email',
      purpose: 'marketing',
      given: true,
      wordingVersion: 1,
      source: 'booking page',
      recordedAt: at('2026-09-20', 581),
      actor: 'Guest booking',
    },
    {
      ...scope,
      id: 'consent-2',
      clientId: 'client-4',
      channel: 'email',
      purpose: 'marketing',
      given: true,
      wordingVersion: 1,
      source: 'desk',
      recordedAt: at('2026-09-17', 725),
      actor: 'Sophia Reed',
    },
    {
      ...scope,
      id: 'consent-3',
      clientId: 'client-4',
      channel: 'email',
      purpose: 'marketing',
      given: false,
      source: 'guest link',
      recordedAt: at(addDays(DEMO_DATE, -6), 1217),
      actor: 'Guest (private link)',
    },
  ]
  // V1.5: Ellie talked through a colour change with Theo; he firmed up the price the next morning,
  // and her gloss visit was booked against that second version.
  const talked = { serviceIds: ['service-gloss'], quoteMinor: uk ? 6500 : 8500, notes: '' }
  state.consultations = [
    {
      ...scope,
      id: 'consult-ellie',
      clientId: 'client-3',
      staffId: 'staff-theo',
      heldOn: addDays(DEMO_DATE, -12),
      versions: [
        {
          ...talked,
          version: 1,
          wants: 'Warmer, softer blonde. Less brassy at the ends.',
          plan: 'Gloss and tone in a warm beige. Keep the roots as they are.',
          quoteMinor: null,
          savedAt: at(addDays(DEMO_DATE, -12), 920),
          savedBy: 'Theo Bennett',
        },
        {
          ...talked,
          version: 2,
          wants: 'Warmer, softer blonde. Less brassy at the ends.',
          plan: 'Gloss and tone in a warm beige. Keep the roots as they are. Trim the ends after.',
          savedAt: at(addDays(DEMO_DATE, -11), 545),
          savedBy: 'Theo Bennett',
        },
      ],
    },
  ]
  const ellie = state.appointments.find((a) => a.id === 'visit-gloss-ellie')
  if (ellie) ellie.consultation = { id: 'consult-ellie', version: 2 }
  // V1.5: a few replies in the inbox. Ellie texted last night and nobody has read it yet; a
  // number the studio does not know asked about Saturday; Amelia's thank-you has been read.
  state.replies = [
    {
      ...scope,
      id: 'reply-amelia',
      clientId: 'client-1',
      channel: 'email',
      from: clientOf('client-1').email,
      body: 'Thank you, see you then. Could I have the quiet room again if it is free?',
      receivedAt: at(addDays(DEMO_DATE, -2), 612),
      providerRef: 'sample-email-1',
      actor: 'Email line',
      readAt: at(addDays(DEMO_DATE, -1), 545),
      readBy: 'Maya Lewis',
    },
    {
      ...scope,
      id: 'reply-ellie',
      clientId: 'client-3',
      channel: 'sms',
      from: clientOf('client-3').phone.replace(/\s/g, ''),
      body: 'Hi! Could I come half an hour later on Thursday? Same gloss please. Ellie',
      receivedAt: at(addDays(DEMO_DATE, -1), 1188),
      providerRef: 'sample-text-1',
      actor: 'Text line',
    },
    {
      ...scope,
      id: 'reply-unknown',
      channel: 'sms',
      from: uk ? '+447700900999' : '+12125550199',
      body: 'Hello, do you have anything on Saturday morning for a cut and finish?',
      receivedAt: at(DEMO_DATE, 451),
      providerRef: 'sample-text-2',
      actor: 'Text line',
    },
  ]
  state.savedReplies = [
    {
      id: 'saved-thanks',
      name: 'Thanks, back soon',
      body: 'Thank you for your message. We will come back to you as soon as we can.',
    },
    {
      id: 'saved-move',
      name: 'Moving a visit',
      body: 'Of course. We can move you to a time that suits. Let us know which day works best and we will change it for you.',
    },
    {
      id: 'saved-late',
      name: 'Running late',
      body: 'Thank you for letting us know. We will hold your time for 15 minutes. If you will be later than that, reply and we will find you a new time.',
    },
  ]
  // Receipts are numbered in the order they were paid, as checkout numbers them.
  ;[...state.sales]
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
    .forEach((sale, i) => {
      sale.receiptNumber = `SL-${i + 1}`
    })
  return parseState(state, region)
}

/** What nine of the named clients said privately after a visit: visit and practitioner stars. */
const NAMED_FEEDBACK: [
  appointmentId: string,
  visit: number,
  practitioner: number,
  comment: string,
][] = [
  ['history-amelia-7', 5, 5, 'Maya remembered exactly what worked last time. My skin feels calm.'],
  ['history-ruby-2', 5, 5, ''],
  ['history-noor-3', 4, 5, 'Lovely as ever. The room was a little cool to start.'],
  ['history-zoe-2', 5, 4, ''],
  ['history-olivia-3', 5, 5, 'Sophia was wonderful. I slept so well that night.'],
  ['history-ava-3', 3, 4, 'Started ten minutes late, but the treatment itself was very good.'],
  ['history-noor-4', 5, 5, 'Felt completely looked after. The room was so calm.'],
  ['history-ellie-4', 5, 5, 'Best cut I have had in years.'],
  ['history-luca-2', 4, 5, ''],
]

/**
 * V1.5: private feedback, sent the evening after a visit, about the treatment and the person the
 * guest actually had: nine named clients, and about a third of the regulars seen in the last three
 * weeks.
 */
function seedFeedback(
  state: BusinessState,
  random: Random,
  at: (date: string, minutes: number) => string,
) {
  const said: Record<string, string[]> = {
    'staff-maya Skin': [
      'My skin feels brand new. Maya explained every step.',
      'So relaxing. My skin has not looked this good in months.',
    ],
    'staff-maya Body': [
      'Maya found every knot. I feel ten years younger.',
      'Exactly the pressure I asked for.',
    ],
    'staff-sophia Skin': ['Sophia was so gentle. My skin is glowing.'],
    'staff-sophia Body': [
      'I slept so well that night. Thank you, Sophia.',
      'Started a few minutes late, but the massage itself was lovely.',
    ],
    'staff-theo Hair': [
      'Theo listened, and it is exactly what I wanted.',
      'A great cut, though I waited a little at the desk.',
    ],
  }
  const visit = (id: string) => state.appointments.find((a) => a.id === id)!
  const answers = NAMED_FEEDBACK.map(([id, visitRating, practitionerRating, comment]) => ({
    a: visit(id),
    visitRating,
    practitionerRating,
    comment,
  }))
  const from = addDays(DEMO_DATE, -21)
  for (const a of state.appointments) {
    if (!a.id.startsWith('visit-r') || a.status !== 'completed' || a.date < from) continue
    if (a.date >= DEMO_DATE || random() >= 0.32) continue
    const category = state.services.find((s) => s.id === a.serviceId)!.category
    const lines = said[`${a.staffId} ${category}`] ?? ['']
    const comment = random() < 0.5 ? lines[Math.floor(random() * lines.length)] : ''
    const roll = random()
    // Lower scores always come with the reason the guest gave.
    const [visitRating, practitionerRating] = /late|waited/.test(comment)
      ? [4, 4]
      : roll < 0.62
        ? [5, 5]
        : roll < 0.78
          ? [4, 5]
          : roll < 0.9
            ? [5, 4]
            : [4, 4]
    answers.push({ a, visitRating, practitionerRating, comment })
  }
  state.feedback = answers.map(({ a, visitRating, practitionerRating, comment }, n) => ({
    organisationId: state.organisation.id,
    id: `feedback-${a.id}`,
    appointmentId: a.id,
    clientId: a.clientId,
    staffId: a.staffId,
    visitRating,
    practitionerRating,
    comment,
    // That evening, a few hours after checkout.
    createdAt: at(
      a.date,
      Math.min(1380, a.startMinutes + a.bookedDurationMinutes + 150 + ((n * 47) % 240)),
    ),
  }))
}

/** V2: two fictional suppliers, products linked to them and one order not yet arrived. */
function seedSuppliers(state: BusinessState) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  o.suppliers = [
    {
      id: 'supplier-skin',
      name: 'Meadowline Skin Supply',
      email: 'orders@meadowline.example',
      note: 'Order by Thursday for Monday delivery.',
    },
    { id: 'supplier-pro', name: 'Studio Pro Wholesale', phone: '+44 20 7946 0000' },
  ]
  const from: Record<string, [string, number?]> = {
    'product-cleansing-balm': ['supplier-skin', 6],
    'product-hydrating-serum': ['supplier-skin', 6],
    'product-mineral-spf': ['supplier-skin', 12],
    'product-body-oil': ['supplier-skin'],
    'product-hair-mask': ['supplier-pro'],
    'product-massage-oil': ['supplier-pro', 4],
    'product-enzyme-peel': ['supplier-pro', 2],
  }
  for (const product of o.products) {
    const link = from[product.id]
    if (!link) continue
    product.supplierId = link[0]
    if (link[1]) product.reorderQuantity = link[1]
  }
  o.purchaseOrders = [
    {
      id: 'order-1',
      number: 'PO-1',
      supplierId: 'supplier-pro',
      lines: [{ productId: 'product-hair-mask', quantity: 6 }],
      status: 'ordered',
      createdAt: instantFor(state, '2026-10-02', 600),
      actor: 'Maya Lewis',
    },
  ]
}

/** V2: example account codes so the demo can prepare a test batch. Real codes come from the accountant. */
function seedAccounting(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  o.accounting = {
    provider: uk ? 'xero' : 'quickbooks',
    codes: {
      services: '200',
      products: '210',
      tax: uk ? '820' : '2200',
      tips: '825',
      plans: '205',
      rent: '260',
      fees: '270',
      refunds: '215',
      clearing: '610',
    },
  }
}

/** V2: Theo rents the styling chair by the week from 21 September; two weeks paid, this week owed. */
function seedRent(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const amountMinor = (uk ? 180 : 220) * 100
  o.rentals = [
    {
      id: 'rental-theo',
      staffId: 'staff-theo',
      space: 'chair',
      resourceId: 'chair-one',
      amountMinor,
      every: 'week',
      from: '2026-09-21',
      createdAt: instantFor(state, '2026-09-15', 600),
      actor: 'Owner',
    },
  ]
  // He paid the first week in cash when he was next in, and the second by bank transfer.
  const paid: [string, 'cash' | 'bank_transfer', string][] = [
    ['2026-09-21', 'cash', instantFor(state, '2026-09-22', 590)],
    ['2026-09-28', 'bank_transfer', instantFor(state, '2026-09-28', 660)],
  ]
  o.rentPayments = paid.map(([periodStart, method, paidAt], i) => ({
    id: `rent-payment-${i + 1}`,
    rentalId: 'rental-theo',
    periodStart,
    amountMinor,
    method,
    ...(method === 'bank_transfer' ? { reference: `THEO-RENT-${i + 1}` } : {}),
    paidAt,
    actor: 'Front desk',
  }))
}

/** V2: holidays and a sick day for the team, with yearly allowances. Fictional. */
function seedTimeOff(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const away: [string, string, string, 'holiday' | 'sick', string, string?][] = [
    ['staff-maya', '2026-08-10', '2026-08-14', 'holiday', instantFor(state, '2026-06-01', 600)],
    ['staff-theo', '2026-09-17', '2026-09-17', 'sick', instantFor(state, '2026-09-17', 485)],
    [
      'staff-sophia',
      '2026-10-19',
      '2026-10-23',
      'holiday',
      instantFor(state, '2026-07-01', 600),
      'Family wedding',
    ],
  ]
  o.timeOff = away.map(([staffId, from, to, kind, createdAt, note], i) => ({
    id: `time-off-${i + 1}`,
    staffId,
    from,
    to,
    kind,
    ...(note ? { note } : {}),
    createdAt,
    actor: 'Owner',
  }))
  o.leaveAllowances = state.staff.map((person) => ({ staffId: person.id, days: uk ? 28 : 15 }))
}

/** V2: commission rates for the team, so Pay has figures to show. Fictional. */
function seedPay(state: BusinessState) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const rates: [string, number, number, string][] = [
    // person, services %, products %, from
    ['staff-maya', 40, 10, '2026-01-01'],
    ['staff-sophia', 35, 10, '2026-01-01'],
    ['staff-theo', 30, 10, '2026-01-01'],
    ['staff-theo', 35, 10, '2026-09-01'],
  ]
  o.payRates = rates.map(([staffId, services, products, from], i) => ({
    id: `pay-rate-${i + 1}`,
    staffId,
    serviceBps: services * 100,
    productBps: products * 100,
    from,
    createdAt: instantFor(state, from, 600),
    actor: 'Owner',
  }))
}

/** V5: the starter branch checklist and one visit, so Branch visits has something to show. */
function seedBranchVisits(state: BusinessState) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const items = STARTER_CHECKLIST.items.map((text, i) => ({ id: `check-line-${i + 1}`, text }))
  o.checklists = [{ id: 'checklist-1', name: STARTER_CHECKLIST.name, items, archived: false }]
  const answers: Record<number, ['no' | 'na', string]> = {
    3: ['no', 'Two serums out of stock on the shelf; order placed.'],
    4: ['na', 'Counted at close instead.'],
  }
  o.branchVisits = [
    {
      id: 'branch-visit-1',
      locationId: state.organisation.locationId,
      checklistId: 'checklist-1',
      checklistName: STARTER_CHECKLIST.name,
      date: '2026-10-02',
      answers: items.map((item, i) => ({
        itemId: item.id,
        text: item.text,
        answer: answers[i]?.[0] ?? 'yes',
        ...(answers[i] ? { note: answers[i][1] } : {}),
      })),
      note: 'A calm, well-run Friday. Thank the team for the window display.',
      recordedAt: instantFor(state, '2026-10-02', 1050),
      actor: 'Owner',
    },
  ]
}

/**
 * V2: a small shelf of products. Guests buy them with about one visit in six; deliveries keep the
 * shelf stocked, the treatment rooms use oil and peel, and one guest bought body oil without a
 * visit. Stock never runs below zero, and only the enzyme peel is low today.
 */
function seedStock(
  state: BusinessState,
  uk: boolean,
  random: Random,
  at: (date: string, minutes: number) => string,
) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const price = (gbp: number, usd: number) => (uk ? gbp : usd) * 100
  const shelf: [string, string, number, number, number, number, number, boolean?][] = [
    // id, name, price £, price $, cost £, left today, reorder at, for sale
    ['cleansing-balm', 'Calming Cleansing Balm', 32, 38, 12, 6, 4],
    ['hydrating-serum', 'Hydrating Serum', 48, 56, 18, 5, 4],
    ['mineral-spf', 'Daily Mineral SPF 30', 28, 34, 10, 9, 5],
    ['hair-mask', 'Restorative Hair Mask', 26, 30, 9, 4, 3],
    ['body-oil', 'Nourishing Body Oil', 38, 44, 14, 4, 3],
    ['massage-oil', 'Massage Oil, 1 litre', 0, 0, 22, 3, 2, false],
    ['enzyme-peel', 'Enzyme Peel, professional size', 0, 0, 30, 1, 2, false],
  ]
  for (const [id, name, gbp, usd, cost, , reorderAt, forSale = true] of shelf)
    o.products.push({
      id: `product-${id}`,
      name,
      sku: id.toUpperCase(),
      priceMinor: price(gbp, usd),
      reorderAt,
      archived: false,
      forSale,
      costMinor: price(cost, Math.round(cost * 1.2)),
    })
  const product = (id: string) => o.products.find((p) => p.id === `product-${id}`)!
  const out: { productId: string; quantity: number; at: string }[] = []
  // Products bought with a visit, matched to the treatment.
  const picks: Record<string, string[][]> = {
    Skin: [
      ['hydrating-serum'],
      ['cleansing-balm'],
      ['mineral-spf'],
      ['hydrating-serum', 'mineral-spf'],
    ],
    Body: [['body-oil']],
    Hair: [['hair-mask']],
  }
  const done = state.appointments.filter(
    (a) => a.status === 'completed' && a.date >= '2026-09-01' && a.date < DEMO_DATE,
  )
  // Amelia took home a serum and sun cream after her last facial, and Ellie a hair mask today.
  const named: Record<string, string[]> = {
    'history-amelia-7': ['hydrating-serum', 'mineral-spf'],
    'visit-ellie': ['hair-mask'],
  }
  const regulars = done.filter((a) => a.id.startsWith('visit-r'))
  for (const a of [...regulars, ...state.appointments.filter((a) => named[a.id])]) {
    if (!named[a.id] && random() >= 0.17) continue
    const category = state.services.find((s) => s.id === a.serviceId)!.category
    const options = picks[category]
    const sale = state.sales.find((x) => x.appointmentId === a.id)!
    const settlement = state.payments.find((p) => p.saleId === sale.id)!
    const chosen = named[a.id] ?? options[Math.floor(random() * options.length)]
    const lines = chosen.map((id) => ({
      productId: product(id).id,
      name: product(id).name,
      quantity: 1,
      unitMinor: product(id).priceMinor,
    }))
    const subtotalMinor = lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0)
    sale.retail = {
      lines,
      subtotalMinor,
      taxMinor: 0,
      taxRateBps: 0,
      taxInclusive: false,
      taxLabel: '',
    }
    sale.totalMinor += subtotalMinor
    sale.balanceMinor += subtotalMinor
    settlement.amountMinor += subtotalMinor
    const event = state.events.find((e) => e.id === `event-checkout-${a.id}`)!
    event.detail = `Bought ${lines.map((line) => line.name).join(' and ')}. ${event.detail}`
    for (const line of lines) {
      o.movements.push({
        id: `movement-sold-${line.productId}-${a.id}`,
        productId: line.productId,
        quantity: -line.quantity,
        reason: 'retail',
        note: 'Sold with the visit',
        createdAt: sale.paidAt,
        actor: 'Front desk',
        appointmentId: a.id,
        saleId: sale.id,
      })
      out.push({ productId: line.productId, quantity: line.quantity, at: sale.paidAt })
    }
  }
  // A guest who popped in for body oil without a visit.
  const oil = product('body-oil')
  const counterLine = { productId: oil.id, name: oil.name, quantity: 1, unitMinor: oil.priceMinor }
  const popped = at('2026-10-03', 900)
  state.counterSales = [
    {
      id: 'counter-sale-1',
      organisationId: state.organisation.id,
      clientId: 'client-5',
      staffId: 'staff-sophia',
      receiptNumber: 'SC-1',
      currency: state.organisation.currency,
      retail: {
        lines: [counterLine],
        subtotalMinor: oil.priceMinor,
        taxMinor: 0,
        taxRateBps: 0,
        taxInclusive: false,
        taxLabel: '',
      },
      totalMinor: oil.priceMinor,
      paidAt: popped,
      method: 'demo_cash',
      actor: 'Front desk',
    },
  ]
  o.movements.push({
    id: 'movement-sold-counter-1',
    productId: oil.id,
    quantity: -1,
    reason: 'retail',
    note: 'Sold without a visit on receipt SC-1',
    createdAt: popped,
    actor: 'Front desk',
    counterSaleId: 'counter-sale-1',
  })
  out.push({ productId: oil.id, quantity: 1, at: popped })
  // The treatment rooms use up a bottle of massage oil every thirty or so body treatments, and an
  // enzyme peel every thirty or so facials.
  const used: [string, string][] = [
    ['massage-oil', 'Body'],
    ['enzyme-peel', 'Skin'],
  ]
  for (const [id, category] of used) {
    const treatments = done.filter(
      (a) => state.services.find((s) => s.id === a.serviceId)!.category === category,
    )
    const every = 30
    treatments
      .filter((_, i) => i % every === every - 1)
      .forEach((a) => {
        o.movements.push({
          id: `movement-used-${id}-${a.id}`,
          productId: `product-${id}`,
          quantity: -1,
          reason: 'consumed',
          note: 'Used in treatment',
          createdAt: at(a.date, a.startMinutes + a.bookedDurationMinutes),
          actor: 'Front desk',
          appointmentId: a.id,
        })
        out.push({ productId: `product-${id}`, quantity: 1, at: at(a.date, a.startMinutes) })
      })
  }
  // Deliveries: the opening order on 1 September covers the first three weeks, and a second on
  // 22 September brings each product up to what is on the shelf today.
  const second = at('2026-09-22', 600)
  for (const [id, , , , , left] of shelf) {
    const productId = `product-${id}`
    const gone = out.filter((m) => m.productId === productId)
    const early = gone.filter((m) => m.at < second).reduce((sum, m) => sum + m.quantity, 0)
    const total = gone.reduce((sum, m) => sum + m.quantity, 0)
    const opening = Math.max(early + 2, Math.ceil((total + left) * 0.6))
    const later = Math.max(0, total + left - opening)
    o.movements.push({
      id: `movement-received-${id}`,
      productId,
      quantity: opening,
      reason: 'received',
      note: 'September delivery',
      createdAt: at('2026-09-01', 570),
      actor: 'Front desk',
    })
    if (later)
      o.movements.push({
        id: `movement-received-${id}-2`,
        productId,
        quantity: later,
        reason: 'received',
        note: 'Delivery',
        createdAt: second,
        actor: 'Front desk',
      })
  }
}

/**
 * V1.5: two calls nobody could answer this morning, one from Emily, who is due back, and a guest
 * who has told the desk from her private link that she has arrived. NEXT-17: and one call the AI
 * receptionist answered.
 */
function seedArrivals(
  state: BusinessState,
  uk: boolean,
  at: (date: string, minutes: number) => string,
) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const time = (hour: number, minute: number) => at(DEMO_DATE, hour * 60 + minute)
  o.missedCalls = [
    {
      id: 'missed-call-1',
      number: uk ? '+447700900014' : '+12125550113',
      at: time(8, 52),
      lastAt: time(9, 4),
      calls: 2,
      source: 'phone',
      clientId: 'client-14',
      actor: 'Phone line',
    },
    {
      id: 'missed-call-2',
      number: uk ? '+447700900456' : '+12125550199',
      at: time(10, 41),
      lastAt: time(10, 41),
      calls: 1,
      source: 'desk',
      actor: 'Front desk',
    },
  ]
  // NEXT-17: a call the AI receptionist answered while the desk was with a guest.
  o.answeredCalls = [
    {
      id: 'answered-call-1',
      number: uk ? '+447700900321' : '+12125550142',
      at: time(9, 37),
      seconds: 160,
      turns: [
        { from: 'guest', text: 'Hello, have you got anything for a facial on Saturday morning?' },
        {
          from: 'receptionist',
          text: `Yes, the Skin Renewal Facial with Maya Lewis is free on Saturday at ${uk ? '10:30' : '10:30 AM'}. I can text you a link to book it. Nothing is booked until you confirm there.`,
        },
        {
          from: 'guest',
          text: 'Yes please. And could someone tell me if I can bring my sister along?',
        },
        {
          from: 'receptionist',
          text: 'I have texted you the link. I will pass your question about your sister to the team, and they will come back to you.',
        },
      ],
      texted: [
        uk
          ? 'Skin Renewal Facial with Maya Lewis, Saturday 10 October at 10:30'
          : 'Skin Renewal Facial with Maya Lewis, Saturday, October 10 at 10:30 AM',
      ],
      message: {
        name: 'Hannah Cole',
        contact: uk ? '07700 900321' : '(212) 555-0142',
        message: 'Can I bring my sister along to my facial on Saturday? She would like one too.',
      },
    },
  ]
  const noor = state.appointments.find((a) => a.id === 'visit-noor')
  if (!noor) return
  noor.guestHereAt = time(10, 42)
  state.events.push({
    organisationId: state.organisation.id,
    id: 'event-arrived-visit-noor',
    clientId: noor.clientId,
    appointmentId: noor.id,
    type: 'arrived',
    title: 'Said they have arrived',
    detail: 'The guest tapped “I’ve arrived” on their private link. The desk welcomes them.',
    occurredAt: noor.guestHereAt,
    actor: 'Guest (private link)',
  })
}

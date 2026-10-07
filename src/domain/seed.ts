import { DEMO_DATE, parseState } from './model'
import type { Appointment, BusinessState, Region } from './model'
import { addDays, dateLabel, timeLabel } from './format'

export function seed(region: Region): BusinessState {
  const uk = region === 'UK'
  const organisationId = uk ? 'org-atelier-london' : 'org-atelier-new-york'
  const scope = { organisationId }
  const createdAt = '2026-06-01T12:00:00.000Z'
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
      ['Ruby Taylor', 'Weekend availability is best.'],
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
      createdAt,
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
    ],
    staff: [
      {
        ...scope,
        id: 'staff-maya',
        name: 'Maya Lewis',
        role: 'Skin & wellbeing',
        serviceIds: ['service-facial', 'service-restore'],
        tone: 'sage',
      },
      {
        ...scope,
        id: 'staff-sophia',
        name: 'Sophia Reed',
        role: 'Body & skin',
        serviceIds: ['service-lymphatic', 'service-restore', 'service-facial'],
        tone: 'blue',
      },
      {
        ...scope,
        id: 'staff-theo',
        name: 'Theo Bennett',
        role: 'Hair & styling',
        serviceIds: ['service-cut'],
        tone: 'sand',
      },
    ],
    resources: [
      { ...scope, id: 'room-one', name: 'Treatment room 1', type: 'treatment' },
      { ...scope, id: 'room-two', name: 'Treatment room 2', type: 'treatment' },
      { ...scope, id: 'chair-one', name: 'Styling chair', type: 'chair' },
    ],
    appointments: [],
    sales: [],
    payments: [],
    events: [],
    relationships: [
      {
        ...scope,
        id: 'relationship-amelia-olivia',
        fromClientId: 'client-1',
        toClientId: 'client-2',
        type: 'referral',
        createdAt: '2026-07-07T12:00:00.000Z',
      },
    ],
  }
  function visit(
    id: string,
    clientIndex: number,
    serviceId: string,
    staffId: string,
    resourceId: string,
    date: string,
    startMinutes: number,
    status: Appointment['status'] = 'completed',
  ) {
    const service = state.services.find((s) => s.id === serviceId)!
    const bookedAt = `${addDays(date, -7)}T12:00:00.000Z`
    const appointment: Appointment = {
      ...scope,
      id,
      clientId: `client-${clientIndex}`,
      locationId: state.organisation.locationId,
      serviceId,
      staffId,
      resourceId,
      date,
      startMinutes,
      status,
      source: 'desk',
      createdAt: bookedAt,
      bookedPriceMinor: service.priceMinor,
      bookedDepositMinor: service.depositMinor,
      bookedDurationMinutes: service.durationMinutes,
      bookedBufferMinutes: service.bufferMinutes,
    }
    state.appointments.push(appointment)
    state.payments.push({
      ...scope,
      id: `deposit-${id}`,
      appointmentId: id,
      amountMinor: service.depositMinor,
      currency: state.organisation.currency,
      kind: 'deposit',
      method: 'demo_card',
      recordedAt: bookedAt,
    })
    state.events.push({
      ...scope,
      id: `event-booked-${id}`,
      clientId: appointment.clientId,
      appointmentId: id,
      type: 'booked',
      title: 'Appointment booked',
      detail: `${service.name} · ${dateLabel(date, state.organisation.locale)} at ${timeLabel(startMinutes, state.organisation.locale)}`,
      occurredAt: bookedAt,
      actor: 'Front desk · demo fixture',
    })
    if (status === 'completed') {
      const tip = uk ? 0 : Math.round(service.priceMinor * 0.15)
      const paidAt = `${date}T12:00:00.000Z`
      const saleId = `sale-${id}`
      state.sales.push({
        ...scope,
        id: saleId,
        appointmentId: id,
        currency: state.organisation.currency,
        serviceMinor: service.priceMinor,
        tipMinor: tip,
        depositAppliedMinor: service.depositMinor,
        totalMinor: service.priceMinor + tip,
        balanceMinor: service.priceMinor + tip - service.depositMinor,
        paidAt,
        method: 'demo_card',
      })
      state.payments.push({
        ...scope,
        id: `settlement-${id}`,
        appointmentId: id,
        saleId,
        amountMinor: service.priceMinor + tip - service.depositMinor,
        currency: state.organisation.currency,
        kind: 'settlement',
        method: 'demo_card',
        recordedAt: paidAt,
      })
      state.events.push({
        ...scope,
        id: `event-checkout-${id}`,
        clientId: appointment.clientId,
        appointmentId: id,
        saleId,
        type: 'checkout',
        title: 'Visit completed',
        detail: `${service.name}. Demo receipt recorded.`,
        occurredAt: paidAt,
        actor: 'Front desk · demo fixture',
      })
    }
  }
  for (let day = 1; day <= 28; day++) {
    visit(
      `history-skin-${day}`,
      (day % 7) + 1,
      'service-facial',
      'staff-maya',
      'room-one',
      addDays(DEMO_DATE, -day),
      570,
    )
    if (day % 3 !== 0)
      visit(
        `history-body-${day}`,
        ((day + 2) % 7) + 1,
        'service-restore',
        'staff-sophia',
        'room-two',
        addDays(DEMO_DATE, -day),
        660,
      )
    if (day % 4 === 0)
      visit(
        `history-hair-${day}`,
        ((day + 4) % 7) + 1,
        'service-cut',
        'staff-theo',
        'chair-one',
        addDays(DEMO_DATE, -day),
        780,
      )
  }
  for (let i = 8; i <= 15; i++)
    visit(
      `history-return-${i}`,
      i,
      i === 9 ? 'service-cut' : 'service-facial',
      i === 9 ? 'staff-theo' : 'staff-maya',
      i === 9 ? 'chair-one' : 'room-one',
      addDays(DEMO_DATE, -28 - i),
      600,
    )
  visit('visit-amelia', 1, 'service-facial', 'staff-maya', 'room-one', DEMO_DATE, 570, 'arrived')
  visit('visit-olivia', 2, 'service-lymphatic', 'staff-sophia', 'room-two', DEMO_DATE, 540)
  visit('visit-ellie', 3, 'service-cut', 'staff-theo', 'chair-one', DEMO_DATE, 540)
  visit('visit-noor', 4, 'service-facial', 'staff-maya', 'room-one', DEMO_DATE, 660, 'confirmed')
  visit(
    'visit-ava',
    5,
    'service-lymphatic',
    'staff-sophia',
    'room-two',
    DEMO_DATE,
    660,
    'confirmed',
  )
  visit('visit-grace', 6, 'service-cut', 'staff-theo', 'chair-one', DEMO_DATE, 660, 'confirmed')
  visit('visit-zoe', 7, 'service-facial', 'staff-maya', 'room-one', DEMO_DATE, 810, 'confirmed')
  visit('visit-nina', 8, 'service-restore', 'staff-sophia', 'room-two', DEMO_DATE, 840, 'confirmed')
  visit('visit-luca', 9, 'service-cut', 'staff-theo', 'chair-one', DEMO_DATE, 840, 'confirmed')
  visit('visit-ruby', 10, 'service-restore', 'staff-maya', 'room-one', DEMO_DATE, 900, 'confirmed')
  visit(
    'visit-isabel',
    11,
    'service-facial',
    'staff-sophia',
    'room-two',
    DEMO_DATE,
    960,
    'confirmed',
  )
  visit('visit-sophie', 12, 'service-cut', 'staff-theo', 'chair-one', DEMO_DATE, 960, 'confirmed')
  state.events.push({
    ...scope,
    id: 'event-amelia-note',
    clientId: 'client-1',
    type: 'note',
    title: 'A familiar rhythm',
    detail: 'Amelia prefers Maya and the quiet room. Offer her a Tuesday when rebooking.',
    occurredAt: '2026-09-01T13:00:00.000Z',
    actor: 'Maya · demo fixture',
  })
  state.events.push({
    ...scope,
    id: 'event-amelia-referral',
    clientId: 'client-1',
    type: 'relationship',
    title: 'Introduced Olivia to the studio',
    detail: 'Referral relationship recorded with both client records.',
    occurredAt: '2026-07-07T12:00:00.000Z',
    actor: 'Front desk · demo fixture',
  })
  // V1.5: private feedback from a few recent guests, so the owner's feedback page has substance.
  const answers: [string, number, number, string][] = [
    ['history-skin-1', 5, 5, 'Maya remembered exactly what worked last time. My skin feels calm.'],
    ['history-skin-2', 5, 5, ''],
    ['history-skin-3', 4, 5, 'Lovely as ever. The room was a little cool to start.'],
    ['history-skin-5', 5, 4, ''],
    ['history-body-1', 5, 5, 'Sophia was wonderful. I slept so well that night.'],
    ['history-body-2', 4, 4, ''],
    ['history-body-4', 3, 4, 'Started ten minutes late, but the treatment itself was very good.'],
    ['history-hair-4', 5, 5, 'Best cut I have had in years.'],
    ['history-hair-8', 4, 5, ''],
  ]
  state.feedback = answers.flatMap(([appointmentId, visitRating, practitionerRating, comment]) => {
    const a = state.appointments.find((item) => item.id === appointmentId)
    if (!a || a.status !== 'completed') return []
    return [
      {
        ...scope,
        id: `feedback-${appointmentId}`,
        appointmentId,
        clientId: a.clientId,
        staffId: a.staffId,
        visitRating,
        practitionerRating,
        comment,
        createdAt: `${addDays(a.date, 1)}T09:00:00.000Z`,
      },
    ]
  })
  return parseState(state, region)
}

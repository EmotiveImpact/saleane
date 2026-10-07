import type { WaitlistTime } from './waitlistSchema'
import { DEMO_DATE, parseState } from './model'
import type { Appointment, BusinessState, Region } from './model'
import { addDays, dateLabel, timeLabel } from './format'
import { defaultOperations } from './operations'

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
      // V1.5: a few guests shared their birthday, month and day only.
      ...(i === 0 ? { birthday: '10-09' } : i === 4 ? { birthday: '03-14' } : {}),
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
        serviceIds: ['service-cut', 'service-gloss'],
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
  seedStock(state, uk)
  seedSuppliers(state)
  seedPay(state)
  seedTimeOff(state, uk)
  seedRent(state, uk)
  seedAccounting(state, uk)
  seedArrivals(state, uk)
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
      createdAt: `${addDays(DEMO_DATE, -2)}T10:00:00.000Z`,
    }),
  )
  // V1.5: two gift cards on sale already, so the desk can try spending one at checkout.
  const soldOn = addDays(DEMO_DATE, -12)
  const lastDay = (years: number) => `${Number(soldOn.slice(0, 4)) + years}${soldOn.slice(4)}`
  const years = region === 'US' ? 5 : 2
  state.giftCards = [
    {
      ...scope,
      id: 'gift-1',
      code: 'LAKE-7K4M-2QHN',
      kind: 'money' as const,
      valueMinor: uk ? 7500 : 10000,
      clientId: 'client-2',
      purchaserName: state.clients.find((c) => c.id === 'client-2')!.name,
      recipientName: 'Her sister',
      message: 'For a quiet hour just for you.',
      issuedOn: soldOn,
      expiresOn: lastDay(years),
      soldAt: `${soldOn}T11:20:00.000Z`,
      actor: 'Sample front desk',
      payment: {
        id: 'gift-pay-1',
        amountMinor: uk ? 7500 : 10000,
        method: 'demo_card' as const,
        recordedAt: `${soldOn}T11:20:00.000Z`,
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
      purchaserName: 'Daniel Okafor',
      recipientName: 'Amara',
      message: 'Happy anniversary.',
      issuedOn: soldOn,
      expiresOn: lastDay(years),
      soldAt: `${soldOn}T15:05:00.000Z`,
      actor: 'Sample front desk',
      payment: {
        id: 'gift-pay-2',
        amountMinor: uk ? 9500 : 12500,
        method: 'demo_cash' as const,
        recordedAt: `${soldOn}T15:05:00.000Z`,
      },
      redemptions: [],
      extensions: [],
      status: 'active' as const,
      refunds: [],
    },
  ]
  // V1.5: three colour visits later this week: one guest is clear, one is waiting for the result
  // and one has no patch test yet, so the desk and the reminder have something to show.
  const later = (days: number) => addDays(DEMO_DATE, days)
  visit(
    'visit-gloss-ellie',
    3,
    'service-gloss',
    'staff-theo',
    'chair-one',
    later(2),
    600,
    'confirmed',
  )
  visit(
    'visit-gloss-grace',
    6,
    'service-gloss',
    'staff-theo',
    'chair-one',
    later(3),
    600,
    'confirmed',
  )
  visit(
    'visit-gloss-luca',
    9,
    'service-gloss',
    'staff-theo',
    'chair-one',
    later(4),
    600,
    'confirmed',
  )
  const tested = (days: number) => `${addDays(DEMO_DATE, -days)}T10:30:00.000Z`
  state.patchTests = [
    {
      ...scope,
      id: 'patch-1',
      clientId: 'client-3',
      testedAt: tested(9),
      product: 'Gloss toner 9.1 with 2% developer',
      staffId: 'staff-theo',
      notes: '',
      recordedAt: tested(9),
      actor: 'Theo Bennett · demo fixture',
      result: {
        outcome: 'clear' as const,
        notes: 'No redness after 48 hours.',
        at: `${addDays(DEMO_DATE, -7)}T11:00:00.000Z`,
        actor: 'Theo Bennett · demo fixture',
      },
    },
    {
      ...scope,
      id: 'patch-2',
      clientId: 'client-6',
      testedAt: tested(1),
      product: 'Gloss toner 8.3 with 2% developer',
      staffId: 'staff-theo',
      notes: 'Behind the left ear.',
      recordedAt: tested(1),
      actor: 'Theo Bennett · demo fixture',
    },
  ]
  // V1.5: an ordinary form for haircuts, and one guest who has filled it in already.
  const fixture = 'Theo Bennett · demo fixture'
  state.forms = [
    {
      ...scope,
      id: 'form-cut',
      serviceIds: ['service-cut'],
      when: 'every_visit',
      versions: [
        {
          version: 1,
          publishedAt: `${addDays(DEMO_DATE, -30)}T09:00:00.000Z`,
          publishedBy: fixture,
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
      submittedAt: `${addDays(DEMO_DATE, -1)}T19:12:00.000Z`,
    },
  ]
  // V1.5: one guest agreed to email news on the booking page; another agreed at the desk and later
  // stopped it from their visit link. The others were recorded before these records began. Version
  // 1 is SALEANE's standard wording, frozen in the studio's own name when someone next agrees.
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
      recordedAt: `${addDays(DEMO_DATE, -30)}T09:41:00.000Z`,
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
      recordedAt: `${addDays(DEMO_DATE, -21)}T11:05:00.000Z`,
      actor: 'Maya · demo operator',
    },
    {
      ...scope,
      id: 'consent-3',
      clientId: 'client-4',
      channel: 'email',
      purpose: 'marketing',
      given: false,
      source: 'guest link',
      recordedAt: `${addDays(DEMO_DATE, -6)}T20:17:00.000Z`,
      actor: 'Guest (private link)',
    },
  ]
  return parseState(state, region)
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
      createdAt: '2026-10-02T10:00:00.000Z',
      actor: 'Maya · demo fixture',
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
      createdAt: '2026-09-15T09:00:00.000Z',
      actor: 'Owner · demo fixture',
    },
  ]
  const paid: [string, 'cash' | 'bank_transfer'][] = [
    ['2026-09-21', 'cash'],
    ['2026-09-28', 'bank_transfer'],
  ]
  o.rentPayments = paid.map(([periodStart, method], i) => ({
    id: `rent-payment-${i + 1}`,
    rentalId: 'rental-theo',
    periodStart,
    amountMinor,
    method,
    ...(method === 'bank_transfer' ? { reference: `THEO-RENT-${i + 1}` } : {}),
    paidAt: `${periodStart}T10:00:00.000Z`,
    actor: 'Front desk · demo fixture',
  }))
}

/** V2: holidays and a sick day for the demo team, with yearly allowances. Fictional. */
function seedTimeOff(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const away: [string, string, string, 'holiday' | 'sick', string?][] = [
    ['staff-maya', '2026-08-10', '2026-08-14', 'holiday'],
    ['staff-theo', '2026-09-30', '2026-09-30', 'sick'],
    ['staff-sophia', '2026-10-19', '2026-10-23', 'holiday', 'Family wedding'],
  ]
  o.timeOff = away.map(([staffId, from, to, kind, note], i) => ({
    id: `time-off-${i + 1}`,
    staffId,
    from,
    to,
    kind,
    ...(note ? { note } : {}),
    createdAt: '2026-07-01T09:00:00.000Z',
    actor: 'Owner · demo fixture',
  }))
  o.leaveAllowances = state.staff.map((person) => ({ staffId: person.id, days: uk ? 28 : 15 }))
}

/** V2: commission rates for the demo team, so Pay has figures to show. Fictional. */
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
    createdAt: `${from}T09:00:00.000Z`,
    actor: 'Owner · demo fixture',
  }))
}

/**
 * V2: a small shelf of products, a delivery, products used in treatments and two receipts that
 * included products, so Stock and the Business figures have something real to show.
 */
function seedStock(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const price = (gbp: number, usd: number) => (uk ? gbp : usd) * 100
  const shelf: [string, string, number, number, number, number, number, boolean?][] = [
    // id, name, price £, price $, cost £, delivered, reorder at, for sale
    ['cleansing-balm', 'Calming Cleansing Balm', 32, 38, 12, 10, 4],
    ['hydrating-serum', 'Hydrating Serum', 48, 56, 18, 6, 4],
    ['mineral-spf', 'Daily Mineral SPF 30', 28, 34, 10, 12, 5],
    ['hair-mask', 'Restorative Hair Mask', 26, 30, 9, 8, 3],
    ['body-oil', 'Nourishing Body Oil', 38, 44, 14, 5, 3],
    ['massage-oil', 'Massage Oil, 1 litre', 0, 0, 22, 4, 2, false],
    ['enzyme-peel', 'Enzyme Peel, professional size', 0, 0, 30, 2, 2, false],
  ]
  for (const [id, name, gbp, usd, cost, delivered, reorderAt, forSale = true] of shelf) {
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
    o.movements.push({
      id: `movement-received-${id}`,
      productId: `product-${id}`,
      quantity: delivered,
      reason: 'received',
      note: 'September delivery',
      createdAt: '2026-09-15T10:00:00.000Z',
      actor: 'Front desk · demo fixture',
    })
  }
  const used: [string, string, number][] = [
    ['massage-oil', 'history-body-1', 1],
    ['enzyme-peel', 'history-skin-2', 1],
  ]
  for (const [product, appointmentId, quantity] of used)
    if (state.appointments.some((a) => a.id === appointmentId))
      o.movements.push({
        id: `movement-used-${product}-${appointmentId}`,
        productId: `product-${product}`,
        quantity: -quantity,
        reason: 'consumed',
        note: 'Used in treatment',
        createdAt: '2026-09-20T12:00:00.000Z',
        actor: 'Front desk · demo fixture',
        appointmentId,
      })
  const bought: [string, [string, number][]][] = [
    [
      'history-skin-1',
      [
        ['hydrating-serum', 1],
        ['mineral-spf', 1],
      ],
    ],
    ['history-hair-4', [['hair-mask', 1]]],
  ]
  // A guest who popped in for body oil without a visit.
  const oil = o.products.find((p) => p.id === 'product-body-oil')!
  const counterLine = { productId: oil.id, name: oil.name, quantity: 1, unitMinor: oil.priceMinor }
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
      paidAt: '2026-10-03T15:00:00.000Z',
      method: 'demo_cash',
      actor: 'Front desk · demo fixture',
    },
  ]
  o.movements.push({
    id: 'movement-sold-counter-1',
    productId: oil.id,
    quantity: -1,
    reason: 'retail',
    note: 'Sold without a visit on receipt SC-1',
    createdAt: '2026-10-03T15:00:00.000Z',
    actor: 'Front desk · demo fixture',
    counterSaleId: 'counter-sale-1',
  })
  for (const [appointmentId, items] of bought) {
    const sale = state.sales.find((x) => x.appointmentId === appointmentId)
    const settlement = state.payments.find((p) => p.saleId === sale?.id)
    if (!sale || !settlement) continue
    const lines = items.map(([product, quantity]) => {
      const item = o.products.find((p) => p.id === `product-${product}`)!
      return { productId: item.id, name: item.name, quantity, unitMinor: item.priceMinor }
    })
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
    for (const line of lines)
      o.movements.push({
        id: `movement-sold-${line.productId}-${appointmentId}`,
        productId: line.productId,
        quantity: -line.quantity,
        reason: 'retail',
        note: 'Sold with the visit',
        createdAt: sale.paidAt,
        actor: 'Front desk · demo fixture',
        appointmentId,
        saleId: sale.id,
      })
  }
}

/**
 * V1.5: two calls nobody could answer this morning, one from a client, and a guest who has told
 * the desk from her private link that she has arrived.
 */
function seedArrivals(state: BusinessState, uk: boolean) {
  const o = (state.operations ??= defaultOperations('sandbox'))
  const at = (hour: number, minute: number) =>
    `${DEMO_DATE}T${String(hour - (uk ? 1 : -4)).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
  o.missedCalls = [
    {
      id: 'missed-call-1',
      number: uk ? '+447700900002' : '+12125550101',
      at: at(8, 52),
      lastAt: at(9, 4),
      calls: 2,
      source: 'phone',
      clientId: 'client-2',
      actor: 'Phone line',
    },
    {
      id: 'missed-call-2',
      number: uk ? '+447700900456' : '+12125550199',
      at: at(10, 41),
      lastAt: at(10, 41),
      calls: 1,
      source: 'desk',
      actor: 'Front desk · demo fixture',
    },
  ]
  const noor = state.appointments.find((a) => a.id === 'visit-noor')
  if (noor) noor.guestHereAt = at(10, 52)
}

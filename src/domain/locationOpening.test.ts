import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { places, serviceAt, staffLocationOn } from './locations'
import { monthBill, planDate } from './billing'
import type { BillingView } from './billing'
import {
  bookedWeekdays,
  openDays,
  openingBill,
  openingCommand,
  openingDraft,
  openingImpact,
  openingProblem,
  startingRooms,
} from './locationOpening'
import type { OpeningDraft } from './locationOpening'

// "Add a location": the change its last screen saves, and what each screen still needs.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `opening-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** A local studio with the sample menu, team and rooms, and no visits. */
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Two-site studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
const where = (s: BusinessState, patch: Partial<OpeningDraft> = {}): OpeningDraft => ({
  ...openingDraft(s),
  name: 'Islington',
  address: '1 Upper Street, London',
  ...patch,
})

describe('add a location', () => {
  it('starts with every treatment at the house price and no one working there', () => {
    const s = studio()
    const draft = openingDraft(s)
    expect(Object.keys(draft.menu)).toEqual(s.services.filter((x) => !x.archived).map((x) => x.id))
    expect(draft.menu['service-facial']).toEqual({ offered: true, price: '95.00' })
    expect(draft.ownHours).toBe(false)
    expect(openingCommand(s, where(s))).toMatchObject({
      location: { name: 'Islington', address: '1 Upper Street, London' },
      team: [],
      newTeam: [],
      notOffered: [],
      prices: [],
    })
  })

  it('suggests a room and a chair named after the location, for what its menu needs', () => {
    const s = studio()
    expect(startingRooms(s, where(s)).map((r) => [r.name, r.type])).toEqual([
      ['Islington room 1', 'treatment'],
      ['Islington chair 1', 'chair'],
    ])
    // Without the hair treatments, no chair is needed.
    const menu = Object.fromEntries(
      s.services.map((x) => [x.id, { offered: x.category !== 'Hair', price: '' }]),
    )
    expect(startingRooms(s, where(s, { menu })).map((r) => r.type)).toEqual(['treatment'])
  })

  it('saves its menu, rooms, hours and team in one change that opens it for booking', () => {
    const s = studio()
    const hours = openingDraft(s).hours.map((h) => (h.day === 1 ? { ...h, closed: true } : h))
    const draft = where(s, {
      ownHours: true,
      hours,
      menu: {
        ...openingDraft(s).menu,
        'service-facial': { offered: true, price: '105' },
        'service-lymphatic': { offered: false, price: '120.00' },
      },
      rooms: [
        { key: 'a', name: 'Islington room 1', type: 'treatment' },
        { key: 'b', name: 'Islington chair 1', type: 'chair' },
      ],
      // Monday is closed here, so that day is left out.
      days: { 'staff-maya': [1, 4] },
      newTeam: [
        { key: 'n', name: 'Ines Duarte', role: 'Stylist', serviceIds: ['service-cut'], days: [5] },
      ],
    })
    expect(openDays(s, draft).has(1)).toBe(false)
    const command = openingCommand(s, draft)
    expect(command).toMatchObject({
      team: [{ staffId: 'staff-maya', days: [4] }],
      notOffered: ['service-lymphatic'],
      prices: [{ serviceId: 'service-facial', priceMinor: 10500 }],
    })
    for (const step of ['where', 'hours', 'treatments', 'rooms', 'team'] as const)
      expect(openingProblem(s, step, draft)).toBeNull()
    const after = apply(s, command)
    const islington = places(after).find((p) => p.name === 'Islington')!
    expect(staffLocationOn(after, 'staff-maya', '2026-10-08')).toBe(islington.id)
    expect(
      serviceAt(
        after.services.find((x) => x.id === 'service-facial')!,
        islington.id,
      ),
    ).toMatchObject({
      priceMinor: 10500,
    })
    expect(after.staff.find((p) => p.name === 'Ines Duarte')).toBeTruthy()
  })

  it('says what each screen still needs', () => {
    const s = studio()
    const draft = where(s)
    expect(openingProblem(s, 'where', { ...draft, name: '' })).toMatch(/Give the location a name/)
    expect(openingProblem(s, 'where', { ...draft, name: s.organisation.locationName })).toBe(
      'Another location already has that name.',
    )
    expect(openingProblem(s, 'where', { ...draft, address: '' })).toBe(
      'Add the address so guests can find it.',
    )
    expect(openingProblem(s, 'where', { ...draft, email: 'nope' })).toMatch(/email address/)
    expect(
      openingProblem(s, 'hours', {
        ...draft,
        ownHours: true,
        hours: draft.hours.map((h) => ({ ...h, closed: true })),
      }),
    ).toBe('Open on one day at least.')
    const none = Object.fromEntries(s.services.map((x) => [x.id, { offered: false, price: '' }]))
    expect(openingProblem(s, 'treatments', { ...draft, menu: none })).toBe(
      'Offer one treatment here at least.',
    )
    expect(openingProblem(s, 'rooms', draft)).toBe('Add a room or chair here.')
    expect(
      openingProblem(s, 'rooms', {
        ...draft,
        rooms: [{ key: 'a', name: 'Islington room 1', type: 'treatment' }],
      }),
    ).toMatch(/needs a styling chair/)
    expect(openingProblem(s, 'team', draft)).toBe('Choose who works here, and on which days.')
    expect(
      openingProblem(s, 'team', {
        ...draft,
        newTeam: [{ key: 'n', name: 'Ines', role: 'Stylist', serviceIds: [], days: [5] }],
      }),
    ).toBe('Tick the treatments Ines gives.')
  })

  it('keeps the house rules: core treatments stay and prices stay in the band', () => {
    const s = apply(studio(), {
      type: 'house-rules',
      priceBandPercent: 10,
      coreServiceIds: ['service-facial'],
    } as Command)
    const draft = where(s)
    expect(
      openingProblem(s, 'treatments', {
        ...draft,
        menu: { ...draft.menu, 'service-facial': { offered: false, price: '95.00' } },
      }),
    ).toBe('Skin Renewal Facial is a core treatment, so it stays on every location’s menu.')
    expect(
      openingProblem(s, 'treatments', {
        ...draft,
        menu: { ...draft.menu, 'service-cut': { offered: true, price: '99' } },
      }),
    ).toBe('Under the house rules Signature Cut & Finish stays within 10% of the house price.')
  })

  it('shows the visits a day here would strand before anything is saved', () => {
    const booked = apply(studio(), {
      type: 'book',
      input: {
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-08',
        startMinutes: 600,
        clientId: 'client-1',
        source: 'desk',
      },
    } as Command)
    expect([...bookedWeekdays(booked, 'staff-maya', now)]).toEqual([4])
    const thursday = where(booked, { days: { 'staff-maya': [4] } })
    const impact = openingImpact(booked, thursday, now)
    expect(impact).toHaveLength(1)
    expect(impact[0].reason).toContain('working at another location that day')
    expect(openingProblem(booked, 'team', thursday, impact)).toMatch(
      /would lose their professional/,
    )
    // Another day has nothing booked.
    expect(openingImpact(booked, where(booked, { days: { 'staff-maya': [2] } }), now)).toEqual([])
  })
})

describe('what one more location does to the bill', () => {
  const org = createWorkspace({
    name: 'Linden Studio',
    region: 'UK',
    locationName: 'Bath',
  }).organisation
  const ends = Date.parse('2026-10-23T09:00:00.000Z')
  const plan = (extra: Partial<BillingView> = {}): BillingView => ({
    status: 'trial',
    stopReason: null,
    region: 'UK',
    test: false,
    trialEndsAt: ends,
    periodStart: null,
    periodEnd: null,
    plus: false,
    plusNext: false,
    phone: false,
    phoneNext: false,
    phoneConnected: false,
    cancelAtPeriodEnd: false,
    card: null,
    locations: 1,
    people: 3,
    nextBill: { at: ends, bill: monthBill('UK', 1, false, 3) },
    overdue: null,
    lockAt: null,
    locked: false,
    checking: false,
    held: false,
    invoices: [],
    moreBills: null,
    ai: {
      typed: { used: 0, of: 300 },
      guestChats: { used: 0, of: 200 },
      talkSeconds: { used: 0, of: 1800 },
      phoneSeconds: { used: 0, of: 0 },
    },
    ...extra,
  })

  it('gives the whole monthly bill before and after, with VAT, and takes nothing during a trial', () => {
    const bill = openingBill(plan(), org)
    expect(bill.before.totalMinor).toBe(7080)
    expect(bill.after.totalMinor).toBe(14160)
    expect(bill.heading).toBe(
      'Your monthly bill goes from £70.80 to £141.60, including VAT at 20%.',
    )
    expect(bill.detail).toBe(
      `Your first bill is on ${planDate(org, ends)}, when the free trial ends. Nothing is taken during the trial.`,
    )
  })

  it('starts the new amount with the next bill, never part way through a month', () => {
    const bill = openingBill(
      plan({ status: 'active', periodStart: ends - 30 * 86400000, periodEnd: ends, locations: 2 }),
      org,
    )
    expect(bill.heading).toBe(
      'Your monthly bill goes from £141.60 to £212.40, including VAT at 20%.',
    )
    expect(bill.detail).toBe(
      `The new amount starts with your next bill on ${planDate(org, ends)}. Nothing is taken today.`,
    )
  })

  it('counts Plus for the new location too', () => {
    const bill = openingBill(plan({ plusNext: true }), org)
    expect(bill.heading).toBe(
      'Your monthly bill, with Plus, goes from £117.60 to £235.20, including VAT at 20%.',
    )
  })

  it('says so when card payments are in test mode', () => {
    expect(openingBill(plan({ test: true }), org).detail).toMatch(
      /Card payments are in test mode, so nothing is charged\.$/,
    )
  })

  it('takes nothing when the plan is ending or owed', () => {
    expect(
      openingBill(plan({ status: 'active', periodEnd: ends, cancelAtPeriodEnd: true }), org).detail,
    ).toBe(`Your plan stops on ${planDate(org, ends)}, so nothing more is taken.`)
    expect(openingBill(plan({ status: 'overdue' }), org).detail).toBe(
      'The new amount starts with the monthly bill after the one that is owed. Nothing more is taken today.',
    )
  })

  it('counts the new hires who take bookings, as the next bill will', () => {
    // Five people already, all included; a second location includes five more, and six new
    // professionals make eleven, so one is paid for.
    const bill = openingBill(plan({ people: 5 }), org, 6)
    expect(bill.before.totalMinor).toBe(7080)
    expect(bill.after.totalMinor).toBe(14160 + 1080)
    expect(bill.heading).toBe(
      'Your monthly bill goes from £70.80 to £152.40, including VAT at 20%.',
    )
  })

  it('leaves US sales tax to the provider', () => {
    const us = createWorkspace({ name: 'Linden Studio', region: 'US', locationName: 'Austin' })
    expect(openingBill(plan({ region: 'US' }), us.organisation).heading).toBe(
      'Your monthly bill goes from $69.00 to $138.00, plus any sales tax.',
    )
  })
})

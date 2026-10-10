import { describe, expect, test } from 'vitest'
import {
  DAY_MS,
  billingNotice,
  lockedMessage,
  monthAfter,
  monthBill,
  nextRetry,
  peopleChange,
  plusBill,
  readOnlyMessage,
  taxed,
  trialDaysLeft,
} from './billing'
import { ALLOWANCES, RETRY_DAYS, allowanceFor, bookingPeople, extraPeople } from './pricing'
import { seed } from './seed'

const at = (iso: string) => Date.parse(iso)

// NEXT-02: the pure parts of a studio paying for SALEANE.
describe('the billing month', () => {
  test('runs to the same day next month, at the same time', () => {
    expect(new Date(monthAfter(at('2026-10-09T14:30:00Z'), 9)).toISOString()).toBe(
      '2026-11-09T14:30:00.000Z',
    )
    expect(new Date(monthAfter(at('2026-12-20T00:00:00Z'), 20)).toISOString()).toBe(
      '2027-01-20T00:00:00.000Z',
    )
  })
  test('ends on the last day of a shorter month, then returns to its own day', () => {
    const feb = monthAfter(at('2027-01-31T09:00:00Z'), 31)
    expect(new Date(feb).toISOString()).toBe('2027-02-28T09:00:00.000Z')
    expect(new Date(monthAfter(feb, 31)).toISOString()).toBe('2027-03-31T09:00:00.000Z')
    expect(new Date(monthAfter(at('2028-01-30T09:00:00Z'), 30)).toISOString()).toBe(
      '2028-02-29T09:00:00.000Z',
    )
  })
})

describe('a bill', () => {
  test('adds VAT at 20% in the UK and leaves US sales tax to the card service', () => {
    const uk = monthBill('UK', 1, false, 0)
    expect(uk).toMatchObject({
      subtotalMinor: 4900,
      taxMinor: 980,
      taxLabel: 'VAT at 20%',
      totalMinor: 5880,
    })
    expect(uk.lines).toEqual([
      { text: 'SALEANE, 1 location', quantity: 1, unitMinor: 4900, amountMinor: 4900 },
    ])
    const us = monthBill('US', 1, false, 0)
    expect(us).toMatchObject({ subtotalMinor: 5900, taxMinor: 0, taxLabel: null, totalMinor: 5900 })
  })
  test('charges each location, and Plus for each location', () => {
    const bill = monthBill('UK', 3, true, 0)
    expect(bill.lines.map((line) => [line.text, line.amountMinor])).toEqual([
      ['SALEANE, 3 locations', 14700],
      ['Plus, 3 locations', 11700],
    ])
    expect(bill.totalMinor).toBe(Math.round(26400 * 1.2))
    // A studio with no locations listed still has its main one.
    expect(monthBill('UK', 0, false, 0).lines[0].quantity).toBe(1)
  })
  test('charges each person taking bookings beyond the five each location includes', () => {
    // One location and seven people: two more, at £9 each.
    const uk = monthBill('UK', 1, false, 7)
    expect(
      uk.lines.map((line) => [line.text, line.quantity, line.unitMinor, line.amountMinor]),
    ).toEqual([
      ['SALEANE, 1 location', 1, 4900, 4900],
      ['2 more people taking bookings, beyond the 5 included', 2, 900, 1800],
    ])
    expect(uk.totalMinor).toBe(Math.round(6700 * 1.2))
    // The included places are shared across a group: two locations include ten people.
    expect(monthBill('US', 2, false, 11).lines.slice(1)).toEqual([
      {
        text: '1 more person taking bookings, beyond the 10 included',
        quantity: 1,
        unitMinor: 1200,
        amountMinor: 1200,
      },
    ])
    expect(monthBill('UK', 3, true, 12).lines.map((line) => line.text)).toEqual([
      'SALEANE, 3 locations',
      'Plus, 3 locations',
    ])
    expect(monthBill('UK', 1, false, 5).lines).toHaveLength(1)
    expect(extraPeople(6, 0)).toBe(1)
  })
  test('counts only the people who take bookings', () => {
    const s = seed('UK')
    const offered = s.services.find((item) => !item.archived)!
    const person = (id: string, serviceIds: string[], archived?: boolean) => ({
      ...s.staff[0],
      id,
      serviceIds,
      ...(archived ? { archived } : {}),
    })
    const retired = { ...offered, id: 'service-retired', archived: true }
    const team = {
      services: [...s.services, retired],
      staff: [
        person('takes-bookings', [offered.id]),
        person('left', [offered.id], true),
        person('front-desk', []),
        person('only-retired-treatment', [retired.id]),
      ],
    }
    expect(bookingPeople(team)).toBe(1)
    // The sample studio's professionals all take bookings.
    expect(bookingPeople(s)).toBe(s.staff.filter((p) => !p.archived && p.serviceIds.length).length)
  })
  test('tells the owner when saving a professional moves the bill', () => {
    const s = seed('UK')
    const offered = s.services.find((item) => !item.archived)!
    const five = {
      ...s,
      staff: Array.from({ length: 5 }, (_, i) => ({
        ...s.staff[0],
        id: `p${i}`,
        archived: false,
        serviceIds: [offered.id],
      })),
    }
    expect(peopleChange(five, 1, { serviceIds: [offered.id] })).toBe(
      'Saving makes 6 people taking bookings, and your location includes 5, so the monthly bill goes up by £9, plus VAT, from the next bill.',
    )
    // Reception, a second location's five, and an unchanged edit leave the bill alone.
    expect(peopleChange(five, 1, { serviceIds: [] })).toBe('')
    expect(peopleChange(five, 2, { serviceIds: [offered.id] })).toBe('')
    expect(peopleChange(five, 1, { id: 'p0', serviceIds: [offered.id] })).toBe('')
    const six = { ...five, staff: [...five.staff, { ...five.staff[0], id: 'p5' }] }
    expect(peopleChange(six, 1, { id: 'p5', serviceIds: [offered.id], archived: true })).toBe(
      'Saving brings the people taking bookings to 5, so the monthly bill goes down by £9, plus VAT, from the next bill.',
    )
    const us = { ...six, organisation: seed('US').organisation }
    expect(peopleChange(us, 1, { id: 'p5', serviceIds: [] })).toContain(
      'goes down by $12, plus any sales tax,',
    )
  })
  test('rounds VAT to the penny', () => {
    expect(taxed('UK', [{ text: 'x', quantity: 1, unitMinor: 1, amountMinor: 1 }]).taxMinor).toBe(0)
    expect(taxed('UK', [{ text: 'x', quantity: 1, unitMinor: 3, amountMinor: 3 }]).taxMinor).toBe(1)
  })
  test('charges Plus added part way through a month only for the days left', () => {
    const start = at('2026-10-01T00:00:00Z')
    const end = at('2026-11-01T00:00:00Z')
    const bill = plusBill('UK', 1, at('2026-10-11T00:00:00Z'), start, end)
    expect(bill.lines[0].text).toBe('Plus, 1 location, for the 21 days left of 31')
    expect(bill.lines[0].amountMinor).toBe(Math.round((3900 * 21) / 31))
    expect(plusBill('UK', 2, start, start, end).lines[0].amountMinor).toBe(7800)
    expect(plusBill('UK', 1, end, start, end).lines[0].amountMinor).toBe(0)
  })
})

test('tries a declined card again on days 1, 3 and 7, then stops trying', () => {
  const since = at('2026-10-09T10:00:00Z')
  expect(nextRetry(since, since, RETRY_DAYS)).toBe(since + DAY_MS)
  expect(nextRetry(since, since + DAY_MS, RETRY_DAYS)).toBe(since + 3 * DAY_MS)
  expect(nextRetry(since, since + 3 * DAY_MS + 1, RETRY_DAYS)).toBe(since + 7 * DAY_MS)
  expect(nextRetry(since, since + 7 * DAY_MS, RETRY_DAYS)).toBeNull()
})

test('counts part of a trial day as a day, and never below nought', () => {
  const now = at('2026-10-09T10:00:00Z')
  expect(trialDaysLeft(now + 14 * DAY_MS, now)).toBe(14)
  expect(trialDaysLeft(now + 1, now)).toBe(1)
  expect(trialDaysLeft(now - DAY_MS, now)).toBe(0)
})

test('gives each location its own AI, Plus more, and a stopped studio none', () => {
  expect(allowanceFor({ locations: 1, plus: false }).monthly).toEqual(ALLOWANCES.included.monthly)
  const three = allowanceFor({ locations: 3, plus: true })
  expect(three.monthly).toEqual({ typed: 2400, talkSeconds: 27000, guestChats: 1500 })
  expect(three.dailySpendCeilingMinor).toBe(1200)
  expect(three.monthlySpendCeilingMinor).toBe(18000)
  // One person and one talk keep the same limits however big the studio is.
  expect(three.perPersonHourly).toBe(ALLOWANCES.plus.perPersonHourly)
  const paused = allowanceFor({ locations: 2, plus: false, paused: true })
  expect(paused.monthly).toEqual({ typed: 0, talkSeconds: 0, guestChats: 0 })
  expect(paused.dailySpendCeilingMinor).toBe(0)
  expect(paused.monthlySpendCeilingMinor).toBe(0)
})

describe('the line above every screen', () => {
  const org = seed('UK').organisation
  const now = at('2026-10-09T10:00:00Z')
  test('tells everyone a read only studio is read only, and only the owner how to pay', () => {
    const stopped = { readOnly: true }
    expect(billingNotice(stopped, 'manager', org, now)).toEqual({
      tone: 'stopped',
      text: 'This studio is read only until the owner pays its SALEANE bill. You can still see everything. Nothing has been lost, and guests can still book.',
    })
    expect(
      billingNotice({ readOnly: true, stopReason: 'unpaid', hasCard: true }, 'owner', org, now),
    ).toMatchObject({ tone: 'stopped', action: 'Pay now' })
    expect(
      billingNotice(
        { readOnly: true, stopReason: 'trial_ended', hasCard: false },
        'owner',
        org,
        now,
      ),
    ).toMatchObject({ text: expect.stringContaining('free trial has ended'), action: 'Add a card' })
    expect(
      billingNotice({ readOnly: true, stopReason: 'cancelled', hasCard: true }, 'owner', org, now),
    ).toMatchObject({ action: 'Start again' })
  })
  test('tells everyone the day a read only studio locks', () => {
    const lockAt = at('2026-11-08T10:00:00Z')
    expect(billingNotice({ readOnly: true, lockAt }, 'reception', org, now)?.text).toBe(
      'This studio is read only until the owner pays its SALEANE bill. You can still see everything. Nothing has been lost, and guests can still book. On 8 November 2026 it locks, and only the owner will be able to open it.',
    )
    expect(
      billingNotice(
        { readOnly: true, lockAt, stopReason: 'unpaid', hasCard: true },
        'owner',
        org,
        now,
      )?.text,
    ).toBe(
      'The SALEANE bill is unpaid, so the studio is read only. Nothing has been lost, and guests can still book. On 8 November 2026 it locks: only you will be able to open it, and online booking closes.',
    )
    expect(lockedMessage('owner')).toMatch(/^This studio is locked until its SALEANE bill is paid/)
    expect(lockedMessage('manager')).toBe(
      'This studio is locked until the owner pays its SALEANE bill. Nothing has been deleted.',
    )
  })
  test('warns only the owner about a missed payment, with the last day', () => {
    const due = {
      readOnly: false,
      status: 'overdue' as const,
      graceEndsAt: at('2026-10-23T10:00:00Z'),
    }
    expect(billingNotice(due, 'owner', org, now)).toEqual({
      tone: 'due',
      text: 'We could not take this month’s SALEANE payment. Pay, or use another card, by 23 October 2026 to keep everything working.',
      action: 'Pay now',
    })
    expect(billingNotice(due, 'manager', org, now)).toBeNull()
  })
  test('reminds the owner in the last week of a trial with no card, and not before', () => {
    const trial = (days: number, hasCard = false) => ({
      readOnly: false,
      status: 'trial' as const,
      trialEndsAt: now + days * DAY_MS,
      hasCard,
    })
    expect(billingNotice(trial(10), 'owner', org, now)).toBeNull()
    expect(billingNotice(trial(7), 'owner', org, now)).toMatchObject({
      tone: 'soon',
      text: 'Your free trial ends on 16 October 2026. Add a card to carry on without a break.',
      action: 'Add a card',
    })
    expect(billingNotice(trial(3, true), 'owner', org, now)).toBeNull()
    expect(billingNotice(trial(3), 'reception', org, now)).toBeNull()
    expect(billingNotice(null, 'owner', org, now)).toBeNull()
  })
  test('says the same thing when a change is refused', () => {
    expect(readOnlyMessage('owner')).toContain('Pay in Settings, Plan and billing.')
    expect(readOnlyMessage('reception')).toContain('until the owner pays')
  })
})

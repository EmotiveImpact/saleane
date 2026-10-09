import { describe, expect, it } from 'vitest'
import { cancellationTerms, civilTime, whenLabel } from './bookingTerms'

const uk = {
  date: '2026-10-07',
  startMinutes: 600,
  timeZone: 'Europe/London',
  locale: 'en-GB',
  cutoffHours: 24,
}
// 10:00 on Wednesday 7 October in London is 09:00Z; the cutoff is 09:00Z the day before.
const before = Date.parse('2026-10-05T12:00:00.000Z')
const after = Date.parse('2026-10-06T09:30:00.000Z')

describe('the cancellation rule shown before a guest confirms', () => {
  it('names the cutoff on the studio’s clock, with the day written out', () => {
    const terms = cancellationTerms({ ...uk, depositMinor: 2000, feePercent: 0, now: before })
    expect(terms.cutoff).toBe('Tuesday 6 October at 10:00')
    expect(terms.cutoffAt).toBe(Date.parse('2026-10-06T09:00:00.000Z'))
    expect(terms.passed).toBe(false)
    expect(terms.rule).toBe(
      'Free to cancel until Tuesday 6 October at 10:00, and the studio refunds your deposit. After that it keeps the deposit.',
    )
  })

  it('says the deposit is kept once the visit is less than a day away', () => {
    const terms = cancellationTerms({ ...uk, depositMinor: 2000, feePercent: 0, now: after })
    expect(terms.passed).toBe(true)
    expect(terms.rule).toBe(
      'Your visit is less than 24 hours away, so if you cancel or miss it, the studio keeps your deposit.',
    )
  })

  it('adds the studio’s late cancellation charge, less any deposit', () => {
    expect(cancellationTerms({ ...uk, depositMinor: 2000, feePercent: 50, now: before }).rule).toBe(
      'Free to cancel until Tuesday 6 October at 10:00, and the studio refunds your deposit. After that it keeps the deposit, and for a late cancellation or a missed visit it may charge up to 50% of the price, less the deposit.',
    )
    expect(cancellationTerms({ ...uk, depositMinor: 0, feePercent: 50, now: before }).rule).toBe(
      'Free to cancel until Tuesday 6 October at 10:00. After that, or if you miss your visit, the studio may charge up to 50% of the price.',
    )
    expect(cancellationTerms({ ...uk, depositMinor: 0, feePercent: 50, now: after }).rule).toBe(
      'Your visit is less than 24 hours away, so if you cancel or miss it, the studio may charge up to 50% of the price.',
    )
    expect(cancellationTerms({ ...uk, depositMinor: 2000, feePercent: 50, now: after }).rule).toBe(
      'Your visit is less than 24 hours away, so if you cancel or miss it, the studio keeps your deposit and may charge up to 50% of the price, less the deposit.',
    )
  })

  it('keeps it simple when there is no deposit and no charge', () => {
    expect(cancellationTerms({ ...uk, depositMinor: 0, feePercent: 0, now: after }).rule).toBe(
      'Free to cancel online any time before your visit.',
    )
  })

  it('counts 24 real hours across a clock change, and writes US times in 12-hour form', () => {
    // 10:00 GMT on Sunday 25 October, the morning the clocks go back: a day earlier was 11:00 BST.
    expect(
      cancellationTerms({ ...uk, date: '2026-10-25', depositMinor: 2000, feePercent: 0, now: 0 })
        .cutoff,
    ).toBe('Saturday 24 October at 11:00')
    const us = cancellationTerms({
      date: '2026-11-02',
      startMinutes: 540,
      timeZone: 'America/New_York',
      locale: 'en-US',
      cutoffHours: 24,
      depositMinor: 2500,
      feePercent: 0,
      now: 0,
    })
    expect(us.cutoff).toBe('Sunday, November 1 at 09:00 AM')
  })

  it('writes a date and time out in the studio’s words', () => {
    expect(whenLabel('2026-11-03', 870, 'en-GB')).toBe('Tuesday 3 November at 14:30')
    expect(whenLabel('2026-11-03', 870, 'en-US')).toBe('Tuesday, November 3 at 02:30 PM')
    expect(civilTime(Date.parse('2026-10-06T23:30:00.000Z'), 'Europe/London')).toEqual({
      date: '2026-10-07',
      minutes: 30,
    })
  })
})

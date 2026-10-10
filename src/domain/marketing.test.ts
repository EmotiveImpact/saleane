import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import {
  BOOKED_WITHIN_DAYS,
  audienceChanges,
  isAutomaticOn,
  marketingResults,
  tallyWords,
} from './marketing'
import type { SentCopy } from './marketing'
import type { BusinessState } from './model'

// NEXT-14: what Marketing counts. Only what SALEANE recorded: the sender's answers, stop links
// used and visits booked afterwards.
const DAY = 86400000
const at = (iso: string) => Date.parse(iso)
const copy = (over: Partial<SentCopy>): SentCopy => ({
  kind: 'news',
  slot: 'news:m1',
  clientId: 'client-1',
  status: 'accepted',
  createdAt: at('2026-10-01T09:00:00Z'),
  updatedAt: at('2026-10-01T09:05:00Z'),
  ...over,
})
function studio() {
  const s = seed('UK')
  // Visits booked for client-1 a week after the message, and for client-2 three weeks after.
  const base = s.appointments[0]
  const booked = (id: string, clientId: string, createdAt: string, source = 'online') => ({
    ...base,
    id,
    clientId,
    createdAt,
    source: source as typeof base.source,
    status: 'confirmed' as const,
  })
  s.appointments = [
    ...s.appointments.filter((a) => !['client-1', 'client-2', 'client-3'].includes(a.clientId)),
    booked('b1', 'client-1', '2026-10-08T10:00:00Z'),
    booked('b1b', 'client-1', '2026-10-09T10:00:00Z'),
    booked('b2', 'client-2', '2026-10-22T10:00:00Z'),
    // An imported visit is history, not a booking.
    booked('b3', 'client-3', '2026-10-03T10:00:00Z', 'import'),
  ]
  return s
}

describe('marketing results', () => {
  it('counts what the sender accepted, what was not sent, and who booked within two weeks', () => {
    const s = studio()
    const copies = [
      copy({ clientId: 'client-1' }),
      copy({ clientId: 'client-2', status: 'delivered' }),
      copy({ clientId: 'client-3' }),
      copy({ clientId: 'client-5', status: 'failed' }),
      copy({ clientId: 'client-6', status: 'skipped' }),
      copy({ clientId: 'client-7', status: 'pending' }),
      copy({ clientId: 'client-8', status: 'unknown' }),
      // Another campaign this person may not see is left out.
      copy({ slot: 'news:other', clientId: 'client-1' }),
    ]
    const results = marketingResults(
      s,
      copies,
      [{ messageId: 'm1', usedAt: at('2026-10-02T08:00:00Z') }],
      {
        campaignIds: ['m1'],
        automatic: false,
        now: at('2026-10-10T09:00:00Z'),
      },
    )
    expect(results.campaigns).toEqual([
      { id: 'm1', sent: 3, test: 0, notSent: 2, waiting: 2, stopped: 1, booked: 1 },
    ])
    expect(results.automatic).toBeUndefined()
    expect(results.months).toEqual([
      {
        month: '2026-10',
        campaigns: [{ id: 'm1', sent: 3, test: 0, notSent: 2, waiting: 2, stopped: 1, booked: 1 }],
        automatic: [],
        stoppedAll: 0,
      },
    ])
    expect(tallyWords(results.campaigns[0], true)).toBe(
      '3 sent · 2 still going · 2 not sent · 1 stopped hearing from you · 1 booked within two weeks',
    )
    expect(BOOKED_WITHIN_DAYS).toBe(14)
  })

  it('never counts a test-mode copy as reaching anyone, nor a booking after it', () => {
    const s = studio()
    const results = marketingResults(s, [copy({ status: 'test' })], [], {
      campaignIds: ['m1'],
      automatic: true,
      now: at('2026-10-10T09:00:00Z'),
    })
    expect(results.campaigns[0]).toMatchObject({ sent: 0, test: 1, booked: 0 })
    expect(tallyWords(results.campaigns[0], true)).toBe('1 in test mode, not sent')
  })

  it('follows each automatic email by month on the studio’s calendar, and the last 30 days', () => {
    const s = studio()
    const now = at('2026-10-10T09:00:00Z')
    const results = marketingResults(
      s,
      [
        copy({ kind: 'birthday', slot: 'birthday:x', updatedAt: now - 2 * DAY }),
        copy({
          kind: 'birthday',
          slot: 'birthday:y',
          updatedAt: now - 40 * DAY,
          clientId: 'client-4',
        }),
        // 23:30 on 30 September in London is still September, though it is 1 October nowhere.
        copy({
          kind: 'miss_you',
          slot: 'miss:z',
          updatedAt: at('2026-09-30T22:30:00Z'),
          clientId: 'client-2',
        }),
        // Booking messages are not marketing and are not counted here.
        copy({ kind: 'confirmation', slot: 'visit:1' }),
      ],
      [],
      { campaignIds: [], automatic: true, now },
    )
    const birthday = results.automatic!.find((a) => a.kind === 'birthday')!
    expect(birthday).toMatchObject({ sent: 2, lastThirtyDays: 1 })
    expect(results.automatic!.find((a) => a.kind === 'aftercare')).toMatchObject({
      sent: 0,
      lastThirtyDays: 0,
    })
    expect(results.months.map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(results.months.map((m) => m.automatic.map((a) => a.kind))).toEqual([
      ['birthday'],
      ['miss_you'],
      ['birthday'],
    ])
    expect(results.months[1].automatic.find((a) => a.kind === 'miss_you')).toMatchObject({
      sent: 1,
      // client-2 booked three weeks later: too late to count.
      booked: 0,
    })
    // Every stop that month, however it was asked for: Noor stopped from her visit link.
    expect(results.months.reduce((n, m) => n + m.stoppedAll, 0)).toBe(1)
  })
})

describe('the audience', () => {
  it('counts who may hear from the studio and how people stopped, never who', () => {
    const s: BusinessState = seed('UK')
    s.consentRecords = [
      ...s.consentRecords!,
      {
        ...s.consentRecords![0],
        id: 'consent-desk-stop',
        clientId: 'client-1',
        given: false,
        wordingVersion: undefined,
        source: 'desk',
        recordedAt: '2026-10-05T10:00:00.000Z',
        actor: 'Sophia Reed',
      },
    ]
    const changes = audienceChanges(s, at('2026-10-10T09:00:00Z'))
    expect(changes.stoppedBy).toEqual({ link: 1, desk: 1, booking: 0, software: 0 })
    expect(changes.agreed).toBe(s.clients.filter((c) => c.marketingConsent).length)
    expect(changes.months[0].month).toBe('2026-10')
    expect(changes.months.reduce((n, m) => n + m.agreed + m.stopped, 0)).toBe(
      s.consentRecords.length,
    )
    expect(JSON.stringify(changes)).not.toMatch(/client-|Amelia|Noor/)
  })

  it('reads each automatic email as on unless it was switched off', () => {
    expect(isAutomaticOn({} as never, 'birthday')).toBe(true)
    expect(isAutomaticOn({ missYou: false } as never, 'miss_you')).toBe(false)
  })
})

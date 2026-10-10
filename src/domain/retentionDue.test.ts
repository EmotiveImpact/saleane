import { describe, expect, it } from 'vitest'
import { execute, dispatch } from './commands'
import type { Command } from './commands'
import { parseState } from './model'
import type { BusinessState } from './model'
import { seed } from './seed'
import { can, operations } from './operations'
import type { Role } from './operations'
import { DELETION_APPROVERS, canApproveDeletion } from './dataRetention'
import { erasureReview } from './privacy'
import { practitionerRefusal } from './practitioner'
import { areaRefusal } from './area'
import { branchRefusal } from './branch'
import { changeDetail } from './changeRecord'
import { directoryRows } from './directory'
import { dueClients } from './selectors'
import {
  FORMER_CLIENT,
  deletionMeaning,
  dueOn,
  dueRecords,
  keepUntil,
  keptRecords,
  lastActivity,
  moneyKeptUntil,
  retentionRecord,
} from './retentionDue'

// A sample studio's day is always 6 October 2026, whatever the clock says.
const TODAY = '2026-10-06'
const now = '2026-10-06T09:00:00.000Z'
let sequence = 0
const makeId = () => `test-${++sequence}`
/** The sample as the demo shows it: with the regulars, two of whom are long past their period. */
const sample = (region: 'UK' | 'US' = 'UK') => seed(region, { regulars: true })
function run(s: BusinessState, command: Command) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const refused = (s: BusinessState, command: Command) => {
  const result = execute(s, command, now, makeId)
  return result.ok ? null : result.error
}
const group = (s: BusinessState, kind: string, today = TODAY) =>
  dueRecords(s, today)
    .find((g) => g.kind === kind)
    ?.records.map((r) => r.id) ?? []

describe('records waiting for a decision in the sample studio', () => {
  it('has a few of each kind due, and none of the named clients', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = sample(region)
      expect(group(s, 'client')).toEqual(['client-former-1', 'client-former-2'])
      expect(group(s, 'feedback')).toEqual(['feedback-history-client-former-1'])
      expect(group(s, 'message')).toEqual(['message-former-2'])
      expect(group(s, 'waitlist')).toEqual(['waitlist-former-1'])
    }
    // The tests' quieter sample, without the regulars, has nothing due.
    expect(dueRecords(seed('UK'), TODAY)).toEqual([])
  })

  it('says why each record is due, in words', () => {
    const [clients] = dueRecords(sample(), TODAY)
    expect(clients.label).toBe('Client details')
    expect(clients.records[0]).toMatchObject({
      title: 'Winifred Ashby',
      why: 'Last visit 12 March 2024.',
      dueOn: '2026-03-12',
    })
  })
})

describe('when a record is due', () => {
  it('counts two years from the last visit, on the studio’s own day, through leap years', () => {
    const s = sample()
    const client = s.clients.find((c) => c.id === 'client-former-1')!
    const visit = s.appointments.find((a) => a.clientId === client.id)!
    client.createdAt = '2024-02-20T10:00:00.000Z'
    visit.date = '2024-02-29'
    // A waitlist request ending earlier does not move the date.
    expect(lastActivity(s, client.id)).toBe('2024-02-29')
    // 29 February plus two years is 28 February, since 2026 has no 29th.
    expect(dueOn(s, 'client', client.id)).toBe('2026-02-28')
    expect(group(s, 'client', '2026-02-27')).not.toContain(client.id)
    expect(group(s, 'client', '2026-02-28')).toContain(client.id)
  })

  it('keeps a month-end date at the end of the month', () => {
    const s = sample()
    const visit = s.appointments.find((a) => a.clientId === 'client-former-2')!
    visit.date = '2024-08-31'
    expect(dueOn(s, 'client', 'client-former-2')).toBe('2026-08-31')
    expect(keepUntil('2026-01-31', 1, 'months')).toBe('2026-02-28')
    expect(keepUntil('2027-01-31', 1, 'months')).toBe('2027-02-28')
    expect(keepUntil('2028-01-31', 1, 'months')).toBe('2028-02-29')
    expect(keepUntil('2026-10-06', 1, 'years')).toBe('2027-10-06')
  })

  it('counts unsent messages from the day they were written where the studio is', () => {
    const uk = sample('UK')
    const message = operations(uk).messages.find((m) => m.id === 'message-former-2')!
    // 23:30 UTC on 31 March is 00:30 on 1 April in London, after the clocks went forward.
    message.createdAt = '2026-03-31T23:30:00.000Z'
    expect(dueOn(uk, 'message', message.id)).toBe('2026-06-30')
    const us = sample('US')
    const draft = operations(us).messages.find((m) => m.id === 'message-former-2')!
    // 03:00 UTC on 1 January is still New Year's Eve in New York.
    draft.createdAt = '2026-01-01T03:00:00.000Z'
    expect(dueOn(us, 'message', draft.id)).toBe('2026-03-31')
  })

  it('never counts a message approved for sending, which may have gone out', () => {
    const s = sample()
    const message = operations(s).messages.find((m) => m.id === 'message-former-2')!
    message.approvedAt = '2026-06-04T10:00:00.000Z'
    message.status = 'queued'
    expect(group(s, 'message')).toEqual([])
  })

  it('counts waitlist requests from the last day asked for, and feedback from when it was given', () => {
    const s = sample()
    const entry = s.waitlist!.find((e) => e.id === 'waitlist-former-1')!
    entry.toDate = '2026-07-08'
    expect(dueOn(s, 'waitlist', entry.id)).toBe('2026-10-06')
    expect(group(s, 'waitlist')).toEqual([entry.id])
    entry.toDate = '2026-07-09'
    expect(group(s, 'waitlist')).toEqual([])
    const feedback = s.feedback!.find((f) => f.id === 'feedback-history-client-former-1')!
    expect(dueOn(s, 'feedback', feedback.id)).toBe('2026-03-12')
  })

  it('waits while a client has a visit booked, an active membership or money open', () => {
    const s = sample()
    const ahead = structuredClone(s)
    ahead.appointments.find((a) => a.clientId === 'client-former-1')!.date = '2026-11-02'
    expect(group(ahead, 'client')).toEqual(['client-former-2'])
    const member = structuredClone(s)
    // Only what the rule reads: whose it is, and that it is still active.
    const holding = { clientId: 'client-former-2', status: 'active', startedOn: '2024-05-16' }
    member.holdings = [holding as unknown as NonNullable<BusinessState['holdings']>[number]]
    expect(group(member, 'client')).toEqual(['client-former-1'])
    member.holdings[0].status = 'cancelled'
    expect(group(member, 'client')).toEqual(['client-former-1', 'client-former-2'])
  })

  it('counts the same guest under every record with their email', () => {
    const s = sample()
    const twin = s.clients.find((c) => c.id === 'client-1')!
    s.clients.find((c) => c.id === 'client-former-1')!.email = twin.email
    expect(group(s, 'client')).toEqual(['client-former-2'])
  })
})

describe('who decides', () => {
  it('is the owner and managers only, as the register says', () => {
    const roles: Role[] = ['owner', 'manager', 'reception', 'practitioner', 'general', 'regional']
    for (const role of roles) {
      expect(can(role, 'retention')).toBe(canApproveDeletion(role))
      expect(can(role, 'retention')).toBe((DELETION_APPROVERS as readonly string[]).includes(role))
    }
    expect(roles.filter((role) => can(role, 'retention'))).toEqual(['owner', 'manager'])
  })

  it('refuses practitioners, regional managers and general managers in their own checks too', () => {
    const s = sample()
    const commands: Command[] = [
      { type: 'retention-delete', kind: 'client', ids: ['client-former-1'] },
      {
        type: 'retention-keep',
        kind: 'feedback',
        ids: ['feedback-history-client-former-1'],
        amount: 1,
        unit: 'years',
        reason: 'A complaint is open.',
      },
    ]
    for (const command of commands) {
      expect(practitionerRefusal(s, 'staff-maya', command, TODAY)).toBeTruthy()
      expect(areaRefusal(s, 'region-any', command)).toBeTruthy()
      expect(branchRefusal(s, s.organisation.locationId, command)).toBeTruthy()
    }
  })
})

describe('approving deletion', () => {
  it('deletes a client’s details and keeps their money under Former client', () => {
    const s = sample()
    const visits = s.appointments.filter((a) => a.clientId === 'client-former-1')
    const sales = s.sales.filter((x) => visits.some((a) => a.id === x.appointmentId))
    const payments = s.payments.filter((p) => visits.some((a) => a.id === p.appointmentId))
    expect(sales.length).toBe(1)
    const next = run(s, { type: 'retention-delete', kind: 'client', ids: ['client-former-1'] })
    const client = next.clients.find((c) => c.id === 'client-former-1')!
    expect(client).toMatchObject({
      name: FORMER_CLIENT,
      phone: '',
      preferences: '',
      marketingConsent: false,
      erasedAt: now,
    })
    expect(client.email).toMatch(/@erased\.invalid$/)
    expect(JSON.stringify(next)).not.toContain('Winifred')
    expect(JSON.stringify(next)).not.toContain('winifred')
    // Receipts, payments and booked visit terms are exactly as they were.
    expect(next.appointments.filter((a) => a.clientId === client.id)).toEqual(visits)
    expect(next.sales.filter((x) => sales.some((y) => y.id === x.id))).toEqual(sales)
    expect(next.payments.filter((p) => payments.some((q) => q.id === p.id))).toEqual(payments)
    expect(next.sales.reduce((sum, x) => sum + x.totalMinor, 0)).toBe(
      s.sales.reduce((sum, x) => sum + x.totalMinor, 0),
    )
    // Everything the erasure review says could go has gone with them.
    const review = erasureReview(next, client.id, TODAY)
    expect(
      review.removable.filter(
        (item) => item.count && item.label !== 'Email address and telephone number',
      ),
    ).toEqual([])
    expect(review.kept.find((item) => item.label === 'Receipts')!.count).toBe(1)
    // Their feedback and waitlist request went with them, so they are no longer waiting either.
    expect(group(next, 'client')).toEqual(['client-former-2'])
    expect(group(next, 'feedback')).toEqual([])
    expect(group(next, 'waitlist')).toEqual([])
    // A former client is not listed, searched or asked back.
    expect(directoryRows(next).some((row) => row.client.id === client.id)).toBe(false)
    expect(dueClients(next).some((c) => c.id === client.id)).toBe(false)
    expect(parseState(structuredClone(next), 'UK')).toEqual(next)
  })

  it('withdraws email news on record, takes their name off others’ connections and gift cards', () => {
    const s = sample()
    const client = s.clients.find((c) => c.id === 'client-former-1')!
    client.marketingConsent = true
    s.relationships.push({
      organisationId: s.organisation.id,
      id: 'relationship-former',
      fromClientId: client.id,
      toClientId: 'client-2',
      type: 'referral',
      createdAt: '2024-03-12T12:00:00.000Z',
    })
    s.events.push({
      organisationId: s.organisation.id,
      id: 'event-introduced-by-winifred',
      clientId: 'client-2',
      type: 'relationship',
      title: 'Introduced by Winifred Ashby',
      detail: 'Winifred recommended the studio.',
      occurredAt: '2024-03-12T12:00:00.000Z',
      actor: 'Front desk',
    })
    const card = structuredClone(s.giftCards![0])
    s.giftCards!.push({
      ...card,
      id: 'gift-former',
      code: 'FRMR-CLNT-2345',
      payment: { ...card.payment, id: 'gift-pay-former' },
      clientId: client.id,
      purchaserName: 'Winifred Ashby',
    })
    const next = run(s, { type: 'retention-delete', kind: 'client', ids: [client.id] })
    expect(next.relationships.some((r) => r.id === 'relationship-former')).toBe(false)
    expect(next.events.find((e) => e.id === 'event-introduced-by-winifred')).toMatchObject({
      title: 'Introduced by a former client',
      detail: 'a former client recommended the studio.',
    })
    expect(next.giftCards!.find((c) => c.id === 'gift-former')!.purchaserName).toBe(FORMER_CLIENT)
    expect(next.consentRecords!.at(-1)).toMatchObject({ clientId: client.id, given: false })
    expect(JSON.stringify(next)).not.toContain('Winifred')
    expect(parseState(structuredClone(next), 'UK')).toEqual(next)
  })

  it('says what goes and what stays, with the money kept 6 years in the UK and 7 in the US', () => {
    const uk = sample('UK')
    const us = sample('US')
    expect(moneyKeptUntil(uk, 'client-former-1')).toBe('2030-03-12')
    expect(moneyKeptUntil(us, 'client-former-1')).toBe('2031-03-12')
    expect(deletionMeaning(uk, 'client', ['client-former-1', 'client-former-2']).stays).toBe(
      'Receipts, payments, deposits, refunds, gift cards, packages and booked visit terms stay under the name Former client, as the law requires, until at least 16 May 2030.',
    )
    expect(moneyKeptUntil(uk, 'client-1')).not.toBeNull()
  })

  it('deletes feedback, unsent messages and waitlist requests on their own', () => {
    let s = sample()
    s = run(s, {
      type: 'retention-delete',
      kind: 'feedback',
      ids: ['feedback-history-client-former-1'],
    })
    expect(s.feedback!.some((f) => f.id === 'feedback-history-client-former-1')).toBe(false)
    s = run(s, { type: 'retention-delete', kind: 'message', ids: ['message-former-2'] })
    expect(operations(s).messages.some((m) => m.id === 'message-former-2')).toBe(false)
    s = run(s, { type: 'retention-delete', kind: 'waitlist', ids: ['waitlist-former-1'] })
    expect(s.waitlist!.some((e) => e.id === 'waitlist-former-1')).toBe(false)
    // The clients themselves are untouched, and still waiting.
    expect(s.clients.find((c) => c.id === 'client-former-1')!.name).toBe('Winifred Ashby')
    expect(group(s, 'client')).toEqual(['client-former-1', 'client-former-2'])
  })

  it('never deletes twice, nor a record that is not due, nor part of a group', () => {
    const s = sample()
    const once = run(s, { type: 'retention-delete', kind: 'client', ids: ['client-former-1'] })
    expect(
      refused(once, { type: 'retention-delete', kind: 'client', ids: ['client-former-1'] }),
    ).toBe('Some of these records have already been deleted. Reload to see what is still waiting.')
    expect(refused(s, { type: 'retention-delete', kind: 'client', ids: ['client-1'] })).toBe(
      'Some of these records are not due for a decision. Reload to see what is still waiting.',
    )
    // One record not due stops the whole decision; nothing is deleted.
    expect(
      refused(s, {
        type: 'retention-delete',
        kind: 'client',
        ids: ['client-former-1', 'client-1'],
      }),
    ).toMatch(/not due/)
    expect(
      refused(s, { type: 'retention-delete', kind: 'message', ids: ['nothing-here'] }),
    ).toMatch(/already been deleted/)
  })

  it('records who, when, which kind and how many, never what was deleted', () => {
    const s = sample()
    const result = dispatch(
      s,
      { type: 'retention-delete', kind: 'client', ids: ['client-former-1', 'client-former-2'] },
      'Studio Owner',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    const [decision] = retentionRecord(result.state).decisions
    expect(decision).toEqual({
      id: result.recordId,
      choice: 'delete',
      kind: 'client',
      count: 2,
      at: now,
      actor: 'Studio Owner',
    })
    const detail = changeDetail(s, result.state, 'retention-delete', result.recordId)
    expect(detail).toEqual({
      fields: [
        { f: 'records', to: 'client' },
        { f: 'count', to: 2 },
      ],
    })
    const kept = JSON.stringify({ decision, detail })
    for (const word of ['Winifred', 'Gideon', 'client-former', 'example.com'])
      expect(kept).not.toContain(word)
  })

  it('happens only through a decision: a studio left alone keeps every record', () => {
    const s = sample()
    const later = run(s, { type: 'note', clientId: 'client-1', text: 'Prefers peppermint tea.' })
    expect(later.clients.find((c) => c.id === 'client-former-1')!.name).toBe('Winifred Ashby')
    expect(group(later, 'client')).toEqual(['client-former-1', 'client-former-2'])
  })
})

describe('keeping longer', () => {
  it('keeps records until a new date, years by default, with the reason, then brings them back', () => {
    const s = sample()
    const next = run(s, {
      type: 'retention-keep',
      kind: 'client',
      ids: ['client-former-1', 'client-former-2'],
      amount: 1,
      unit: 'years',
      reason: 'An open complaint about a voucher.',
    })
    expect(group(next, 'client')).toEqual([])
    expect(retentionRecord(next).kept.map((k) => [k.recordId, k.until, k.reason])).toEqual([
      ['client-former-1', '2027-10-06', 'An open complaint about a voucher.'],
      ['client-former-2', '2027-10-06', 'An open complaint about a voucher.'],
    ])
    expect(keptRecords(next, TODAY).map((k) => k.title)).toEqual([
      'Winifred Ashby',
      'Gideon Marlowe',
    ])
    // The day before, still kept; on the day, back for a decision, saying it was kept.
    expect(group(next, 'client', '2027-10-05')).toEqual([])
    const back = dueRecords(next, '2027-10-06')[0].records.find((r) => r.id === 'client-former-1')
    expect(back).toMatchObject({
      id: 'client-former-1',
      keptUntil: '2027-10-06',
      dueOn: '2027-10-06',
    })
    // Nothing about them changed.
    expect(next.clients).toEqual(s.clients)
  })

  it('keeps by months, and refuses more than ten years at once or no reason', () => {
    const s = sample()
    const months = run(s, {
      type: 'retention-keep',
      kind: 'message',
      ids: ['message-former-2'],
      amount: 3,
      unit: 'months',
      reason: 'Checking the wording.',
    })
    expect(retentionRecord(months).kept[0].until).toBe('2027-01-06')
    expect(
      refused(s, {
        type: 'retention-keep',
        kind: 'message',
        ids: ['message-former-2'],
        amount: 11,
        unit: 'years',
        reason: 'Long story.',
      }),
    ).toMatch(/10 years/)
    expect(
      refused(s, {
        type: 'retention-keep',
        kind: 'message',
        ids: ['message-former-2'],
        amount: 1,
        unit: 'years',
        reason: '',
      }),
    ).toBeTruthy()
  })

  it('drops the keep once the record is deleted, and a later visit can push the date further', () => {
    const s = sample()
    const kept = run(s, {
      type: 'retention-keep',
      kind: 'feedback',
      ids: ['feedback-history-client-former-1'],
      amount: 6,
      unit: 'months',
      reason: 'Shared with the team.',
    })
    // Deleting the client takes their feedback with them, and the keep with it.
    const gone = run(structuredClone(kept), {
      type: 'retention-delete',
      kind: 'client',
      ids: ['client-former-1'],
    })
    expect(retentionRecord(gone).kept).toEqual([])
    expect(retentionRecord(gone).decisions.map((d) => d.choice)).toEqual(['keep', 'delete'])
  })
})

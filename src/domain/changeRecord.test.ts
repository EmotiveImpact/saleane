import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import {
  actionsIn,
  automaticSource,
  changeCsv,
  changeDetail,
  changeSummary,
  changeWords,
  describeChange,
  recordNames,
  type ChangeDetail,
} from './changeRecord'

// NEXT-05: who changed what.
const at = '2026-10-06T08:00:00.000Z'
function apply(state: BusinessState, command: Command) {
  const result = dispatch(state, command, 'Ada Owner', at)
  if (!result.ok) throw new Error(result.error)
  return { after: result.state, recordId: result.recordId }
}
function entry(state: BusinessState, action: string, recordId: string, detail?: ChangeDetail) {
  return describeChange(state, recordNames(state), {
    id: 'e1',
    action,
    recordId,
    occurredAt: Date.parse(at),
    actor: 'Ada Owner',
    account: null,
    detail: detail ? JSON.stringify(detail) : null,
  })
}

describe('the words for each change', () => {
  it('has words for every change the server records', () => {
    // Every literal action passed to audit() or persist() on the server, so none reads "Made a change".
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
        f.isDirectory()
          ? files(join(dir, f.name))
          : f.name.endsWith('.ts') && !f.name.endsWith('.test.ts')
            ? [join(dir, f.name)]
            : [],
      )
    const found = new Set<string>()
    for (const file of files('server'))
      for (const match of readFileSync(file, 'utf8').matchAll(
        /(?:audit|persist)\([^;()]*?'([a-z_-]+\.[a-z_.-]+)'/g,
      ))
        found.add(match[1])
    expect(found.size).toBeGreaterThan(25)
    for (const action of found) expect(changeWords, action).toHaveProperty([action])
    // And those built from a payment's purpose (every purpose a card payment can have, refunds
    // included) or an Ask Saleane answer.
    const purposes = /purpose IN \(([^)]*)\)/.exec(readFileSync('server/database.ts', 'utf8'))![1]
    for (const purpose of purposes.match(/[a-z_]+/g)!) {
      expect(changeWords).toHaveProperty([`payment.${purpose}`])
      expect(changeWords).toHaveProperty([`payment.${purpose}.started`])
    }
    expect(actionsIn('money')).toContain('payment.refund')
    for (const outcome of ['approved', 'declined'])
      expect(changeWords).toHaveProperty([`assistant.${outcome}`])
  })

  it('finds every action of a kind, and puts each in exactly one kind', () => {
    expect(actionsIn('money')).toEqual(
      expect.arrayContaining(['checkout', 'refund', 'card.removed']),
    )
    expect(actionsIn('visits')).toContain('guest.move')
    // Stage 5: a guest moving their Google booking.
    expect(changeWords['google.move']).toEqual(['visits', 'Moved through Book with Google'])
    // Stage 5: a guest booking through ChatGPT, Claude or an assistant that did not say which.
    expect(changeWords['ai-booking.chatgpt']).toEqual(['visits', 'Booked through ChatGPT'])
    expect(changeWords['ai-booking.claude']).toEqual(['visits', 'Booked through Claude'])
    expect(changeWords['ai-booking.assistant']).toEqual([
      'visits',
      'Booked through an AI assistant',
    ])
    expect(changeWords['ai-booking']).toEqual([
      'settings',
      'Changed booking through ChatGPT or Claude',
    ])
    expect(automaticSource('ai-booking.claude')).toBe('A guest, through Claude')
    expect(automaticSource('ai-booking.assistant')).toBe('A guest, through an AI assistant')
    const all = Object.keys(changeWords)
    const grouped = (
      ['visits', 'clients', 'money', 'team', 'stock', 'messages', 'settings', 'access'] as const
    ).flatMap((group) => actionsIn(group))
    expect(grouped.sort()).toEqual(all.sort())
  })
})

describe('what changed', () => {
  it('keeps a treatment’s old and new price and length, in the studio’s money', () => {
    const before = seed('UK')
    const service = before.services.find((s) => s.id === 'service-facial')!
    const input = service
    const { after, recordId } = apply(before, {
      type: 'service',
      id: service.id,
      input: { ...input, priceMinor: 10500, durationMinutes: 75 },
    })
    const detail = changeDetail(before, after, 'service', recordId)
    expect(detail).toEqual({
      fields: [
        { f: 'durationMinutes', from: 60, to: 75 },
        { f: 'priceMinor', from: 9500, to: 10500 },
      ],
    })
    const shown = entry(after, 'service', recordId, detail)
    expect(shown).toMatchObject({
      what: 'Changed a treatment',
      about: 'Skin Renewal Facial',
      group: 'settings',
    })
    expect(changeSummary(shown)).toBe(
      'Length 60 minutes became 75 minutes. Price £95.00 became £105.00',
    )
  })

  it('says a new treatment was added, without listing every detail', () => {
    const before = seed('UK')
    const input = before.services[0]
    const { after, recordId } = apply(before, {
      type: 'service',
      input: { ...input, name: 'Brow Shape' },
    })
    const detail = changeDetail(before, after, 'service', recordId)
    expect(detail?.made).toBe('added')
    expect(entry(after, 'service', recordId, detail)).toMatchObject({
      what: 'Added a treatment',
      about: 'Brow Shape',
    })
  })

  it('keeps only which client details changed, never what they say', () => {
    const before = seed('UK')
    const client = before.clients.find((c) => c.id === 'client-1')!
    const { after, recordId } = apply(before, {
      type: 'client-edit',
      clientId: client.id,
      contact: {
        name: client.name,
        email: 'amelia.new@example.invalid',
        phone: '+44 7700 900123',
        marketingConsent: client.marketingConsent,
      },
      preferences: 'Prefers a quiet room',
    })
    const detail = changeDetail(before, after, 'client-edit', recordId)!
    const stored = JSON.stringify(detail)
    expect(stored).not.toMatch(/amelia\.new|7700|quiet room/)
    expect(detail.fields!.every((f) => !('from' in f) && !('to' in f))).toBe(true)
    const shown = entry(after, 'client-edit', recordId, detail)
    expect(shown.about).toBe('Amelia Carter')
    expect(shown.lines).toEqual([])
    expect(changeSummary(shown)).toBe('Changed email, phone and preferences')
  })

  it('keeps a moved visit’s time and professional, named', () => {
    const before = seed('UK')
    const visit = before.appointments.find((a) => a.id === 'visit-noor')!
    const { after, recordId } = apply(before, {
      type: 'reschedule',
      appointmentId: visit.id,
      date: '2026-10-08',
      startMinutes: 900,
      staffId: 'staff-sophia',
    })
    const detail = changeDetail(before, after, 'reschedule', recordId)
    const shown = entry(after, 'reschedule', recordId, detail)
    expect(shown.what).toBe('Moved a visit')
    expect(shown.about).toMatch(/^.+, Skin Renewal Facial, Thu 8 Oct at 15:00$/)
    const summary = changeSummary(shown)
    expect(summary).toContain('Date 6 October 2026 became 8 October 2026')
    expect(summary).toContain('Time 11:00 became 15:00')
    expect(summary).toContain('Professional Maya Lewis became Sophia Reed')
  })

  it('keeps what was taken at checkout, including a discount', () => {
    const before = seed('UK')
    const visit = before.appointments.find((a) => a.id === 'visit-noor')!
    const arrived = apply(before, { type: 'arrive', appointmentId: visit.id }).after
    const { after, recordId } = apply(arrived, {
      type: 'checkout',
      appointmentId: visit.id,
      tipMinor: 500,
      method: 'demo_card',
      discountMinor: 1000,
    } as Command)
    const detail = changeDetail(arrived, after, 'checkout', recordId)!
    expect(detail.made).toBe('added')
    const shown = entry(after, 'checkout', recordId, detail)
    expect(shown.what).toBe('Took payment for a visit')
    expect(shown.about).toMatch(/Skin Renewal Facial/)
    const summary = changeSummary(shown)
    expect(summary).toContain('Discount: £10.00')
    expect(summary).toContain('Tip: £5.00')
    expect(summary).toContain('Paid by: Demo card')
  })

  it('puts opening hours day by day', () => {
    const before = seed('UK')
    const hours = before.operations!.hours.map((h) =>
      h.day === 1 ? { ...h, closed: false, open: 600, close: 1020 } : h,
    )
    const { after, recordId } = apply(before, { type: 'hours', hours })
    const detail = changeDetail(before, after, 'hours', recordId)
    const shown = entry(after, 'hours', recordId, detail)
    expect(changeSummary(shown)).toMatch(/^Monday (09:00 to 18:00|closed) became 10:00 to 17:00$/)
  })

  it('records nothing extra when nothing useful changed', () => {
    const before = seed('UK')
    expect(changeDetail(before, before, 'service', 'service-facial')).toBeUndefined()
    expect(changeDetail(before, before, 'note', 'no-such-record')).toBeUndefined()
  })

  it('shows a change of access in words, and survives a damaged detail', () => {
    const state = seed('UK')
    const shown = describeChange(state, recordNames(state), {
      id: 'e2',
      action: 'membership.changed',
      recordId: 'account-x',
      occurredAt: Date.parse(at),
      actor: 'Ada Owner',
      account: 'Rae Desk',
      detail: JSON.stringify({ fields: [{ f: 'access', from: 'reception', to: 'manager' }] }),
    })
    expect(shown).toMatchObject({
      what: 'Changed someone’s access',
      about: 'Rae Desk',
      group: 'access',
    })
    expect(changeSummary(shown)).toBe('Access Reception became Manager')
    expect(entry(state, 'service', 'service-facial', undefined).lines).toEqual([])
    const broken = describeChange(state, recordNames(state), {
      id: 'e3',
      action: 'something.new',
      recordId: 'x',
      occurredAt: 0,
      actor: null,
      account: null,
      detail: '{not json',
    })
    expect(broken).toMatchObject({
      what: 'Made a change',
      who: 'SALEANE',
      person: false,
      lines: [],
    })
  })

  it('names who made a change nobody signed in made', () => {
    const state = seed('UK')
    const who = (action: string) =>
      describeChange(state, recordNames(state), {
        id: action,
        action,
        recordId: 'visit-noor',
        occurredAt: 0,
        actor: null,
        account: null,
        detail: null,
      }).who
    expect(who('public.book')).toBe('A guest booking online')
    expect(who('guest.move')).toBe('A guest, from their visit link')
    expect(who('google.book')).toBe('A guest, through Google')
    expect(who('receptionist.message')).toBe('The AI receptionist')
    expect(who('workspace.restored')).toBe('A backup on this computer')
  })

  it('downloads as a spreadsheet in the studio’s time, with formulas kept as text', () => {
    const state = seed('UK')
    const csv = changeCsv(state, [
      {
        id: 'e1',
        at: Date.parse('2026-10-06T08:05:00.000Z'),
        who: '=Ada',
        person: true,
        group: 'settings',
        what: 'Changed a treatment',
        about: 'Skin Renewal Facial',
        lines: [{ what: 'price', from: '£95.00', to: '£105.00' }],
        others: [],
      },
    ])
    expect(csv).toBe(
      'When,Who,Kind,What,About,Details\n' +
        "2026-10-06 09:05,'=Ada,Settings,Changed a treatment,Skin Renewal Facial,Price £95.00 became £105.00\n",
    )
  })
})

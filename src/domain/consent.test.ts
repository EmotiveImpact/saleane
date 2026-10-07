import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { BookingInput, Command } from './commands'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import { can } from './operations'
import { consentHistory, currentWording, standardWording, wordingFor } from './consent'
import { guestView } from './guest'
import { clientExport } from './privacy'

// V1.5: versioned consent for email news, recorded on every path that changes it.
let sequence = 0
const makeId = () => `consent-test-${++sequence}`
const NOW = `${DEMO_DATE}T08:00:00.000Z`
function run(s: BusinessState, command: Command, actor = 'Maya') {
  const result = dispatch(s, command, actor, NOW)
  if (!result.ok) throw new Error(result.error)
  return result
}
const online = (marketingConsent: boolean, consentVersion?: number): BookingInput => ({
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: addDays(DEMO_DATE, 1),
  startMinutes: 540,
  source: 'online',
  contact: {
    name: 'Alex Demo',
    email: 'alex@example.com',
    phone: '+44 7700 900111',
    marketingConsent,
  },
  ...(consentVersion ? { consentVersion } : {}),
})
const booked = (s: BusinessState, id: string) =>
  s.clients.find((c) => c.id === s.appointments.find((a) => a.id === id)!.clientId)!

describe('versioned consent for email news (V1.5)', () => {
  it('records the words a guest agreed to on the booking page', () => {
    const s = seed('UK')
    const result = run(s, { type: 'book', input: online(true, 1) }, 'Guest booking')
    const client = booked(result.state, result.recordId!)
    const [record] = consentHistory(result.state, client.id)
    expect(record).toMatchObject({
      given: true,
      channel: 'email',
      purpose: 'marketing',
      wordingVersion: 1,
      source: 'booking page',
      actor: 'Guest booking',
    })
    expect(wordingFor(result.state, 1)?.text).toBe(standardWording(s.organisation.name))
  })

  it('writes nothing when a guest leaves the box empty', () => {
    const result = run(seed('UK'), { type: 'book', input: online(false) })
    expect(consentHistory(result.state, booked(result.state, result.recordId!).id)).toEqual([])
  })

  it('refuses a tick given against words the studio has since changed', () => {
    const s = run(seed('UK'), {
      type: 'consent-wording',
      text: 'Send me news of new treatments and quiet-day offers. I can stop at any time.',
    }).state
    const stale = execute(s, { type: 'book', input: online(true, 1) }, NOW, makeId)
    expect(stale.ok || stale.error).toMatch(/changed how it asks about email news/)
    const fresh = run(s, { type: 'book', input: online(true, 2) })
    expect(
      consentHistory(fresh.state, booked(fresh.state, fresh.recordId!).id)[0].wordingVersion,
    ).toBe(2)
  })

  it('keeps earlier words when the studio changes them, and ignores a save with no change', () => {
    let s = seed('UK')
    const text = 'News and offers from us now and then. Stop whenever you like.'
    s = run(s, { type: 'consent-wording', text }).state
    expect(currentWording(s)).toMatchObject({ version: 2, text, publishedBy: 'Maya' })
    expect(wordingFor(s, 1)?.text).toBe(standardWording(s.organisation.name))
    const again = dispatch(s, { type: 'consent-wording', text: ` ${text} ` }, 'Maya', NOW)
    expect(again.ok && again.state).toBe(s)
    // A record made against version 1 still shows version 1's words.
    expect(consentHistory(s, 'client-1')[0].wordingVersion).toBe(1)
  })

  it('freezes the standard words the first time someone agrees, so a new studio name cannot rewrite them', () => {
    let s = seed('UK')
    delete s.consentWording
    s.consentRecords = []
    const before = standardWording(s.organisation.name)
    s = run(s, { type: 'consent', clientId: 'client-4', consent: true }).state
    s.organisation.name = 'A Different Name'
    s = parseState(s, 'UK')
    expect(wordingFor(s, 1)?.text).toBe(before)
  })

  it('records desk changes with who made them, and withdrawal stops queued news', () => {
    let s = seed('UK')
    s = run(s, { type: 'consent', clientId: 'client-4', consent: true }, 'Priya').state
    const draft = run(s, {
      type: 'message',
      input: {
        clientId: 'client-4',
        purpose: 'marketing',
        subject: 'Autumn news',
        body: 'A draft.',
      },
    })
    s = run(draft.state, { type: 'message-queue', messageId: draft.recordId! }).state
    s = run(s, { type: 'consent', clientId: 'client-4', consent: false }, 'Priya').state
    const [stopped, agreed] = consentHistory(s, 'client-4')
    expect(agreed).toMatchObject({ given: true, source: 'desk', actor: 'Priya', wordingVersion: 1 })
    expect(stopped).toMatchObject({ given: false, source: 'desk', actor: 'Priya' })
    expect(stopped.wordingVersion).toBeUndefined()
    expect(s.operations!.messages.find((m) => m.id === draft.recordId)?.status).toBe('suppressed')
  })

  it('records a change made by editing the client', () => {
    const s = seed('UK')
    const client = s.clients.find((c) => c.id === 'client-2')!
    const edited = run(s, {
      type: 'client-edit',
      clientId: client.id,
      contact: {
        name: client.name,
        email: client.email,
        phone: client.phone,
        marketingConsent: false,
      },
      preferences: client.preferences,
    }).state
    expect(consentHistory(edited, client.id)[0]).toMatchObject({ given: false, source: 'desk' })
  })

  it('lets a guest stop email news from their own link, and only from there', () => {
    let s = seed('UK')
    const visit = s.appointments.find(
      (a) =>
        a.status === 'confirmed' && s.clients.find((c) => c.id === a.clientId)?.marketingConsent,
    )!
    const clientId = visit.clientId
    expect(guestView(s, visit.id, Date.parse(NOW)).emailNews).toBe(true)
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const)
      expect(can(role, 'guest-consent-stop')).toBe(false)
    s = run(
      s,
      { type: 'guest-consent-stop', appointmentId: visit.id },
      'Guest (private link)',
    ).state
    expect(s.clients.find((c) => c.id === clientId)?.marketingConsent).toBe(false)
    expect(consentHistory(s, clientId)[0]).toMatchObject({
      given: false,
      source: 'guest link',
      actor: 'Guest (private link)',
    })
    expect(guestView(s, visit.id, Date.parse(NOW)).emailNews).toBeUndefined()
    const again = dispatch(s, { type: 'guest-consent-stop', appointmentId: visit.id }, 'Guest', NOW)
    expect(again.ok && again.state).toBe(s)
  })

  it('lets owners and managers change the words, not reception', () => {
    expect(can('manager', 'consent-wording')).toBe(true)
    expect(can('reception', 'consent-wording')).toBe(false)
    expect(can('practitioner', 'consent-wording')).toBe(false)
  })

  it('refuses a record that disagrees with the client', () => {
    const s = seed('UK')
    s.clients.find((c) => c.id === 'client-1')!.marketingConsent = false
    expect(() => parseState(s, 'UK')).toThrow('latest record')
  })

  it('puts each record and the words agreed to in the client’s export', () => {
    const s = seed('UK')
    const file = clientExport(s, 'client-4', { generatedAt: NOW, generatedBy: 'Maya' })
    expect(file.consent.records).toEqual([
      expect.objectContaining({
        given: true,
        wordingVersion: 1,
        wording: standardWording(s.organisation.name),
        source: 'desk',
      }),
      expect.objectContaining({ given: false, source: 'guest link' }),
    ])
  })
})

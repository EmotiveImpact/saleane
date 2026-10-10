import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { Appointment, BusinessState, Client } from './model'
import { parseState } from './model'
import { can, operations, permissionFor } from './operations'
import type { Role } from './operations'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { branchRefusal, branchView } from './branch'
import { practitionerRefusal } from './practitioner'
import { areaRefusal } from './area'
import { changeDetail, changeWords, describeChange, recordNames } from './changeRecord'
import { consentHistory } from './consent'
import {
  NEWS_LOCATION_RULE,
  NEWS_STOP_LINK,
  NEWS_TEXT_STOP,
  newsAudience,
  newsEmail,
  newsMessage,
  newsSendFrom,
  newsStillFor,
  newsText,
  textParts,
  withoutNews,
} from './news'

// Stage 4: one message to clients across the group.
const NOW = '2026-10-06T10:00:00.000Z' // Tuesday 6 October, 11:00 in London.
const NORTH = 'loc-north'
let sequence = 0

type Visit = [clientId: string, locationId: 'main' | 'north', date: string, status?: string]

/** A studio of its own with two locations and clients who visit one, the other or both. */
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Linden Rooms', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  s.operations!.locations = [{ id: NORTH, name: 'Islington', address: '1 Upper Street' }]
  const person = (n: number, over: Partial<Client> = {}): Client => ({
    id: `c${n}`,
    organisationId: s.organisation.id,
    name: `Client ${n} Example`,
    email: `client${n}@example.com`,
    phone: `+44 7700 900${String(n).padStart(3, '0')}`,
    preferences: '',
    marketingConsent: true,
    createdAt: '2026-01-01T09:00:00.000Z',
    ...over,
  })
  s.clients = [
    person(1), // main, recent
    person(2), // north, recent
    person(3), // both locations
    person(4, { marketingConsent: false }), // main, never agreed
    person(5), // main, but last there 13 months ago
    person(6), // north, booked ahead only
    person(7), // no visits at all
    person(8, { email: 'CLIENT1@example.com', phone: '+44 7700 900801' }), // a second record of client 1
    person(9), // north, replied STOP
    person(10), // north, a cancelled visit only
  ]
  const visits: Visit[] = [
    ['c1', 'main', '2026-09-01', 'completed'],
    ['c2', 'north', '2026-08-15', 'completed'],
    ['c3', 'main', '2026-05-10', 'completed'],
    ['c3', 'north', '2026-09-20', 'completed'],
    ['c4', 'main', '2026-09-03', 'completed'],
    ['c5', 'main', '2025-09-05', 'completed'],
    ['c6', 'north', '2026-10-20', 'confirmed'],
    ['c8', 'north', '2026-03-03', 'completed'],
    ['c9', 'north', '2026-09-09', 'completed'],
    ['c10', 'north', '2026-09-10', 'cancelled'],
  ]
  s.appointments = visits.map(([clientId, where, date, status], i) => ({
    id: `v${i + 1}`,
    organisationId: s.organisation.id,
    locationId: where === 'main' ? s.organisation.locationId : NORTH,
    clientId,
    serviceId: 'service-facial',
    staffId: 'staff-maya',
    resourceId: 'room-one',
    date,
    startMinutes: 600 + i * 5,
    status: (status ?? 'completed') as Appointment['status'],
    source: 'desk',
    createdAt: '2026-01-01T09:00:00.000Z',
    bookedPriceMinor: 8000,
    bookedDepositMinor: 0,
    bookedDurationMinutes: 60,
    bookedBufferMinutes: 0,
  }))
  s.textStops = [{ number: '+447700900009', stoppedAt: '2026-09-30T10:00:00.000Z', replyId: 'r1' }]
  return parseState(s, 'UK')
}
const main = (s: BusinessState) => s.organisation.locationId

function run(s: BusinessState, command: Command, at = NOW) {
  return execute(s, command, at, () => `news-test-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = NOW) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result
}
function refusal(s: BusinessState, command: Command, at = NOW) {
  const result = run(s, command, at)
  if (result.ok) throw new Error('Expected a refusal.')
  return result.error
}
const input = (over: Record<string, unknown> = {}) => ({
  subject: 'Late evenings in November',
  body: 'We are open until eight on Thursdays from November. Come and unwind after work.',
  by: 'email' as const,
  ...over,
})
function draft(s: BusinessState, over: Record<string, unknown> = {}) {
  const result = apply(s, { type: 'news-save', input: input(over) } as Command)
  return { s: result.state, id: result.recordId }
}
/** Wording that names texts, and a client who agreed to it. */
function agreeToTexts(s: BusinessState, clientIds: string[]) {
  const next = structuredClone(s)
  next.consentWording = [
    { version: 1, text: 'I’d like occasional email news and offers from Linden Rooms.' },
    {
      version: 2,
      text: 'I’d like occasional news and offers from Linden Rooms by email or text.',
      publishedAt: '2026-09-01T09:00:00.000Z',
      publishedBy: 'Owner',
    },
  ]
  next.consentRecords = clientIds.map((clientId, i) => ({
    id: `consent-${i}`,
    organisationId: s.organisation.id,
    clientId,
    channel: 'email' as const,
    purpose: 'marketing' as const,
    given: true,
    wordingVersion: 2,
    source: 'desk' as const,
    recordedAt: '2026-09-02T09:00:00.000Z',
    actor: 'Owner',
  }))
  return parseState(next, 'UK')
}

describe('who a message to clients reaches', () => {
  it('counts each person once, under every record, and says who was left out and why', () => {
    const s = studio()
    const audience = newsAudience(s, { by: 'email' }, { now: NOW })
    // c1 and c8 share an email: one person, one message, from the record of their latest visit.
    expect(audience.recipients.map((r) => r.clientId).sort()).toEqual(
      ['c1', 'c10', 'c2', 'c3', 'c5', 'c6', 'c7'].sort(),
    )
    expect(audience).toMatchObject({ email: 7, text: 0, total: 7, leftOutTotal: 2 })
    expect(audience.leftOut).toEqual([
      { reason: 'not-agreed', count: 1 },
      { reason: 'stopped', count: 1 },
    ])
  })

  it('leaves a person out when any of their records said no', () => {
    const s = studio()
    s.clients.find((c) => c.id === 'c8')!.marketingConsent = false
    const audience = newsAudience(s, { by: 'email' }, { now: NOW })
    expect(audience.recipients.some((r) => r.clientId === 'c1' || r.clientId === 'c8')).toBe(false)
    expect(audience.leftOut).toContainEqual({ reason: 'not-agreed', count: 2 })
  })

  it('never includes someone who asked to be erased, under any of their records', () => {
    const audience = newsAudience(studio(), { by: 'email' }, { now: NOW, erased: ['c8'] })
    expect(audience.recipients.some((r) => r.clientId === 'c1')).toBe(false)
    expect(audience.leftOut[0]).toEqual({ reason: 'erased', count: 1 })
  })

  it('counts a location’s clients by a visit there in the last twelve months or one booked', () => {
    const s = studio()
    expect(NEWS_LOCATION_RULE).toBe(
      'A client of a location had a visit there in the last 12 months, or has one booked there.',
    )
    const north = newsAudience(s, { by: 'email', locationIds: [NORTH] }, { now: NOW })
    // c2 visited, c3 visited both, c1 through their second record, c6 is booked; c9 said STOP;
    // c10's only visit there was cancelled, c5 and c7 never went.
    expect(north.recipients.map((r) => r.clientId).sort()).toEqual(['c2', 'c3', 'c6', 'c8'])
    expect(north.byLocation).toEqual([{ locationId: NORTH, email: 4, text: 0 }])
    const home = newsAudience(s, { by: 'email', locationIds: [main(s)] }, { now: NOW })
    // c5's last visit there was thirteen months ago.
    expect(home.recipients.map((r) => r.clientId).sort()).toEqual(['c1', 'c3'])
    const both = newsAudience(s, { by: 'email', locationIds: [main(s), NORTH] }, { now: NOW })
    expect(both.total).toBe(4)
    // Someone who goes to both is counted once, at the location they went to last.
    expect(both.recipients.find((r) => r.clientId === 'c3')!.locationId).toBe(NORTH)
  })

  it('places everyone in the whole studio, with no location for those without a recent visit', () => {
    const audience = newsAudience(studio(), { by: 'email' }, { now: NOW })
    const where = Object.fromEntries(audience.recipients.map((r) => [r.clientId, r.locationId]))
    expect(where).toMatchObject({ c5: null, c7: null, c10: null, c6: NORTH })
    expect(audience.byLocation.map((l) => l.locationId)).toEqual([expect.any(String), NORTH, null])
  })

  it('texts only clients whose agreement named texts, one text to a number, never after STOP', () => {
    let s = agreeToTexts(studio(), ['c2', 'c3', 'c6'])
    // c6 shares c3's number, so c6 is emailed; c2 asked for no texts about visits, so email too.
    s = structuredClone(s)
    s.clients.find((c) => c.id === 'c6')!.phone = s.clients.find((c) => c.id === 'c3')!.phone
    s.clients.find((c) => c.id === 'c2')!.noTextReminders = true
    const email = newsAudience(s, { by: 'email' }, { now: NOW })
    expect(email.text).toBe(0)
    const either = newsAudience(s, { by: 'either' }, { now: NOW })
    expect(either.recipients.filter((r) => r.channel === 'sms').map((r) => r.clientId)).toEqual([
      'c3',
    ])
    expect(either).toMatchObject({ email: 6, text: 1, emailNotText: 6 })
  })
})

describe('the words', () => {
  it('names the studio, offers the booking page and says how to stop, by email and by text', () => {
    const s = studio()
    const mail = newsEmail(s, { ...input(), bookLink: true }, { name: 'Amelia Carter' })
    expect(mail.subject).toBe('Late evenings in November')
    expect(mail.body).toContain('Hello Amelia,')
    expect(mail.body).toContain('Book when it suits you: {{book_link}}')
    expect(mail.body).toContain(
      `You are hearing from Linden Rooms because you agreed to news and offers. To stop them, use this link: ${NEWS_STOP_LINK}`,
    )
    expect(mail.body.endsWith('\n\nLinden Rooms')).toBe(true)
    // Written here as escapes, an em dash and an en dash become plain hyphens in a text.
    const body = 'Don’t miss “late” evenings\u2014Thursdays\u2013Fridays…'
    const text = newsText(s, { body, bookLink: true })
    expect(text).toBe(
      `Linden Rooms: Don't miss "late" evenings-Thursdays-Fridays...\nBook: {{book_link}}\n${NEWS_TEXT_STOP}`,
    )
    expect(textParts(text).plain).toBe(true)
    expect(NEWS_TEXT_STOP).toBe('Reply STOP to stop texts.')
  })

  it('counts a text’s length and parts as the phone networks do', () => {
    expect(textParts('a'.repeat(160))).toEqual({ characters: 160, parts: 1, plain: true })
    expect(textParts('a'.repeat(161))).toEqual({ characters: 161, parts: 2, plain: true })
    expect(textParts('a'.repeat(306)).parts).toBe(2)
    expect(textParts('a'.repeat(307)).parts).toBe(3)
    // € and square brackets take two places.
    expect(textParts('€[]').characters).toBe(6)
    // An emoji makes every part hold 70.
    expect(textParts('🌿' + 'a'.repeat(68))).toEqual({ characters: 70, parts: 1, plain: false })
    expect(textParts('🌿' + 'a'.repeat(69)).parts).toBe(2)
  })
})

describe('quiet hours', () => {
  const s = studio()
  it('lets a message go only between 09:00 and 19:00 on the studio’s clock', () => {
    const at = (iso: string) => newsSendFrom(s, Date.parse(iso))
    // 07:30 in London waits for 09:00 that day.
    expect(at('2026-10-06T06:30:00.000Z')).toBe(Date.parse('2026-10-06T08:00:00.000Z'))
    // 11:00 goes now.
    expect(at(NOW)).toBe(Date.parse(NOW))
    // 18:59 goes now; 19:00 waits for the morning.
    expect(at('2026-10-06T17:59:00.000Z')).toBe(Date.parse('2026-10-06T17:59:00.000Z'))
    expect(at('2026-10-06T18:00:00.000Z')).toBe(Date.parse('2026-10-07T08:00:00.000Z'))
    // Late on the night the clocks go back, 09:00 the next day is in winter time.
    expect(at('2026-10-24T22:30:00.000Z')).toBe(Date.parse('2026-10-25T09:00:00.000Z'))
  })
})

describe('drafting, approving and stopping', () => {
  it('saves a draft that can be changed until it is approved, and puts one aside', () => {
    const { s, id } = draft(studio())
    expect(newsMessage(s, id)).toMatchObject({ status: 'draft', by: 'email' })
    const edited = apply(s, {
      type: 'news-save',
      id,
      input: input({ subject: 'Thursday evenings', by: 'either' }),
    } as Command).state
    expect(newsMessage(edited, id)).toMatchObject({ subject: 'Thursday evenings', by: 'either' })
    expect(newsMessage(edited, id)!.editedAt).toBe(NOW)
    // Saving the same words again changes nothing.
    const same = run(edited, {
      type: 'news-save',
      id,
      input: input({ subject: 'Thursday evenings', by: 'either' }),
    } as Command)
    expect(same.ok && same.state).toBe(edited)
    const aside = apply(edited, { type: 'news-discard', messageId: id }).state
    expect(newsMessage(aside, id)!.status).toBe('discarded')
    expect(refusal(aside, { type: 'news-save', id, input: input() } as Command)).toBe(
      'This draft was put aside. Write a new one.',
    )
    expect(
      refusal(studio(), {
        type: 'news-save',
        input: input({ locationIds: ['loc-nowhere'] }),
      } as Command),
    ).toBe('Choose locations the studio has open.')
  })

  it('approves only with the numbers the owner saw, and records them and each client’s timeline', () => {
    const { s, id } = draft(studio())
    expect(refusal(s, { type: 'news-approve', messageId: id, expect: { email: 6, text: 0 } })).toBe(
      'The numbers changed since you looked. It would now go to 7 clients: 7 by email and 0 by text. Check them and approve again.',
    )
    const result = dispatch(
      s,
      { type: 'news-approve', messageId: id, expect: { email: 7, text: 0 } },
      'Owner Example',
      NOW,
    )
    if (!result.ok) throw new Error(result.error)
    const approved = newsMessage(result.state, id)!
    expect(approved).toMatchObject({
      status: 'approved',
      approvedAt: NOW,
      approvedBy: 'Owner Example',
      toEmail: 7,
      toText: 0,
      leftOut: 2,
    })
    expect(approved.sample).toBeUndefined()
    const timeline = result.state.events.filter((e) => e.title === 'Message to clients')
    expect(timeline.map((e) => e.clientId).sort()).toEqual(
      ['c1', 'c10', 'c2', 'c3', 'c5', 'c6', 'c7'].sort(),
    )
    // The timeline names the message, never its words, and never says it was sent.
    expect(timeline[0].detail).toBe(
      '“Late evenings in November”, by email. Queued to go out, not sent yet. Whether it went shows with their messages.',
    )
    // Once approved the words are fixed; approving again queues nothing more.
    expect(refusal(result.state, { type: 'news-save', id, input: input() } as Command)).toBe(
      'This message is approved, so it can no longer be changed.',
    )
    const again = run(result.state, {
      type: 'news-approve',
      messageId: id,
      expect: { email: 7, text: 0 },
    })
    expect(again.ok && again.state).toBe(result.state)
    expect(refusal(result.state, { type: 'news-discard', messageId: id })).toBe(
      'Only a draft can be put aside.',
    )
    // The change record keeps the numbers by channel, and names the message by its subject.
    const detail = changeDetail(s, result.state, 'news-approve', id)
    expect(detail?.fields).toEqual(
      expect.arrayContaining([
        { f: 'status', from: 'draft', to: 'approved' },
        { f: 'toEmail', from: null, to: 7 },
        { f: 'toText', from: null, to: 0 },
      ]),
    )
    const entry = describeChange(result.state, recordNames(result.state), {
      id: 'a1',
      action: 'news-approve',
      recordId: id,
      occurredAt: Date.parse(NOW),
      actor: 'Owner Example',
      account: null,
      detail: JSON.stringify(detail),
    })
    expect(entry).toMatchObject({
      group: 'messages',
      what: 'Approved a message to clients',
      about: 'Late evenings in November',
    })
    expect(entry.lines).toContainEqual({ what: 'clients by email', from: 'none', to: '7' })
  })

  it('refuses a message nobody could receive', () => {
    const s = studio()
    for (const c of s.clients) c.marketingConsent = false
    const { s: drafted, id } = draft(parseState(s, 'UK'))
    expect(
      refusal(drafted, { type: 'news-approve', messageId: id, expect: { email: 0, text: 0 } }),
    ).toBe(
      'Nobody can receive this message yet: no client of these locations has agreed to news and offers.',
    )
  })

  it('stops an approved message once, and never a draft', () => {
    const { s, id } = draft(studio())
    expect(refusal(s, { type: 'news-stop', messageId: id })).toBe(
      'Only an approved message can be stopped.',
    )
    const approved = apply(s, {
      type: 'news-approve',
      messageId: id,
      expect: { email: 7, text: 0 },
    }).state
    const stopped = dispatch(approved, { type: 'news-stop', messageId: id }, 'Owner Example', NOW)
    if (!stopped.ok) throw new Error(stopped.error)
    expect(newsMessage(stopped.state, id)).toMatchObject({
      status: 'stopped',
      stoppedAt: NOW,
      stoppedBy: 'Owner Example',
    })
    const twice = run(stopped.state, { type: 'news-stop', messageId: id })
    expect(twice.ok && twice.state).toBe(stopped.state)
    // Each copy still waiting is checked again before it goes, and goes no further.
    expect(newsStillFor(stopped.state, id, 'c1', 'email')).toEqual({
      skip: 'Stopped before it went out.',
    })
  })

  it('checks each copy again just before it leaves', () => {
    let s = agreeToTexts(studio(), ['c3'])
    const { s: drafted, id } = draft(s, { by: 'either' })
    s = apply(drafted, {
      type: 'news-approve',
      messageId: id,
      expect: { email: 6, text: 1 },
    }).state
    expect(newsStillFor(s, id, 'c1', 'email')).toEqual({ to: 'client1@example.com' })
    expect(newsStillFor(s, id, 'c3', 'sms')).toEqual({ to: '+447700900003' })
    expect(newsStillFor(s, id, 'c1', 'email', ['c8'])).toEqual({
      skip: 'They asked to have their details erased before it went out.',
    })
    const changed = structuredClone(s)
    changed.clients.find((c) => c.id === 'c8')!.marketingConsent = false
    changed.textStops = [
      ...(changed.textStops ?? []),
      { number: '+447700900003', stoppedAt: NOW, replyId: 'r2' },
    ]
    expect(newsStillFor(changed, id, 'c1', 'email')).toEqual({
      skip: 'News and offers were no longer agreed before it went out.',
    })
    expect(newsStillFor(changed, id, 'c3', 'sms')).toEqual({
      skip: 'They replied STOP to the studio’s texts before it went out.',
    })
  })

  it('turns news off under every record from the link in an email, with a record of where', () => {
    const { s, id } = draft(studio())
    const approved = apply(s, {
      type: 'news-approve',
      messageId: id,
      expect: { email: 7, text: 0 },
    }).state
    const result = apply(approved, { type: 'news-unsubscribe', clientId: 'c1', messageId: id })
    const after = result.state
    expect(
      after.clients.filter((c) => ['c1', 'c8'].includes(c.id)).map((c) => c.marketingConsent),
    ).toEqual([false, false])
    expect(consentHistory(after, 'c1')[0]).toMatchObject({ given: false, source: 'email link' })
    expect(consentHistory(after, 'c8')[0]).toMatchObject({ given: false, source: 'email link' })
    expect(after.events.at(-1)).toMatchObject({
      clientId: 'c1',
      type: 'consent',
      detail: 'Stopped from the link in a message to clients. No message sent.',
    })
    // Using the link again changes nothing.
    const again = run(after, { type: 'news-unsubscribe', clientId: 'c1', messageId: id })
    expect(again.ok && again.state).toBe(after)
    expect(newsAudience(after, { by: 'email' }, { now: NOW }).total).toBe(6)
  })
})

describe('who may do what', () => {
  const roles: Role[] = ['owner', 'manager', 'general', 'reception', 'practitioner', 'regional']
  const allowed = (action: string) => roles.filter((role) => can(role, action))
  it('lets leads draft, only the owner approve, and nobody stop news for a client', () => {
    expect(permissionFor({ type: 'news-save' })).toBe('news')
    expect(permissionFor({ type: 'news-discard' })).toBe('news')
    expect(permissionFor({ type: 'news-approve' })).toBe('news-send')
    expect(allowed('news')).toEqual(['owner', 'manager', 'general'])
    expect(allowed('news-stop')).toEqual(['owner', 'manager', 'general'])
    expect(allowed('news-send')).toEqual(['owner'])
    expect(allowed('news-unsubscribe')).toEqual([])
  })

  it('keeps a general manager to their own location’s clients', () => {
    const s = studio()
    const own = (over: Record<string, unknown>) =>
      ({ type: 'news-save', input: input(over) }) as Command
    expect(branchRefusal(s, NORTH, own({ locationIds: [NORTH] }))).toBeNull()
    expect(branchRefusal(s, NORTH, own({}))).toBe('Write only to the clients of your own location.')
    expect(branchRefusal(s, NORTH, own({ locationIds: [main(s)] }))).toBe(
      'Write only to the clients of your own location.',
    )
    expect(branchRefusal(s, NORTH, own({ locationIds: [NORTH, main(s)] }))).toBe(
      'Write only to the clients of your own location.',
    )
    const { s: whole, id } = draft(s)
    expect(
      branchRefusal(whole, NORTH, {
        type: 'news-save',
        id,
        input: input({ locationIds: [NORTH] }),
      }),
    ).toBe('That message is for other locations.')
    expect(branchRefusal(whole, NORTH, { type: 'news-discard', messageId: id })).toBe(
      'That message is for other locations.',
    )
    expect(branchRefusal(whole, NORTH, { type: 'news-stop', messageId: id })).toBe(
      'That message is for other locations.',
    )
    const { s: theirs, id: mine } = draft(whole, { locationIds: [NORTH] })
    expect(branchRefusal(theirs, NORTH, { type: 'news-discard', messageId: mine })).toBeNull()
    // Their view holds only their own location's messages; the front desk's holds none.
    expect(operations(branchView(theirs, NORTH)).news!.map((m) => m.id)).toEqual([mine])
    expect(operations(withoutNews(theirs)).news).toBeUndefined()
  })

  it('refuses practitioners and regional managers every part of it', () => {
    const { s, id } = draft(studio())
    const commands: Command[] = [
      { type: 'news-save', input: input() } as Command,
      { type: 'news-approve', messageId: id, expect: { email: 7, text: 0 } },
      { type: 'news-stop', messageId: id },
      { type: 'news-discard', messageId: id },
    ]
    for (const command of commands) {
      expect(practitionerRefusal(s, 'staff-maya', command, '2026-10-06')).toBe(
        'Your role cannot make this change.',
      )
      expect(areaRefusal(s, 'region-x', command)).toBe('Your role cannot make this change.')
    }
  })

  it('has words for every change in the record', () => {
    expect(changeWords['news-save']).toEqual([
      'messages',
      'Changed a message to clients',
      'Wrote a message to clients',
    ])
    expect(changeWords['guest.news-stop']).toEqual([
      'clients',
      'Stopped news from the link in a message',
    ])
  })
})

describe('the record', () => {
  it('rejects a message whose steps do not agree', () => {
    const { s, id } = draft(studio())
    const broken = structuredClone(s)
    newsMessage(broken, id)!.status = 'approved'
    expect(() => parseState(broken, 'UK')).toThrow('An approved message is missing its approval.')
    const early = structuredClone(s)
    newsMessage(early, id)!.approvedAt = NOW
    expect(() => parseState(early, 'UK')).toThrow('A draft message carries a later step.')
  })
})

describe('the sample studio', () => {
  it('has a draft ready to approve, and approving it queues nothing and says so', () => {
    const s = seed('UK')
    const sample = operations(s).news!.find((m) => m.status === 'draft')!
    expect(sample).toMatchObject({ subject: 'Thursday evenings at Atelier House', by: 'either' })
    const audience = newsAudience(s, sample, { now: NOW })
    expect(audience.total).toBeGreaterThan(5)
    // The sample's guests agreed to email news only, so nobody is texted.
    expect(audience.text).toBe(0)
    const result = apply(s, {
      type: 'news-approve',
      messageId: sample.id,
      expect: { email: audience.email, text: audience.text },
    })
    expect(newsMessage(result.state, sample.id)).toMatchObject({ status: 'approved', sample: true })
    expect(result.state.events.at(-1)!.detail).toBe(
      '“Thursday evenings at Atelier House”, by email. A sample studio, so nothing was queued or sent.',
    )
  })
})

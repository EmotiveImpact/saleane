// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { Appointment, BusinessState, Client } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { seed } from '../src/domain/seed'
import { NEWS_STOP_LINK } from '../src/domain/news'
import type { NewsSummary } from '../src/domain/news'
import { postmarkProvider, testProvider } from './messaging/providers'
import type { MessageProvider, OutgoingMessage, Providers } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// Stage 4: one message to clients across the group, through the server and the outbox.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const NORTH = 'loc-north'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]

/** A provider that records what it is given and answers as a live one would. */
function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      if (message.fromName === 'SALEANE') return { outcome: 'test' }
      sent.push(message)
      return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
    },
  }
}
/** A server in test mode, or with live providers recorded here. */
function serve(live = false) {
  clock = Date.parse('2026-10-06T10:00:00.000Z') // Tuesday, 11:00 in London.
  sent = []
  const providers: Providers = {
    email: live ? recording('email') : testProvider('email'),
    sms: live ? recording('sms') : testProvider('sms'),
    receipt: (provider, request) => [
      { provider, providerRef: request.body, delivered: !request.body.startsWith('fail') },
    ],
  }
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers,
  })
}
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, extra: Record<string, unknown>, name = 'Ada Owner') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email, password, ...extra },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const state = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state
async function command(login: Login, cmd: Command, key: string = crypto.randomUUID()) {
  const { revision } = await state(login)
  return post(login, '/commands', { revision, command: cmd }, { 'idempotency-key': key })
}
async function run(login: Login, cmd: Command) {
  const response = await command(login, cmd)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** Writes the studio record straight to the database, as a restore or another change would. */
function write(orgId: string, next: BusinessState) {
  next.revision += 1
  api.database.run(
    'UPDATE organisations SET state=?,revision=? WHERE id=?',
    JSON.stringify(next),
    next.revision,
    orgId,
  )
}
const rows = () =>
  api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='news' ORDER BY client_id")
const audit = (action: string) =>
  api.database.all<{ actor_id: string | null; record_id: string; detail: string | null }>(
    'SELECT actor_id,record_id,detail FROM audit_events WHERE action=?',
    action,
  )

type Visit = [
  clientId: string,
  where: 'main' | 'north',
  date: string,
  status: Appointment['status'],
]
/**
 * A studio of its own with Islington open as well. c1 goes to the main location and c5 is a second
 * record of theirs, c2 and c6 go to Islington, c3 goes to both, and c4 never agreed to news.
 * `more` adds that many clients who agreed and have no visits.
 */
async function studio(more = 0) {
  const owner = await register('owner@example.invalid', {
    workspace: { name: 'Linden Rooms', locationName: 'Marylebone', region: 'UK', sample: false },
  })
  const s = await state(owner)
  const sample = seed('UK')
  for (const key of ['services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  s.operations!.locations = [{ id: NORTH, name: 'Islington', address: '1 Upper Street' }]
  const person = (id: string, n: number, over: Partial<Client> = {}): Client => ({
    id,
    organisationId: s.organisation.id,
    name: `Client ${n} Example`,
    email: `${id}@example.invalid`,
    phone: `+44 7700 900${String(n).padStart(3, '0')}`,
    preferences: '',
    marketingConsent: true,
    createdAt: '2026-01-01T09:00:00.000Z',
    ...over,
  })
  s.clients = [
    person('c1', 1),
    person('c2', 2),
    person('c3', 3),
    person('c4', 4, { marketingConsent: false }),
    person('c5', 5, { email: 'C1@example.invalid' }),
    person('c6', 6),
    ...Array.from({ length: more }, (_, i) => person(`m${String(i).padStart(3, '0')}`, 100 + i)),
  ]
  const visits: Visit[] = [
    ['c1', 'main', '2026-09-01', 'completed'],
    ['c2', 'north', '2026-08-15', 'completed'],
    ['c3', 'main', '2026-05-10', 'completed'],
    ['c3', 'north', '2026-09-20', 'completed'],
    ['c4', 'north', '2026-09-03', 'completed'],
    ['c6', 'north', '2026-10-20', 'confirmed'],
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
    status,
    source: 'desk',
    createdAt: '2026-01-01T09:00:00.000Z',
    bookedPriceMinor: 8000,
    bookedDepositMinor: 0,
    bookedDurationMinutes: 60,
    bookedBufferMinutes: 0,
  }))
  write(owner.orgId, s)
  return { owner, main: s.organisation.locationId }
}
/** The studio's wording names texts, and c3 agreed to it. */
async function textsAgreed(owner: Login) {
  const s = await state(owner)
  s.consentWording = [
    { version: 1, text: 'I’d like occasional email news and offers from Linden Rooms.' },
    {
      version: 2,
      text: 'I’d like occasional news and offers from Linden Rooms by email or text.',
      publishedAt: '2026-09-01T09:00:00.000Z',
      publishedBy: 'Ada Owner',
    },
  ]
  s.consentRecords = [
    {
      id: 'consent-c3',
      organisationId: s.organisation.id,
      clientId: 'c3',
      channel: 'email',
      purpose: 'marketing',
      given: true,
      wordingVersion: 2,
      source: 'desk',
      recordedAt: '2026-09-02T09:00:00.000Z',
      actor: 'Ada Owner',
    },
  ]
  write(owner.orgId, s)
}
const words = {
  subject: 'Thursday evenings',
  body: 'We are open until eight on Thursdays from November. Come and unwind after work.',
}
const draft = (login: Login, extra: Record<string, unknown> = {}) =>
  run(login, { type: 'news-save', input: { ...words, by: 'email', ...extra } } as Command)
async function numbers(login: Login, by: 'email' | 'either', locations?: string[]) {
  const query = new URLSearchParams({
    by,
    ...(locations ? { locations: locations.join(',') } : {}),
  })
  const response = await get(login, `/news/audience?${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<NewsSummary>()
}
const approve = (login: Login, messageId: string, email: number, text: number, key?: string) =>
  command(login, { type: 'news-approve', messageId, expect: { email, text } }, key)
async function invite(owner: Login, email: string, role: string, extra = {}) {
  const invitation = await post(owner, '/invitations', { email, role, ...extra })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(
    email,
    { invitation: invitation.json<{ invitation: string }>().invitation },
    'Team Member',
  )
  return { ...login, orgId: owner.orgId }
}

describe('approving a message to clients', () => {
  it('queues one copy for each client in test mode, and says none was sent', async () => {
    serve()
    const { owner } = await studio()
    const id = await draft(owner)
    const counted = await numbers(owner, 'email')
    expect(counted).toMatchObject({ email: 4, text: 0, total: 4, leftOutTotal: 1 })
    expect(counted.leftOut).toEqual([{ reason: 'not-agreed', count: 1 }])
    // Only numbers leave the server, never who.
    expect(counted).not.toHaveProperty('recipients')
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    // c1 and c5 are one person: one copy, from the record with their visit.
    expect(rows().map((r) => [r.client_id, r.channel, r.status])).toEqual([
      ['c1', 'email', 'pending'],
      ['c2', 'email', 'pending'],
      ['c3', 'email', 'pending'],
      ['c6', 'email', 'pending'],
    ])
    expect(rows()[0]).toMatchObject({
      recipient: 'c1@example.invalid',
      subject: 'Thursday evenings',
      appointment_id: '',
    })
    expect(rows()[0].body).toContain(NEWS_STOP_LINK)
    await api.outbox.deliver()
    expect(rows().map((r) => r.status)).toEqual(['test', 'test', 'test', 'test'])
    // The stop link is never written down, not even in test mode.
    expect(rows()[0].body).toContain(NEWS_STOP_LINK)
    const followed = (await get(owner, '/news')).json<{
      mode: string
      providers: { email: { live: boolean } }
      messages: { id: string; outbox: Record<string, number> }[]
    }>()
    expect(followed.mode).toBe('local')
    expect(followed.providers.email.live).toBe(false)
    expect(followed.messages).toEqual([
      { id, outbox: expect.objectContaining({ test: 4, pending: 0, delivered: 0, accepted: 0 }) },
    ])
    // Each client's own list shows their copy; the studio's list is not crowded by them.
    const own = (await get(owner, '/outbox?clientId=c1')).json<{
      messages: { kind: string; body: string }[]
    }>()
    expect(own.messages[0].kind).toBe('news')
    expect(own.messages[0].body).toContain('[private link to stop news]')
    const all = (await get(owner, '/outbox')).json<{ messages: { kind: string }[] }>()
    expect(all.messages.some((m) => m.kind === 'news')).toBe(false)
    // The record: who drafted and approved it, when, and how many by each way.
    const message = (await state(owner)).operations!.news![0]
    expect(message).toMatchObject({
      status: 'approved',
      actor: 'Ada Owner',
      approvedBy: 'Ada Owner',
      approvedAt: new Date(clock).toISOString(),
      toEmail: 4,
      toText: 0,
    })
    const changes = (await get(owner, '/changes')).json<{
      entries: { what: string; about?: string; lines: { what: string; to?: string }[] }[]
    }>().entries
    const approval = changes.find((e) => e.what === 'Approved a message to clients')!
    expect(approval.about).toBe('Thursday evenings')
    expect(approval.lines).toContainEqual({ what: 'clients by email', from: 'none', to: '4' })
    expect(changes.some((e) => e.what === 'Wrote a message to clients')).toBe(true)
  })

  it('counts consent again at approval, and refuses numbers that have changed', async () => {
    serve()
    const { owner } = await studio()
    const id = await draft(owner)
    expect((await numbers(owner, 'email')).total).toBe(4)
    // c2 withdraws after the owner looked.
    await run(owner, { type: 'consent', clientId: 'c2', consent: false })
    const stale = await approve(owner, id, 4, 0)
    expect(stale.statusCode).toBe(422)
    expect(stale.json<{ error: string }>().error).toBe(
      'The numbers changed since you looked. It would now go to 3 clients: 3 by email and 0 by text. Check them and approve again.',
    )
    // An erasure request, which only the server knows, is counted too, whatever a browser says.
    expect((await post(owner, '/privacy/clients/c6/erasure', {})).statusCode).toBe(201)
    const counted = await numbers(owner, 'email')
    expect(counted).toMatchObject({ total: 2 })
    expect(counted.leftOut).toContainEqual({ reason: 'erased', count: 1 })
    const { revision } = await state(owner)
    const claimed = await post(
      owner,
      '/commands',
      {
        revision,
        command: { type: 'news-approve', messageId: id, expect: { email: 3, text: 0 }, erased: [] },
      },
      { 'idempotency-key': crypto.randomUUID() },
    )
    expect(claimed.statusCode).toBe(422)
    expect(rows()).toEqual([])
    expect((await approve(owner, id, 2, 0)).statusCode).toBe(200)
    expect(rows().map((r) => r.client_id)).toEqual(['c1', 'c3'])
  })

  it('never queues twice, whether the approval is repeated or replayed', async () => {
    serve()
    const { owner } = await studio()
    const id = await draft(owner)
    const key = crypto.randomUUID()
    expect((await approve(owner, id, 4, 0, key)).statusCode).toBe(200)
    expect((await approve(owner, id, 4, 0, key)).statusCode).toBe(200)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    expect(rows()).toHaveLength(4)
    expect(audit('news-approve')).toHaveLength(1)
    // Once approved its words cannot change.
    const edit = await command(owner, {
      type: 'news-save',
      id,
      input: { ...words, subject: 'Changed', by: 'email' },
    })
    expect(edit.json<{ error: string }>().error).toBe(
      'This message is approved, so it can no longer be changed.',
    )
  })

  it('texts only those who agreed to texts, says how to stop, and never after STOP', async () => {
    serve(true)
    const { owner } = await studio()
    await textsAgreed(owner)
    const id = await draft(owner, { by: 'either', bookLink: true })
    expect(await numbers(owner, 'either')).toMatchObject({ email: 3, text: 1, emailNotText: 3 })
    expect((await approve(owner, id, 3, 1)).statusCode).toBe(200)
    const text = rows().find((r) => r.channel === 'sms')!
    expect(text).toMatchObject({ client_id: 'c3', recipient: '+447700900003', subject: '' })
    expect(text.body).toBe(
      `Linden Rooms: ${words.body}\nBook: {{book_link}}\nReply STOP to stop texts.`,
    )
    await api.outbox.deliver()
    const texted = sent.find((m) => m.channel === 'sms')!
    expect(texted.body).toContain(`Book: ${origin}/book/`)
    expect(texted.body.endsWith('Reply STOP to stop texts.')).toBe(true)
    expect(texted.unsubscribeUrl).toBeUndefined()
    expect(texted.stream).toBeUndefined()
    // The provider has it; only its receipt can say it was delivered.
    expect(rows().map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted'])
    const followed = (await get(owner, '/news')).json<{
      messages: { outbox: Record<string, number> }[]
    }>()
    expect(followed.messages[0].outbox).toMatchObject({ accepted: 4, delivered: 0 })
    const ref = rows().find((r) => r.channel === 'sms')!.provider_ref!
    api.outbox.record({ provider: 'twilio', providerRef: ref, delivered: true })
    expect(rows().find((r) => r.channel === 'sms')!.status).toBe('delivered')
    // c3's number replies STOP: a later message leaves them out altogether.
    const s = await state(owner)
    s.textStops = [
      { number: '+447700900003', stoppedAt: new Date(clock).toISOString(), replyId: 'r1' },
    ]
    write(owner.orgId, s)
    const after = await numbers(owner, 'either')
    expect(after).toMatchObject({ email: 3, text: 0 })
    expect(after.leftOut).toContainEqual({ reason: 'stopped', count: 1 })
  })
})

describe('when each copy leaves the outbox', () => {
  it('waits for the daytime, then checks consent, STOP and erasure again', async () => {
    serve(true)
    const { owner } = await studio()
    await textsAgreed(owner)
    // 21:00 in London: nothing goes until 09:00.
    clock = Date.parse('2026-10-06T20:00:00.000Z')
    const id = await draft(owner, { by: 'either' })
    expect((await approve(owner, id, 3, 1)).statusCode).toBe(200)
    const nine = Date.parse('2026-10-07T08:00:00.000Z')
    expect(new Set(rows().map((r) => r.next_attempt_at))).toEqual(new Set([nine]))
    await api.outbox.deliver()
    expect(sent).toEqual([])
    // Overnight: c2 withdraws, c3 replies STOP, and the team records c6's erasure request.
    await run(owner, { type: 'consent', clientId: 'c2', consent: false })
    const s = await state(owner)
    s.textStops = [
      { number: '+447700900003', stoppedAt: new Date(clock).toISOString(), replyId: 'r1' },
    ]
    write(owner.orgId, s)
    expect((await post(owner, '/privacy/clients/c6/erasure', {})).statusCode).toBe(201)
    clock = nine
    await api.outbox.deliver()
    expect(sent.map((m) => m.to)).toEqual(['c1@example.invalid'])
    const by = Object.fromEntries(rows().map((r) => [r.client_id, [r.status, r.detail]]))
    expect(by).toEqual({
      c1: ['accepted', null],
      c2: ['skipped', 'News and offers were no longer agreed before it went out.'],
      c3: ['skipped', 'They replied STOP to the studio’s texts before it went out.'],
      c6: ['skipped', 'They asked to have their details erased before it went out.'],
    })
  })

  it('puts a copy that comes due at night back to the morning, and drops one days late', async () => {
    serve(true)
    const { owner } = await studio()
    const id = await draft(owner)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    // The server was off all day and comes back at 22:00.
    clock = Date.parse('2026-10-06T21:00:00.000Z')
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows()[0]).toMatchObject({
      status: 'pending',
      next_attempt_at: Date.parse('2026-10-07T08:00:00.000Z'),
      detail: 'Waiting for the daytime on the studio’s clock.',
    })
    // Three days on, it is too late to be welcome.
    clock = Date.parse('2026-10-09T10:01:00.000Z')
    await api.outbox.deliver()
    expect(sent).toEqual([])
    expect(rows()[0]).toMatchObject({
      status: 'skipped',
      detail: 'Too late: it could not go within three days of being approved.',
    })
  })

  it('stops the rest of a message part-way through', async () => {
    serve(true)
    const { owner } = await studio(60)
    const id = await draft(owner)
    expect((await approve(owner, id, 64, 0)).statusCode).toBe(200)
    await api.outbox.deliver()
    expect(sent).toHaveLength(50)
    expect(await run(owner, { type: 'news-stop', messageId: id })).toBe(id)
    await api.outbox.deliver()
    expect(sent).toHaveLength(50)
    const statuses = rows().reduce<Record<string, number>>(
      (all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }),
      {},
    )
    expect(statuses).toEqual({ accepted: 50, skipped: 14 })
    expect(rows().find((r) => r.status === 'skipped')!.detail).toBe('Stopped before it went out.')
    const message = (await state(owner)).operations!.news![0]
    expect(message).toMatchObject({ status: 'stopped', stoppedBy: 'Ada Owner' })
  })

  it('sends each email with its own stop link, which turns news off and is kept only as a hash', async () => {
    serve(true)
    const { owner } = await studio()
    const id = await draft(owner)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    await api.outbox.deliver()
    const mail = sent.find((m) => m.to === 'c1@example.invalid')!
    const link = /\/news\/stop#([A-Za-z0-9_-]+)/.exec(mail.body)!
    // The mail app's own Unsubscribe button posts to the same link's one-click address.
    expect(mail).toMatchObject({
      stream: 'broadcast',
      unsubscribeUrl: `${origin}/api/news/one-click/${link[1]}`,
    })
    expect(mail.body).toContain(
      'You are hearing from Linden Rooms because you agreed to news and offers. To stop them, use this link:',
    )
    const raw = link[1]
    expect(JSON.stringify(api.database.all('SELECT * FROM news_links'))).not.toContain(raw)
    expect(JSON.stringify(rows())).not.toContain(raw)
    const guest = (path: string, token: string) =>
      api.inject({
        method: 'POST',
        url: `/api/news/${path}`,
        headers: { origin },
        payload: { token },
      })
    expect((await guest('open', raw)).json()).toEqual({ studio: 'Linden Rooms', stopped: false })
    expect((await guest('stop', raw)).json()).toEqual({ studio: 'Linden Rooms', stopped: true })
    const s = await state(owner)
    // Both of the person's records stop, each with a record of where.
    expect(
      s.clients.filter((c) => c.id === 'c1' || c.id === 'c5').map((c) => c.marketingConsent),
    ).toEqual([false, false])
    expect(
      s
        .consentRecords!.filter((r) => r.source === 'email link')
        .map((r) => r.clientId)
        .sort(),
    ).toEqual(['c1', 'c5'])
    expect(audit('guest.news-stop')).toEqual([
      expect.objectContaining({ actor_id: null, record_id: 'c1' }),
    ])
    // Using it again changes nothing; a wrong or old link reads the same as any other.
    expect((await guest('stop', raw)).statusCode).toBe(200)
    expect(audit('guest.news-stop')).toHaveLength(1)
    const refused = await guest('open', 'x'.repeat(43))
    expect(refused.statusCode).toBe(404)
    expect((await guest('open', 'short')).json()).toEqual(refused.json())
    // A link sent to an address the client no longer uses stops working.
    const other = sent.find((m) => m.to === 'c2@example.invalid')!
    const second = /\/news\/stop#([A-Za-z0-9_-]+)/.exec(other.body)![1]
    await run(owner, {
      type: 'client-edit',
      clientId: 'c2',
      contact: {
        name: 'Client 2 Example',
        email: 'new-c2@example.invalid',
        phone: '+44 7700 900002',
        marketingConsent: true,
      },
      preferences: '',
    } as Command)
    expect((await guest('open', second)).statusCode).toBe(404)
  })

  it('stops news from a mail app’s own Unsubscribe button, with no page and no sign-in (RFC 8058)', async () => {
    serve(true)
    const { owner } = await studio()
    const id = await draft(owner)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    await api.outbox.deliver()
    const mail = sent.find((m) => m.to === 'c1@example.invalid')!
    const raw = /\/news\/stop#([A-Za-z0-9_-]+)/.exec(mail.body)![1]
    const oneClick = (body: string, method: 'POST' | 'GET' = 'POST', token = raw) =>
      api.inject({
        method,
        url: `/api/news/one-click/${token}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        ...(method === 'POST' ? { rawPayload: body } : {}),
      })
    // Opened in a browser, it goes to the page that asks before stopping.
    const opened = await oneClick('', 'GET')
    expect(opened.statusCode).toBe(303)
    expect(opened.headers.location).toBe(`${origin}/news/stop#${raw}`)
    // Only the one-click post stops it, from the mail provider's servers with no origin.
    expect((await oneClick('List-Unsubscribe=Other')).statusCode).toBe(400)
    expect((await state(owner)).clients.find((c) => c.id === 'c1')!.marketingConsent).toBe(true)
    const stopped = await oneClick('List-Unsubscribe=One-Click')
    expect(stopped.statusCode).toBe(200)
    expect(stopped.json()).toEqual({ stopped: true })
    const s = await state(owner)
    expect(
      s.clients.filter((c) => c.id === 'c1' || c.id === 'c5').map((c) => c.marketingConsent),
    ).toEqual([false, false])
    expect(audit('guest.news-stop')).toEqual([
      expect.objectContaining({ actor_id: null, record_id: 'c1' }),
    ])
    // Pressed again it changes nothing; a made-up link reads like any expired one.
    expect((await oneClick('List-Unsubscribe=One-Click')).statusCode).toBe(200)
    expect(audit('guest.news-stop')).toHaveLength(1)
    expect((await oneClick('List-Unsubscribe=One-Click', 'POST', 'x'.repeat(43))).statusCode).toBe(
      404,
    )
    expect(JSON.stringify(api.database.all('SELECT * FROM news_links'))).not.toContain(raw)
  })
})

describe('who may do what', () => {
  it('lets a general manager draft for their own location only, and never approve', async () => {
    serve()
    const { owner, main } = await studio()
    const gm = await invite(owner, 'gm@example.invalid', 'general', { locationId: NORTH })
    const whole = await command(gm, {
      type: 'news-save',
      input: { ...words, by: 'email' },
    } as Command)
    expect(whole.statusCode).toBe(403)
    expect(
      (
        await command(gm, {
          type: 'news-save',
          input: { ...words, by: 'email', locationIds: [main] },
        } as Command)
      ).statusCode,
    ).toBe(403)
    const theirs = await draft(gm, { locationIds: [NORTH] })
    expect(await numbers(gm, 'email', [NORTH])).toMatchObject({ total: 3 })
    expect((await get(gm, `/news/audience?by=email&locations=${main}`)).statusCode).toBe(403)
    expect((await get(gm, '/news/audience?by=email')).statusCode).toBe(403)
    expect((await approve(gm, theirs, 3, 0)).statusCode).toBe(403)
    // The owner's message to everyone is not theirs to see, change or stop.
    const everyone = await draft(owner)
    expect((await state(gm)).operations!.news!.map((m) => m.id)).toEqual([theirs])
    expect((await command(gm, { type: 'news-discard', messageId: everyone })).statusCode).toBe(403)
    expect((await approve(owner, everyone, 4, 0)).statusCode).toBe(200)
    expect((await command(gm, { type: 'news-stop', messageId: everyone })).statusCode).toBe(403)
    expect((await get(gm, '/news')).json<{ messages: unknown[] }>().messages).toEqual([])
    // The owner approves the general manager's draft, for Islington's clients only.
    expect((await approve(owner, theirs, 3, 0)).statusCode).toBe(200)
    expect(
      rows()
        .filter((r) => r.slot === `news:${theirs}`)
        .map((r) => r.client_id),
    ).toEqual(['c2', 'c3', 'c6'])
    // A copy of a message to clients goes again only on the owner's word.
    const row = rows().find((r) => r.slot === `news:${theirs}`)!
    api.database.run("UPDATE outbox SET status='failed' WHERE id=?", row.id)
    expect((await post(gm, `/outbox/${row.id}/retry`, {})).statusCode).toBe(403)
    expect((await post(owner, `/outbox/${row.id}/retry`, {})).statusCode).toBe(200)
  })

  it('lets a manager draft but not approve, and keeps the desk and practitioners out', async () => {
    serve()
    const { owner } = await studio()
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    const desk = await invite(owner, 'desk@example.invalid', 'reception')
    const practitioner = await invite(owner, 'maya@example.invalid', 'practitioner', {
      staffId: 'staff-maya',
    })
    const id = await draft(manager)
    expect((await numbers(manager, 'email')).total).toBe(4)
    expect((await approve(manager, id, 4, 0)).statusCode).toBe(403)
    const { revision } = await state(owner)
    for (const login of [desk, practitioner]) {
      const refused = await post(
        login,
        '/commands',
        { revision, command: { type: 'news-save', input: { ...words, by: 'email' } } },
        { 'idempotency-key': crypto.randomUUID() },
      )
      expect(refused.statusCode).toBe(403)
      expect((await get(login, '/news')).statusCode).toBe(403)
      expect((await get(login, '/news/audience?by=email')).statusCode).toBe(403)
    }
    expect((await state(desk)).operations!.news).toBeUndefined()
    // Nobody signed in can say a client stopped news for them.
    expect(
      (await command(owner, { type: 'news-unsubscribe', clientId: 'c1', messageId: id }))
        .statusCode,
    ).toBe(403)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
  })
})

describe('sample studios', () => {
  it('approve the sample draft without queuing anything, and say so', async () => {
    serve(true)
    const owner = await register('sample@example.invalid', {
      workspace: { name: 'Sample Rooms', locationName: 'London', region: 'UK', sample: true },
    })
    const s = await state(owner)
    const sample = s.operations!.news!.find((m) => m.status === 'draft')!
    // The sample's draft speaks in the new studio's name, as its consent wording does.
    expect(sample.subject).toBe('Thursday evenings at Sample Rooms')
    const counted = await numbers(owner, 'either')
    expect(counted.total).toBeGreaterThan(5)
    expect((await approve(owner, sample.id, counted.email, counted.text)).statusCode).toBe(200)
    await api.outbox.deliver()
    expect(rows()).toEqual([])
    expect(sent).toEqual([])
    const after = await state(owner)
    expect(after.operations!.news!.find((m) => m.id === sample.id)).toMatchObject({
      status: 'approved',
      sample: true,
    })
    expect(after.events.at(-1)!.detail).toContain('A sample studio, so nothing was queued or sent.')
    expect((await get(owner, '/news')).json<{ mode: string }>().mode).toBe('sandbox')
  })
})

describe('the email provider', () => {
  it('sends a message to clients on Postmark’s stream for many people, naming the stop link', async () => {
    const bodies: Record<string, unknown>[] = []
    const provider = postmarkProvider({
      token: 'server-token',
      from: 'hello@example.invalid',
      broadcastStream: 'broadcast',
      fetcher: async (_url, init) => {
        bodies.push(JSON.parse(String(init!.body)))
        return new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-1' }), { status: 200 })
      },
    })
    const message: OutgoingMessage = {
      id: 'outbox-1',
      channel: 'email',
      to: 'guest@example.invalid',
      subject: 'Thursday evenings',
      body: 'Body',
      fromName: 'Linden Rooms',
    }
    await provider.send(message)
    await provider.send({
      ...message,
      stream: 'broadcast',
      unsubscribeUrl: `${origin}/news/stop#abc`,
    })
    expect(bodies[0]).toMatchObject({ MessageStream: 'outbound' })
    expect(bodies[0]).not.toHaveProperty('Headers')
    expect(bodies[1]).toMatchObject({
      MessageStream: 'broadcast',
      Headers: [
        { Name: 'List-Unsubscribe', Value: `<${origin}/news/stop#abc>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ],
    })
  })
})

// NEXT-14: the Marketing section's numbers, and the month's marketing emails as a hard stop.
describe('marketing', () => {
  const DAY = 86400000
  /** Copies already in the outbox, as earlier sending would have left them. */
  function fill(orgId: string, n: number, status: string, kind: string, at: number) {
    api.database.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
       INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       SELECT ?||i,?,?||i,'','earlier-'||i,?,'email','earlier','earlier'||i||'@example.invalid','Earlier','Earlier words',?,?,?,? FROM n`,
      n,
      `${kind}-${status}-${at}-`,
      orgId,
      `${kind}-${status}-${at}-`,
      kind,
      status,
      at,
      at,
      at,
    )
  }
  type Marketing = {
    emails?: { used: number; limit: number }
    campaigns: { id: string; sent: number; test: number }[]
    automatic?: { kind: string }[]
  }

  it('sets a campaign’s emails aside when approved, and refuses one that would go over the month’s', async () => {
    serve(true)
    const { owner } = await studio()
    // Two locations, so 4,000 this month. Earlier this month 3,997 marketing emails went. Copies in test mode, failed ones, aftercare
    // (about a visit) and last month's do not count.
    fill(owner.orgId, 3997, 'accepted', 'birthday', clock - DAY)
    fill(owner.orgId, 30, 'test', 'news', clock - DAY)
    fill(owner.orgId, 30, 'failed', 'miss_you', clock - DAY)
    fill(owner.orgId, 30, 'accepted', 'aftercare', clock - DAY)
    fill(owner.orgId, 30, 'accepted', 'due_back', Date.parse('2026-09-30T22:00:00.000Z'))
    expect((await get(owner, '/marketing')).json<Marketing>().emails).toEqual({
      used: 3997,
      limit: 4000,
    })
    const id = await draft(owner)
    const refused = await approve(owner, id, 4, 0)
    expect(refused.statusCode).toBe(409)
    expect(refused.json<{ error: string }>().error).toBe(
      'This campaign would send 4 emails, and 3 of this month’s 4,000 marketing emails are left. Choose fewer locations, send it by text, or approve it next month.',
    )
    expect(rows().filter((r) => r.slot === `news:${id}`)).toEqual([])
    expect((await state(owner)).operations!.news![0].status).toBe('draft')
    // On the 1st the month starts again, on the studio's own clock.
    clock = Date.parse('2026-11-03T10:00:00.000Z')
    const again = await api.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.invalid', password },
    })
    expect(again.statusCode, again.body).toBe(200)
    owner.csrf = again.json<{ csrf: string }>().csrf
    owner.cookie = cookie(again)
    expect((await approve(owner, id, 4, 0)).statusCode).toBe(200)
    // Approved copies still waiting are set aside: a second campaign cannot take them.
    expect((await get(owner, '/marketing')).json<Marketing>().emails).toEqual({
      used: 4,
      limit: 4000,
    })
    await api.outbox.deliver()
    expect(sent).toHaveLength(4)
    expect((await get(owner, '/marketing')).json<Marketing>().emails).toEqual({
      used: 4,
      limit: 4000,
    })
  })

  it('says only numbers, and shows a general manager only their own location’s campaigns', async () => {
    serve(true)
    const { owner } = await studio()
    const gm = await invite(owner, 'gm@example.invalid', 'general', { locationId: NORTH })
    const everyone = await draft(owner)
    const theirs = await draft(gm, { locationIds: [NORTH] })
    expect((await approve(owner, everyone, 4, 0)).statusCode).toBe(200)
    expect((await approve(owner, theirs, 3, 0)).statusCode).toBe(200)
    await api.outbox.deliver()
    const mine = (await get(owner, '/marketing')).json<Marketing>()
    expect(mine.campaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: everyone, sent: 4 }),
        expect.objectContaining({ id: theirs, sent: 3 }),
      ]),
    )
    expect(mine.automatic!.map((a) => a.kind)).toEqual([
      'aftercare',
      'due_back',
      'birthday',
      'miss_you',
    ])
    expect(mine.emails).toEqual({ used: 7, limit: 4000 })
    expect(JSON.stringify(mine)).not.toMatch(/example\.invalid|"c[0-9]"|Client [0-9]/)
    const north = (await get(gm, '/marketing')).json<Marketing>()
    expect(north.campaigns.map((c) => c.id)).toEqual([theirs])
    expect(north).not.toHaveProperty('automatic')
    const desk = await invite(owner, 'desk@example.invalid', 'reception')
    expect((await get(desk, '/marketing')).statusCode).toBe(403)
  })

  it('counts nothing in a sample studio, which never sends', async () => {
    serve()
    const sample = await register('sample@example.invalid', {
      workspace: { name: 'Sample Rooms', locationName: 'Soho', region: 'UK', sample: true },
    })
    const results = (await get(sample, '/marketing')).json<Marketing & { mode: string }>()
    expect(results.mode).toBe('sandbox')
    expect(results).not.toHaveProperty('emails')
  })
})

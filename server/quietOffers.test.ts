// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import { SCHEMA_VERSION } from './database'
import { backupDatabase, restoreDatabase } from './backup'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import { defaultQuietOffers } from '../src/domain/quietOffersSchema'

// Stage 5: an invitation with a quiet-time price, through the server. Its private link is made as
// the email goes and kept only as a hash; the guest books the lower price with it once, for that
// time only, and a retry never takes it twice.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]
let testMode: boolean
let directory = ''
const recording = (channel: 'email' | 'sms'): MessageProvider => ({
  name: channel === 'email' ? 'postmark' : 'twilio',
  live: true,
  channel,
  send: async (message) => {
    if (message.fromName === 'SALEANE' || testMode) return { outcome: 'test' }
    sent.push(message)
    return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
  },
})
const handler = (databasePath = ':memory:') =>
  createApiHandler({
    origin,
    databasePath,
    now: () => clock,
    turnstile: null,
    providers: {
      email: recording('email'),
      sms: recording('sms'),
      receipt: () => null,
      inbound: () => null,
    },
  })
beforeEach(() => {
  // 08:00 in London on Tuesday 6 October.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  testMode = false
  api = handler()
})
afterEach(() => {
  api.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function workspace(login: Login) {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}`,
    headers: headers(login),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ slug: string; state: BusinessState }>()
}
async function attempt(login: Login, command: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
}
async function run(login: Login, command: Command) {
  const response = await attempt(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** Someone joining the studio's team with this role. */
async function teammate(owner: Login, email: string, role: string): Promise<Login> {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Team Member',
      email,
      password: 'Fictional local account 2026!',
      invitation: invitation.json<{ invitation: string }>().invitation,
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    csrf: response.json<{ csrf: string }>().csrf,
    orgId: owner.orgId,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
/** Signs in again after a day away, as the team would. */
async function signIn(login: Login) {
  const again = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@example.invalid', password: 'Fictional local account 2026!' },
  })
  expect(again.statusCode, again.body).toBe(200)
  login.cookie = String(again.headers['set-cookie']).split(';')[0]
  login.csrf = again.json<{ csrf: string }>().csrf
}
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex')
const lowerPriced = () => sent.filter((m) => m.subject.endsWith('at a lower price'))
const offerRows = () =>
  api.database.all<{
    token_hash: string
    message_id: string
    expires_at: number
    used_at: number | null
    appointment_id: string | null
    revoked_at: number | null
  }>('SELECT * FROM offer_links')
const guest = {
  name: 'Grace Chen',
  email: 'grace@example.invalid',
  phone: '+44 7700 900123',
  marketingConsent: false,
}

/**
 * A real studio, its owner offering 20% off quiet times. Grace agreed to hear from the studio. At
 * 08:00 on Tuesday 6 October the desk writes her an invitation to Maya's open time for a £95
 * facial on Wednesday 7 October at 10:00, with a lower price open for 24 hours.
 */
async function studio() {
  const owner = await register()
  await run(owner, {
    type: 'organisation',
    name: 'Linden Studio',
    locationName: 'London',
    address: '1 Linden Street',
    timeZone: 'Europe/London',
    bookingEnabled: true,
  })
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 3000,
      resourceType: 'treatment',
    },
  })
  const maya = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lewis', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const grace = await run(owner, {
    type: 'client',
    contact: { ...guest, marketingConsent: false },
  })
  await run(owner, { type: 'consent', clientId: grace, consent: true })
  await run(owner, {
    type: 'quiet-offers',
    settings: {
      discount: 'percent',
      offPercent: 20,
      offMinor: 1000,
      floorMinor: 0,
      openHours: 24,
      leftOutIds: [],
    },
  })
  const messageId = await run(owner, {
    type: 'offer-invite',
    clientId: grace,
    serviceId,
    staffId: maya,
    date: '2026-10-07',
    startMinutes: 600,
  })
  const { slug, state } = await workspace(owner)
  const message = state.operations!.messages.find((m) => m.id === messageId)!
  return { owner, slug, serviceId, maya, grace, message }
}
/** Approves the invitation and lets the outbox send it, returning the private link's token. */
async function sendIt(owner: Login, messageId: string) {
  await run(owner, { type: 'message-queue', messageId })
  await api.outbox.tick()
  await api.outbox.tick()
  const body = lowerPriced().at(-1)?.body ?? ''
  return /#offer=([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? ''
}
const offerInfo = (slug: string, offer: string) =>
  api.inject({ method: 'POST', url: `/api/public/${slug}/offer`, payload: { offer } })
const hold = (slug: string, serviceId: string, staffId: string, extra = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date: '2026-10-07', startMinutes: 600, ...extra },
  })
const book = (slug: string, held: string) =>
  api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held, contact: guest, policy: true },
  })

describe('quiet-time prices through the server', () => {
  it('keeps each private link in a table of its own from migration 34', () => {
    // Stage 5's access key writes (migration 35) follow it.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(34)
    expect(
      api.database.all("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_links'"),
    ).toHaveLength(1)
    expect(api.database.all('SELECT version FROM schema_migrations WHERE version=34')).toHaveLength(
      1,
    )
  })

  it('sends the lower price only once approved, with a private link kept only as its hash', async () => {
    const { owner, slug, serviceId, maya, message } = await studio()
    expect(message).toMatchObject({
      status: 'draft',
      offer: { priceMinor: 7600, usualPriceMinor: 9500, endsAt: '2026-10-07T07:00:00.000Z' },
    })
    await api.outbox.tick()
    expect(lowerPriced()).toEqual([])
    expect(offerRows()).toEqual([])
    const raw = await sendIt(owner, message.id)
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [email] = lowerPriced()
    expect(email.subject).toBe('A time for you tomorrow, Grace, at a lower price')
    expect(email.body).toContain(
      'It has been a little while. Maya has tomorrow at 10:00 free for Restorative facial, and we thought of you.',
    )
    expect(email.body).toContain(
      'For that time only, it is £76 instead of the usual £95. The lower price is open until Wednesday 7 October at 08:00.',
    )
    expect(email.body).toContain(
      `${origin}/book/${slug}?service=${serviceId}&staff=${maya}&date=2026-10-07&start=600#offer=${raw}`,
    )
    expect(email.body).not.toContain('{{')
    // Only the hash is kept: never in the outbox, the studio record or the table itself.
    expect(offerRows()).toMatchObject([
      { token_hash: sha(raw), message_id: message.id, used_at: null, revoked_at: null },
    ])
    const outbox = api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='message'")
    expect(JSON.stringify(outbox)).not.toContain(raw)
    expect(JSON.stringify(api.database.all('SELECT * FROM offer_links'))).not.toContain(raw)
    expect(JSON.stringify((await workspace(owner)).state)).not.toContain(raw)
    const listed = await api.inject({
      url: `/api/workspaces/${owner.orgId}/outbox`,
      headers: headers(owner),
    })
    const shown = listed
      .json<{ messages: { messageId?: string; body: string }[] }>()
      .messages.find((m) => m.messageId === message.id)!
    expect(shown.body).toContain('[a private link to book this time at its lower price]')
    expect(shown.body).not.toContain('{{')
  })

  it('in test mode, queues the invitation and sends nothing', async () => {
    testMode = true
    const { owner, message } = await studio()
    await sendIt(owner, message.id)
    expect(lowerPriced()).toEqual([])
    expect(api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='message'")).toMatchObject([
      { status: 'test' },
    ])
  })

  it('does not send a lower price that ended before it could go', async () => {
    const { owner, message } = await studio()
    await run(owner, { type: 'message-queue', messageId: message.id })
    clock = Date.parse('2026-10-07T07:30:00.000Z')
    await api.outbox.tick()
    await api.outbox.tick()
    expect(lowerPriced()).toEqual([])
    expect(offerRows()).toEqual([])
    expect(api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='message'")).toMatchObject([
      {
        status: 'skipped',
        detail: 'The lower price ended, or the treatment’s price changed, before it went out.',
      },
    ])
  })

  it('tells the booking page what a link offers, and the same for any link that is not one', async () => {
    const { owner, slug, serviceId, maya, message } = await studio()
    const raw = await sendIt(owner, message.id)
    const read = await offerInfo(slug, raw)
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json()).toEqual({
      offer: {
        serviceId,
        staffId: maya,
        date: '2026-10-07',
        startMinutes: 600,
        priceMinor: 7600,
        usualPriceMinor: 9500,
        endsAt: '2026-10-07T07:00:00.000Z',
        ends: 'Wednesday 7 October at 08:00',
        time: 'Wednesday 7 October at 10:00 with Maya',
      },
    })
    const unknown =
      'This quiet-time price could not be found. It may have ended or been replaced. You can still book at the usual price.'
    for (const offer of ['not-a-token', 'A'.repeat(43), `${raw.slice(0, -1)}x`])
      expect((await offerInfo(slug, offer)).json()).toEqual({ problem: unknown })
    // It ends with its offer.
    clock = Date.parse('2026-10-07T07:00:00.000Z')
    expect((await offerInfo(slug, raw)).json()).toEqual({
      problem: 'This quiet-time price ended on Wednesday 7 October at 08:00.',
    })
  })

  it('holds and books the visit at the lower price, once, and a retry never takes it twice', async () => {
    const { owner, slug, serviceId, maya, message } = await studio()
    const raw = await sendIt(owner, message.id)
    const held = await hold(slug, serviceId, maya, { offer: raw })
    expect(held.statusCode, held.body).toBe(201)
    expect(held.json()).toMatchObject({
      staffId: maya,
      offer: { priceMinor: 7600, usualPriceMinor: 9500 },
    })
    expect(held.json().offerProblem).toBeUndefined()
    const token = held.json<{ hold: string }>().hold
    const first = await book(slug, token)
    expect(first.statusCode, first.body).toBe(200)
    const appointmentId = first.json<{ appointmentId: string }>().appointmentId
    // The deposit is asked from the lower price by the treatment's own rule.
    expect(first.json()).toMatchObject({ payment: { depositDueMinor: 3000 } })
    const state = (await workspace(owner)).state
    const visit = state.appointments.find((a) => a.id === appointmentId)!
    // Booked online as any guest is, under the details they gave.
    expect(state.clients.find((c) => c.id === visit.clientId)?.email).toBe(guest.email)
    expect(visit).toMatchObject({
      source: 'online',
      bookedPriceMinor: 7600,
      bookedDepositMinor: 3000,
      bookedOffer: { messageId: message.id, usualPriceMinor: 9500 },
    })
    expect(offerRows()).toMatchObject([{ appointment_id: appointmentId, revoked_at: null }])
    expect(offerRows()[0].used_at).not.toBeNull()
    // The guest's own page can cancel it, but only the studio moves it.
    const manage = first.json<{ manage: { url: string } }>().manage.url.split('#')[1]
    const view = await api.inject({
      method: 'POST',
      url: '/api/guest/visit',
      payload: { token: manage },
    })
    expect(view.json()).toMatchObject({ move: { available: false, reason: 'offer' } })
    const move = await api.inject({
      method: 'POST',
      url: '/api/guest/move-times',
      payload: { token: manage },
    })
    expect(move.statusCode).toBe(409)
    expect(move.json().error).toBe(
      'This visit was booked at a quiet-time price for that time only, so it cannot be moved online. Contact the studio to change it.',
    )
    // The first answer never arrived: the same booking again changes nothing.
    const again = await book(slug, token)
    expect(again.statusCode, again.body).toBe(200)
    expect(again.json()).toMatchObject({ appointmentId, replayed: true })
    expect((await workspace(owner)).state.appointments.filter((a) => a.bookedOffer)).toHaveLength(1)
    expect(offerRows()).toHaveLength(1)
    // Checkout charges the lower price, and tax and takings follow it.
    clock = Date.parse('2026-10-07T09:00:00.000Z')
    await signIn(owner)
    await run(owner, { type: 'arrive', appointmentId })
    await run(owner, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
    const sale = (await workspace(owner)).state.sales.find((s) => s.appointmentId === appointmentId)
    expect(sale).toMatchObject({ serviceMinor: 7600, totalMinor: 7600 })
  })

  it('books at the usual price once the lower price is used, or for any other time', async () => {
    const { owner, slug, serviceId, maya, message } = await studio()
    const raw = await sendIt(owner, message.id)
    // Another time: held at the usual price, and the guest is told why.
    const other = await hold(slug, serviceId, maya, { offer: raw, startMinutes: 720 })
    expect(other.statusCode, other.body).toBe(201)
    expect(other.json()).toMatchObject({
      offerProblem: 'This quiet-time price is for Wednesday 7 October at 10:00 with Maya only.',
    })
    expect(other.json().offer).toBeUndefined()
    await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds/release`,
      payload: { hold: other.json<{ hold: string }>().hold },
    })
    const first = await book(
      slug,
      (await hold(slug, serviceId, maya, { offer: raw })).json<{ hold: string }>().hold,
    )
    expect(first.statusCode, first.body).toBe(200)
    await run(owner, {
      type: 'cancel',
      appointmentId: first.json<{ appointmentId: string }>().appointmentId,
      reason: 'Guest changed plans',
    })
    // Used: the page is told plainly, and the same time books at the usual price.
    expect((await offerInfo(slug, raw)).json()).toEqual({
      problem: 'This quiet-time price has already been used to book.',
    })
    const later = await hold(slug, serviceId, maya, { offer: raw })
    expect(later.json()).toMatchObject({
      offerProblem: 'This quiet-time price has already been used to book.',
    })
    const second = await book(slug, later.json<{ hold: string }>().hold)
    expect(second.statusCode, second.body).toBe(200)
    const visit = (await workspace(owner)).state.appointments.find(
      (a) => a.id === second.json<{ appointmentId: string }>().appointmentId,
    )!
    expect(visit.bookedPriceMinor).toBe(9500)
    expect(visit.bookedOffer).toBeUndefined()
  })

  it('refuses the booking, and books nothing, when the link stops working while held', async () => {
    const { owner, slug, serviceId, maya, message } = await studio()
    const raw = await sendIt(owner, message.id)
    const held = (await hold(slug, serviceId, maya, { offer: raw })).json<{ hold: string }>().hold
    api.database.run('UPDATE offer_links SET revoked_at=?', clock)
    const refused = await book(slug, held)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toBe(
      'This quiet-time price is no longer open. You can still book this time at the usual price.',
    )
    expect((await workspace(owner)).state.appointments.filter((a) => a.bookedOffer)).toEqual([])
    expect(offerRows()[0].used_at).toBeNull()
  })

  it('is set by the owner only; the desk writes invitations with it but does not approve them', async () => {
    const { owner, serviceId, maya, grace } = await studio()
    const manager = await teammate(owner, 'manager@example.invalid', 'manager')
    const desk = await teammate(owner, 'desk@example.invalid', 'reception')
    for (const login of [manager, desk]) {
      const refused = await attempt(login, { type: 'quiet-offers', settings: defaultQuietOffers })
      expect(refused.statusCode, refused.body).toBe(403)
    }
    const written = await run(desk, {
      type: 'offer-invite',
      clientId: grace,
      serviceId,
      staffId: maya,
      date: '2026-10-07',
      startMinutes: 720,
    })
    expect(
      (await workspace(owner)).state.operations!.messages.find((m) => m.id === written),
    ).toMatchObject({ status: 'draft', offer: { priceMinor: 7600 } })
    const approve = await attempt(desk, { type: 'message-queue', messageId: written })
    expect(approve.statusCode, approve.body).toBe(403)
    expect((await attempt(manager, { type: 'message-queue', messageId: written })).statusCode).toBe(
      200,
    )
    const settings = {
      discount: 'amount' as const,
      offPercent: 20,
      offMinor: 1500,
      floorMinor: 5000,
      openHours: 48 as const,
      leftOutIds: [],
    }
    await run(owner, { type: 'quiet-offers', settings })
    expect((await workspace(owner)).state.operations!.quietOffers).toEqual(settings)
    const recorded = api.database.all<{ action: string; detail: string }>(
      "SELECT action,detail FROM audit_events WHERE action='quiet-offers' ORDER BY rowid DESC LIMIT 1",
    )
    expect(JSON.parse(recorded[0].detail)).toMatchObject({
      fields: expect.arrayContaining([{ f: 'discount', from: 'percent', to: 'amount' }]),
    })
  })
})

describe('restoring a backup', () => {
  it('stops every unused link to a lower price', async () => {
    api.close()
    directory = mkdtempSync(join(tmpdir(), 'saleane-offers-test-'))
    api = handler(join(directory, 'live.sqlite'))
    const { owner, message } = await studio()
    expect(await sendIt(owner, message.id)).not.toBe('')
    const backup = join(directory, 'before.sqlite'),
      restored = join(directory, 'after.sqlite')
    backupDatabase(api.database.path, backup)
    expect(restoreDatabase(backup, restored)).toMatchObject({ offerLinksStopped: 1 })
  })
})

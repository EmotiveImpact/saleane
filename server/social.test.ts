// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { testProvider } from './messaging/providers'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'
import { metaSignature } from './messaging/meta'
import type { SocialOptions } from './messaging/meta'

// V4: guests' messages to the studio's Instagram, Facebook and WhatsApp accounts, and answers.
const origin = 'http://127.0.0.1:5173'
const meta: SocialOptions = {
  mode: 'test',
  appSecret: 'a-long-meta-app-secret-2026',
  verifyToken: 'a-long-verify-token-2026',
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]

const recording = (channel: 'instagram' | 'facebook' | 'whatsapp'): MessageProvider => ({
  name: 'test',
  live: false,
  channel,
  send: async (message) => {
    sent.push(message)
    return { outcome: 'test' }
  },
})
const make = (social: SocialOptions | null = meta) => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: {
      email: testProvider('email'),
      sms: testProvider('sms'),
      instagram: recording('instagram'),
      facebook: recording('facebook'),
      whatsapp: recording('whatsapp'),
      receipt: () => null,
    },
    social: social ?? { mode: 'off', appSecret: '', verifyToken: '' },
  })
}
beforeEach(() => make())
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
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
async function register(sample = false, email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
/** A session lasts less than a day, so after the clock moves on the owner signs in again. */
async function signIn(login: Login, email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'Fictional local account 2026!' },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    ...login,
    csrf: response.json<{ csrf: string }>().csrf,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const connect = (login: Login, channel: string, accountId: string | null) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/social`,
    headers: headers(login),
    payload: { channel, accountId },
  })
/** The test-mode step that stands in for signing in with Meta. */
const confirm = (login: Login, channel: string) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/social/confirm`,
    headers: headers(login),
    payload: { channel },
  })
/** Adds an account and confirms it, as the owner signing in with Meta would. */
async function connected(login: Login, channel: string, accountId: string) {
  expect((await connect(login, channel, accountId)).statusCode).toBe(200)
  const confirmed = await confirm(login, channel)
  expect(confirmed.statusCode, confirmed.body).toBe(200)
}
/** A new studio takes online bookings, and so its receptionist answers, once the owner switches them on. */
async function bookingOn(login: Login) {
  const { name, locationName, address, timeZone } = (await workspace(login)).state.organisation
  await run(login, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
}
let clientId: string
async function studio() {
  const login = await register()
  clientId = await run(login, {
    type: 'client',
    contact: {
      name: 'Rosa Field',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: false,
    },
  })
  await bookingOn(login)
  await connected(login, 'instagram', '17841400000000001')
  await connected(login, 'whatsapp', '106540352242922')
  return login
}
const post = (payload: unknown, secret = meta.appSecret) => {
  const body = JSON.stringify(payload)
  return api.inject({
    method: 'POST',
    url: '/api/hooks/meta',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': metaSignature(secret, body),
    },
    rawPayload: body,
  })
}
let mid = 0
const instagram = (text: string, from = '9000001', account = '17841400000000001', echo = false) =>
  post({
    object: 'instagram',
    entry: [
      {
        id: account,
        time: clock,
        messaging: [
          {
            sender: { id: from },
            recipient: { id: account },
            timestamp: clock,
            message: { mid: `m-${++mid}`, text, ...(echo ? { is_echo: true } : {}) },
          },
        ],
      },
    ],
  })
const whatsapp = (text: string, from = '447700900456', name = 'Rosa') =>
  post({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '442071234567',
                phone_number_id: '106540352242922',
              },
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [
                { from, id: `wamid.${++mid}`, timestamp: '1', type: 'text', text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  })
const replies = async (login: Login) => (await workspace(login)).state.replies ?? []
const outbox = () =>
  api.database.all<OutboxRow>("SELECT * FROM outbox WHERE kind='social' ORDER BY created_at")

describe('Instagram, Facebook and WhatsApp messages', () => {
  it('is off unless the server is started for it, and checks Meta’s verify token', async () => {
    api.close()
    make(null)
    expect((await api.inject({ url: '/api/hooks/meta' })).statusCode).toBe(404)
    api.close()
    make()
    const check = (token: string) =>
      api.inject({
        url: `/api/hooks/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
      })
    const good = await check(meta.verifyToken)
    expect(good.statusCode).toBe(200)
    expect(good.body).toBe('12345')
    expect((await check('not-the-token-at-all')).statusCode).toBe(403)
  })

  it('keeps only signed messages for a connected account, once, and never the studio’s echoes', async () => {
    const login = await studio()
    const before = (await replies(login)).length
    expect(
      (await post({ object: 'instagram', entry: [] }, 'the-wrong-secret-entirely')).statusCode,
    ).toBe(403)
    // An account no studio connected is left alone.
    expect((await instagram('Hello', '9000001', '17841499999999999')).statusCode).toBe(200)
    expect(await replies(login)).toHaveLength(before)
    await instagram('Do you have anything on Saturday?')
    const first = mid
    await instagram('Thank you', '9000001', '17841400000000001', true)
    const kept = (await replies(login)).slice(before)
    expect(kept).toMatchObject([
      { channel: 'instagram', from: '9000001', body: 'Do you have anything on Saturday?' },
    ])
    expect(kept[0].clientId).toBeUndefined()
    // Meta sending the same message again keeps it once.
    const again = {
      object: 'instagram',
      entry: [
        {
          id: '17841400000000001',
          messaging: [
            {
              sender: { id: '9000001' },
              recipient: { id: '17841400000000001' },
              message: { mid: `m-${first}`, text: 'Do you have anything on Saturday?' },
            },
          ],
        },
      ],
    }
    await post(again)
    expect((await replies(login)).slice(before)).toHaveLength(1)
  })

  it('matches a WhatsApp number to its client and keeps the name WhatsApp gives', async () => {
    const login = await studio()
    await whatsapp('Can I move my facial?')
    expect((await replies(login)).at(-1)).toMatchObject({
      channel: 'whatsapp',
      from: '+447700900456',
      name: 'Rosa',
      clientId,
    })
  })

  it('lets the owner connect an account to one studio only, never a sample studio', async () => {
    const login = await studio()
    const other = await register(false, 'second@example.invalid')
    expect((await connect(other, 'instagram', '17841400000000001')).statusCode).toBe(409)
    const sample = await register(true, 'sample@example.invalid')
    expect((await connect(sample, 'facebook', '123456789')).statusCode).toBe(409)
    const list = await api.inject({
      url: `/api/workspaces/${login.orgId}/social`,
      headers: headers(login),
    })
    expect(list.json<{ accounts: { channel: string }[] }>().accounts.map((a) => a.channel)).toEqual(
      ['instagram', 'whatsapp'],
    )
  })

  it('keeps a newly added account waiting until the owner confirms it is theirs', async () => {
    const login = await register()
    await bookingOn(login)
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, social: true },
    })
    expect((await connect(login, 'instagram', '17841400000000001')).statusCode).toBe(200)
    const listed = async () =>
      (
        await api.inject({ url: `/api/workspaces/${login.orgId}/social`, headers: headers(login) })
      ).json<{ accounts: { channel: string; accountId: string; confirmed: boolean }[] }>().accounts
    expect(await listed()).toMatchObject([
      { channel: 'instagram', accountId: '17841400000000001', confirmed: false },
    ])
    // Until it is confirmed, its messages reach no inbox and the receptionist does not answer.
    await instagram('Are you open on Sunday?')
    expect(await replies(login)).toEqual([])
    expect(api.database.all("SELECT * FROM outbox WHERE kind='receptionist'")).toEqual([])
    const confirmed = await confirm(login, 'instagram')
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(await listed()).toMatchObject([{ accountId: '17841400000000001', confirmed: true }])
    await instagram('Are you open on Sunday?')
    expect(await replies(login)).toHaveLength(1)
    expect(api.database.all("SELECT * FROM outbox WHERE kind='receptionist'")).toHaveLength(1)
    // Adding the same account again keeps it confirmed.
    await connect(login, 'instagram', '17841400000000001')
    expect(await listed()).toMatchObject([{ confirmed: true }])
  })

  it('lets only the first studio to confirm an account keep it', async () => {
    const first = await register()
    const second = await register(false, 'second@example.invalid')
    // Typing an id proves nothing, so both can wait to confirm the same one.
    expect((await connect(first, 'instagram', '17841400000000001')).statusCode).toBe(200)
    expect((await connect(second, 'instagram', '17841400000000001')).statusCode).toBe(200)
    expect((await confirm(first, 'instagram')).statusCode).toBe(200)
    const late = await confirm(second, 'instagram')
    expect(late.statusCode).toBe(409)
    expect(late.json<{ error: string }>().error).toMatch(/connected to another studio/)
    // Once confirmed, no other studio can add it.
    expect((await connect(second, 'facebook', '17841400000000001')).statusCode).toBe(200)
    await connect(second, 'instagram', null)
    expect((await connect(second, 'instagram', '17841400000000001')).statusCode).toBe(409)
    await instagram('Hello')
    expect(await replies(first)).toHaveLength(1)
    expect(await replies(second)).toEqual([])
  })

  it('confirms only in test mode, and never takes a waiting account’s stored name as an id', async () => {
    const login = await register()
    expect((await connect(login, 'instagram', `unconfirmed:${login.orgId}:178`)).statusCode).toBe(
      400,
    )
    api.close()
    make({ mode: 'off', appSecret: '', verifyToken: '' })
    const owner = await register()
    expect((await connect(owner, 'instagram', '17841400000000001')).statusCode).toBe(200)
    const refused = await confirm(owner, 'instagram')
    expect(refused.statusCode).toBe(409)
    expect(refused.json<{ error: string }>().error).toMatch(/signing in with Meta/)
    expect((await confirm(owner, 'facebook')).statusCode).toBe(409)
  })

  it('answers on the app the guest wrote on, within its day, through the outbox', async () => {
    const login = await studio()
    await instagram('Do you have anything on Saturday?')
    const reply = (await replies(login)).at(-1)!
    await run(login, { type: 'social-answer', replyId: reply.id, body: 'Yes, 10:00 is free.' })
    const { state } = await workspace(login)
    expect(state.socialAnswers).toMatchObject([
      { channel: 'instagram', to: '9000001', body: 'Yes, 10:00 is free.', actor: 'Ada Owner' },
    ])
    expect(state.replies?.find((r) => r.id === reply.id)?.readAt).toBeTruthy()
    await api.outbox.tick()
    expect(sent).toMatchObject([
      {
        channel: 'instagram',
        to: '9000001',
        body: 'Yes, 10:00 is free.',
        account: '17841400000000001',
      },
    ])
    expect(outbox()[0]).toMatchObject({ status: 'test', recipient: '9000001' })
    // Matching the sender to a client later takes the answers along.
    await run(login, { type: 'reply-link', replyId: reply.id, clientId })
    expect((await workspace(login)).state.socialAnswers?.[0].clientId).toBe(clientId)
    // A day after their last message the app allows no more answers.
    clock += 24 * 60 * 60000 + 60000
    const late = await attempt(await signIn(login), {
      type: 'social-answer',
      replyId: reply.id,
      body: 'Are you still looking?',
    })
    expect(late.statusCode).toBe(422)
    expect(late.json<{ error: string }>().error).toMatch(/within a day/)
  })

  it('does not send an answer once the day has passed or the account was disconnected', async () => {
    const login = await studio()
    await instagram('Hello')
    await whatsapp('Hi there')
    const [ig, wa] = (await replies(login)).slice(-2)
    // Written in the last minute of the day, and not sent before it ended.
    clock += 24 * 60 * 60000 - 60000
    const later = await signIn(login)
    await run(later, { type: 'social-answer', replyId: ig.id, body: 'Hello, how can we help?' })
    clock += 120000
    await connect(later, 'whatsapp', null)
    await api.outbox.tick()
    expect(sent).toEqual([])
    expect(outbox()).toMatchObject([{ status: 'skipped' }])
    expect(outbox()[0].detail).toMatch(/day to answer ended/)
    // WhatsApp's day ended too, so nothing more can be written there.
    expect(
      (await attempt(later, { type: 'social-answer', replyId: wa.id, body: 'Hi Rosa' })).statusCode,
    ).toBe(422)
  })

  it('does not send an answer once the account was disconnected', async () => {
    const login = await studio()
    await instagram('Hello')
    const reply = (await replies(login)).at(-1)!
    await run(login, { type: 'social-answer', replyId: reply.id, body: 'Hello, how can we help?' })
    await connect(login, 'instagram', null)
    await api.outbox.tick()
    expect(sent).toEqual([])
    expect(outbox()[0]).toMatchObject({ status: 'skipped' })
    expect(outbox()[0].detail).toMatch(/disconnected/)
  })

  it('answers only from the account the guest wrote to', async () => {
    const login = await studio()
    await instagram('Hello')
    const old = (await replies(login)).at(-1)!
    expect(old.account).toBe('17841400000000001')
    await run(login, { type: 'social-answer', replyId: old.id, body: 'Hello, how can we help?' })
    // The owner swaps to another Instagram account before it goes: the guest's id belongs to the
    // first one, so nothing is sent through the second.
    await connected(login, 'instagram', '17841400000000002')
    await api.outbox.tick()
    expect(sent).toEqual([])
    expect(outbox()[0].detail).toMatch(/disconnected or changed/)
    // The same id writing to the new account does not reopen the old account's day.
    await instagram('Hi again', '9000001', '17841400000000002')
    clock += 24 * 60 * 60000 + 60000
    await instagram('Still there?', '9000001', '17841400000000002')
    const later = await signIn(login)
    expect(
      (await attempt(later, { type: 'social-answer', replyId: old.id, body: 'Yes' })).statusCode,
    ).toBe(422)
  })

  it('lets the AI receptionist answer on the app when the studio chooses it', async () => {
    const login = await studio()
    const reception = () =>
      api.database.all<OutboxRow>(
        "SELECT * FROM outbox WHERE kind='receptionist' ORDER BY created_at",
      )
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, texts: true },
    })
    await instagram('When are you open?')
    expect(reception()).toEqual([])
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, social: true },
    })
    await instagram('When are you open?')
    expect(reception()).toMatchObject([
      { channel: 'instagram', recipient: '9000001', status: 'pending' },
    ])
    await api.outbox.tick()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ channel: 'instagram', account: '17841400000000001' })
    expect(sent[0].body).toMatch(/^Linden Studio AI receptionist: Linden Studio is open:/)
    // Once someone from the team answers, it steps back for the hour.
    const reply = (await replies(login)).at(-1)!
    await run(login, {
      type: 'social-answer',
      replyId: reply.id,
      body: 'Ada here, how can I help?',
    })
    clock += 60000
    await instagram('Can someone call me?')
    expect(reception()).toHaveLength(1)
  })

  it('moves the receptionist’s answer with the guest, and keeps each account’s chat apart', async () => {
    const login = await studio()
    const reception = () =>
      api.database.all<OutboxRow>(
        "SELECT * FROM outbox WHERE kind='receptionist' ORDER BY created_at",
      )
    await run(login, {
      type: 'receptionist',
      settings: { enabled: true, handOver: true, social: true },
    })
    await instagram('When are you open?')
    expect(reception()).toHaveLength(1)
    // The team answers on this account, so the receptionist steps back here.
    const asked = (await replies(login)).at(-1)!
    await run(login, { type: 'social-answer', replyId: asked.id, body: 'Ada here.' })
    // Matching the sender to Rosa takes the receptionist's answer into her conversation too.
    await run(login, { type: 'reply-link', replyId: asked.id, clientId })
    const listed = async (query = '') =>
      (
        await api.inject({
          method: 'GET',
          url: `/api/workspaces/${login.orgId}/outbox${query}`,
          headers: headers(login),
        })
      ).json<{ messages: { kind: string; clientId: string }[] }>().messages
    expect((await listed()).find((m) => m.kind === 'receptionist')?.clientId).toBe(clientId)
    expect((await listed(`?clientId=${clientId}`)).map((m) => m.kind)).toContain('receptionist')
    // A new account on the same app is a new chat: the same sender id there is answered afresh.
    await connected(login, 'instagram', '17841400000000002')
    clock += 60000
    await instagram('Hello?', '9000001', '17841400000000002')
    expect(reception()).toHaveLength(2)
  })

  it('refuses health words in an answer', async () => {
    const login = await studio()
    await instagram('Hello')
    const reply = (await replies(login)).at(-1)!
    const response = await attempt(login, {
      type: 'social-answer',
      replyId: reply.id,
      body: 'Is your diabetes under control?',
    })
    expect(response.statusCode).toBe(422)
    expect(response.json<{ error: string }>().error).toMatch(/health details/)
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { MessageProvider } from './messaging/providers'

// Stage 6: the Inbox reads a guest's sent messages from every one of their records, and only
// from records of the same studio that share their email.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler

const test = (channel: 'email' | 'sms'): MessageProvider => ({
  name: 'test',
  live: false,
  channel,
  send: async () => ({ outcome: 'test' }),
})
beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T07:00:00.000Z'),
    turnstile: null,
    providers: { email: test('email'), sms: test('sms'), receipt: () => null },
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email: string, name: string): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password: 'Fictional local account 2026!',
      workspace: { name, locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function run(login: Login, command: Command) {
  const { state } = (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ state: BusinessState }>()
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
const client = (login: Login, name: string, email: string, phone: string) =>
  run(login, { type: 'client', contact: { name, email, phone, marketingConsent: false } })
/** An approved message to a record, so the outbox holds a row for it. */
async function message(login: Login, clientId: string, body: string) {
  const messageId = await run(login, {
    type: 'message',
    input: { clientId, purpose: 'appointment', channel: 'email', subject: 'Hello', body },
  })
  await run(login, { type: 'message-queue', messageId })
  await api.outbox.tick()
}
async function outbox(login: Login, query: string) {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}/outbox?${query}`,
    headers: headers(login),
  })
  return response
}
const bodies = async (login: Login, query: string) => {
  const response = await outbox(login, query)
  expect(response.statusCode, response.body).toBe(200)
  return response
    .json<{ messages: { body: string }[] }>()
    .messages.map((m) => m.body)
    .sort()
}

describe("a guest's sent messages across their records (Stage 6)", () => {
  it('lists every record of the guest when asked, and one record otherwise', async () => {
    const owner = await register('owner@example.invalid', 'Linden Studio')
    const first = await client(owner, 'Rosa Field', 'rosa@example.invalid', '+44 7700 900456')
    // Booking online again opened a second record with the same email, typed differently.
    const again = await client(owner, 'Rosa Field', 'ROSA@example.invalid', '+44 7700 900457')
    const someoneElse = await client(
      owner,
      'Rosa Field',
      'other@example.invalid',
      '+44 7700 900456',
    )
    await message(owner, first, 'To the first record.')
    await message(owner, again, 'To the record made online.')
    await message(owner, someoneElse, 'To another guest with the same name and number.')

    expect(await bodies(owner, `clientId=${first}&guest=1`)).toEqual([
      'To the first record.',
      'To the record made online.',
    ])
    expect(await bodies(owner, `clientId=${again}&guest=1`)).toEqual([
      'To the first record.',
      'To the record made online.',
    ])
    // Without asking for the guest, a client's page still reads its own record only.
    expect(await bodies(owner, `clientId=${first}`)).toEqual(['To the first record.'])
    expect(await bodies(owner, `clientId=${someoneElse}&guest=1`)).toEqual([
      'To another guest with the same name and number.',
    ])
  })

  it('never reaches another studio, even for a guest with the same email', async () => {
    const owner = await register('owner@example.invalid', 'Linden Studio')
    const other = await register('elsewhere@example.invalid', 'Elm Studio')
    const mine = await client(owner, 'Rosa Field', 'rosa@example.invalid', '+44 7700 900456')
    const theirs = await client(other, 'Rosa Field', 'rosa@example.invalid', '+44 7700 900456')
    await message(owner, mine, 'From Linden.')
    await message(other, theirs, 'From Elm.')
    expect(await bodies(owner, `clientId=${mine}&guest=1`)).toEqual(['From Linden.'])
    // Another studio's record id reads nothing from it.
    expect(await bodies(owner, `clientId=${theirs}&guest=1`)).toEqual([])
    // Nor can one studio's owner open the other's outbox.
    const across = await api.inject({
      url: `/api/workspaces/${other.orgId}/outbox?clientId=${theirs}&guest=1`,
      headers: headers(owner),
    })
    expect(across.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('refuses a guest request it does not understand', async () => {
    const owner = await register('owner@example.invalid', 'Linden Studio')
    const first = await client(owner, 'Rosa Field', 'rosa@example.invalid', '+44 7700 900456')
    expect((await outbox(owner, `clientId=${first}&guest=yes`)).statusCode).toBe(400)
  })
})

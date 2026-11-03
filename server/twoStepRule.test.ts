// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { OutgoingMessage } from './messaging/providers'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { codeAt, STEP_SECONDS } from './twoStep'
import { OWNER_FIRST } from './twoStepRule'

// Stage 6: a studio can ask everyone in it to use two-step sign-in. Anyone who has not set it up
// is refused every studio request until they do, whatever their role and however they signed in,
// and only in the studios that ask. Email stays in test mode, so nothing is sent.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; address: string; email: string }
let api: ApiHandler
let clock: number
let mail: OutgoingMessage[]
let people = 0

beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  mail = []
  people = 0
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    providers: {
      email: {
        name: 'test',
        live: false,
        channel: 'email',
        send: async (message) => (mail.push(message), { outcome: 'test' }),
      },
      sms: { name: 'test', live: false, channel: 'sms', send: async () => ({ outcome: 'test' }) },
      receipt: () => null,
    },
  })
})
afterEach(() => api.close())

const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
const step = () => Math.floor(clock / 1000 / STEP_SECONDS)
const settled = () => new Promise((done) => setImmediate(done))
/** Each person signs in from their own address, so sign-in limits apply to each separately. */
const nextAddress = () => `192.0.2.${++people}`
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf, origin })
async function register(
  email: string,
  invitation?: string,
  studio = 'Fernleaf Rooms',
  sample = true,
) {
  const address = nextAddress()
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: address,
    payload: {
      name: 'Fictional Person',
      email,
      password,
      ...(invitation
        ? { invitation }
        : { workspace: { name: studio, locationName: 'Bath', region: 'UK', sample } }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    address,
    email,
  }
}
const post = (login: Login, url: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url,
    remoteAddress: login.address,
    headers: { ...headers(login), ...extra },
    payload,
  })
const read = (login: Login, path = '', orgId = login.orgId) =>
  api.inject({
    url: `/api/workspaces/${orgId}${path}`,
    remoteAddress: login.address,
    headers: headers(login),
  })
const session = (login: Login) =>
  api.inject({ url: '/api/session', remoteAddress: login.address, headers: headers(login) })
async function studio(owner: Login) {
  const response = await read(owner)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ state: BusinessState }>().state
}
const run = async (login: Login, command: Command, orgId = login.orgId) => {
  const revision = (await read(login, '', orgId)).json<{
    state?: BusinessState
    practitioner?: { revision: number }
  }>()
  return post(
    login,
    `/api/workspaces/${orgId}/commands`,
    { revision: revision.state?.revision ?? revision.practitioner?.revision ?? 0, command },
    { 'idempotency-key': crypto.randomUUID() },
  )
}
async function ok(login: Login, command: Command) {
  const response = await run(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response
}
/** Turns on two-step sign-in for this person and returns their key. */
async function turnOn(login: Login) {
  const started = await post(login, '/api/auth/two-step/start', {})
  expect(started.statusCode, started.body).toBe(200)
  const { secret } = started.json<{ secret: string }>()
  const confirmed = await post(login, '/api/auth/two-step/confirm', {
    code: codeAt(secret, step()),
  })
  expect(confirmed.statusCode, confirmed.body).toBe(200)
  expect(confirmed.body).toContain('recoveryCodes')
  return secret
}
async function invite(owner: Login, email: string, extra: Record<string, string>) {
  const response = await post(owner, `/api/workspaces/${owner.orgId}/invitations`, {
    email,
    ...extra,
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ invitation: string }>().invitation
}
async function member(owner: Login, email: string, extra: Record<string, string>) {
  const login = await register(email, await invite(owner, email, extra))
  return { ...login, orgId: owner.orgId }
}
/** Expects the refusal that holds someone until they set up two-step sign-in. */
function held(response: InjectResponse, studioName = 'Fernleaf Rooms') {
  expect(response.statusCode, response.body).toBe(403)
  expect(response.json()).toEqual({
    error: `${studioName} asks everyone to use two-step sign-in. Set it up to open the studio.`,
    code: 'two_step_required',
  })
}
const askEveryone = (forEveryone: boolean): Command => ({ type: 'two-step-rule', forEveryone })

/** A sample studio with a second location in its own region, and one of each role. */
async function team() {
  const owner = await register('owner@example.invalid')
  await ok(owner, { type: 'location', input: { name: 'Leeds', address: '2 Briggate' } })
  let state = await studio(owner)
  const leeds = state.operations!.locations![0].id
  await ok(owner, { type: 'region', input: { name: 'North', locationIds: [leeds] } })
  state = await studio(owner)
  const north = state.operations!.regions![0].id
  const staffId = state.staff.find((person) => !person.archived)!.id
  return {
    owner,
    manager: await member(owner, 'manager@example.invalid', { role: 'manager' }),
    reception: await member(owner, 'desk@example.invalid', { role: 'reception' }),
    practitioner: await member(owner, 'maya@example.invalid', { role: 'practitioner', staffId }),
    regional: await member(owner, 'rae@example.invalid', { role: 'regional', areaId: north }),
    general: await member(owner, 'gia@example.invalid', { role: 'general', locationId: leeds }),
  }
}

describe('asking everyone to use two-step sign-in', () => {
  it('is the owner’s alone, and only once they use it themselves', async () => {
    const { owner, manager, reception, practitioner, regional, general } = await team()
    // Nobody but the owner may change it, even with two-step sign-in on.
    for (const person of [manager, reception, practitioner, regional, general]) {
      await turnOn(person)
      const refused = await run(person, askEveryone(true))
      expect(refused.statusCode, refused.body).toBe(403)
    }
    // The owner has not turned it on for themselves yet.
    const first = await run(owner, askEveryone(true))
    expect(first.statusCode).toBe(409)
    expect(first.json<{ error: string }>().error).toBe(OWNER_FIRST)
    expect((await studio(owner)).operations?.twoStep).toBeUndefined()
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    expect((await studio(owner)).operations?.twoStep).toEqual({ forEveryone: true })
    // Asking again changes nothing and records nothing.
    const revision = (await studio(owner)).revision
    await ok(owner, askEveryone(true))
    expect((await studio(owner)).revision).toBe(revision)
  })

  it('records who switched it on and off in the change record', async () => {
    const owner = await register('owner@example.invalid')
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    clock += 60000
    await ok(owner, askEveryone(false))
    const page = await read(owner, '/changes?group=access')
    expect(page.statusCode, page.body).toBe(200)
    const entries = page
      .json<{
        entries: { what: string; lines: { what: string; from?: string; to?: string }[] }[]
      }>()
      .entries.filter((e) => e.what === 'Changed whether everyone must use two-step sign-in')
    // Newest first: switched off, then switched on.
    expect(entries.map((e) => e.lines)).toEqual([
      [{ what: 'two-step sign-in for everyone', from: 'yes', to: 'no' }],
      [{ what: 'two-step sign-in for everyone', from: 'no', to: 'yes' }],
    ])
    const stored = api.database.all<{ detail: string }>(
      "SELECT detail FROM audit_events WHERE action='two-step-rule' ORDER BY occurred_at",
    )
    expect(stored.map((row) => JSON.parse(row.detail).fields)).toEqual([
      [{ f: 'forEveryone', from: false, to: true }],
      [{ f: 'forEveryone', from: true, to: false }],
    ])
  })

  it('holds every role without it at every studio route, and lets them set it up', async () => {
    const { owner, manager, reception, practitioner, regional, general } = await team()
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    // The owner, who uses it, works on.
    expect((await read(owner)).statusCode).toBe(200)
    expect((await read(owner, '/team')).statusCode).toBe(200)
    for (const person of [manager, reception, practitioner, regional, general]) {
      // The studio record, saving, the day sheet, the change record and Ask SALEANE are refused.
      held(await read(person))
      held(await run(person, { type: 'note', clientId: 'any-client', text: 'Hello' }))
      held(await read(person, '/day-sheet'))
      held(await read(person, '/changes'))
      held(await read(person, '/diary-links'))
      // Who they are and which studio asks are still there, without anything from the studio.
      const me = await session(person)
      expect(me.statusCode).toBe(200)
      expect(me.json()).toMatchObject({
        user: { twoStep: null },
        workspaces: [{ id: owner.orgId, name: 'Fernleaf Rooms', twoStepRequired: true }],
      })
      // Setting it up releases them at once, in the same session.
      await turnOn(person)
      const opened = await read(person)
      expect(opened.statusCode, opened.body).toBe(200)
    }
  })

  it('holds a product photo too', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', { role: 'manager' })
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    // The photo need not exist: the person is refused before the photo is looked for.
    held(await read(manager, '/images/00000000000000000000000000000000'))
    const missing = await read(owner, '/images/00000000000000000000000000000000')
    expect(missing.statusCode).toBe(404)
  })

  it('lets a held person sign out', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', { role: 'manager' })
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    held(await read(manager))
    const out = await post(manager, '/api/auth/logout', {})
    expect(out.statusCode).toBe(200)
    expect((await session(manager)).statusCode).toBe(401)
  })

  it('releases everyone when the owner switches it off', async () => {
    const owner = await register('owner@example.invalid')
    const reception = await member(owner, 'desk@example.invalid', { role: 'reception' })
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    held(await read(reception))
    await ok(owner, askEveryone(false))
    expect((await read(reception)).statusCode).toBe(200)
    const me = (await session(reception)).json<{ workspaces: Record<string, unknown>[] }>()
    expect(me.workspaces[0]).not.toHaveProperty('twoStepRequired')
  })

  it('holds someone in two studios only at the one that asks', async () => {
    const first = await register('owner@example.invalid', undefined, 'Fernleaf Rooms')
    const second = await register('other@example.invalid', undefined, 'Willow House')
    const both = await member(first, 'both@example.invalid', { role: 'manager' })
    // The same person joins the second studio from its own invitation.
    const accepted = await post(both, '/api/invitations/accept', {
      invitation: await invite(second, 'both@example.invalid', { role: 'reception' }),
    })
    expect(accepted.statusCode, accepted.body).toBe(200)
    await turnOn(second)
    await ok(second, askEveryone(true))
    expect((await read(both, '', first.orgId)).statusCode).toBe(200)
    held(await read(both, '', second.orgId), 'Willow House')
    const me = (await session(both)).json<{ workspaces: Record<string, unknown>[] }>()
    const byName = me.workspaces
      .map((w) => [w.name, w.twoStepRequired ?? false])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    expect(byName).toEqual([
      ['Fernleaf Rooms', false],
      ['Willow House', true],
    ])
    // Saving in the studio that does not ask still works.
    const clientId = (await studio(first)).clients[0].id
    const saved = await run(both, { type: 'note', clientId, text: 'Hello' }, first.orgId)
    expect(saved.statusCode, saved.body).toBe(200)
  })

  it('lets an invitation be accepted, then holds the new member until they set it up', async () => {
    const owner = await register('owner@example.invalid')
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    // A new account joins as it is made.
    const fresh = await member(owner, 'new@example.invalid', { role: 'reception' })
    held(await read(fresh))
    // Someone with an account already joins from the account page.
    const elsewhere = await register('elsewhere@example.invalid', undefined, 'Willow House')
    const accepted = await post(elsewhere, '/api/invitations/accept', {
      invitation: await invite(owner, 'elsewhere@example.invalid', { role: 'manager' }),
    })
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<{ orgId: string }>().orgId).toBe(owner.orgId)
    held(await read(elsewhere, '', owner.orgId))
    // Their own studio, which does not ask, still opens.
    expect((await read(elsewhere)).statusCode).toBe(200)
    // Both invitations were used and recorded; neither person reached the studio record.
    const joined = api.database.all(
      "SELECT actor_id FROM audit_events WHERE action='invitation.accepted' AND organisation_id=?",
      owner.orgId,
    )
    expect(joined).toHaveLength(2)
  })

  it('holds someone who signs in by password, by reset link or by changing their password', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', { role: 'manager' })
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    const fromPassword = await api.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: manager.address,
      headers: { origin },
      payload: { email: manager.email, password },
    })
    expect(fromPassword.statusCode).toBe(200)
    held(
      await read({
        ...manager,
        cookie: cookie(fromPassword),
        csrf: fromPassword.json<{ csrf: string }>().csrf,
      }),
    )
    // A reset link proves the inbox and signs them in, but they are still held.
    await api.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      remoteAddress: manager.address,
      headers: { origin },
      payload: { email: manager.email },
    })
    await settled()
    const token = mail
      .filter((m) => m.to === manager.email)
      .at(-1)!
      .body.match(/\/reset-password#([A-Za-z0-9_-]{32,})\s/)![1]
    const reset = await api.inject({
      method: 'POST',
      url: '/api/auth/reset',
      remoteAddress: manager.address,
      headers: { origin },
      payload: { token, password: 'A brand new password 2026' },
    })
    expect(reset.statusCode, reset.body).toBe(200)
    const afterReset = {
      ...manager,
      cookie: cookie(reset),
      csrf: reset.json<{ csrf: string }>().csrf,
    }
    held(await read(afterReset))
    // Changing the password signs in afresh, still held.
    const changed = await post(afterReset, '/api/auth/password', {
      current: 'A brand new password 2026',
      password: 'Another new password 2026',
    })
    expect(changed.statusCode, changed.body).toBe(200)
    held(
      await read({
        ...afterReset,
        cookie: cookie(changed),
        csrf: changed.json<{ csrf: string }>().csrf,
      }),
    )
  })

  it('holds someone again who turns their own two-step sign-in off', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', { role: 'manager' })
    const secret = await turnOn(manager)
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    expect((await read(manager)).statusCode).toBe(200)
    clock += STEP_SECONDS * 1000
    const off = await post(manager, '/api/auth/two-step/off', {
      password,
      code: codeAt(secret, step()),
    })
    expect(off.statusCode, off.body).toBe(200)
    held(await read(manager))
    // The owner too: they cannot switch the studio's rule off until they set it up again.
    clock += STEP_SECONDS * 1000
    const ownerSecret = api.database.get<{ totp_secret: string }>(
      'SELECT totp_secret FROM accounts WHERE email=?',
      owner.email,
    )!.totp_secret
    const ownerOff = await post(owner, '/api/auth/two-step/off', {
      password,
      code: codeAt(ownerSecret, step()),
    })
    expect(ownerOff.statusCode, ownerOff.body).toBe(200)
    held(await run(owner, askEveryone(false)))
    await turnOn(owner)
    await ok(owner, askEveryone(false))
    expect((await read(manager)).statusCode).toBe(200)
  })

  it('leaves partner keys and the booking page working', async () => {
    // Access keys are for a studio of one's own, never a sample.
    const owner = await register('owner@example.invalid', undefined, 'Fernleaf Rooms', false)
    const { name, locationName, address, timeZone } = (await studio(owner)).organisation
    await ok(owner, {
      type: 'organisation',
      name,
      locationName,
      address,
      timeZone,
      bookingEnabled: true,
    })
    const keyMade = await post(owner, `/api/workspaces/${owner.orgId}/api-keys`, {
      name: 'Accounts',
      scopes: ['services:read'],
    })
    expect(keyMade.statusCode, keyMade.body).toBe(201)
    const { key } = keyMade.json<{ key: string }>()
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    // Turn the owner's own two-step sign-in off, so every person is held, then check the rest.
    clock += STEP_SECONDS * 1000
    const secret = api.database.get<{ totp_secret: string }>(
      'SELECT totp_secret FROM accounts WHERE email=?',
      owner.email,
    )!.totp_secret
    await post(owner, '/api/auth/two-step/off', { password, code: codeAt(secret, step()) })
    held(await read(owner))
    const keyRead = await api.inject({
      url: '/api/v1/services',
      headers: { authorization: `Bearer ${key}` },
    })
    expect(keyRead.statusCode, keyRead.body).toBe(200)
    const slug = api.database.get<{ slug: string }>(
      'SELECT slug FROM organisations WHERE id=?',
      owner.orgId,
    )!.slug
    const page = await api.inject({ url: `/api/public/${slug}` })
    expect(page.statusCode, page.body).toBe(200)
  })

  it('leaves out a held studio from the owner’s brands together, without failing', async () => {
    const owner = await register('owner@example.invalid', undefined, 'Fernleaf Rooms')
    const second = await post(owner, '/api/workspaces', {
      workspace: { name: 'Willow House', locationName: 'Leeds', region: 'UK', sample: true },
    })
    expect(second.statusCode, second.body).toBe(201)
    const secret = await turnOn(owner)
    await ok(owner, askEveryone(true))
    clock += STEP_SECONDS * 1000
    await post(owner, '/api/auth/two-step/off', { password, code: codeAt(secret, step()) })
    const group = await api.inject({
      url: '/api/group',
      remoteAddress: owner.address,
      headers: headers(owner),
    })
    expect(group.statusCode, group.body).toBe(200)
    expect(group.body).toContain('Willow House')
    expect(group.body).not.toContain('Fernleaf Rooms')
  })

  it('shows the owner who has it on, and nothing secret', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await member(owner, 'manager@example.invalid', { role: 'manager' })
    await member(owner, 'desk@example.invalid', { role: 'reception' })
    const secret = await turnOn(manager)
    await turnOn(owner)
    await ok(owner, askEveryone(true))
    const list = await read(owner, '/team')
    expect(list.statusCode).toBe(200)
    const members = list.json<{ members: { email: string; twoStep: boolean }[] }>().members
    expect(Object.fromEntries(members.map((m) => [m.email, m.twoStep]))).toEqual({
      'owner@example.invalid': true,
      'manager@example.invalid': true,
      'desk@example.invalid': false,
    })
    expect(list.body).not.toContain(secret)
    expect(list.body).not.toMatch(/totp|secret|recovery/i)
  })
})

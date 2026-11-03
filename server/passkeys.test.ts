// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { OutgoingMessage } from './messaging/providers'
import { PASSKEY_GONE, PASSKEYS_EACH, passkeyPlace, userHandle } from './passkeys'
import { codeAt, STEP_SECONDS } from './twoStep'
import { PretendPhone } from './test/authenticator'
import type { Prompt } from './test/authenticator'

// NEXT-15: signing in with Face ID or a fingerprint through a passkey. A pretend phone makes real
// ES256 signatures, so every check the server makes runs as it would with a real device.
const origin = 'http://localhost:5173'
const password = 'Fictional local account 2026!'
const email = 'owner@example.invalid'
let api: ApiHandler
let clock: number
let mail: OutgoingMessage[]

function server(at = origin) {
  return createApiHandler({
    origin: at,
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
}
beforeEach(() => {
  clock = Date.parse('2026-10-10T08:00:00.000Z')
  mail = []
  api = server()
})
afterEach(() => api.close())

type Login = { cookie: string; csrf: string }
type Options = Prompt & {
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  excludeCredentials?: { id: string }[]
  authenticatorSelection?: Record<string, unknown>
  allowCredentials?: unknown[]
  userVerification?: string
}
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
const settled = () => new Promise((done) => setImmediate(done))
async function register(who = email, name = 'Ada Owner'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email: who,
      password,
      workspace: { name: 'Fernleaf Rooms', locationName: 'Bath', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string }>(), cookie: cookie(response) }
}
const post = (login: Login | null, url: string, payload: unknown) =>
  api.inject({
    method: 'POST',
    url,
    headers: login ? { cookie: login.cookie, 'x-csrf-token': login.csrf, origin } : { origin },
    payload,
  })
const session = (login: Login) =>
  api.inject({ url: '/api/session', headers: { cookie: login.cookie } })
async function addingPrompt(login: Login, extra: Record<string, string> = {}) {
  const asked = await post(login, '/api/auth/passkeys/options', { password, ...extra })
  expect(asked.statusCode, asked.body).toBe(200)
  return asked.json<Options>()
}
/** Adds this phone's passkey for the person signed in. */
async function addPhone(login: Login, phone: PretendPhone, name = 'iPhone') {
  const prompt = await addingPrompt(login)
  const added = await post(login, '/api/auth/passkeys', { response: phone.create(prompt), name })
  expect(added.statusCode, added.body).toBe(201)
  return added.json<{ passkeys: { id: string; name: string; shared: boolean }[] }>().passkeys
}
async function signInPrompt() {
  const asked = await post(null, '/api/auth/passkey/options', {})
  expect(asked.statusCode, asked.body).toBe(200)
  return asked.json<Options>()
}
const answer = (response: unknown) => post(null, '/api/auth/passkey', { response })

describe('where passkeys can work', () => {
  it('needs a domain on a secure address, or localhost', () => {
    expect(passkeyPlace(new URL('http://localhost:5173'))).toEqual({
      rpID: 'localhost',
      origin: 'http://localhost:5173',
    })
    expect(passkeyPlace(new URL('https://linden.saleane.app'))).toEqual({
      rpID: 'linden.saleane.app',
      origin: 'https://linden.saleane.app',
    })
    expect(passkeyPlace(new URL('http://studio.localhost:5173'))?.rpID).toBe('studio.localhost')
    for (const refused of [
      'http://127.0.0.1:5173',
      'https://192.0.2.10',
      'http://[::1]:5173',
      'https://[2001:db8::1]',
      'http://linden.example.com',
    ])
      expect(passkeyPlace(new URL(refused)), refused).toBeNull()
  })

  it('is not offered on an IP address, and its routes say why', async () => {
    api.close()
    api = server('http://127.0.0.1:5173')
    const login = await register()
    const read = await api.inject({ url: '/api/session', headers: { cookie: login.cookie } })
    expect(read.json()).toMatchObject({ passkeysHere: false, user: { passkeys: 0 } })
    expect((await api.inject({ url: '/api/health' })).json()).toMatchObject({
      passkeysHere: false,
    })
    const asked = await api.inject({
      method: 'POST',
      url: '/api/auth/passkey/options',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: {},
    })
    expect(asked.statusCode).toBe(404)
    expect(asked.json()).toEqual({
      error: 'Face ID sign-in needs SALEANE on a secure web address, so it is not available here.',
    })
  })
})

describe('Face ID sign-in', () => {
  it('adds a device with the password, then signs in with it and no password', async () => {
    const login = await register()
    expect((await session(login)).json()).toMatchObject({
      passkeysHere: true,
      user: { passkeys: 0 },
    })
    // The password is asked for again, as for any change to how someone signs in.
    const wrong = await post(login, '/api/auth/passkeys/options', { password: 'not it at all' })
    expect(wrong.statusCode).toBe(403)
    const prompt = await addingPrompt(login)
    expect(prompt).toMatchObject({
      rp: { id: 'localhost', name: 'SALEANE' },
      user: { name: email, displayName: 'Ada Owner' },
      attestation: 'none',
      excludeCredentials: [],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    const accountId = (await session(login)).json<{ user: { id: string } }>().user.id
    expect(prompt.user.id).toBe(userHandle(accountId))

    const phone = new PretendPhone(origin)
    const added = await post(login, '/api/auth/passkeys', {
      response: phone.create(prompt),
      name: '  Ada’s iPhone ',
    })
    expect(added.statusCode, added.body).toBe(201)
    expect(added.json()).toEqual({
      passkeys: [
        {
          id: expect.any(String),
          name: 'Ada’s iPhone',
          createdAt: clock,
          lastUsedAt: null,
          shared: true,
        },
      ],
    })
    // Kept: the public key and its count, never anything about the face or finger.
    expect(
      api.database.all('SELECT device_type,backed_up,counter,transports FROM passkeys'),
    ).toEqual([
      { device_type: 'multiDevice', backed_up: 1, counter: 0, transports: '["internal","hybrid"]' },
    ])
    await settled()
    expect(mail.map((m) => m.subject)).toContain('Face ID sign-in was added to SALEANE')
    expect(mail.at(-1)?.body).toContain('A device called “Ada’s iPhone” can now sign in')
    expect((await session(login)).json()).toMatchObject({ user: { passkeys: 1 } })
    // Asking again names the passkey the device already has, so it does not make a second.
    expect((await addingPrompt(login)).excludeCredentials).toEqual([
      {
        id: [...phone.credentials.keys()][0],
        transports: ['internal', 'hybrid'],
        type: 'public-key',
      },
    ])

    // Signing in on the same device: no email, no password.
    const asked = await signInPrompt()
    expect(asked).toMatchObject({ rpId: 'localhost', userVerification: 'required' })
    expect(asked.allowCredentials ?? []).toEqual([])
    clock += 60_000
    const signedIn = await answer(phone.get(asked))
    expect(signedIn.statusCode, signedIn.body).toBe(200)
    const fresh = { cookie: cookie(signedIn), csrf: signedIn.json<{ csrf: string }>().csrf }
    expect((await session(fresh)).json()).toMatchObject({ user: { email } })
    expect(api.database.get('SELECT last_used_at FROM passkeys')).toEqual({ last_used_at: clock })
    // The same answer never signs in twice.
    expect((await answer(phone.get(asked))).statusCode).toBe(410)
  })

  it('asks for the code to add a device when two-step sign-in is on, and then needs no code', async () => {
    const login = await register()
    const started = await post(login, '/api/auth/two-step/start', {})
    const { secret } = started.json<{ secret: string }>()
    const step = () => Math.floor(clock / 1000 / STEP_SECONDS)
    expect(
      (await post(login, '/api/auth/two-step/confirm', { code: codeAt(secret, step()) }))
        .statusCode,
    ).toBe(200)
    clock += STEP_SECONDS * 1000
    const noCode = await post(login, '/api/auth/passkeys/options', { password })
    expect(noCode.statusCode).toBe(400)
    expect(noCode.json<{ error: string }>().error).toBe(
      'Enter a code from your authenticator app, or a recovery code.',
    )
    const badCode = await post(login, '/api/auth/passkeys/options', { password, code: '000000' })
    expect(badCode.statusCode).toBe(400)
    const prompt = await addingPrompt(login, { code: codeAt(secret, step()) })
    const phone = new PretendPhone(origin)
    expect(
      (await post(login, '/api/auth/passkeys', { response: phone.create(prompt), name: 'Mac' }))
        .statusCode,
    ).toBe(201)
    // The device checked the face or finger, which counts as the second step.
    const signedIn = await answer(phone.get(await signInPrompt()))
    expect(signedIn.statusCode, signedIn.body).toBe(200)
    expect(signedIn.json()).toEqual({ csrf: expect.any(String) })
  })

  it('refuses an answer from another address, without the face or finger, or too late', async () => {
    const login = await register()
    const elsewhere = await post(login, '/api/auth/passkeys', {
      response: new PretendPhone(origin).create(await addingPrompt(login), {
        origin: 'https://saleane.example.com',
      }),
      name: 'iPhone',
    })
    expect(elsewhere.statusCode).toBe(400)
    expect(elsewhere.json()).toEqual({
      error: 'Your device’s answer could not be checked. Try adding it again.',
    })
    const unverified = await post(login, '/api/auth/passkeys', {
      response: new PretendPhone(origin, { verifies: false }).create(await addingPrompt(login)),
      name: 'iPhone',
    })
    expect(unverified.statusCode).toBe(400)
    const prompt = await addingPrompt(login)
    clock += 6 * 60_000
    const late = await post(login, '/api/auth/passkeys', {
      response: new PretendPhone(origin).create(prompt),
      name: 'iPhone',
    })
    expect(late.statusCode).toBe(410)
    expect(late.json()).toEqual({ error: 'Adding this device took too long. Start again.' })
    expect(api.database.all('SELECT id FROM passkeys')).toEqual([])
  })

  it('never adds a passkey with someone else’s prompt', async () => {
    const ada = await register()
    const ben = await register('ben@example.invalid', 'Ben Owner')
    const adaPrompt = await addingPrompt(ada)
    const taken = await post(ben, '/api/auth/passkeys', {
      response: new PretendPhone(origin).create(adaPrompt),
      name: 'iPhone',
    })
    expect(taken.statusCode).toBe(400)
    expect(api.database.all('SELECT id FROM passkeys')).toEqual([])
  })

  it('keeps one device per person to ten', async () => {
    const login = await register()
    const accountId = (await session(login)).json<{ user: { id: string } }>().user.id
    for (let i = 0; i < PASSKEYS_EACH; i++)
      api.database.run(
        "INSERT INTO passkeys(id,account_id,public_key,counter,transports,device_type,backed_up,name,created_at) VALUES(?,?,x'00',0,'[]','multiDevice',1,'Old',0)",
        `old-passkey-${String(i).padStart(8, '0')}`,
        accountId,
      )
    const asked = await post(login, '/api/auth/passkeys/options', { password })
    expect(asked.statusCode).toBe(409)
    expect(asked.json()).toEqual({
      error: 'You already have 10 devices set up. Remove one you no longer use first.',
    })
  })

  it('stops a removed device from signing in, keeps a record of it and tells the inbox', async () => {
    const login = await register()
    const phone = new PretendPhone(origin)
    const [added] = await addPhone(login, phone, 'Old iPhone')
    const wrong = await post(login, '/api/auth/passkeys/remove', {
      id: added.id,
      password: 'not it at all',
    })
    expect(wrong.statusCode).toBe(403)
    const removed = await post(login, '/api/auth/passkeys/remove', { id: added.id, password })
    expect(removed.statusCode, removed.body).toBe(200)
    expect(removed.json()).toEqual({ passkeys: [] })
    expect(
      api.database.all('SELECT removed_at,removed_why FROM passkeys WHERE id=?', added.id),
    ).toEqual([{ removed_at: clock, removed_why: 'person' }])
    await settled()
    expect(mail.at(-1)).toMatchObject({ subject: 'Face ID sign-in was removed from SALEANE' })
    expect(mail.at(-1)?.body).toContain('The device called “Old iPhone” can no longer sign in')
    const refused = await answer(phone.get(await signInPrompt()))
    expect(refused.statusCode).toBe(401)
    expect(refused.json()).toEqual({ error: PASSKEY_GONE })
    // Removing it twice, or someone else's, finds nothing.
    expect(
      (await post(login, '/api/auth/passkeys/remove', { id: added.id, password })).statusCode,
    ).toBe(404)
  })

  it('refuses a passkey whose count went backwards, or that names another person', async () => {
    const login = await register()
    const phone = new PretendPhone(origin, { counts: true })
    await addPhone(login, phone)
    expect((await answer(phone.get(await signInPrompt()))).statusCode).toBe(200)
    expect((await answer(phone.get(await signInPrompt()))).statusCode).toBe(200)
    expect(api.database.get('SELECT counter FROM passkeys')).toEqual({ counter: 2 })
    // A copy of the passkey made before those two sign-ins.
    const copied = await answer(phone.get(await signInPrompt(), undefined, { counter: 1 }))
    expect(copied.statusCode).toBe(401)
    expect(copied.json<{ error: string }>().error).toContain('could not be trusted')

    const other = phone.get(await signInPrompt())
    other.response.userHandle = userHandle('someone-else')
    expect((await answer(other)).statusCode).toBe(401)
  })

  it('lists only the person’s own devices', async () => {
    const ada = await register()
    await addPhone(ada, new PretendPhone(origin), 'Ada’s Mac')
    const ben = await register('ben@example.invalid', 'Ben Owner')
    const list = await api.inject({ url: '/api/auth/passkeys', headers: { cookie: ben.cookie } })
    expect(list.json()).toEqual({ passkeys: [], here: true })
    const [adas] = (
      await api.inject({ url: '/api/auth/passkeys', headers: { cookie: ada.cookie } })
    ).json<{ passkeys: { id: string }[] }>().passkeys
    expect(
      (await post(ben, '/api/auth/passkeys/remove', { id: adas.id, password })).statusCode,
    ).toBe(404)
  })
})

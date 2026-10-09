// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { OutgoingMessage } from './messaging/providers'
import { codeAt, fromBase32, matchStep, STEP_SECONDS, toBase32 } from './twoStep'

// NEXT-04: two-step sign-in with an authenticator app, recovery codes, and the notices that go to
// the account's inbox. Email stays in test mode, so nothing is sent.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const email = 'owner@example.invalid'
let api: ApiHandler
let clock: number
let mail: OutgoingMessage[]

beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  mail = []
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

type Login = { cookie: string; csrf: string; orgId?: string }
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
const step = () => Math.floor(clock / 1000 / STEP_SECONDS)
const settled = () => new Promise((done) => setImmediate(done))
async function register(): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Fernleaf Rooms', locationName: 'Bath', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const post = (login: Login | null, url: string, payload: unknown) =>
  api.inject({
    method: 'POST',
    url,
    headers: login ? { cookie: login.cookie, 'x-csrf-token': login.csrf, origin } : {},
    payload,
  })
const signIn = (pass = password) => post(null, '/api/auth/login', { email, password: pass })
const session = (login: Login) =>
  api.inject({ url: '/api/session', headers: { cookie: login.cookie } })
const enterCode = (challenge: string, code: string) =>
  post(null, '/api/auth/login/code', { challenge, code })
/** Turns two-step sign-in on and returns the key and the recovery codes. */
async function turnOn(login: Login) {
  const started = await post(login, '/api/auth/two-step/start', {})
  expect(started.statusCode, started.body).toBe(200)
  const { secret, uri } = started.json<{ secret: string; uri: string }>()
  const confirmed = await post(login, '/api/auth/two-step/confirm', {
    code: codeAt(secret, step()),
  })
  expect(confirmed.statusCode, confirmed.body).toBe(200)
  return { secret, uri, codes: confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes }
}
async function challenge() {
  const answered = await signIn()
  expect(answered.statusCode, answered.body).toBe(200)
  expect(answered.headers['set-cookie']).toBeUndefined()
  const body = answered.json<{ twoStep: boolean; challenge: string }>()
  expect(body.twoStep).toBe(true)
  return body.challenge
}

describe('authenticator codes', () => {
  it('match the published RFC 6238 examples', () => {
    const secret = toBase32(Buffer.from('12345678901234567890'))
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(fromBase32(secret).toString()).toBe('12345678901234567890')
    const at = (seconds: number) => codeAt(secret, Math.floor(seconds / 30))
    expect(at(59)).toBe('287082')
    expect(at(1111111109)).toBe('081804')
    expect(at(1111111111)).toBe('050471')
    expect(at(1234567890)).toBe('005924')
    expect(at(2000000000)).toBe('279037')
    expect(at(20000000000)).toBe('353130')
  })

  it('allow one step either side of now, and never a step already used', () => {
    const secret = toBase32(Buffer.from('12345678901234567890'))
    const now = 1111111111 * 1000,
      here = Math.floor(now / 30000)
    expect(matchStep(secret, codeAt(secret, here), now)).toBe(here)
    expect(matchStep(secret, codeAt(secret, here - 1), now)).toBe(here - 1)
    expect(matchStep(secret, codeAt(secret, here + 1), now)).toBe(here + 1)
    expect(matchStep(secret, codeAt(secret, here - 2), now)).toBeUndefined()
    expect(matchStep(secret, codeAt(secret, here), now, here)).toBeUndefined()
    expect(matchStep(secret, 'abcdef', now)).toBeUndefined()
  })
})

describe('turning two-step sign-in on', () => {
  it('needs a right code from the app, then gives ten recovery codes once', async () => {
    const owner = await register()
    const started = await post(owner, '/api/auth/two-step/start', {})
    const { secret, uri } = started.json<{ secret: string; uri: string }>()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(uri).toBe(
      `otpauth://totp/SALEANE%3A${encodeURIComponent(email)}?secret=${secret}&issuer=SALEANE&algorithm=SHA1&digits=6&period=30`,
    )
    const wrong = await post(owner, '/api/auth/two-step/confirm', { code: '000000' })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json<{ error: string }>().error).toContain('not right')
    expect((await session(owner)).json<{ user: { twoStep: unknown } }>().user.twoStep).toBeNull()
    const right = await post(owner, '/api/auth/two-step/confirm', { code: codeAt(secret, step()) })
    expect(right.statusCode, right.body).toBe(200)
    const codes = right.json<{ recoveryCodes: string[] }>().recoveryCodes
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) expect(code).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/)
    expect((await session(owner)).json<{ user: { twoStep: unknown } }>().user.twoStep).toEqual({
      since: clock,
      recoveryLeft: 10,
    })
    // Neither the key nor the codes are kept in the clear.
    const stored = api.database.all<{ code_hash: string }>('SELECT code_hash FROM recovery_codes')
    expect(stored.some((row) => codes.some((code) => row.code_hash.includes(code)))).toBe(false)
    await settled()
    expect(mail.at(-1)?.subject).toBe('Two-step sign-in is on for SALEANE')
  })

  it('signs out every other device, keeping this one', async () => {
    const owner = await register()
    const other = await signIn()
    const elsewhere = { cookie: cookie(other), csrf: other.json<{ csrf: string }>().csrf }
    expect((await session(elsewhere)).statusCode).toBe(200)
    await turnOn(owner)
    expect((await session(elsewhere)).statusCode).toBe(401)
    expect((await session(owner)).statusCode).toBe(200)
  })

  it('refuses a key left waiting more than half an hour', async () => {
    const owner = await register()
    const { secret } = (await post(owner, '/api/auth/two-step/start', {})).json<{
      secret: string
    }>()
    clock += 31 * 60000
    const late = await post(owner, '/api/auth/two-step/confirm', { code: codeAt(secret, step()) })
    expect(late.statusCode).toBe(400)
    expect(late.json<{ error: string }>().error).toContain('took too long')
  })

  it('shows the owner who has it on, and nothing more', async () => {
    const owner = await register()
    await turnOn(owner)
    const team = await api.inject({
      url: `/api/workspaces/${owner.orgId}/team`,
      headers: { cookie: owner.cookie },
    })
    const [member] = team.json<{ members: Record<string, unknown>[] }>().members
    expect(member.twoStep).toBe(true)
    expect(JSON.stringify(team.json())).not.toMatch(/secret|totp|recovery/i)
  })
})

describe('signing in with two-step sign-in on', () => {
  it('asks for the code after the password, and opens no session until it is right', async () => {
    const owner = await register()
    const { secret } = await turnOn(owner)
    clock += STEP_SECONDS * 1000
    const pending = await challenge()
    const wrong = await enterCode(pending, '000000')
    expect(wrong.statusCode).toBe(400)
    expect(wrong.headers['set-cookie']).toBeUndefined()
    const right = await enterCode(pending, codeAt(secret, step()))
    expect(right.statusCode, right.body).toBe(200)
    const signed = { cookie: cookie(right), csrf: right.json<{ csrf: string }>().csrf }
    expect((await session(signed)).statusCode).toBe(200)
    // The same step was a moment ago, so the same code never opens a second session.
    const again = await enterCode(await challenge(), codeAt(secret, step()))
    expect(again.statusCode).toBe(400)
    // Nor does a used sign-in step.
    expect((await enterCode(pending, codeAt(secret, step() + 1))).statusCode).toBe(410)
  })

  it('starts again after five wrong codes, or after five minutes', async () => {
    const owner = await register()
    const { secret } = await turnOn(owner)
    clock += STEP_SECONDS * 1000
    const pending = await challenge()
    for (let i = 0; i < 4; i++)
      expect((await enterCode(pending, '000000')).json<{ error: string }>().error).toContain(
        'not right',
      )
    const fifth = await enterCode(pending, '000000')
    expect(fifth.statusCode).toBe(410)
    expect(fifth.json<{ error: string }>().error).toContain('Start again')
    expect((await enterCode(pending, codeAt(secret, step()))).statusCode).toBe(410)
    const slow = await challenge()
    clock += 6 * 60000
    const late = await enterCode(slow, codeAt(secret, step()))
    expect(late.statusCode).toBe(410)
    expect(late.json<{ error: string }>().error).toContain('timed out')
  })

  it('takes a recovery code once, however it is typed, and tells the inbox', async () => {
    const owner = await register()
    const { codes } = await turnOn(owner)
    const typed = ` ${codes[0].toUpperCase().replace('-', ' ')} `
    const used = await enterCode(await challenge(), typed)
    expect(used.statusCode, used.body).toBe(200)
    expect(used.json<{ recoveryLeft: number }>().recoveryLeft).toBe(9)
    await settled()
    expect(mail.at(-1)?.subject).toBe('A SALEANE recovery code was used')
    expect((await enterCode(await challenge(), codes[0])).statusCode).toBe(400)
    expect((await enterCode(await challenge(), codes[1])).statusCode).toBe(200)
  })

  it('still asks for the code after a password reset from the email', async () => {
    const owner = await register()
    const { secret } = await turnOn(owner)
    clock += STEP_SECONDS * 1000
    await post(null, '/api/auth/forgot', { email })
    const token = mail.at(-1)!.body.match(/\/reset-password#([A-Za-z0-9_-]{32,})\s/)![1]
    const reset = await post(null, '/api/auth/reset', {
      token,
      password: 'A brand new password 2026',
    })
    expect(reset.statusCode, reset.body).toBe(200)
    expect(reset.headers['set-cookie']).toBeUndefined()
    const pending = reset.json<{ twoStep: boolean; challenge: string }>()
    expect(pending.twoStep).toBe(true)
    // The new password is saved, every device is signed out, and the code finishes signing in.
    expect((await session(owner)).statusCode).toBe(401)
    expect((await signIn('A brand new password 2026')).json()).toMatchObject({ twoStep: true })
    const done = await enterCode(pending.challenge, codeAt(secret, step()))
    expect(done.statusCode, done.body).toBe(200)
  })
})

describe('changing two-step sign-in', () => {
  it('turns off only with the password and a code, and tells the inbox', async () => {
    const owner = await register()
    const { secret } = await turnOn(owner)
    clock += STEP_SECONDS * 1000
    const code = codeAt(secret, step())
    expect(
      (await post(owner, '/api/auth/two-step/off', { password: 'not the password', code }))
        .statusCode,
    ).toBe(403)
    expect(
      (await post(owner, '/api/auth/two-step/off', { password, code: '000000' })).statusCode,
    ).toBe(400)
    const off = await post(owner, '/api/auth/two-step/off', { password, code })
    expect(off.statusCode, off.body).toBe(200)
    await settled()
    expect(mail.at(-1)?.subject).toBe('Two-step sign-in is off for SALEANE')
    const plain = await signIn()
    expect(plain.json<{ csrf: string }>().csrf).toBeTruthy()
    expect(api.database.all('SELECT * FROM recovery_codes')).toEqual([])
  })

  it('makes new recovery codes with the password, and the old ones stop working', async () => {
    const owner = await register()
    const { codes } = await turnOn(owner)
    expect(
      (await post(owner, '/api/auth/two-step/recovery', { password: 'not the password' }))
        .statusCode,
    ).toBe(403)
    const fresh = await post(owner, '/api/auth/two-step/recovery', { password })
    expect(fresh.statusCode, fresh.body).toBe(200)
    const next = fresh.json<{ recoveryCodes: string[] }>().recoveryCodes
    expect(next).toHaveLength(10)
    expect((await enterCode(await challenge(), codes[0])).statusCode).toBe(400)
    expect((await enterCode(await challenge(), next[0])).statusCode).toBe(200)
    await settled()
    expect(mail.map((m) => m.subject)).toContain('New SALEANE recovery codes')
  })

  it('cannot be set up twice', async () => {
    const owner = await register()
    await turnOn(owner)
    expect((await post(owner, '/api/auth/two-step/start', {})).statusCode).toBe(409)
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { OutgoingMessage, SendResult } from './messaging/providers'

// NEXT-03: choosing a new password from an emailed link, and confirming an email address. Email
// stays in test mode here, so the test provider keeps what would have gone and nothing is sent.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
let api: ApiHandler
let clock: number
let mail: OutgoingMessage[]
let answer: () => SendResult
/** Holds the email provider's answer until released, like a slow email service. */
let gate: Promise<void>

function start(at = origin) {
  api?.close()
  api = createApiHandler({
    origin: at,
    databasePath: ':memory:',
    now: () => clock,
    providers: {
      email: {
        name: 'test',
        live: false,
        channel: 'email',
        send: async (message) => {
          mail.push(message)
          await gate
          return answer()
        },
      },
      sms: { name: 'test', live: false, channel: 'sms', send: async () => ({ outcome: 'test' }) },
      receipt: () => null,
    },
  })
}
beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  mail = []
  answer = () => ({ outcome: 'test' })
  gate = Promise.resolve()
  start()
})
afterEach(() => api.close())

const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email = 'owner@example.invalid') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Studio Person',
      email,
      password,
      workspace: { name: 'Fernleaf Rooms', locationName: 'Bath', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string }>(), cookie: cookie(response) }
}
/** The link's code travels in the fragment, never the query, so no request log sees it. */
const tokenOf = (message: OutgoingMessage) =>
  message.body.match(/\/(?:reset-password|confirm-email)#([A-Za-z0-9_-]{32,})\s/)![1]
const forgot = (email: string) =>
  api.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email } })
const reset = (token: string, next = 'A brand new password 2026') =>
  api.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password: next } })
const login = (pass: string) =>
  api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@example.invalid', password: pass },
  })
const session = (c: string) => api.inject({ url: '/api/session', headers: { cookie: c } })
/** Emails go out after the answer, so let them finish before reading what was recorded. */
const settled = () => new Promise((done) => setImmediate(done))
const records = async () => {
  await settled()
  return api.database.all('SELECT kind,status,recipient FROM account_mail ORDER BY created_at')
}
const confirm = (token: string) =>
  api.inject({ method: 'POST', url: '/api/auth/confirm', payload: { token } })

describe('forgotten password', () => {
  it('gives the same answer whether or not the address has an account', async () => {
    await register()
    mail = []
    const known = await forgot('owner@example.invalid')
    const unknown = await forgot('nobody@example.invalid')
    expect(known.statusCode).toBe(200)
    expect(unknown.statusCode).toBe(200)
    expect(known.json()).toEqual(unknown.json())
    expect(known.json()).toEqual({ ok: true, emailConnected: false, linkInLog: true })
    expect(mail).toHaveLength(1)
    expect(mail[0].to).toBe('owner@example.invalid')
    expect(mail[0].subject).toBe('Choose a new SALEANE password')
    expect(mail[0].body).toContain(`${origin}/reset-password#`)
    expect(mail[0].body).not.toContain('?')
  })

  it('writes test-mode links in the log only when SALEANE runs for this computer alone', async () => {
    start('https://studio.example.com')
    const answered = await api.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      headers: { origin: 'https://studio.example.com' },
      payload: { email: 'nobody@example.invalid' },
    })
    expect(answered.statusCode, answered.body).toBe(200)
    expect(answered.json()).toEqual({ ok: true, emailConnected: false, linkInLog: false })
  })

  it('records a test-mode email as not sent', async () => {
    await register()
    await forgot('owner@example.invalid')
    expect(await records()).toEqual([
      { kind: 'confirm', status: 'test', recipient: 'owner@example.invalid' },
      { kind: 'reset', status: 'test', recipient: 'owner@example.invalid' },
    ])
  })

  it('sets the new password, signs out every other device, and works only once', async () => {
    const owner = await register()
    await forgot('owner@example.invalid')
    const token = tokenOf(mail.at(-1)!)
    const done = await reset(token)
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json<{ csrf: string }>().csrf).toBeTruthy()
    // The new session works; the old one does not.
    expect((await session(cookie(done))).statusCode).toBe(200)
    expect((await session(owner.cookie)).statusCode).toBe(401)
    expect((await login(password)).statusCode).toBe(401)
    expect((await login('A brand new password 2026')).statusCode).toBe(200)
    const again = await reset(token, 'Another new password 2026')
    expect(again.statusCode).toBe(400)
    expect(again.json<{ error: string }>().error).toContain('already been used')
  })

  it('expires after an hour', async () => {
    await register()
    await forgot('owner@example.invalid')
    clock += 61 * 60000
    expect((await reset(tokenOf(mail.at(-1)!))).statusCode).toBe(400)
  })

  it('keeps earlier links working until one is used, as emails can arrive out of order', async () => {
    await register()
    await forgot('owner@example.invalid')
    const first = tokenOf(mail.at(-1)!)
    await forgot('owner@example.invalid')
    const second = tokenOf(mail.at(-1)!)
    expect((await reset(first)).statusCode).toBe(200)
    expect((await reset(second)).statusCode).toBe(400)
  })

  it('stops working when the account email changes', async () => {
    await register()
    await forgot('owner@example.invalid')
    const token = tokenOf(mail.at(-1)!)
    api.database.run(
      'UPDATE accounts SET email=? WHERE email=?',
      'moved@example.invalid',
      'owner@example.invalid',
    )
    expect((await reset(token)).statusCode).toBe(400)
  })

  it('refuses a short password and a made-up link', async () => {
    await register()
    await forgot('owner@example.invalid')
    expect((await reset(tokenOf(mail.at(-1)!), 'short')).statusCode).toBe(400)
    expect((await reset('x'.repeat(43))).statusCode).toBe(400)
  })

  it('records a provider failure honestly', async () => {
    await register()
    answer = () => ({ outcome: 'failed', detail: 'Refused', retry: false })
    await forgot('owner@example.invalid')
    expect((await records()).at(-1)).toMatchObject({ kind: 'reset', status: 'failed' })
  })

  it('answers without waiting for the email service', async () => {
    await register()
    let release = () => {}
    gate = new Promise((done) => (release = done))
    const answered = await forgot('owner@example.invalid')
    expect(answered.statusCode).toBe(200)
    // Recorded before the answer, as not known yet, so a server that stops now still has it.
    expect((await records()).at(-1)).toMatchObject({ kind: 'reset', status: 'unknown' })
    release()
    expect((await records()).at(-1)).toMatchObject({ kind: 'reset', status: 'test' })
  })

  it('sends one inbox no more than five links an hour, with the same answer', async () => {
    await register()
    mail = []
    for (let i = 0; i < 6; i++) {
      const answered = await forgot('owner@example.invalid')
      expect(answered.json()).toEqual({ ok: true, emailConnected: false, linkInLog: true })
    }
    expect(mail).toHaveLength(5)
    clock += 61 * 60000
    await forgot('owner@example.invalid')
    expect(mail).toHaveLength(6)
  })

  it('lets only one of two requests with the same link through', async () => {
    await register()
    await forgot('owner@example.invalid')
    const token = tokenOf(mail.at(-1)!)
    const both = await Promise.all([
      reset(token, 'The first new password'),
      reset(token, 'The second new password'),
    ])
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400])
  })
})

describe('confirming an email address', () => {
  it('sends a link on sign-up, and the account works before it is opened', async () => {
    const owner = await register()
    expect(mail).toHaveLength(1)
    expect(mail[0].subject).toBe('Confirm your email for SALEANE')
    const before = await session(owner.cookie)
    expect(before.json<{ user: { emailConfirmed: boolean } }>().user.emailConfirmed).toBe(false)
    const token = tokenOf(mail[0])
    const done = await confirm(token)
    expect(done.statusCode, done.body).toBe(200)
    const after = await session(owner.cookie)
    expect(after.json<{ user: { emailConfirmed: boolean } }>().user.emailConfirmed).toBe(true)
    expect((await confirm(token)).statusCode).toBe(400)
    // A link left unopened for more than seven days no longer works.
    await register('second@example.invalid')
    clock += 8 * 24 * 60 * 60000
    expect((await confirm(tokenOf(mail.at(-1)!))).statusCode).toBe(400)
    expect(
      api.database.get(
        'SELECT email_confirmed_at AS at FROM accounts WHERE email=?',
        'second@example.invalid',
      ),
    ).toEqual({ at: null })
  })

  it('sends a fresh link on request, and none once confirmed', async () => {
    const owner = await register()
    const first = tokenOf(mail[0])
    const resend = () =>
      api.inject({
        method: 'POST',
        url: '/api/auth/confirm/resend',
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf, origin },
        payload: {},
      })
    const sent = await resend()
    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json()).toEqual({
      ok: true,
      emailConnected: false,
      linkInLog: true,
      confirmed: false,
    })
    expect(mail).toHaveLength(2)
    // Either link works; once one is used, the other no longer does.
    expect((await confirm(first)).statusCode).toBe(200)
    expect((await confirm(tokenOf(mail[1]))).statusCode).toBe(400)
    expect((await resend()).json()).toEqual({
      ok: true,
      emailConnected: false,
      linkInLog: true,
      confirmed: true,
    })
    expect(mail).toHaveLength(2)
  })

  it('stops sending fresh links after five in an hour', async () => {
    const owner = await register()
    const resend = () =>
      api.inject({
        method: 'POST',
        url: '/api/auth/confirm/resend',
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf, origin },
        payload: {},
      })
    for (let i = 0; i < 4; i++) expect((await resend()).statusCode).toBe(200)
    const refused = await resend()
    expect(refused.statusCode).toBe(429)
    expect(refused.json<{ error: string }>().error).toContain('Use the newest')
    expect(mail).toHaveLength(5)
  })

  it('counts a password reset as confirming the address', async () => {
    await register()
    await forgot('owner@example.invalid')
    const done = await reset(tokenOf(mail.at(-1)!))
    const after = await session(cookie(done))
    expect(after.json<{ user: { emailConfirmed: boolean } }>().user.emailConfirmed).toBe(true)
  })
})

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import { supportAddressFromEnv } from './routes/support'
import type { SupportAnswer } from '../src/domain/help'

// NEXT-06: writing to the SALEANE team from Help.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let sent: OutgoingMessage[]
let outcome: 'accepted' | 'failed' | 'test'

function open(supportEmail: string | null, live = true) {
  sent = []
  outcome = 'accepted'
  const email: MessageProvider = {
    name: 'postmark',
    live,
    channel: 'email',
    send: async (message) => {
      if (message.fromName !== 'SALEANE Help') return { outcome: 'test' }
      sent.push(message)
      if (!live || outcome === 'test') return { outcome: 'test' }
      return outcome === 'accepted'
        ? { outcome: 'accepted', providerRef: `ref-${sent.length}` }
        : { outcome: 'failed', detail: 'The inbox refused it.', retry: false }
    },
  }
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    turnstile: null,
    supportEmail,
    providers: { email, sms: { ...email, channel: 'sms' }, receipt: () => null },
  })
}
afterEach(() => api.close())

const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Fernleaf Rooms', locationName: 'Bath', region: 'UK', sample: true },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const write = (login: Login, payload: object, csrf = login.csrf) =>
  api.inject({
    method: 'POST',
    url: '/api/support',
    headers: { cookie: login.cookie, 'x-csrf-token': csrf, origin },
    payload,
  })
const list = async (login: Login) =>
  (
    await api.inject({ url: '/api/support', headers: { cookie: login.cookie } })
  ).json<SupportAnswer>()
const ask = {
  topic: 'using',
  message: 'How do I move a visit to next week?',
  page: '/calendar',
}

describe('writing to the SALEANE team (NEXT-06)', () => {
  it('emails the team with who wrote, from which studio and screen, and records that it went', async () => {
    open('help@saleane.example')
    const owner = await register()
    const response = await write(owner, { ...ask, workspaceId: owner.orgId })
    expect(response.statusCode, response.body).toBe(200)
    const answer = response.json<SupportAnswer>()
    expect(answer.delivery).toBe('email')
    expect(answer.requests).toEqual([
      expect.objectContaining({
        id: answer.id,
        topic: 'using',
        message: ask.message,
        page: '/calendar',
        studio: 'Fernleaf Rooms',
        status: 'accepted',
      }),
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'help@saleane.example', fromName: 'SALEANE Help' })
    expect(sent[0].subject).toMatch(/^Help request: How to do something \([0-9a-f]{8}\)$/)
    expect(sent[0].body).toContain('From: Ada Owner <owner@example.invalid>')
    expect(sent[0].body).toContain('Studio: Fernleaf Rooms (Owner)')
    expect(sent[0].body).toContain('Screen: /calendar')
    expect(sent[0].body).toContain(ask.message)
  })

  it('keeps a request it could not send, and never says it was sent', async () => {
    open('help@saleane.example')
    const owner = await register()
    outcome = 'failed'
    await write(owner, ask)
    expect((await list(owner)).requests[0]).toMatchObject({ status: 'failed', studio: null })
    api.close()

    open('help@saleane.example', false)
    const tested = await register()
    const answer = (await write(tested, ask)).json<SupportAnswer>()
    expect(answer.delivery).toBe('test')
    expect(answer.requests[0].status).toBe('test')
    api.close()

    open(null)
    const kept = await register()
    const keptAnswer = (await write(kept, ask)).json<SupportAnswer>()
    expect(keptAnswer.delivery).toBe('kept')
    expect(keptAnswer.requests[0].status).toBe('kept')
    expect(sent).toHaveLength(0)
  })

  it('lets people see only their own requests', async () => {
    open('help@saleane.example')
    const owner = await register()
    const other = await register('other@example.invalid')
    await write(owner, ask)
    expect((await list(owner)).requests).toHaveLength(1)
    expect((await list(other)).requests).toEqual([])
    // A studio someone does not belong to cannot be named.
    expect((await write(other, { ...ask, workspaceId: owner.orgId })).statusCode).toBe(404)
  })

  it('asks for a signed-in person, the right form and a fair number of requests', async () => {
    open('help@saleane.example')
    expect(
      (await api.inject({ method: 'POST', url: '/api/support', headers: { origin }, payload: ask }))
        .statusCode,
    ).toBe(401)
    const owner = await register()
    expect((await write(owner, ask, 'wrong')).statusCode).toBe(403)
    expect((await write(owner, { ...ask, message: 'Help' })).statusCode).toBe(400)
    expect((await write(owner, { ...ask, topic: 'refund' })).statusCode).toBe(400)
    expect((await write(owner, { ...ask, page: 'https://elsewhere.example/' })).statusCode).toBe(
      400,
    )
    for (let n = 0; n < 5; n++) expect((await write(owner, ask)).statusCode).toBe(200)
    const sixth = await write(owner, ask)
    expect(sixth.statusCode).toBe(429)
    expect(sixth.json<{ error: string }>().error).toMatch(/several times this hour/)
    expect(sent).toHaveLength(5)
  })

  it('reads the help address from the server settings', () => {
    expect(supportAddressFromEnv({})).toBeNull()
    expect(supportAddressFromEnv({ SALEANE_SUPPORT_EMAIL: ' help@saleane.example ' })).toBe(
      'help@saleane.example',
    )
    expect(() => supportAddressFromEnv({ SALEANE_SUPPORT_EMAIL: 'not an address' })).toThrow(
      'SALEANE_SUPPORT_EMAIL must be an email address.',
    )
  })
})

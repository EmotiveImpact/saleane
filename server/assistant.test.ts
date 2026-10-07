// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'

// Ask Saleane on the server: test mode, the allowance kept per studio, approvals saved as commands.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
let api: ApiHandler

beforeEach(() => {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T08:00:00.000Z'),
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string, name = 'Studio Owner') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: {
              name: 'Reference Studio',
              locationName: 'London',
              region: 'UK',
              sample: true,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    userId: '',
  }
  login.userId = (await api.inject({ url: '/api/session', headers: headers(login) })).json<{
    user: { id: string }
  }>().user.id
  return login
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: headers(login),
    payload,
  })
async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await post(owner, '/invitations', { email, role, staffId })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation, email)
  return { ...login, orgId: owner.orgId }
}
const ask = (login: Login, text: string) => post(login, '/assistant', { text })
type Answer = {
  status: string
  text: string
  proposals: { id: string; summary: string }[]
  usage: { used: { typed: number }; allowance: { typed: number } }
}
const studio = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state

describe('Ask Saleane on the server', () => {
  it('answers from the studio record and counts each question for the studio', async () => {
    const owner = await register('owner@example.invalid')
    const first = await ask(owner, "What's on today?")
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json<Answer>()).toMatchObject({
      status: 'answered',
      usage: { used: { typed: 1 } },
    })
    expect(first.json<Answer>().text).toMatch(/Tuesday 6 October/)
    await ask(owner, 'Who is due back?')
    const usage = await get(owner, '/assistant')
    expect(usage.json<{ mode: string; usage: Answer['usage'] }>()).toMatchObject({
      mode: 'test',
      usage: { used: { typed: 2 }, allowance: { typed: 300 } },
    })
  })

  it('stops asking once the monthly allowance is used, without calling the brain', async () => {
    const owner = await register('owner@example.invalid')
    api.database.run(
      'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?)',
      owner.orgId,
      JSON.stringify({
        period: '2026-10',
        used: { typed: 300, talkSeconds: 0, guestChats: 0 },
        spendByDay: {},
        recent: {},
      }),
      0,
    )
    const answer = (await ask(owner, "What's on today?")).json<Answer>()
    expect(answer.status).toBe('refused')
    expect(answer.text).toMatch(/allowance is used up/)
    expect(answer.usage.used.typed).toBe(300)
  })

  it('saves an approved invitation as an unsent draft only through the command route', async () => {
    const owner = await register('owner@example.invalid')
    const state = await studio(owner)
    const client = state.clients.find((c) => c.marketingConsent)!
    const answer = (await ask(owner, `Invite ${client.name} back`)).json<Answer>()
    expect(answer.proposals).toHaveLength(1)
    expect((await studio(owner)).revision).toBe(state.revision)

    const decided = await post(owner, `/assistant/proposals/${answer.proposals[0].id}`, {
      approve: true,
    })
    expect(decided.statusCode, decided.body).toBe(200)
    const { command } = decided.json<{ outcome: string; command: unknown }>()
    const saved = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/commands`,
      headers: { ...headers(owner), 'idempotency-key': `assistant:${answer.proposals[0].id}` },
      payload: { revision: state.revision, command },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const after = await studio(owner)
    const drafts = after.operations!.messages.filter((m) => m.clientId === client.id)
    expect(drafts.at(-1)?.status).toBe('draft')

    // A proposal is decided once.
    const again = await post(owner, `/assistant/proposals/${answer.proposals[0].id}`, {
      approve: true,
    })
    expect(again.statusCode).toBe(404)
  })

  it('keeps proposals to the person who asked and keeps practitioners out', async () => {
    const owner = await register('owner@example.invalid')
    const state = await studio(owner)
    const client = state.clients.find((c) => c.marketingConsent)!
    const answer = (await ask(owner, `Invite ${client.name} back`)).json<Answer>()
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const stolen = await post(desk, `/assistant/proposals/${answer.proposals[0].id}`, {
      approve: true,
    })
    expect(stolen.statusCode).toBe(404)
    expect((await ask(desk, 'How much did we take this week?')).json<Answer>().text).toBe(
      'That is for owners and managers.',
    )
    const practitioner = await member(
      owner,
      'pro@example.invalid',
      'practitioner',
      state.staff[0].id,
    )
    expect((await ask(practitioner, "What's on today?")).statusCode).toBe(403)
  })
})

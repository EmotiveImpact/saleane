// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// V5: comparing with similar studios, anonymously and only when the studio shares.
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
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const run = (login: Login, revision: number, command: Command, key: string = crypto.randomUUID()) =>
  post(login, '/commands', { revision, command }, { 'idempotency-key': key })
async function studio(owner: Login) {
  return (await get(owner)).json<{ state: BusinessState }>().state
}
const ok = async (login: Login, command: Command) => {
  const response = await run(login, (await studio(login)).revision, command)
  expect(response.statusCode, response.body).toBe(200)
  return response
}
async function invite(owner: Login, email: string, role: string) {
  const invitation = await post(owner, '/invitations', { email, role })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}

type Benchmark = {
  sharing: boolean
  enoughVisits?: boolean
  comparison?: { key: string; own: number; median: number; position: string }[] | null
}
const benchmark = async (login: Login) => {
  const response = await get(login, '/benchmark')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Benchmark>()
}
const share = (login: Login, on = true) => ok(login, { type: 'benchmark-sharing', share: on })

describe('how you compare', () => {
  it('is shown only to a studio that shares, and only with enough others sharing', async () => {
    const owner = await register('owner@example.invalid')
    expect(await benchmark(owner)).toEqual({ sharing: false })
    await share(owner)
    expect((await studio(owner)).operations!.benchmark).toEqual({
      sharing: true,
      since: '2026-10-06',
    })
    const others: Login[] = []
    for (let i = 0; i < 5; i++) others.push(await register(`peer${i}@example.invalid`))
    // Four others sharing is too few: nothing about them is shown.
    for (const peer of others.slice(0, 4)) await share(peer)
    let view = await benchmark(owner)
    expect(view).toMatchObject({ sharing: true, enoughVisits: true, comparison: null })
    await share(others[4])
    view = await benchmark(owner)
    expect(view.comparison!.map((c) => c.key)).toEqual([
      'averageVisit',
      'rebookRate',
      'returnRate',
      'noShowRate',
    ])
    // The sample studios are alike, so this one sits in the middle of them.
    expect(view.comparison!.every((c) => c.position === 'typical' && c.own === c.median)).toBe(true)
    // Nothing names or counts another studio.
    const text = JSON.stringify(view)
    expect(text).not.toContain('orgId')
    expect(text).not.toMatch(/"(id|name|count|studios)"/)
    // A studio that stops sharing drops out at once.
    await share(others[4], false)
    expect((await benchmark(owner)).comparison).toBeNull()
  })

  it('never mixes sample studios with real ones or markets with each other', async () => {
    const owner = await register('owner@example.invalid')
    await share(owner)
    for (let i = 0; i < 5; i++) {
      const response = await api.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Peer Owner',
          email: `us${i}@example.invalid`,
          password,
          workspace: { name: 'New York Studio', locationName: 'Main', region: 'US', sample: true },
        },
      })
      const peer = {
        ...response.json<{ csrf: string; orgId: string }>(),
        cookie: cookie(response),
        userId: '',
      }
      await share(peer)
    }
    expect((await benchmark(owner)).comparison).toBeNull()
  })

  it('is set by the owner only and read by the owner and managers', async () => {
    const owner = await register('owner@example.invalid')
    const manager = await invite(owner, 'manager@example.invalid', 'manager')
    const desk = await invite(owner, 'desk@example.invalid', 'reception')
    const state = await studio(owner)
    expect(
      (await run(manager, state.revision, { type: 'benchmark-sharing', share: true })).statusCode,
    ).toBe(403)
    expect((await benchmark(manager)).sharing).toBe(false)
    expect((await get(desk, '/benchmark')).statusCode).toBe(403)
  })
})

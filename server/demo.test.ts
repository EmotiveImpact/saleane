// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'

let api: ApiHandler | undefined
afterEach(() => {
  api?.close()
  api = undefined
})

const start = () =>
  (api = createApiHandler({
    origin: 'http://127.0.0.1:5173',
    databasePath: ':memory:',
    turnstile: null,
  }))

describe('the one-press demo', () => {
  it('gives each visitor their own signed-in sample studio', async () => {
    const handler = start()
    const first = await handler.inject({ method: 'POST', url: '/api/demo', payload: {} })
    expect(first.statusCode, first.body).toBe(201)
    const { orgId } = first.json<{ orgId: string; csrf: string }>()
    const cookie = String(first.headers['set-cookie']).split(';')[0]
    const session = (await handler.inject({ url: '/api/session', headers: { cookie } })).json<{
      workspaces: { id: string; mode: string; role: string }[]
    }>()
    expect(session.workspaces).toEqual([
      expect.objectContaining({ id: orgId, mode: 'sandbox', role: 'owner' }),
    ])
    const second = await handler.inject({ method: 'POST', url: '/api/demo', payload: {} })
    expect(second.json<{ orgId: string }>().orgId).not.toBe(orgId)
  })

  it('is limited for each visitor, so nobody can fill SALEANE with demos', async () => {
    const handler = start()
    const answers = []
    for (let i = 0; i < 7; i++)
      answers.push(
        (await handler.inject({ method: 'POST', url: '/api/demo', payload: {} })).statusCode,
      )
    expect(answers.slice(0, 6)).toEqual([201, 201, 201, 201, 201, 201])
    expect(answers[6]).toBe(429)
  })
})

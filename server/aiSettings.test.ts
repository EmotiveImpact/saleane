// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'

// A wrong AI setting must turn the AI off, never stop sign-in and the diary for every studio.
// Fictional settings only: nothing here reaches a real supplier.
const saved = { ...process.env }
let api: ApiHandler | undefined
afterEach(() => {
  api?.close()
  api = undefined
  process.env = { ...saved }
  vi.restoreAllMocks()
})

describe('AI settings that cannot be read', () => {
  it('keeps the app answering with the AI off, and says so without the values', async () => {
    process.env.SALEANE_AI_PROVIDER = 'keiki'
    process.env.KEIKI_API_KEY = 'fictional-key-not-real'
    process.env.KEIKI_AGENT = 'fictional-agent'
    process.env.SALEANE_AI_PRICES = '$3 / $15'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    api = createApiHandler({ origin: 'http://127.0.0.1:5173', databasePath: ':memory:' })
    const health = await api.inject({ url: '/api/health' })
    expect(health.statusCode).toBe(200)
    const body = JSON.parse(health.body)
    expect(body.aiSettingsValid).toBe(false)
    expect(body.services.ai).toBe(false)
    expect(health.body).not.toContain('fictional-key-not-real')
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/SALEANE AI is off: .*PRICES/))
  })

  it('reports valid settings when the AI is simply not chosen', async () => {
    delete process.env.SALEANE_AI_PROVIDER
    api = createApiHandler({ origin: 'http://127.0.0.1:5173', databasePath: ':memory:' })
    const body = JSON.parse((await api.inject({ url: '/api/health' })).body)
    expect(body.aiSettingsValid).toBe(true)
  })
})

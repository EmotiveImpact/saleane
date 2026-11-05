// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { addresses } from './vercel'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'

let api: ApiHandler | undefined
afterEach(() => {
  api?.close()
  api = undefined
})

describe('one public address', () => {
  it('answers as the website address and still accepts the hosting address', () => {
    expect(addresses({ APP_ORIGIN: 'https://saleane-app.vercel.app' })).toEqual({
      origin: 'https://saleane.vercel.app',
      alsoHosts: ['saleane-app.vercel.app'],
    })
    expect(
      addresses({
        APP_ORIGIN: 'https://x.vercel.app',
        SALEANE_PUBLIC_ORIGIN: 'https://saleane.com',
      }),
    ).toEqual({ origin: 'https://saleane.com', alsoHosts: ['x.vercel.app'] })
    expect(addresses({})).toBeNull()
  })

  it('accepts requests forwarded to the hosting address, and no other host', async () => {
    api = createApiHandler({
      origin: 'https://saleane.vercel.app',
      alsoHosts: ['saleane-app.vercel.app'],
      databasePath: ':memory:',
    })
    const forwarded = await api.inject({
      url: '/api/health',
      headers: { host: 'saleane-app.vercel.app' },
    })
    expect(forwarded.statusCode).toBe(200)
    const other = await api.inject({ url: '/api/health', headers: { host: 'elsewhere.example' } })
    expect(other.statusCode).toBe(403)
  })
})

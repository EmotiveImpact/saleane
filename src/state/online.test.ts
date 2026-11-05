import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}))

async function fresh() {
  vi.resetModules()
  const { api, ApiError } = await import('./api')
  const { runsOnline } = await import('./online')
  return { api: vi.mocked(api), ApiError, runsOnline }
}
beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

test('the server says whether SALEANE runs online', async () => {
  const { api, runsOnline } = await fresh()
  api.mockResolvedValue({ localOnly: false })
  expect(await runsOnline()).toBe(true)
  const again = await fresh()
  again.api.mockResolvedValue({ localOnly: true })
  expect(await again.runsOnline()).toBe(false)
})

test('while the server is being set up, a public address in the browser counts as online', async () => {
  const { api, ApiError, runsOnline } = await fresh()
  api.mockRejectedValue(new ApiError('SALEANE is being set up. Try again shortly.', 503))
  vi.stubGlobal('location', { hostname: 'saleane-app.vercel.app' })
  expect(await runsOnline()).toBe(true)
  vi.stubGlobal('location', { hostname: '127.0.0.1' })
  // A failed answer is not kept, so the next question asks again.
  expect(await runsOnline()).toBe(false)
})

import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Account } from './Account'
import { api, ApiError } from '../state/api'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const where = { online: false }
vi.mock('../state/online', () => ({ useRunsOnline: () => where.online }))
const enterDemo = vi.fn()
vi.mock('../state/context', () => ({
  useStore: () => ({
    session: null,
    refreshSession: async () => null,
    openWorkspace: vi.fn(),
    state: { organisation: { locale: 'en-GB' } },
    enterDemo,
    logout: vi.fn(),
  }),
}))
afterEach(() => {
  vi.resetAllMocks()
  where.online = false
})

function signIn() {
  vi.mocked(api).mockRejectedValue(new ApiError('Sign in to continue.', 401))
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('online, the fictional demo opens its own Vercel site in a new tab', async () => {
  where.online = true
  signIn()
  const demo = await screen.findByRole('link', { name: /Explore the fictional demo/ })
  expect(demo).toHaveAttribute('href', 'https://saleane-try-demo.vercel.app')
  expect(demo).toHaveAttribute('target', '_blank')
  expect(demo).toHaveAttribute('rel', 'noopener noreferrer')
  expect(demo).toHaveAccessibleName(/opens in a new tab/)
  expect(screen.getByText(/made-up studio with fictional clients/)).toBeInTheDocument()
  expect(enterDemo).not.toHaveBeenCalled()
})

test('on a computer, the demo stays inside this SALEANE', async () => {
  signIn()
  const demo = await screen.findByRole('button', { name: 'Explore the fictional demo' })
  expect(screen.queryByRole('link', { name: /Explore the fictional demo/ })).toBeNull()
  demo.click()
  expect(enterDemo).toHaveBeenCalledOnce()
})

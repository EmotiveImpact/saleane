import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider } from './StoreProvider'
import { StudioLanding } from '../components/StudioLanding'
import { movedAddress } from './online'

// Online, a visitor must never land in the fictional demo kept in the browser (5 November 2026:
// a new visitor to the app's address was shown "Atelier House" and its sample AI answers).
vi.mock('./online', async (original) => ({
  ...(await original<typeof import('./online')>()),
  seemsOnline: () => true,
}))

const fetchMock = vi.fn<typeof fetch>()
function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: 'Sign in to continue.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SALEANE at a public address', () => {
  it('sends a signed-out visitor to sign in instead of the demo', async () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <StoreProvider>
          <StudioLanding>
            <Routes>
              <Route path="*" element={<Where />} />
            </Routes>
          </StudioLanding>
        </StoreProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/account'))
  })

  it('moves the hosting address to the one address, keeping the page', () => {
    const at = {
      hostname: 'saleane-app.vercel.app',
      pathname: '/book/fern',
      search: '?a=1',
      hash: '#x',
    }
    expect(movedAddress(at)).toBe('https://saleane.vercel.app/book/fern?a=1#x')
    expect(movedAddress({ ...at, hostname: 'saleane.vercel.app' })).toBeNull()
    expect(movedAddress({ ...at, hostname: '127.0.0.1' })).toBeNull()
  })
})

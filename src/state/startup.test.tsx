import { webcrypto } from 'node:crypto'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider } from './StoreProvider'
import { useStore } from './context'
import type { Store } from './context'
import { setCsrf } from './api'
import type { RemoteWorkspace, Session } from './api'
import type { Role } from '../domain/operations'
import { createWorkspace } from '../domain/workspace'
import { StudioLanding } from '../components/StudioLanding'

// A new tab, or a workspace page, never shows a signed-in person the fictional demo by accident.
const fetchMock = vi.fn<typeof fetch>()
const MEMORY = 'saleane.last-studio.v1'
const DEMO_NAME = 'Atelier House'
function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function studio(name: string, role: Role = 'owner'): RemoteWorkspace {
  const state = createWorkspace({ name, region: 'UK' })
  return {
    id: state.organisation.id,
    slug: `studio-${state.organisation.id}`,
    view: 'studio',
    state,
    role,
    today: '2026-10-06',
    mode: 'local',
  }
}
function sessionFor(...workspaces: RemoteWorkspace[]): Session {
  return {
    user: { id: 'account-imogen', name: 'Imogen Hart', email: 'imogen@example.invalid' },
    csrf: 'test-csrf-token',
    workspaces: workspaces.map((w) => ({
      id: w.id,
      slug: w.slug,
      role: w.role,
      name: w.state.organisation.name,
      region: 'UK',
      mode: 'local',
    })),
    services: { email: false, payments: false },
    localOnly: true,
  }
}
/** The browser remembers that this account last used `studioId` (or only that it signed in). */
function signedInBefore(studioId = '', account = 'account-imogen') {
  localStorage.setItem(MEMORY, JSON.stringify([[account, studioId]]))
}
function serve(session: Session | number, ...workspaces: RemoteWorkspace[]) {
  fetchMock.mockImplementation(async (path) => {
    const url = String(path)
    if (url === '/api/session')
      return typeof session === 'number'
        ? response({ error: 'Sign in to continue.' }, session)
        : response(session)
    const found = workspaces.find((w) => url === `/api/workspaces/${w.id}`)
    if (found) return response(found)
    return response({ error: 'Not found.' }, 404)
  })
}
let latest!: Store
const seen: string[] = []
function Consumer() {
  const store = useStore()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    latest = store
  }, [store])
  // Every studio a workspace page showed outside the loading screen. The account page and the
  // practitioner and area pages do not show the studio record.
  if (!store.loading && !/^\/(account|practice\/|area\/)/.test(pathname))
    seen.push(store.state.organisation.name)
  return (
    <>
      <output data-testid="where">{pathname}</output>
      <output data-testid="workspace">
        {store.loading ? 'loading' : store.state.organisation.name}
      </output>
      <output data-testid="mode">{store.mode}</output>
      <button onClick={() => navigate('/clients')}>Clients</button>
    </>
  )
}
function mount(path = '/today') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StoreProvider>
        <StudioLanding>
          <Routes>
            <Route path="*" element={<Consumer />} />
          </Routes>
        </StudioLanding>
      </StoreProvider>
    </MemoryRouter>,
  )
}
const where = () => screen.getByTestId('where').textContent
const shown = () => screen.getByTestId('workspace').textContent

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  seen.length = 0
  setCsrf('')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

describe('starting a new tab', () => {
  it('opens the studio this account last used here, not the demo', async () => {
    const first = studio('Fernleaf Rooms'),
      second = studio('Linden Studio')
    signedInBefore(second.id)
    serve(sessionFor(first, second), first, second)
    mount('/clients')
    expect(shown()).toBe('loading')
    await waitFor(() => expect(shown()).toBe('Linden Studio'))
    expect(screen.getByTestId('mode')).toHaveTextContent('server')
    expect(where()).toBe('/clients')
    expect(seen).not.toContain(DEMO_NAME)
    expect(sessionStorage.getItem('saleane.workspace')).toBe(second.id)
  })

  it('opens their only studio when none is remembered', async () => {
    const only = studio('Fernleaf Rooms')
    signedInBefore()
    serve(sessionFor(only), only)
    mount()
    await waitFor(() => expect(shown()).toBe('Fernleaf Rooms'))
    expect(seen).not.toContain(DEMO_NAME)
    // The studio is now remembered for the next tab.
    expect(JSON.parse(localStorage.getItem(MEMORY)!)).toEqual([['account-imogen', only.id]])
  })

  it('asks which studio when there are several and none is remembered', async () => {
    const first = studio('Fernleaf Rooms'),
      second = studio('Linden Studio')
    signedInBefore('', 'someone-else')
    serve(sessionFor(first, second), first, second)
    mount('/calendar')
    await waitFor(() => expect(where()).toBe('/account'))
    expect(seen).not.toContain(DEMO_NAME)
    expect(latest.landing).toBe('/account')
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual(['/api/session'])
  })

  it('sends a practitioner to their own day and a regional manager to their area', async () => {
    const practice = studio('Fernleaf Rooms', 'practitioner')
    signedInBefore(practice.id)
    serve(sessionFor(practice), practice)
    const first = mount('/clients')
    await waitFor(() => expect(where()).toBe(`/practice/${practice.id}`))
    // Their day loads its own scoped record; the whole studio is never requested.
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual(['/api/session'])
    expect(seen).not.toContain(DEMO_NAME)
    first.unmount()

    seen.length = 0
    fetchMock.mockReset()
    const area = studio('Fernleaf Rooms', 'regional')
    signedInBefore(area.id)
    serve(sessionFor(area), area)
    mount('/today')
    await waitFor(() => expect(where()).toBe(`/area/${area.id}`))
    expect(seen).not.toContain(DEMO_NAME)
  })

  it('shows the demo to someone signed out, and asks nothing of a browser nobody signed in on', async () => {
    signedInBefore()
    serve(401)
    const first = mount()
    await waitFor(() => expect(shown()).toBe(DEMO_NAME))
    expect(where()).toBe('/today')
    expect(latest.landing).toBeNull()
    first.unmount()

    localStorage.clear()
    fetchMock.mockReset()
    mount()
    // A visitor's first visit opens the demo at once, without a session request.
    expect(shown()).toBe(DEMO_NAME)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends someone to the account page when the service cannot confirm who is signed in', async () => {
    signedInBefore()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    mount('/today')
    await waitFor(() => expect(where()).toBe('/account'))
    expect(seen).not.toContain(DEMO_NAME)
  })

  it('does not let a late session answer replace an explicit choice of the demo', async () => {
    const only = studio('Fernleaf Rooms')
    signedInBefore(only.id)
    let answer!: (value: Response) => void
    fetchMock.mockImplementation((path) =>
      String(path) === '/api/session'
        ? new Promise<Response>((resolve) => {
            answer = resolve
          })
        : Promise.resolve(response(only)),
    )
    mount('/today')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    act(() => latest.enterDemo())
    await act(async () => {
      answer(response(sessionFor(only)))
    })
    expect(shown()).toBe(DEMO_NAME)
    expect(where()).toBe('/today')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('saleane.workspace')).toBeNull()
  })

  it('does not let a late open replace a studio chosen meanwhile', async () => {
    const first = studio('Fernleaf Rooms'),
      second = studio('Linden Studio')
    signedInBefore(first.id)
    let release!: (value: Response) => void
    fetchMock.mockImplementation((path) => {
      const url = String(path)
      if (url === '/api/session') return Promise.resolve(response(sessionFor(first, second)))
      if (url === `/api/workspaces/${first.id}`)
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      return Promise.resolve(response(second))
    })
    mount('/today')
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([p]) => String(p) === `/api/workspaces/${first.id}`)).toBe(
        true,
      ),
    )
    await act(async () => {
      await latest.openWorkspace(second.id)
    })
    await act(async () => {
      release(response(first))
    })
    expect(shown()).toBe('Linden Studio')
    expect(sessionStorage.getItem('saleane.workspace')).toBe(second.id)
  })
})

describe('a workspace page in a tab with no studio open', () => {
  it('sends a practitioner who signed in on this tab to their day instead of the demo', async () => {
    const practice = studio('Fernleaf Rooms', 'practitioner')
    serve(sessionFor(practice), practice)
    mount('/account')
    // Signing in on the account page; the practitioner then types /clients.
    await act(async () => {
      await latest.refreshSession()
    })
    expect(latest.landing).toBe(`/practice/${practice.id}`)
    expect(where()).toBe('/account')
    act(() => screen.getByRole('button', { name: 'Clients' }).click())
    await waitFor(() => expect(where()).toBe(`/practice/${practice.id}`))
    expect(seen).not.toContain(DEMO_NAME)
  })

  it('leaves the demo to someone who chose it on purpose', async () => {
    const only = studio('Fernleaf Rooms')
    serve(sessionFor(only), only)
    mount('/account')
    await act(async () => {
      await latest.refreshSession()
    })
    expect(latest.landing).toBe('/account')
    act(() => latest.enterDemo())
    expect(latest.landing).toBeNull()
    act(() => screen.getByRole('button', { name: 'Clients' }).click())
    expect(where()).toBe('/clients')
    expect(shown()).toBe(DEMO_NAME)
  })
})

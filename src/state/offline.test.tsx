import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider } from './StoreProvider'
import { useStore } from './context'
import type { Store } from './context'
import { setCsrf } from './api'
import type { RemoteWorkspace, Session } from './api'
import { DAY_SHEET_KEY, readDaySheet } from './daySheet'
import { DaySheetGate } from '../components/DaySheetGate'
import { seed } from '../domain/seed'
import { daySheet } from '../domain/daySheet'
import type { DaySheet } from '../domain/daySheet'

// OFF-01: the read-only day sheet, the offline state and reconnection in the signed-in client.
const fetchMock = vi.fn<typeof fetch>()
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const state = seed('UK')
const remote: RemoteWorkspace = {
  id: state.organisation.id,
  slug: 'reference-studio',
  view: 'studio',
  state,
  role: 'reception',
  today: '2026-10-06',
  mode: 'local',
}
const owner = { role: 'reception' as const, staffId: null }
const session = (workspaces = [remote]): Session => ({
  user: { id: 'account-desk', name: 'Desk Operator', email: 'desk@example.invalid' },
  csrf: 'csrf-token',
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
})
const sheetAt = (time: string): DaySheet => daySheet(state, owner, time)
type Routes = {
  session?: () => Response | Promise<Response>
  sheet?: () => Response | Promise<Response>
  commands?: () => Response | Promise<Response>
}
function serve(routes: Routes = {}) {
  fetchMock.mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/session') return routes.session?.() ?? json(session())
    if (path.endsWith('/day-sheet'))
      return routes.sheet?.() ?? json(sheetAt(new Date().toISOString()))
    if (path.endsWith('/commands')) return routes.commands?.() ?? json({ error: 'No' }, 422)
    if (path === '/api/auth/logout') return json({ ok: true })
    return json(remote)
  })
}
const sheetCalls = () => fetchMock.mock.calls.filter(([p]) => String(p).endsWith('/day-sheet'))
const commandCalls = () => fetchMock.mock.calls.filter(([p]) => String(p).endsWith('/commands'))

function mount() {
  let current!: Store
  // Outside the gate, so the store stays observable while the workspace is replaced.
  function Probe() {
    const store = useStore()
    useEffect(() => {
      current = store
    }, [store])
    return null
  }
  function Workspace() {
    return (
      <main>
        <h1>Workspace</h1>
        <button>New appointment</button>
      </main>
    )
  }
  const view = render(
    <MemoryRouter initialEntries={['/today']}>
      <StoreProvider>
        <Probe />
        <DaySheetGate>
          <Workspace />
        </DaySheetGate>
      </StoreProvider>
    </MemoryRouter>,
  )
  return {
    ...view,
    get store() {
      return current
    },
  }
}
async function signIn(view: ReturnType<typeof mount>) {
  await act(async () => {
    await view.store.refreshSession()
  })
  await act(async () => {
    await view.store.openWorkspace(remote.id)
  })
  await waitFor(() => expect(view.store.daySheet).not.toBeNull())
}
const note = {
  type: 'note' as const,
  clientId: state.clients[0].id,
  text: 'Prefers the window room',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setCsrf('')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

describe('the offline day sheet in the signed-in client (OFF-01)', () => {
  it('keeps the day sheet for this tab only, keyed to the account and studio', async () => {
    serve()
    const view = mount()
    await signIn(view)
    expect(sheetCalls().length).toBeGreaterThan(0)
    expect(localStorage.getItem(DAY_SHEET_KEY)).toBeNull()
    const saved = readDaySheet({ accountId: 'account-desk', workspaceId: remote.id })!
    expect(saved.sheet.visits.length).toBeGreaterThan(0)
    expect(readDaySheet({ accountId: 'someone-else' })).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
  })

  it('shows an unmistakable offline state with the saved sheet and pauses every write', async () => {
    serve()
    const view = mount()
    await signIn(view)
    expect(screen.getByRole('button', { name: 'New appointment' })).toBeInTheDocument()
    serve({ commands: () => Promise.reject(new TypeError('Failed to fetch')) })
    await act(async () => {
      expect((await view.store.commit(note)).ok).toBe(false)
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Offline/)
    // The fictional sandbox keeps a fixed date, so on any other real day the saved time also names its date.
    expect(alert).toHaveTextContent(
      /Showing the day sheet saved at (\w{3} \d{1,2} \w{3}, )?\d\d:\d\d, valid until .+\. Changes are paused\./,
    )
    expect(screen.queryByRole('button', { name: 'New appointment' })).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent(state.clients[0].name.split(' ')[0])
    const writes = commandCalls().length
    await act(async () => {
      const paused = await view.store.commit(note)
      expect(paused.ok).toBe(false)
      if (!paused.ok) expect(paused.error).toMatch(/paused/)
    })
    expect(commandCalls()).toHaveLength(writes)
  })

  it('goes offline when the browser reports no network', async () => {
    serve()
    const view = mount()
    await signIn(view)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Changes are paused/)
    expect(view.store.connection).toBe('offline')
  })

  it('rechecks the session and replaces the sheet before writes resume', async () => {
    serve()
    const view = mount()
    await signIn(view)
    const before = view.store.daySheet!.sheet.generatedAt
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await screen.findByRole('alert')
    // Still unreachable: stays offline and keeps the saved sheet.
    serve({ session: () => Promise.reject(new TypeError('Failed to fetch')) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    })
    await waitFor(() => expect(view.store.connection).toBe('offline'))
    expect(view.store.daySheet?.sheet.generatedAt).toBe(before)
    // Reachable again: the session, studio and a fresh sheet load before the workspace returns.
    // A different sheet that has not expired on the real clock (a fixed date expires overnight).
    const fresh = sheetAt(new Date(Date.now() - 60000).toISOString())
    serve({ sheet: () => json(fresh) })
    fetchMock.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    })
    await screen.findByRole('button', { name: 'New appointment' })
    const order = fetchMock.mock.calls.map(([p]) => String(p))
    expect(order[0]).toBe('/api/session')
    expect(order).toContain(`/api/workspaces/${remote.id}`)
    expect(order.at(-1)).toBe(`/api/workspaces/${remote.id}/day-sheet`)
    expect(view.store.connection).toBe('online')
    expect(view.store.daySheet?.sheet.generatedAt).toBe(fresh.generatedAt)
    expect(readDaySheet()?.sheet.generatedAt).toBe(fresh.generatedAt)
  })

  it('clears the sheet when reconnecting finds the access was removed', async () => {
    serve()
    const view = mount()
    await signIn(view)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await screen.findByRole('alert')
    serve({ session: () => json(session([])) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    })
    await waitFor(() => expect(view.store.connection).toBe('online'))
    expect(view.store.daySheet).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
    expect(view.store.blocked).toBe(true)
  })

  it('clears the sheet on logout, even when the sign-out request cannot be sent', async () => {
    serve()
    const view = mount()
    await signIn(view)
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).not.toBeNull()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await act(async () => {
      await view.store.logout().catch(() => {})
    })
    expect(view.store.daySheet).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
  })

  it('clears the sheet on workspace change and returning to the demo', async () => {
    serve()
    const view = mount()
    await signIn(view)
    act(() => view.store.enterDemo())
    expect(view.store.daySheet).toBeNull()
    expect(view.store.sheetWorkspace).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
    await signIn(view)
    const other = { ...remote, id: 'another-studio' }
    serve({ sheet: () => new Promise(() => {}) })
    fetchMock.mockImplementationOnce(async () => json(other))
    await act(async () => {
      await view.store.openWorkspace(other.id).catch(() => {})
    })
    expect(view.store.daySheet).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
  })

  it('does not restore an expired sheet or one for another studio', () => {
    const old = sheetAt('2026-10-06T08:00:00.000Z')
    const saved = {
      accountId: 'account-desk',
      workspaceId: remote.id,
      savedAt: old.generatedAt,
      source: 'server',
      sheet: old,
    }
    sessionStorage.setItem(DAY_SHEET_KEY, JSON.stringify(saved))
    expect(readDaySheet({}, Date.parse(old.expiresAt) + 1)).toBeNull()
    expect(sessionStorage.getItem(DAY_SHEET_KEY)).toBeNull()
    sessionStorage.setItem(DAY_SHEET_KEY, JSON.stringify({ ...saved, workspaceId: 'elsewhere' }))
    expect(readDaySheet({}, Date.parse(old.generatedAt))).toBeNull()
  })

  it('builds the printable sheet locally in the browser demo, with an offline preview', async () => {
    const page = (entry: string) =>
      render(
        <MemoryRouter initialEntries={[entry]}>
          <StoreProvider>
            <DaySheetGate>
              <p>Workspace</p>
            </DaySheetGate>
          </StoreProvider>
        </MemoryRouter>,
      )
    const first = page('/day-sheet')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Day sheet/)
    expect(screen.getByText(/Built in this browser from the fictional demo/)).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    first.unmount()
    page('/day-sheet?preview=offline')
    expect(screen.getByRole('alert')).toHaveTextContent(/Preview of the offline view/)
    expect(screen.getByRole('alert')).toHaveTextContent(/Changes are paused/)
  })
})

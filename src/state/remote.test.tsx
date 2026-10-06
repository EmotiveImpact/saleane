import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider } from './StoreProvider'
import { useStore } from './context'
import type { Store } from './context'
import { api, setCsrf } from './api'
import type { RemoteWorkspace, Session } from './api'
import { createWorkspace } from '../domain/workspace'
import { seed } from '../domain/seed'
import { execute } from '../domain/commands'
import type { CommandResult } from '../domain/commands'

const fetchMock = vi.fn<typeof fetch>()
const journalKey = 'saleane.pending-commands.v1'
function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function fixture(name = 'Test local studio'): RemoteWorkspace {
  const state = createWorkspace({ name, region: 'UK' })
  state.clients = [{ ...seed('UK').clients[0], organisationId: state.organisation.id }]
  return {
    id: state.organisation.id,
    slug: `studio-${state.organisation.id}`,
    state,
    role: 'owner',
    today: '2026-10-06',
    mode: 'local',
  }
}
function sessionFor(...workspaces: RemoteWorkspace[]): Session {
  return {
    user: { id: 'test-operator', name: 'Test Operator', email: 'operator@example.com' },
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
const note = { type: 'note' as const, clientId: 'client-1', text: 'A considered preference' }
function saved(remote: RemoteWorkspace, text = note.text) {
  const result = execute(remote.state, { ...note, text })
  if (!result.ok) throw new Error(result.error)
  return result
}
function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function mountStore() {
  let current!: Store
  function Consumer() {
    const store = useStore()
    const [text, setText] = useState(''),
      [result, setResult] = useState('')
    useEffect(() => {
      current = store
    }, [store])
    return (
      <>
        <output data-testid="workspace">{store.state.organisation.name}</output>
        <output data-testid="mode">{store.mode}</output>
        <output data-testid="revision">{store.state.revision}</output>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const next = await store.commit({ ...note, text })
            setResult(next.ok ? 'Saved' : next.error)
            if (next.ok) setText('')
          }}
        >
          <label>
            Preference
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button>Save preference</button>
        </form>
        <p role="status">{result}</p>
      </>
    )
  }
  const view = render(
    <StoreProvider>
      <Consumer />
    </StoreProvider>,
  )
  return {
    ...view,
    get store() {
      return current
    },
  }
}
async function open(view: ReturnType<typeof mountStore>, workspace: RemoteWorkspace) {
  await act(async () => {
    await view.store.refreshSession()
  })
  await act(async () => {
    await view.store.openWorkspace(workspace.id)
  })
}
function commandCalls() {
  return fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/commands'))
}
function key(call: (typeof fetchMock.mock.calls)[number]) {
  return new Headers(call[1]?.headers).get('Idempotency-Key')
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

describe('the local API workspace context', () => {
  it('registers, refreshes the session and opens the returned local workspace without importing browser fixtures', async () => {
    const remote = fixture()
    fetchMock.mockImplementation(async (path) => {
      if (String(path) === '/api/auth/register')
        return response({ orgId: remote.id, csrf: 'registration-csrf' }, 201)
      if (String(path) === '/api/session') return response(sessionFor(remote))
      return response(remote)
    })
    const view = mountStore()
    const registration = await api<{ orgId: string }>('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Operator',
        email: 'operator@example.com',
        password: 'fictional-testing-passphrase',
        workspace: {
          name: remote.state.organisation.name,
          region: 'UK',
          locationName: 'Local studio',
        },
      },
    })
    await open(view, remote)
    expect(registration.orgId).toBe(remote.id)
    expect(view.store.mode).toBe('server')
    expect(view.store.state.organisation.id).toBe(remote.id)
    expect(view.store.state.clients).toHaveLength(1)
    expect(view.store.state.sales).toEqual([])
    expect(view.store.session?.services).toEqual({ email: false, payments: false })
    expect(sessionStorage.getItem('saleane.workspace')).toBe(remote.id)
    expect(localStorage.length).toBe(0)
  })
  it('keeps the form draft and workspace intact when a remote write is rejected', async () => {
    const remote = fixture()
    fetchMock.mockImplementation(async (path) =>
      String(path).endsWith('/commands')
        ? response({ error: 'Your role cannot make this change.' }, 403)
        : response(String(path) === '/api/session' ? sessionFor(remote) : remote),
    )
    const view = mountStore()
    await open(view, remote)
    fireEvent.change(screen.getByLabelText('Preference'), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
    await screen.findByText('Your role cannot make this change.')
    expect(screen.getByLabelText('Preference')).toHaveValue('Keep this draft')
    expect(view.store.state.revision).toBe(0)
    expect(view.store.state.events).toEqual([])
    expect(JSON.parse(sessionStorage.getItem(journalKey)!)).toEqual([])
  })
  it('refreshes a stale revision while returning the conflict and preserving the initiating draft', async () => {
    const remote = fixture(),
      changed = saved(remote, 'Another desk recorded this')
    let reads = 0
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/commands'))
        return response({ error: 'This workspace changed. Reload before saving.' }, 409)
      if (String(path) === '/api/session') return response(sessionFor(remote))
      return response(++reads === 1 ? remote : { ...remote, state: changed.state })
    })
    const view = mountStore()
    await open(view, remote)
    fireEvent.change(screen.getByLabelText('Preference'), {
      target: { value: 'Review this draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
    await screen.findByText('This workspace changed. Reload before saving.')
    expect(view.store.state.revision).toBe(1)
    expect(view.store.state.events.at(-1)?.detail).toBe('Another desk recorded this')
    expect(screen.getByLabelText('Preference')).toHaveValue('Review this draft')
  })
  it('keeps an uncertain request key through an explicit reload and retries only the same operation', async () => {
    const remote = fixture(),
      result = saved(remote)
    let writes = 0
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/commands')) {
        if (++writes === 1) throw new TypeError('Connection lost after commit')
        return response(result)
      }
      return response(String(path) === '/api/session' ? sessionFor(remote) : remote)
    })
    const view = mountStore()
    await open(view, remote)
    let failed!: CommandResult
    await act(async () => {
      failed = await view.store.commit(note)
    })
    expect(failed.ok).toBe(false)
    await act(async () => {
      await view.store.reload()
    })
    await act(async () => {
      expect(
        (await view.store.commit({ text: note.text, clientId: note.clientId, type: note.type })).ok,
      ).toBe(true)
    })
    expect(commandCalls()).toHaveLength(2)
    expect(key(commandCalls()[0])).toBe(key(commandCalls()[1]))
    expect(view.store.state.events).toHaveLength(1)
  })
  it('recovers the same uncertain key after remount without storing client text or contact data', async () => {
    const remote = fixture(),
      result = saved(remote)
    let writes = 0
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/commands')) {
        if (++writes === 1) return response({ error: 'Uncertain storage response' }, 503)
        return response(result)
      }
      return response(String(path) === '/api/session' ? sessionFor(remote) : remote)
    })
    const first = mountStore()
    await open(first, remote)
    await act(async () => {
      expect((await first.store.commit(note)).ok).toBe(false)
    })
    const journal = sessionStorage.getItem(journalKey)!
    expect(journal).not.toContain(note.text)
    expect(journal).not.toContain(note.clientId)
    expect(journal).not.toContain('operator@example.com')
    expect(JSON.parse(journal)[0][0]).toMatch(/^[a-f0-9]{64}$/)
    first.unmount()
    const next = mountStore()
    await waitFor(() => expect(next.store.mode).toBe('server'))
    await act(async () => {
      expect((await next.store.commit(note)).ok).toBe(true)
    })
    expect(key(commandCalls()[0])).toBe(key(commandCalls()[1]))
    expect(next.store.state.events).toHaveLength(1)
  })
  it('rejects new remote writes before sending if safe retry storage is denied', async () => {
    const remote = fixture()
    fetchMock.mockImplementation(async (path) =>
      response(String(path) === '/api/session' ? sessionFor(remote) : remote),
    )
    const view = mountStore()
    await open(view, remote)
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await act(async () => {
      const result = await view.store.commit(note)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('retry')
    })
    expect(commandCalls()).toHaveLength(0)
    expect(view.store.state.revision).toBe(0)
    setter.mockRestore()
  })
  it('blocks a corrupt pending journal rather than silently assigning a duplicate request key', async () => {
    const remote = fixture()
    sessionStorage.setItem(journalKey, '{broken')
    fetchMock.mockImplementation(async (path) =>
      response(String(path) === '/api/session' ? sessionFor(remote) : remote),
    )
    const view = mountStore()
    await open(view, remote)
    await act(async () => {
      const result = await view.store.commit(note)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('recovery')
    })
    expect(commandCalls()).toHaveLength(0)
    expect(sessionStorage.getItem(journalKey)).toBe('{broken')
  })
  it('blocks synchronous writes while another workspace is opening and prevents a late write replacing the selected workspace', async () => {
    const first = fixture('First studio'),
      second = fixture('Second studio'),
      loadSecond = deferred(),
      write = deferred()
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/commands')) return write.promise
      if (String(path) === `/api/workspaces/${second.id}`) return loadSecond.promise
      return response(String(path) === '/api/session' ? sessionFor(first, second) : first)
    })
    const view = mountStore()
    await open(view, first)
    let save!: Promise<CommandResult>
    await act(async () => {
      save = view.store.commit(note)
    })
    await waitFor(() => expect(commandCalls()).toHaveLength(1))
    let switching!: Promise<void>
    await act(async () => {
      switching = view.store.openWorkspace(second.id)
      const blocked = await view.store.commit({ ...note, text: 'Wrong studio write' })
      expect(blocked.ok).toBe(false)
    })
    await act(async () => {
      loadSecond.resolve(response(second))
      await switching
    })
    await act(async () => {
      write.resolve(response(saved(first)))
      const result = await save
      expect(result.ok).toBe(false)
    })
    expect(view.store.state.organisation.id).toBe(second.id)
    expect(view.store.state.events).toEqual([])
    expect(commandCalls()).toHaveLength(1)
  })
  it('does not let remembered-session recovery replace an explicit return to the demo', async () => {
    const remote = fixture(),
      restore = deferred()
    sessionStorage.setItem('saleane.workspace', remote.id)
    fetchMock.mockImplementation(async (path) =>
      String(path) === '/api/session' ? response(sessionFor(remote)) : restore.promise,
    )
    const view = mountStore()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([path]) => String(path) === `/api/workspaces/${remote.id}`),
      ).toBe(true),
    )
    act(() => view.store.enterDemo())
    await act(async () => {
      restore.resolve(response(remote))
    })
    expect(view.store.mode).toBe('demo')
    expect(view.store.state.organisation.id).not.toBe(remote.id)
    expect(sessionStorage.getItem('saleane.workspace')).toBeNull()
  })
  it('blocks further writes after session expiry without replacing server records with sample data', async () => {
    const remote = fixture()
    fetchMock.mockImplementation(async (path) =>
      String(path).endsWith('/commands')
        ? response({ error: 'Sign in to continue.' }, 401)
        : response(String(path) === '/api/session' ? sessionFor(remote) : remote),
    )
    const view = mountStore()
    await open(view, remote)
    await act(async () => {
      expect((await view.store.commit(note)).ok).toBe(false)
    })
    expect(view.store.blocked).toBe(true)
    expect(view.store.state.organisation.id).toBe(remote.id)
    await act(async () => {
      expect((await view.store.commit(note)).ok).toBe(false)
    })
    expect(commandCalls()).toHaveLength(1)
  })
})

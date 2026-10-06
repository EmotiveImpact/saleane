import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Region } from '../domain/model'
import { parseState } from '../domain/model'
import { businessDate } from '../domain/operations'
import { StoreContext } from './context'
import { commitWorkspace, loadBrowserWorkspace, resetWorkspace } from './storage'
import { api, ApiError, setCsrf } from './api'
import type { PractitionerWorkspace, RemoteWorkspace, Session } from './api'
import { readPendingKeys, requestFingerprint, writePendingKeys } from './journal'

/** Practitioners receive a scoped record with no studio state; their day has its own screen. */
function studioRecord(next: RemoteWorkspace | PractitionerWorkspace): RemoteWorkspace {
  if (next.view !== 'studio' || !next.state)
    throw new Error(
      'This account opens a practitioner day. Choose the studio from your account page.',
    )
  next.state = parseState(next.state, next.state.organisation.region)
  return next
}
const remembered = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (key: string, value?: string) => {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    /* Keep the current session usable. */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<Region>(() =>
    remembered('saleane.region') === 'US' ? 'US' : 'UK',
  )
  const [workspace, setWorkspace] = useState(() => loadBrowserWorkspace(region))
  const [remote, setRemote] = useState<RemoteWorkspace | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(() => !!remembered('saleane.workspace'))
  const [saving, setSaving] = useState(false)
  const busy = useRef(false),
    generation = useRef(0),
    activeId = useRef<string | null>(null),
    transitioning = useRef(!!remembered('saleane.workspace'))
  const [pendingJournal] = useState(readPendingKeys)
  const pendingKeys = useRef(pendingJournal.keys)
  function keepKey(fingerprint: string, key?: string) {
    if (pendingJournal.error) throw new Error(pendingJournal.error)
    pendingKeys.current = writePendingKeys(pendingKeys.current, fingerprint, key)
  }
  const state = remote?.state ?? workspace.state
  useEffect(() => {
    document.documentElement.lang = state.organisation.locale
  }, [state.organisation.locale])
  async function refreshSession() {
    try {
      const next = await api<Session>('/api/session')
      setSession(next)
      return next
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null)
        setCsrf('')
        return null
      }
      throw error
    }
  }
  async function openWorkspace(id: string) {
    const ticket = ++generation.current
    transitioning.current = true
    setLoading(true)
    try {
      const next = studioRecord(
        await api<RemoteWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`),
      )
      if (ticket !== generation.current) return
      activeId.current = id
      setRemote(next)
      setWorkspace({ state: next.state, warning: '', blocked: false })
      remember('saleane.workspace', id)
    } finally {
      if (ticket === generation.current) {
        transitioning.current = false
        setLoading(false)
      }
    }
  }
  function enterDemo() {
    generation.current++
    activeId.current = null
    transitioning.current = false
    setRemote(null)
    setLoading(false)
    remember('saleane.workspace')
    setWorkspace(loadBrowserWorkspace(region))
  }
  useEffect(() => {
    const id = remembered('saleane.workspace')
    if (!id) return
    const ticket = generation.current
    let cancelled = false
    const load = async () => {
      try {
        const found = await api<Session>('/api/session')
        if (cancelled || ticket !== generation.current) return
        setSession(found)
        const next = studioRecord(
          await api<RemoteWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`),
        )
        if (cancelled || ticket !== generation.current) return
        activeId.current = id
        setRemote(next)
        setWorkspace({ state: next.state, warning: '', blocked: false })
      } catch (error) {
        if (!cancelled && ticket === generation.current)
          setWorkspace((prev) => ({
            ...prev,
            blocked: true,
            warning: error instanceof Error ? error.message : 'Your workspace could not be loaded.',
          }))
      } finally {
        if (!cancelled && ticket === generation.current) {
          transitioning.current = false
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <StoreContext.Provider
      value={{
        ...workspace,
        state,
        region: state.organisation.region,
        mode: remote ? 'server' : 'demo',
        today: businessDate(state),
        role: remote?.role ?? 'owner',
        slug: remote?.slug ?? '',
        session,
        loading,
        saving,
        refreshSession,
        openWorkspace,
        enterDemo,
        async reload() {
          if (activeId.current) await openWorkspace(activeId.current)
          else setWorkspace(loadBrowserWorkspace(region))
        },
        async logout() {
          await api('/api/auth/logout', { method: 'POST', body: {} })
          setSession(null)
          setCsrf('')
          enterDemo()
        },
        async commit(command) {
          if (transitioning.current)
            return { ok: false, error: 'The workspace is opening. Wait before saving.' }
          if (workspace.blocked) return { ok: false, error: workspace.warning }
          if (busy.current)
            return { ok: false, error: 'Please wait for the current change to finish.' }
          busy.current = true
          setSaving(true)
          const ticket = generation.current
          try {
            if (!remote) {
              const result = commitWorkspace(localStorage, region, state, command)
              if (result.ok) setWorkspace({ state: result.state, warning: '', blocked: false })
              return result
            }
            if (!session?.user.id)
              return { ok: false, error: 'Sign in before saving to this workspace.' }
            if (pendingJournal.error) return { ok: false, error: pendingJournal.error }
            const fingerprint = await requestFingerprint(remote.id, session.user.id, command)
            if (
              ticket !== generation.current ||
              activeId.current !== remote.id ||
              transitioning.current
            )
              return {
                ok: false,
                error: 'The workspace changed before saving. Try again in the current workspace.',
              }
            let key = pendingKeys.current.get(fingerprint)
            if (!key) {
              key = crypto.randomUUID()
              keepKey(fingerprint, key)
            }
            try {
              const result = await api<{ ok: true; state: typeof state; recordId: string }>(
                `/api/workspaces/${encodeURIComponent(remote.id)}/commands`,
                { method: 'POST', key, body: { revision: state.revision, command } },
              )
              const parsed = parseState(result.state, state.organisation.region)
              if (ticket !== generation.current || activeId.current !== remote.id)
                return {
                  ok: false,
                  error:
                    'The workspace changed while saving. Reopen the original workspace to see the saved result.',
                }
              // The server has committed: show that first. Clearing the retry key is best-effort,
              // and a key left behind only replays this same committed receipt.
              setRemote({ ...remote, state: parsed })
              setWorkspace({ state: parsed, warning: '', blocked: false })
              try {
                keepKey(fingerprint)
              } catch {
                // Storage refused the update; the next write reports that storage error itself.
              }
              return { ...result, state: parsed }
            } catch (error) {
              if (error instanceof ApiError && error.status > 0 && error.status < 500)
                keepKey(fingerprint)
              if (error instanceof ApiError && error.status === 409) {
                try {
                  const latest = studioRecord(
                    await api<RemoteWorkspace>(`/api/workspaces/${encodeURIComponent(remote.id)}`),
                  )
                  if (ticket === generation.current && activeId.current === remote.id) {
                    setRemote(latest)
                    setWorkspace({ state: latest.state, warning: '', blocked: false })
                  }
                } catch {
                  return {
                    ok: false,
                    error:
                      'This workspace changed, but the latest records could not be loaded. Reconnect and reload before saving.',
                  }
                }
              }
              if (
                error instanceof ApiError &&
                error.status === 401 &&
                ticket === generation.current
              )
                setWorkspace((prev) => ({
                  ...prev,
                  blocked: true,
                  warning:
                    'Your session ended. Sign in to continue; existing server records are preserved.',
                }))
              return {
                ok: false,
                error: error instanceof Error ? error.message : 'This change could not be saved.',
              }
            }
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'This change could not be saved.',
            }
          } finally {
            busy.current = false
            setSaving(false)
          }
        },
        changeRegion(next) {
          generation.current++
          activeId.current = null
          transitioning.current = false
          remember('saleane.region', next)
          remember('saleane.workspace')
          setRegion(next)
          setRemote(null)
          setLoading(false)
          setWorkspace(loadBrowserWorkspace(next))
        },
        reset() {
          if (remote) return
          try {
            const state = resetWorkspace(localStorage, region, workspace.state)
            setWorkspace({ state, warning: '', blocked: false })
          } catch {
            setWorkspace({
              ...workspace,
              blocked: true,
              warning: 'Browser storage is unavailable. Existing records were preserved.',
            })
          }
        },
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ZodError } from 'zod'
import type { ReactNode } from 'react'
import type { Region } from '../domain/model'
import { parseState } from '../domain/model'
import { businessDate } from '../domain/operations'
import { StoreContext } from './context'
import { commitWorkspace, loadBrowserWorkspace, resetWorkspace } from './storage'
import { api, ApiError, onUnreachable, setCsrf, unreachable } from './api'
import type { AreaWorkspace, PractitionerWorkspace, RemoteWorkspace, Session } from './api'
import { readPendingKeys, requestFingerprint, writePendingKeys } from './journal'
import { daySheetSchema } from '../domain/daySheet'
import { clearDaySheet, readDaySheet, storeDaySheet } from './daySheet'
import type { SavedDaySheet } from './daySheet'
import type { Store } from './context'
import { rememberStudio, scopedHome, signedInHere, startingStudio } from './lastStudio'

const OFFLINE_RETRY_MS = 15000
const PAUSED = 'Offline. Changes are paused until SALEANE reconnects and checks your access.'

/**
 * Practitioners and regional managers receive a scoped record with no studio state; each has its
 * own screen.
 */
function studioRecord(
  next: RemoteWorkspace | PractitionerWorkspace | AreaWorkspace,
): RemoteWorkspace {
  if (next.view !== 'studio' || !next.state)
    throw new Error(
      next.view === 'area'
        ? 'This account opens a regional view. Choose the studio from your account page.'
        : 'This account opens a practitioner day. Choose the studio from your account page.',
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
  const sessionRef = useRef<Session | null>(null)
  // A signed-in person stays in the fictional demo only when they chose it.
  const [demoChosen, setDemoChosen] = useState(false)
  // Someone signed in on this browser before, but the session could not be checked at start.
  const [unsure, setUnsure] = useState(false)
  function adopt(next: Session | null) {
    if (next?.user.id !== sessionRef.current?.user.id) setDemoChosen(false)
    sessionRef.current = next
    setSession(next)
    setUnsure(false)
    if (next) rememberStudio(next.user.id)
  }
  // OFF-01: the day sheet this tab holds, and whether the service can be reached.
  const [restored] = useState(() => {
    const id = remembered('saleane.workspace')
    const sheet = readDaySheet(id ? { workspaceId: id } : {})
    return { id: id ?? sheet?.workspaceId ?? null, sheet }
  })
  const [daySheet, setDaySheet] = useState<SavedDaySheet | null>(restored.sheet)
  const [sheetWorkspace, setSheetWorkspace] = useState<string | null>(restored.id)
  const [connection, setConnection] = useState<Store['connection']>('online')
  const scope = useRef(restored.id),
    sheetTicket = useRef(0),
    connectionRef = useRef<Store['connection']>('online'),
    reconnecting = useRef(false)
  function connect(next: Store['connection']) {
    connectionRef.current = next
    setConnection(next)
  }
  /** Removes the sheet from memory and this tab, and stops any in-flight sync from restoring it. */
  function forgetSheet(nextScope: string | null = null) {
    sheetTicket.current++
    scope.current = nextScope
    clearDaySheet()
    setDaySheet(null)
    setSheetWorkspace(nextScope)
  }
  async function syncDaySheet(workspaceId: string) {
    if (scope.current !== workspaceId) forgetSheet(workspaceId)
    const ticket = ++sheetTicket.current
    const sheet = daySheetSchema.parse(
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/day-sheet`),
    )
    if (ticket !== sheetTicket.current || scope.current !== workspaceId) return
    if (sheet.organisation.id !== workspaceId)
      throw new Error('This day sheet is for another studio.')
    const saved: SavedDaySheet = {
      accountId: sessionRef.current?.user.id ?? '',
      workspaceId,
      savedAt: new Date().toISOString(),
      source: 'server',
      sheet,
    }
    storeDaySheet(saved)
    setDaySheet(saved)
  }
  /** Refreshes after a load or save; a failure keeps the previous sheet until it expires. */
  const refreshSheet = (workspaceId: string) => void syncDaySheet(workspaceId).catch(() => {})
  // A new tab with no studio chosen asks who is signed in before showing anything, once someone
  // has signed in on this browser: they open their own studio, never the demo by accident.
  const [checking] = useState(() => !remembered('saleane.workspace') && signedInHere())
  const [loading, setLoading] = useState(() => !!remembered('saleane.workspace') || checking)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false),
    generation = useRef(0),
    activeId = useRef<string | null>(null),
    transitioning = useRef(!!remembered('saleane.workspace') || checking)
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
      adopt(next)
      return next
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        adopt(null)
        setCsrf('')
        return null
      }
      throw error
    }
  }
  /** `quiet` refreshes the open studio in place, so open dialogs keep their place. */
  async function openWorkspace(
    id: string,
    sheet: 'background' | 'await' = 'background',
    quiet = false,
  ) {
    const ticket = ++generation.current
    transitioning.current = true
    if (!quiet) setLoading(true)
    if (scope.current !== id) forgetSheet(id)
    try {
      const next = studioRecord(
        await api<RemoteWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`),
      )
      if (ticket !== generation.current) return
      activeId.current = id
      setRemote(next)
      setWorkspace({ state: next.state, warning: '', blocked: false })
      setDemoChosen(false)
      remember('saleane.workspace', id)
      if (sessionRef.current) rememberStudio(sessionRef.current.user.id, id)
      if (sheet === 'await') await syncDaySheet(id)
      else refreshSheet(id)
    } finally {
      if (ticket === generation.current) {
        transitioning.current = false
        if (!quiet) setLoading(false)
      }
    }
  }
  function enterDemo() {
    generation.current++
    forgetSheet()
    connect('online')
    activeId.current = null
    transitioning.current = false
    setRemote(null)
    setLoading(false)
    setDemoChosen(true)
    setUnsure(false)
    remember('saleane.workspace')
    setWorkspace(loadBrowserWorkspace(region))
  }
  /**
   * OFF-01: on reconnect, check the session and this account's access to the studio, then load the
   * studio and a fresh day sheet before writes resume. Access that changed clears the sheet.
   */
  async function reconnect() {
    const id = scope.current
    if (reconnecting.current || !id) return
    reconnecting.current = true
    connect('reconnecting')
    try {
      const found = await api<Session>('/api/session')
      adopt(found)
      if (!found.workspaces.some((w) => w.id === id))
        throw new ApiError('Your access to this studio has changed.', 404)
      if (activeId.current === id) await openWorkspace(id, 'await')
      else await syncDaySheet(id)
      connect('online')
    } catch (error) {
      if (unreachable(error)) {
        connect('offline')
        return
      }
      // Reached the service but could not confirm this sheet: never keep the old one.
      forgetSheet(id)
      connect('online')
      if (error instanceof ApiError && error.status === 401) {
        adopt(null)
        setCsrf('')
      }
      // A malformed sheet only clears the sheet; changed access also blocks the studio.
      if (activeId.current === id && !(error instanceof ZodError))
        setWorkspace((prev) => ({
          ...prev,
          blocked: true,
          warning:
            error instanceof ApiError && error.status === 401
              ? 'Your session ended while offline. Sign in to continue; server records are preserved.'
              : error instanceof Error
                ? `${error.message} Reopen the studio from your account.`
                : 'Your access could not be confirmed. Reopen the studio from your account.',
        }))
    } finally {
      reconnecting.current = false
    }
  }
  // Event listeners and timers call the latest functions without re-subscribing.
  const reconnectRef = useRef(reconnect),
    syncRef = useRef(syncDaySheet),
    forgetRef = useRef(forgetSheet),
    openRef = useRef(openWorkspace)
  useEffect(() => {
    reconnectRef.current = reconnect
    syncRef.current = syncDaySheet
    forgetRef.current = forgetSheet
    openRef.current = openWorkspace
  })
  useEffect(() => {
    // Any unreachable request, or the browser reporting no network, pauses writes for a signed-in studio.
    const offline = () => {
      if (scope.current && !reconnecting.current) connect('offline')
    }
    const online = () => {
      if (connectionRef.current !== 'online') void reconnectRef.current()
    }
    const stop = onUnreachable(offline)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      stop()
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [])
  useEffect(() => {
    if (connection !== 'offline') return
    const timer = window.setInterval(() => void reconnectRef.current(), OFFLINE_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [connection])
  useEffect(() => {
    if (!daySheet) return
    // The sheet leaves memory and this tab when it expires, online or not.
    const timer = window.setTimeout(
      () => {
        if (scope.current === daySheet.workspaceId) {
          sheetTicket.current++
          clearDaySheet()
          setDaySheet(null)
        }
      },
      Math.min(Math.max(Date.parse(daySheet.sheet.expiresAt) - Date.now(), 0), 2 ** 31 - 1),
    )
    return () => window.clearTimeout(timer)
  }, [daySheet])
  const restoredSheet = restored.sheet
  useEffect(() => {
    const id = remembered('saleane.workspace')
    if (!id) return
    const ticket = generation.current
    let cancelled = false
    const load = async () => {
      try {
        const found = await api<Session>('/api/session')
        if (cancelled || ticket !== generation.current) return
        adopt(found)
        // A sheet restored in this tab must belong to the account now signed in.
        if (restoredSheet && restoredSheet.accountId !== found.user.id) forgetRef.current(id)
        const next = studioRecord(
          await api<RemoteWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`),
        )
        if (cancelled || ticket !== generation.current) return
        activeId.current = id
        setRemote(next)
        setWorkspace({ state: next.state, warning: '', blocked: false })
        rememberStudio(found.user.id, id)
        void syncRef.current(id).catch(() => {})
      } catch (error) {
        // An unreachable service shows the saved day sheet instead (see the reachability effect);
        // any other refusal means this tab can no longer vouch for the sheet.
        if (!cancelled && ticket === generation.current && !unreachable(error))
          forgetRef.current(id)
        if (!cancelled && ticket === generation.current)
          setWorkspace((prev) => ({
            ...prev,
            blocked: true,
            warning: error instanceof Error ? error.message : 'Your studio could not be loaded.',
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
    // restoredSheet is fixed for the life of this provider.
  }, [restoredSheet])
  useEffect(() => {
    if (!checking) return
    const ticket = generation.current
    let cancelled = false
    const current = () => !cancelled && ticket === generation.current
    const start = async () => {
      // Opening a studio takes over the loading screen and its own late-response checks.
      let opening = false
      try {
        const found = await api<Session>('/api/session')
        if (!current()) return
        adopt(found)
        // A sheet restored in this tab must belong to the account now signed in.
        if (restoredSheet && restoredSheet.accountId !== found.user.id)
          forgetRef.current(scope.current)
        // Practitioners and regional managers are sent to their own page (see `landing`).
        const studio = startingStudio(found)
        if (studio && !scopedHome(studio)) {
          opening = true
          await openRef.current(studio.id)
        }
      } catch (error) {
        // A studio that could not be opened leaves the account page to choose from.
        if (opening || !current()) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
          adopt(null)
          setCsrf('')
        } else setUnsure(true)
      } finally {
        if (!opening && current()) {
          transitioning.current = false
          setLoading(false)
        }
      }
    }
    void start()
    return () => {
      cancelled = true
    }
  }, [checking, restoredSheet])
  /**
   * Where a signed-in person belongs while this tab has no studio open: their own day or area, or
   * the account page to choose a studio. Workspace pages send them there instead of the demo.
   */
  let landing: string | null = null
  if (!loading && !remote && !demoChosen) {
    const studio = session && startingStudio(session)
    if (studio) landing = scopedHome(studio) ?? '/account'
    else if (session || unsure) landing = '/account'
  }
  return (
    <StoreContext.Provider
      value={{
        ...workspace,
        state,
        region: state.organisation.region,
        mode: remote ? 'server' : 'demo',
        today: businessDate(state),
        role: remote?.role ?? 'owner',
        branch: remote?.locationId ?? null,
        slug: remote?.slug ?? '',
        session,
        landing,
        loading,
        saving,
        refreshSession,
        openWorkspace,
        enterDemo,
        connection,
        sheetWorkspace,
        daySheet,
        syncDaySheet,
        forgetDaySheet: () => forgetSheet(scope.current),
        reconnect,
        async reload() {
          if (connectionRef.current !== 'online') await reconnect()
          else if (activeId.current) await openWorkspace(activeId.current, 'background', true)
          else setWorkspace(loadBrowserWorkspace(region))
        },
        async logout() {
          // The day sheet leaves this tab even if the sign-out request cannot reach the service.
          forgetSheet()
          await api('/api/auth/logout', { method: 'POST', body: {} })
          adopt(null)
          setCsrf('')
          enterDemo()
        },
        async commit(command) {
          if (transitioning.current)
            return { ok: false, error: 'Your studio is still opening. Wait a moment, then save.' }
          if (workspace.blocked) return { ok: false, error: workspace.warning }
          if (remote && connectionRef.current !== 'online') return { ok: false, error: PAUSED }
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
              return { ok: false, error: 'Sign in before saving to this studio.' }
            if (pendingJournal.error) return { ok: false, error: pendingJournal.error }
            const fingerprint = await requestFingerprint(remote.id, session.user.id, command)
            if (
              ticket !== generation.current ||
              activeId.current !== remote.id ||
              transitioning.current
            )
              return {
                ok: false,
                error: 'You switched studio before this saved. Try again in the studio now open.',
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
                    'You switched studio while this was saving. Open the first studio again to see the result.',
                }
              // The server has committed: show that first. Clearing the retry key is best-effort,
              // and a key left behind only replays this same committed receipt.
              setRemote({ ...remote, state: parsed })
              setWorkspace({ state: parsed, warning: '', blocked: false })
              refreshSheet(remote.id)
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
                      'Someone else saved a change, but the latest records could not be loaded. Reconnect, reload, then try again.',
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
          forgetSheet()
          connect('online')
          setDemoChosen(true)
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

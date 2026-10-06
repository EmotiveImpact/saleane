import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Region } from '../domain/model'
import { StoreContext } from './context'
import { commitWorkspace, loadBrowserWorkspace, storageKey } from './storage'
import { seed } from '../domain/seed'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<Region>(() => {
    try {
      return sessionStorage.getItem('saleane.region') === 'US' ? 'US' : 'UK'
    } catch {
      return 'UK'
    }
  })
  const [workspace, setWorkspace] = useState(() => loadBrowserWorkspace(region))
  useEffect(() => {
    document.documentElement.lang = region === 'UK' ? 'en-GB' : 'en-US'
  }, [region])
  return (
    <StoreContext.Provider
      value={{
        ...workspace,
        region,
        commit(command) {
          if (workspace.blocked) return { ok: false, error: workspace.warning }
          const result = commitWorkspace(localStorage, region, workspace.state, command)
          if (result.ok) setWorkspace({ state: result.state, warning: '', blocked: false })
          return result
        },
        changeRegion(next) {
          try {
            sessionStorage.setItem('saleane.region', next)
          } catch {
            /* Region remains usable for this session. */
          }
          setRegion(next)
          setWorkspace(loadBrowserWorkspace(next))
        },
        reset() {
          try {
            localStorage.setItem(storageKey(region), JSON.stringify(seed(region)))
            setWorkspace({ state: seed(region), warning: '', blocked: false })
          } catch {
            setWorkspace({
              ...workspace,
              warning: 'The demo could not be reset because browser storage is unavailable.',
              blocked: true,
            })
          }
        },
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

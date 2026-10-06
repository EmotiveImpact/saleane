import { createContext, useContext } from 'react'
import type { BusinessState, Region } from '../domain/model'
import type { Command, CommandResult } from '../domain/commands'
import type { Session, WorkspaceAccess } from './api'

export type Store = {
  state: BusinessState
  region: Region
  warning: string
  blocked: boolean
  commit: (command: Command) => Promise<CommandResult>
  changeRegion: (region: Region) => void
  reset: () => void
  mode: 'demo' | 'server'
  today: string
  role: WorkspaceAccess['role']
  slug: string
  session: Session | null
  loading: boolean
  saving: boolean
  refreshSession: () => Promise<Session | null>
  openWorkspace: (id: string) => Promise<void>
  enterDemo: () => void
  logout: () => Promise<void>
  reload: () => Promise<void>
}
export const StoreContext = createContext<Store | null>(null)
export function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('Saleane workspace provider is missing.')
  return context
}

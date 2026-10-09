import { createContext, useContext } from 'react'
import type { BusinessState, Region } from '../domain/model'
import type { Command, CommandResult } from '../domain/commands'
import type { Session, WorkspaceAccess } from './api'
import type { SavedDaySheet } from './daySheet'

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
  /** V5: the location a general manager runs; screens open on it. Null for everyone else. */
  branch?: string | null
  slug: string
  session: Session | null
  /**
   * Where a signed-in person with no studio open in this tab belongs: their practitioner day, their
   * area, or the account page to choose a studio. Null when a studio is open, nobody is signed in or
   * they chose the fictional demo.
   */
  landing?: string | null
  loading: boolean
  saving: boolean
  refreshSession: () => Promise<Session | null>
  openWorkspace: (id: string) => Promise<void>
  enterDemo: () => void
  logout: () => Promise<void>
  reload: () => Promise<void>
  /** OFF-01: 'offline' and 'reconnecting' both pause every write until the session is revalidated. */
  connection: 'online' | 'offline' | 'reconnecting'
  /** The signed-in studio this tab holds a day sheet for (a desk workspace or a practitioner day). */
  sheetWorkspace: string | null
  /** This tab's last day sheet from the server; null in the demo, after logout, switch or expiry. */
  daySheet: SavedDaySheet | null
  syncDaySheet: (workspaceId: string) => Promise<void>
  /** Removes the sheet from memory and this tab at the reader's request (a shared device). */
  forgetDaySheet: () => void
  reconnect: () => Promise<void>
}
export const StoreContext = createContext<Store | null>(null)
export function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('The SALEANE store provider is missing.')
  return context
}

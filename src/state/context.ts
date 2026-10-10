import { createContext, useContext } from 'react'
import type { BusinessState, Region } from '../domain/model'
import type { Command, CommandResult } from '../domain/commands'
import type { Session, TwoStepHold, WorkspaceAccess } from './api'
import type { SavedDaySheet } from './daySheet'
import type { BillingSummary } from '../domain/billing'

export type Store = {
  state: BusinessState
  region: Region
  warning: string
  /** Changes are paused: recovery, a lost session, or (NEXT-02) a studio that has stopped paying. */
  blocked: boolean
  /** NEXT-02: the signed-in studio's plan as its record carries it; null in the demo and samples. */
  billing?: BillingSummary | null
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
  /**
   * Stage 6: a studio that asks everyone to use two-step sign-in has refused this person until they
   * set it up. The app shows "Protect your account" in place of every studio page meanwhile.
   */
  hold?: TwoStepHold | null
  /** Forgets the hold, once two-step sign-in is set up or they choose another studio. */
  releaseHold?: () => void
}
export const StoreContext = createContext<Store | null>(null)
export function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('The SALEANE store provider is missing.')
  return context
}

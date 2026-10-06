import { createContext, useContext } from 'react'
import type { BusinessState, Region } from '../domain/model'
import type { Command, CommandResult } from '../domain/commands'

export type Store = {
  state: BusinessState
  region: Region
  warning: string
  blocked: boolean
  commit: (command: Command) => CommandResult
  changeRegion: (region: Region) => void
  reset: () => void
}
export const StoreContext = createContext<Store | null>(null)
export function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('Saleane workspace provider is missing.')
  return context
}

import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../state/context'
import { DaySheetScreen } from '../pages/DaySheet'

/**
 * OFF-01: serves the printable day sheet at /day-sheet, and while a signed-in studio cannot reach
 * the service, shows the saved day sheet in place of the workspace. The workspace screens (and so
 * every write control in them) return only after the session and access have been checked again.
 * Guest booking pages are never replaced.
 */
export function DaySheetGate({ children }: { children: ReactNode }) {
  const { connection, sheetWorkspace } = useStore()
  const { pathname } = useLocation()
  if (pathname.startsWith('/book/')) return children
  if (pathname === '/day-sheet') return <DaySheetScreen />
  if (connection !== 'online' && sheetWorkspace) return <DaySheetScreen offline />
  return children
}

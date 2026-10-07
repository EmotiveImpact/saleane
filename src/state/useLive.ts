import { useEffect, useRef } from 'react'
import { useStore } from './context'

/** How often a screen the desk keeps open looks for changes made elsewhere. */
export const LIVE_REFRESH_MS = 30000

/**
 * V1.5: guests saying "I've arrived" and calls from the phone line change the studio record
 * without anyone at the desk saving. Today and the calendar look again every 30 seconds while
 * they are on screen, quietly, so open dialogs and half-filled forms keep their place.
 */
export function useLiveRefresh() {
  const { mode, reload, connection, saving } = useStore()
  const latest = useRef({ reload, saving })
  useEffect(() => {
    latest.current = { reload, saving }
  })
  useEffect(() => {
    if (mode !== 'server' || connection !== 'online') return
    const timer = window.setInterval(() => {
      // Never while a change is being saved, so the save is not interrupted.
      if (document.visibilityState === 'visible' && !latest.current.saving)
        void latest.current.reload().catch(() => {})
    }, LIVE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [mode, connection])
}

import { useEffect, useState } from 'react'

/**
 * The current time as an ISO string, refreshed every minute so screens that depend on it (offers
 * whose time has gone, openings that have started) change on an idle page too.
 */
export function useClock(everyMs = 60_000) {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date().toISOString()), everyMs)
    return () => window.clearInterval(tick)
  }, [everyMs])
  return now
}

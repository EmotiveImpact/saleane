import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStore } from '../state/context'

/** Pages that are not the studio workspace; each opens whatever the person is signed in as. */
const OUTSIDE = new Set([
  '/account',
  '/join',
  '/manage',
  '/pay/test',
  '/billing/test-card',
  '/pricing',
  '/day-sheet',
])
const OWN_PAGES = ['/practice/', '/area/', '/book/']

/**
 * A signed-in person with no studio open in this tab is never shown the fictional demo by
 * accident: a workspace page sends a practitioner to their day, a regional manager to their area,
 * and anyone else to the account page to choose a studio (see `landing` in StoreProvider).
 */
export function StudioLanding({ children }: { children: ReactNode }) {
  const { landing } = useStore()
  const { pathname } = useLocation()
  const workspacePage = !OUTSIDE.has(pathname) && !OWN_PAGES.some((p) => pathname.startsWith(p))
  if (landing && workspacePage && pathname !== landing) return <Navigate to={landing} replace />
  return children
}

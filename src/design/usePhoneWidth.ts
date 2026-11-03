import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 650px)'
const media = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null

function subscribe(change: () => void) {
  const query = media()
  query?.addEventListener?.('change', change)
  return () => query?.removeEventListener?.('change', change)
}

/**
 * Whether the screen is phone width: 650px or narrower, the same line the styles draw. For a page
 * whose parts change shape on a phone, not only their size, as Today's become tabs. Where the
 * browser cannot say (the test runner, unless a test asks for a phone), it is not a phone.
 */
export function usePhoneWidth() {
  return useSyncExternalStore(
    subscribe,
    () => !!media()?.matches,
    () => false,
  )
}

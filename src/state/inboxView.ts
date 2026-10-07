import { useEffect, useState } from 'react'

/**
 * How each person likes the Inbox laid out: two columns like email (the
 * default) or a full-width list that opens a side panel. Chosen in settings
 * and kept in this browser, one choice per person.
 */
export type InboxView = 'columns' | 'panel'

const key = (userId?: string) => `saleane-inbox-view:${userId ?? 'demo'}`
const event = 'saleane:inbox-view'
/** This visit's choices, so a choice still applies when the browser will not store it. */
const chosen = new Map<string, InboxView>()

export function readInboxView(userId?: string): InboxView {
  const remembered = chosen.get(key(userId))
  if (remembered) return remembered
  try {
    return localStorage.getItem(key(userId)) === 'panel' ? 'panel' : 'columns'
  } catch {
    return 'columns'
  }
}

export function saveInboxView(userId: string | undefined, view: InboxView) {
  chosen.set(key(userId), view)
  try {
    localStorage.setItem(key(userId), view)
  } catch {
    /* The choice still applies for this visit. */
  }
  window.dispatchEvent(new CustomEvent(event, { detail: { userId, view } }))
}

/** The person's chosen view, following later changes made in settings. */
export function useInboxView(userId?: string) {
  const [view, setView] = useState(() => readInboxView(userId))
  useEffect(() => {
    const follow = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string; view: InboxView }>).detail
      if (detail.userId === userId) setView(detail.view)
    }
    window.addEventListener(event, follow)
    return () => window.removeEventListener(event, follow)
  }, [userId])
  return view
}

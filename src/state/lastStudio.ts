import type { Session, WorkspaceAccess } from './api'

/**
 * The studio each account last worked in on this browser, so a new tab opens it rather than the
 * fictional demo. Only account and studio ids are kept, newest first, for a few accounts at most
 * (a shared desk computer). Storage that is blocked or unreadable is treated as empty.
 */
const KEY = 'saleane.last-studio.v1'
const ACCOUNTS = 12
type Entry = [accountId: string, studioId: string]

function read(): Entry[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is Entry =>
        Array.isArray(row) &&
        row.length === 2 &&
        typeof row[0] === 'string' &&
        typeof row[1] === 'string',
    )
  } catch {
    return null
  }
}

/** Someone has signed in on this browser before, so a new tab checks the session first. */
export function signedInHere() {
  return read() !== null
}

/**
 * Notes the account, and the studio it opened when one is given. An account seen without a studio
 * keeps the studio it had.
 */
export function rememberStudio(accountId: string, studioId?: string) {
  try {
    const rows = read() ?? []
    const kept = rows.find(([account]) => account === accountId)?.[1] ?? ''
    const latest: Entry = [accountId, studioId ?? kept]
    const next = [latest, ...rows.filter(([account]) => account !== accountId)].slice(0, ACCOUNTS)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // A new tab then shows the account page or the demo, as before.
  }
}

/**
 * Where a signed-in person starts when this tab has no studio chosen: the studio they last used
 * here, or their only studio. Null when they have several and none is remembered, or none at all.
 */
export function startingStudio(session: Session): WorkspaceAccess | null {
  const last = read()?.find(([account]) => account === session.user.id)?.[1]
  return (
    session.workspaces.find((w) => w.id === last) ??
    (session.workspaces.length === 1 ? session.workspaces[0] : null)
  )
}

/** The page a scoped role works from; a desk or management role opens the whole studio. */
export function scopedHome(studio: WorkspaceAccess) {
  if (studio.role === 'practitioner') return `/practice/${encodeURIComponent(studio.id)}`
  if (studio.role === 'regional') return `/area/${encodeURIComponent(studio.id)}`
  return null
}

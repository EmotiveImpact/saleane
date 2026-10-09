import type { BusinessState } from '../domain/model'
import type { PractitionerView } from '../domain/practitioner'
import type { AreaView } from '../domain/area'
import type { Role } from '../domain/operations'
import type { BillingSummary } from '../domain/billing'
export type WorkspaceAccess = {
  id: string
  slug: string
  name: string
  region: 'UK' | 'US'
  mode: 'sandbox' | 'local'
  role: Role
  staffId?: string
  /** NEXT-02: locked until its SALEANE bill is paid; only the owner can open it. */
  locked?: boolean
}
export type Session = {
  user: {
    id: string
    name: string
    email: string
    emailConfirmed?: boolean
    /** NEXT-04: when two-step sign-in was turned on and how many recovery codes are left. */
    twoStep?: { since: number; recoveryLeft: number } | null
  }
  csrf: string
  workspaces: WorkspaceAccess[]
  services: { email: boolean; payments: boolean }
  localOnly: boolean
}
type WorkspaceRecord = {
  id: string
  slug: string
  role: WorkspaceAccess['role']
  staffId?: string | null
  /** V5: the location a general manager runs. */
  locationId?: string | null
  today: string
  mode: WorkspaceAccess['mode']
  /** NEXT-02: whether the studio is read only, and its plan's dates for the owner. Null for samples. */
  billing?: BillingSummary | null
}
/** What desk and management roles receive: the whole studio record. */
export type RemoteWorkspace = WorkspaceRecord & { view: 'studio'; state: BusinessState }
/** What an assigned practitioner receives: their own visits only (LOCAL-01). */
export type PractitionerWorkspace = WorkspaceRecord & {
  view: 'practitioner'
  practitioner: PractitionerView
}
/** V5: what a regional manager receives: their region's figures and branch visits only. */
export type AreaWorkspace = WorkspaceRecord & { view: 'area'; area: AreaView }
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
let csrf = ''
export function setCsrf(value: string) {
  csrf = value
}
/** OFF-01: a network failure or gateway error means the local service could not be reached. */
export const unreachable = (error: unknown) =>
  error instanceof ApiError && [0, 502, 504].includes(error.status)
const unreachableListeners = new Set<() => void>()
/** Tells the workspace when a request could not reach the service, so writes can pause. */
export function onUnreachable(listener: () => void) {
  unreachableListeners.add(listener)
  return () => {
    unreachableListeners.delete(listener)
  }
}
function report(error: ApiError) {
  if (unreachable(error)) for (const listener of unreachableListeners) listener()
  return error
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw report(
      new ApiError(
        'The local server could not confirm this request. Reconnect and retry; an uncertain save keeps its request key.',
        0,
      ),
    )
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: string
    csrf?: string
  } | null
  if (!response.ok)
    throw report(
      new ApiError(
        payload?.error ?? `The request could not be completed (${response.status}).`,
        response.status,
      ),
    )
  if (payload?.csrf) setCsrf(payload.csrf)
  return payload as T
}

/** Stage 2: where a studio's product photo is served, to its own team only. */
export function imageUrl(workspaceId: string, imageId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/images/${encodeURIComponent(imageId)}`
}

/**
 * Stage 2: sends a product photo the browser has already shrunk, as its own bytes. The server
 * checks what it really is and returns the id the product keeps.
 */
export async function uploadImage(workspaceId: string, photo: Blob) {
  let response: Response
  try {
    response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/images`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': photo.type, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: photo,
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw report(
      new ApiError('The photo could not reach SALEANE. Check the connection and try again.', 0),
    )
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: string
    id?: string
  } | null
  if (!response.ok || !payload?.id)
    throw report(
      new ApiError(
        payload?.error ?? `The photo could not be added (${response.status}).`,
        response.status,
      ),
    )
  return { id: payload.id }
}

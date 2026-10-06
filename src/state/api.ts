import type { BusinessState } from '../domain/model'
export type WorkspaceAccess = {
  id: string
  slug: string
  name: string
  region: 'UK' | 'US'
  mode: 'sandbox' | 'local'
  role: 'owner' | 'manager' | 'reception' | 'practitioner'
  staffId?: string
}
export type Session = {
  user: { id: string; name: string; email: string }
  csrf: string
  workspaces: WorkspaceAccess[]
  services: { email: boolean; payments: boolean }
  localOnly: boolean
}
export type RemoteWorkspace = {
  id: string
  slug: string
  state: BusinessState
  role: WorkspaceAccess['role']
  staffId?: string
  today: string
  mode: WorkspaceAccess['mode']
}
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
    throw new ApiError(
      'The local server could not confirm this request. Reconnect and retry; an uncertain save keeps its request key.',
      0,
    )
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: string
    csrf?: string
  } | null
  if (!response.ok)
    throw new ApiError(
      payload?.error ?? `The request could not be completed (${response.status}).`,
      response.status,
    )
  if (payload?.csrf) setCsrf(payload.csrf)
  return payload as T
}

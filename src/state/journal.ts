/**
 * The retry journal: one idempotency key per unresolved change, kept in this tab's session
 * storage so a save whose outcome was uncertain retries under the same key and replays the
 * server receipt instead of applying twice.
 */
export const PENDING_KEY = 'saleane.pending-commands.v1'
export const PENDING_PRACTITIONER_KEY = 'saleane.pending-practitioner.v1'

export function readPendingKeys(storageKey = PENDING_KEY): {
  keys: Map<string, string>
  error: string
} {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return { keys: new Map(), error: '' }
    if (raw.length > 32000) throw new Error('oversized journal')
    const rows: unknown = JSON.parse(raw)
    if (
      !Array.isArray(rows) ||
      rows.length > 200 ||
      rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 2 ||
          typeof row[0] !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row[0]) ||
          typeof row[1] !== 'string' ||
          !/^[a-f0-9-]{36}$/i.test(row[1]),
      )
    )
      throw new Error('invalid journal')
    return { keys: new Map(rows as [string, string][]), error: '' }
  } catch {
    return {
      keys: new Map(),
      error:
        'Pending save recovery is unavailable. Restore access to this tab’s session storage and reload before saving. Existing server records are preserved.',
    }
  }
}

/** Writes the journal, or throws a message the screen can show. Returns the stored map. */
export function writePendingKeys(
  current: Map<string, string>,
  fingerprint: string,
  key: string | undefined,
  storageKey = PENDING_KEY,
) {
  const next = new Map(current)
  if (key) next.set(fingerprint, key)
  else next.delete(fingerprint)
  if (next.size > 200)
    throw new Error('Too many unresolved saves. Review pending changes before recording more.')
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...next]))
  } catch {
    throw new Error(
      'This tab cannot preserve safe retry information. Restore session storage and reload before saving again; existing server records are preserved.',
    )
  }
  return next
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export async function requestFingerprint(workspaceId: string, actorId: string, command: unknown) {
  const bytes = new TextEncoder().encode(
    canonical([workspaceId, actorId, JSON.parse(JSON.stringify(command))]),
  )
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

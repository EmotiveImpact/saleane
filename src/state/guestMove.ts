import { z } from 'zod'

/**
 * A move the guest confirmed whose answer has not arrived, kept in this tab. A retry sends the same
 * request again, and the server answers with the move it already made, so a lost answer never
 * moves the visit twice. Until it is settled, the page offers no other change.
 */
const pendingMoveSchema = z
  .object({
    requestKey: z.string().min(16).max(100),
    date: z.iso.date(),
    startMinutes: z.number().int().min(0).max(1439),
    staffId: z.string().min(1).max(150),
    professional: z.string().max(100),
  })
  .strict()
export type PendingMove = z.infer<typeof pendingMoveSchema>

/** One entry per visit, under its one-way calendar identifier, never the private link. */
const key = (visit: string) => `saleane.guest-move:${visit}`

export function readPendingMove(visit: string): PendingMove | null {
  try {
    const raw = sessionStorage.getItem(key(visit))
    return raw ? pendingMoveSchema.parse(JSON.parse(raw)) : null
  } catch {
    return null
  }
}
export function savePendingMove(visit: string, move: PendingMove) {
  try {
    sessionStorage.setItem(key(visit), JSON.stringify(move))
  } catch {
    /* Private windows may refuse storage; the request key still protects this attempt. */
  }
}
export function clearPendingMove(visit: string) {
  try {
    sessionStorage.removeItem(key(visit))
  } catch {
    /* Nothing was kept. */
  }
}

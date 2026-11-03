import { digest, token } from './auth'
import { fail } from './http'
import type { Context, Org } from './context'
import { offerStanding, OFFER_USED } from '../src/domain/quietInvites'

/**
 * Stage 5: the private link in an invitation that carries a quiet-time price. The token goes in
 * the link's fragment, so it never reaches a server log or a Referer header, and only its hash is
 * kept here, never in the studio record. A link is for one invitation, and the invitation's lower
 * price is booked once at most: the record refuses a second visit with it, and the table below
 * keeps one used link for each invitation. A link stops working when its offer ends, when it is
 * used, or when a backup is restored.
 */

/** What a guest reads for any link that is not, or is no longer, one of the studio's. */
export const OFFER_UNKNOWN =
  'This quiet-time price could not be found. It may have ended or been replaced. You can still book at the usual price.'
const TOKEN = /^[A-Za-z0-9_-]{32,100}$/

type OfferLinkRow = {
  token_hash: string
  message_id: string
  expires_at: number
  used_at: number | null
}

/** A fresh link for one invitation's copy as it goes out. Only its hash is kept. */
export function issueOfferLink(
  ctx: Context,
  organisationId: string,
  messageId: string,
  outboxId: string,
  endsAt: number,
) {
  const raw = token()
  const time = ctx.now()
  ctx.db.run(
    'INSERT INTO offer_links(token_hash,organisation_id,message_id,outbox_id,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    digest(raw),
    organisationId,
    messageId,
    outboxId,
    time,
    Math.max(endsAt, time + 1),
  )
  return raw
}

export type OpenOffer = Extract<ReturnType<typeof offerStanding>, { ok: true }> & {
  tokenHash: string
}

/**
 * Reads a guest's link: the invitation it belongs to and whether its lower price still stands, in
 * words for the booking page. Never throws; a guest with a link that does not work books at the
 * usual price.
 */
export function readOffer(
  ctx: Context,
  org: Org,
  raw: unknown,
): OpenOffer | { ok: false; problem: string } {
  if (typeof raw !== 'string' || !TOKEN.test(raw)) return { ok: false, problem: OFFER_UNKNOWN }
  const tokenHash = digest(raw)
  const link = ctx.db.get<OfferLinkRow>(
    'SELECT token_hash,message_id,expires_at,used_at FROM offer_links WHERE token_hash=? AND organisation_id=? AND revoked_at IS NULL',
    tokenHash,
    org.id,
  )
  if (!link) return { ok: false, problem: OFFER_UNKNOWN }
  if (link.used_at !== null || offerSpent(ctx, org.id, link.message_id))
    return { ok: false, problem: OFFER_USED }
  const standing = offerStanding(org.state, link.message_id, new Date(ctx.now()).toISOString())
  if (!standing.ok) return standing
  // The link runs out with its offer, even if the clock on the record says otherwise.
  if (link.expires_at <= ctx.now()) return { ok: false, problem: OFFER_UNKNOWN }
  return { ...standing, tokenHash }
}

/** Whether any link to this invitation has already been used to book. */
function offerSpent(ctx: Context, organisationId: string, messageId: string) {
  return !!ctx.db.get(
    'SELECT 1 FROM offer_links WHERE organisation_id=? AND message_id=? AND used_at IS NOT NULL',
    organisationId,
    messageId,
  )
}

/**
 * Marks a link used by the visit it booked, inside the booking's own transaction. A link already
 * used, revoked or for another studio fails the booking, so a lower price is never taken twice.
 */
export function spendOffer(
  ctx: Context,
  organisationId: string,
  tokenHash: string,
  appointmentId: string,
) {
  let changed = 0
  try {
    changed = Number(
      ctx.db.run(
        'UPDATE offer_links SET used_at=?,appointment_id=? WHERE token_hash=? AND organisation_id=? AND used_at IS NULL AND revoked_at IS NULL',
        ctx.now(),
        appointmentId,
        tokenHash,
        organisationId,
      ).changes,
    )
  } catch {
    // Another link to the same invitation was used first (one used link for each invitation).
  }
  if (changed !== 1) fail(409, `${OFFER_USED} You can still book this time at the usual price.`)
}

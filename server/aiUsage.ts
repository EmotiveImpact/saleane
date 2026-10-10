import { reclaim, reserve, settle } from '../lumane'
import type { Allowance, Usage, UseRequest } from '../lumane'
import type { Context } from './context'

/**
 * The studio's stored assistant usage, or undefined before its first use. A hold whose time has
 * passed is given back here, as SALEANE stopped before settling it; the next write keeps that.
 */
export function storedUsage(ctx: Context, organisationId: string) {
  const raw = ctx.db.get<{ usage: string }>(
    'SELECT usage FROM assistant_usage WHERE organisation_id=?',
    organisationId,
  )
  return raw
    ? reclaim(JSON.parse(raw.usage) as Usage, new Date(ctx.now()).toISOString())
    : undefined
}

function store(ctx: Context, organisationId: string, usage: Usage) {
  ctx.db.run(
    'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?) ON CONFLICT(organisation_id) DO UPDATE SET usage=excluded.usage,updated_at=excluded.updated_at',
    organisationId,
    JSON.stringify(usage),
    ctx.now(),
  )
}

/**
 * NEXT-12: holds one request's share of the studio's AI allowance before the AI is asked, so
 * requests at the same moment, from the team or from guests, cannot all pass the checks against
 * the same usage. Returns whether it was held, and the usage as it was before, which the turn
 * checks again for itself and so refuses exactly when this did.
 */
export function reserveUse(
  ctx: Context,
  organisationId: string,
  allowance: Allowance,
  request: UseRequest,
) {
  return ctx.db.transaction(() => {
    const before = storedUsage(ctx, organisationId)
    const held = reserve(allowance, before, request)
    if (held.ok) store(ctx, organisationId, held.usage)
    return { held: held.ok, before }
  })
}

/**
 * Holds a request whose size depends on what is left, such as a talk, which runs for the time the
 * month still has, up to its longest. `make` sees the usage inside the same write and returns the
 * request, or a sentence for the person when there is too little left. `until` says how long the
 * hold lasts if it is never settled, for a request that runs longer than a question.
 */
export function reserveFor(
  ctx: Context,
  organisationId: string,
  allowance: Allowance,
  make: (before: Usage | undefined) => UseRequest | string,
  until?: (request: UseRequest) => string,
): { held: true; request: UseRequest } | { held: false; text: string } {
  return ctx.db.transaction(() => {
    const before = storedUsage(ctx, organisationId)
    const request = make(before)
    if (typeof request === 'string') return { held: false as const, text: request }
    const held = reserve(allowance, before, request, until?.(request))
    if (!held.ok) return { held: false as const, text: held.message }
    store(ctx, organisationId, held.usage)
    return { held: true as const, request }
  })
}

/**
 * Settles a held request: what it really cost replaces its worst case, and a request that does
 * not count (the AI could not answer, or its answer was not sent) gives its share back. Re-read
 * inside the write, so other requests settled meanwhile are kept. Call inside a transaction.
 */
export function settleUse(
  ctx: Context,
  organisationId: string,
  request: UseRequest,
  outcome: { counted: boolean; costMinor: number; amount?: number },
) {
  const next = settle(storedUsage(ctx, organisationId), request, outcome)
  store(ctx, organisationId, next)
  return next
}

/**
 * Asks the AI with the request's share held. Should the asking fail outright, the share is given
 * back but its worst case stays spent, since what it cost by then is unknown.
 */
export async function holding<T>(
  ctx: Context,
  organisationId: string,
  allowance: Allowance,
  request: UseRequest,
  ask: (before: Usage | undefined) => Promise<T>,
) {
  const { held, before } = reserveUse(ctx, organisationId, allowance, request)
  try {
    return { held, result: await ask(before) }
  } catch (error) {
    if (held)
      ctx.db.transaction(() =>
        settleUse(ctx, organisationId, request, {
          counted: false,
          costMinor: request.worstCaseMinor,
        }),
      )
    throw error
  }
}

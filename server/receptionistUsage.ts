import { current } from '../lumane'
import type { Usage } from '../lumane'
import type { Context } from './context'

/** The studio's stored assistant usage, or undefined before its first use. */
export function storedUsage(ctx: Context, organisationId: string) {
  const raw = ctx.db.get<{ usage: string }>(
    'SELECT usage FROM assistant_usage WHERE organisation_id=?',
    organisationId,
  )
  return raw ? (JSON.parse(raw.usage) as Usage) : undefined
}

/**
 * V4: records one receptionist answer against the studio's allowance. A chat counts once, at its
 * first message, and is re-read inside the write so two guests at once both count. Call inside a
 * transaction.
 */
export function countReception(
  ctx: Context,
  organisationId: string,
  input: { at: string; visitor: string; continuing: boolean; costMinor: number; usage: Usage },
) {
  const before = current(storedUsage(ctx, organisationId), input.at)
  const day = input.at.slice(0, 10)
  const merged: Usage = {
    period: before.period,
    used: { ...before.used, guestChats: before.used.guestChats + (input.continuing ? 0 : 1) },
    spendByDay: {
      ...before.spendByDay,
      [day]: (before.spendByDay[day] ?? 0) + Math.max(0, input.costMinor),
    },
    recent: { ...before.recent, [input.visitor]: input.usage.recent[input.visitor] ?? [] },
  }
  ctx.db.run(
    'INSERT INTO assistant_usage(organisation_id,usage,updated_at) VALUES(?,?,?) ON CONFLICT(organisation_id) DO UPDATE SET usage=excluded.usage,updated_at=excluded.updated_at',
    organisationId,
    JSON.stringify(merged),
    ctx.now(),
  )
}

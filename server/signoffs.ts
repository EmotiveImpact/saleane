import { dispatch } from '../src/domain/commands'
import { duePrices } from '../src/domain/signoffs'
import type { Context, Org } from './context'

/**
 * Stage 4: approved new prices start on their day by themselves. Once a minute the server looks
 * for studios with an approved price whose day has come on the studio's own clock, and starts
 * each one through the ordinary `request-start` command, so it is checked like any change and
 * kept in who changed what as made by SALEANE. A price that cannot start is marked with why.
 */
export function createSignOffs(ctx: Context) {
  const { db, now } = ctx
  let timer: ReturnType<typeof setInterval> | undefined

  /** Starts every approved price that is due. Returns how many it started or marked. */
  function run() {
    const at = new Date(now()).toISOString()
    // Only studios holding an approved price that has neither started nor been stopped.
    const ids = db
      .all<{ id: string }>(
        `SELECT o.id FROM organisations o WHERE EXISTS (
           SELECT 1 FROM json_each(o.state,'$.operations.requests') r
           WHERE json_extract(r.value,'$.kind')='price'
             AND json_extract(r.value,'$.decision.outcome')='approved'
             AND json_extract(r.value,'$.carriedOut') IS NULL
             AND json_extract(r.value,'$.notStarted') IS NULL)`,
      )
      .map((row) => row.id)
    let started = 0
    for (const id of ids)
      try {
        db.transaction(() => {
          let org: Org | null = ctx.systemOrg(id)
          if (!org) return
          for (const request of duePrices(org.state, at)) {
            const result = dispatch(
              org.state,
              { type: 'request-start', requestId: request.id },
              'SALEANE',
              at,
            )
            if (!result.ok || result.state.revision === org.state.revision) continue
            ctx.persist(org, result.state, null, 'request-start', result.recordId)
            org = { ...org, state: result.state }
            started += 1
          }
        })
      } catch {
        // This studio is tried again next minute; the others still start theirs now.
      }
    return started
  }

  return {
    run,
    start(intervalMs: number) {
      const tick = () => {
        try {
          run()
        } catch {
          // Tried again next time; a studio saved meanwhile is read afresh then.
        }
      }
      tick()
      timer ??= setInterval(tick, intervalMs)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
export type SignOffs = ReturnType<typeof createSignOffs>

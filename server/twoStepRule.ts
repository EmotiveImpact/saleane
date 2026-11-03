import { fail } from './http'
import type { Context } from './context'
import { twoStepForEveryone } from '../src/domain/twoStepRule'

/** Said to an owner who asks everyone for two-step sign-in before using it themselves. */
export const OWNER_FIRST =
  'Turn on two-step sign-in for yourself first, then ask everyone to use it.'

/**
 * Stage 6: the studio asks everyone to use two-step sign-in only when the person switching it on
 * uses it themselves. Checked as the change is saved, inside its transaction, so it holds for
 * every way a change arrives (the owner's own command, an approved Ask SALEANE suggestion), and
 * an access key, which is not a person, can never switch it on. Switching it off needs nothing.
 */
export function watchTwoStepRule(ctx: Context) {
  ctx.onPersist((_org, before, after, change) => {
    if (twoStepForEveryone(before) || !twoStepForEveryone(after)) return
    if (!change.actorId || !ctx.twoStepOn(change.actorId)) fail(409, OWNER_FIRST)
  })
}

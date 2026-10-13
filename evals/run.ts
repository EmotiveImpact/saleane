import type { Brain, TurnResult } from '../lumane'
import { askSaleane } from '../src/assistant/ask'
import { askReceptionist } from '../src/assistant/receptionistAsk'
import type { BusinessState } from '../src/domain/model'
import { seed } from '../src/domain/seed'
import type { GuestAsk, TeamAsk } from './saleane.cases'

/** Every case is asked on the sample studio's own day, so its answers can be compared run to run. */
export const EVAL_TODAY = '2026-10-06'
export const EVAL_AT = `${EVAL_TODAY}T09:00:00.000Z`

/** The fictional sample studio, with the receptionist answering and passing messages on. */
export function evalStudio(): BusinessState {
  const s = seed('UK')
  return {
    ...s,
    operations: { ...s.operations!, receptionist: { enabled: true, handOver: true } },
  }
}

/** A case's question with `{client}` as the sample studio's first client. */
const fill = (text: string, state: BusinessState) =>
  text.replaceAll('{client}', state.clients[0].name)

/** One case to Ask, from the role it names; without a brain, the test-mode brain answers. */
export function askTeam(ask: TeamAsk, brain?: Brain): Promise<TurnResult> {
  const studio = evalStudio()
  const state = ask.note
    ? {
        ...studio,
        clients: studio.clients.map((c, i) => (i === 0 ? { ...c, preferences: ask.note! } : c)),
      }
    : studio
  return askSaleane({
    state,
    role: ask.role ?? 'owner',
    personId: 'eval',
    text: fill(ask.text, state),
    ...(ask.history ? { history: ask.history } : {}),
    usage: undefined,
    at: EVAL_AT,
    ...(brain ? { brain } : {}),
  })
}

/** One case to the receptionist; without a brain, the test-mode brain answers. */
export function askGuest(ask: GuestAsk, brain?: Brain): Promise<TurnResult> {
  const state = evalStudio()
  return askReceptionist({
    state,
    today: EVAL_TODAY,
    now: EVAL_AT,
    visitorId: 'eval',
    text: fill(ask.text, state),
    ...(ask.history ? { history: ask.history, continuing: true } : {}),
    ...(ask.channel ? { channel: ask.channel } : {}),
    usage: undefined,
    ...(brain ? { brain } : {}),
  })
}

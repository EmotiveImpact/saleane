import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import type { Outbox } from '../messaging/outbox'
import { recordReply } from '../messaging/calls'
import { answerText } from '../messaging/receptionistText'
import { operations } from '../../src/domain/operations'
import { repliesList } from '../../src/domain/inbox'
import { textNumber } from '../../src/domain/reminders'

const input = z
  .object({
    from: z.string().trim().min(1).max(40),
    body: z.string().max(1600),
    /** The same ref again is the same text again, as a provider retrying it. */
    ref: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,80}$/)
      .optional(),
  })
  .strict()

/**
 * Stage 1: a text to the studio's line that the owner or a manager delivers in test mode, so
 * STOP, START, HELP and ordinary replies can be seen working on this computer with no text
 * provider. It takes exactly the path a provider's text takes (kept once per id, the STOP and
 * START rule, the AI receptionist), and the record says it was a test made by that person.
 * Nothing is sent or received by a phone network. Refused once texts are live in a studio of its
 * own: then only the real line delivers texts, and a made-up STOP or START could change what a
 * real client asked for.
 */
export function testTextRoutes(outbox: Outbox) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'test-text' || path.length !== 4) return false
    if (method !== 'POST') fail(405, 'Use POST.')
    const actor = ctx.actorFor(request, true)
    const org = ctx.orgFor(path[2], actor)
    if (org.role !== 'owner' && org.role !== 'manager')
      fail(403, 'Only the owner or a manager can deliver a test text.')
    if (outbox.providers.sms.live && operations(org.state).mode === 'local')
      fail(409, 'Texts are live, so test texts are off. Text the studio’s number from a phone.')
    const parsed = input.parse(body)
    const from = textNumber(parsed.from)
    if (!from) fail(400, 'Use a mobile number with its country code, such as +44 7700 900456.')
    if (!parsed.body.trim()) fail(400, 'Write what they texted.')
    const text = {
      from: from!,
      body: parsed.body,
      providerRef: `test-${parsed.ref ?? randomUUID()}`,
    }
    const kept = recordReply(ctx, org.slug, 'sms', text, { actorId: actor.id })
    const answered = await answerText(ctx, org.slug, text)
    const saved = repliesList(ctx.systemOrg(org.id)!.state).find(
      (r) => r.channel === 'sms' && r.providerRef === text.providerRef,
    )
    reply(200, {
      kept,
      answered,
      ref: text.providerRef.slice('test-'.length),
      replyId: saved?.id ?? null,
      clientId: saved?.clientId ?? null,
      keyword: saved?.keyword ?? null,
    })
    return true
  }
}

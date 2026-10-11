import { z } from 'zod'
import { BrainError } from '../../lumane'
import type { UseRequest } from '../../lumane'
import { reserveFor, settleUse } from '../aiUsage'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { TranscribeError, TRANSCRIBE_WORST_MINOR } from '../transcribe'
import { businessDate, can, permissionFor } from '../../src/domain/operations'
import { practitionerRefusal } from '../../src/domain/practitioner'
import { branchRefusal } from '../../src/domain/branch'
import { aftercareEmailAhead } from '../../src/domain/reminders'
import type { Command } from '../../src/domain/commands'
import { WRITE_UP_WORDS_LIMIT, testWriteUp, writeUpWith } from '../../src/assistant/writeUp'

/**
 * NEXT-16: writing up a visit. A professional speaks a voice note (or types) after a visit; it is
 * written down, sorted into a note for the studio and aftercare for the guest, and returned for
 * them to check. Nothing is saved here: saving is the ordinary `visit-write-up` command.
 *
 * With a real AI each write-up counts as one Ask SALEANE question and its cost is held first, at
 * the most it could cost; in test mode it is sorted by its words, free, and nothing leaves SALEANE.
 */
export const VOICE_NOTE_BYTES = 1024 * 1024
/** The most a write-up by Claude can cost, in minor units: its words in and the longest reply. */
export const WRITE_UP_WORST_MINOR = 3

export function writeUpRoutes() {
  return async function writeUp(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, url, path, body, reply } = route
    if (path[1] !== 'workspaces') return false
    const status = path[3] === 'write-up' && path.length === 4
    const visit = path[3] === 'visits' && path.length === 6
    if (!status && !(visit && ['write-up', 'voice-note'].includes(path[5]))) return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    const brain = ctx.ai.brainFor(org.state, 'ask')
    // Listening needs both OpenAI to write the note down and Claude to write it up.
    const listens = !!brain && ctx.transcriber.live
    // Allowed exactly when saving a note on this visit would be.
    const refusalFor = (appointmentId: string) => {
      const probe: Command = { type: 'visit-write-up', appointmentId, note: 'probe' }
      if (!can(org.role, permissionFor(probe))) return 'Your role cannot write up visits.'
      const today = businessDate(org.state, new Date(ctx.now()).toISOString())
      return org.role === 'practitioner'
        ? practitionerRefusal(org.state, org.staffId!, probe, today)
        : org.role === 'general'
          ? branchRefusal(org.state, org.locationId!, probe)
          : null
    }
    if (status) {
      if (method !== 'GET') fail(405, 'Use GET.')
      // With a visit named, whether aftercare saved on it now still goes in its aftercare email.
      const asked = url.searchParams.get('visit')
      const shown =
        asked && !refusalFor(asked) ? org.state.appointments.find((a) => a.id === asked) : undefined
      const sent =
        !!shown &&
        !!ctx.db.get(
          "SELECT 1 AS found FROM outbox WHERE organisation_id=? AND appointment_id=? AND kind='aftercare'",
          org.id,
          shown.id,
        )
      reply(200, {
        mode: brain ? 'live' : 'test',
        listens,
        ...(shown
          ? { aftercareEmail: aftercareEmailAhead(org.state, shown, ctx.now(), sent) }
          : {}),
      })
      return true
    }
    if (method !== 'POST') fail(405, 'Use POST.')
    const appointmentId = path[4]
    const refusal = refusalFor(appointmentId)
    if (refusal) fail(403, refusal)
    const found = org.state.appointments.find((a) => a.id === appointmentId)
    if (!found) fail(404, 'This visit is not in your studio.')
    if (found!.status === 'cancelled' || found!.status === 'no_show')
      fail(409, 'This visit did not go ahead, so there is nothing to write up.')
    ctx.rateLimit(request, 'write-up', 20, 60000)

    const spoken = path[5] === 'voice-note'
    if (spoken && !listens) fail(409, 'Voice notes are not switched on for this studio.')
    const typed = spoken
      ? ''
      : z
          .object({ words: z.string().trim().min(2).max(WRITE_UP_WORDS_LIMIT) })
          .strict()
          .parse(body).words
    if (!brain) {
      reply(200, { heard: typed, ...testWriteUp(typed) })
      return true
    }

    const at = new Date(ctx.now()).toISOString()
    const use: UseRequest = {
      meter: 'typed',
      amount: 1,
      personId: actor.id,
      at,
      worstCaseMinor: WRITE_UP_WORST_MINOR + (spoken ? TRANSCRIBE_WORST_MINOR : 0),
    }
    const held = reserveFor(ctx, org.id, ctx.plans.allowance(org), () => use)
    if (!held.held) {
      reply(200, { status: 'refused', text: held.text })
      return true
    }
    let spent = 0
    const settle = (counted: boolean) =>
      ctx.db.transaction(() => settleUse(ctx, org.id, use, { counted, costMinor: spent }))
    let heard = typed
    try {
      if (spoken) {
        const written = await ctx.transcriber.transcribe(
          body as Buffer,
          String(request.headers['content-type']),
        )
        spent += written.costMinor
        heard = written.text.trim().slice(0, WRITE_UP_WORDS_LIMIT)
        if (heard.length < 2) {
          settle(false)
          reply(200, {
            status: 'unheard',
            text: 'Nothing was heard clearly. Try again, or type it.',
          })
          return true
        }
      }
      const result = await writeUpWith(brain, org.state, appointmentId, heard)
      spent += result.costMinor
      settle(true)
      reply(200, { heard, note: result.note, aftercare: result.aftercare })
    } catch (error) {
      // What the failed step may have cost still counts; the question does not.
      if (error instanceof TranscribeError || error instanceof BrainError) spent += error.costMinor
      else spent = use.worstCaseMinor
      settle(false)
      console.error(`[SALEANE] A visit could not be written up: ${(error as Error).message}`)
      reply(200, {
        status: 'unavailable',
        heard,
        text: 'It could not be written up just now. Nothing was saved. Try again, or type it yourself.',
      })
    }
    return true
  }
}

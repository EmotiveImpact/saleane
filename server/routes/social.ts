import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { operations } from '../../src/domain/operations'
import { socialChannels, socialLabel } from '../../src/domain/inboxSchema'
import { UNCONFIRMED, unconfirmedId } from '../messaging/meta'
import type { SocialOptions } from '../messaging/meta'

const accountInput = z
  .object({
    channel: z.enum(socialChannels),
    /** The account's id as Meta shows it; null disconnects it. */
    accountId: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z_.:-]{3,100}$/, 'Use the account id exactly as Meta shows it.')
      .refine(
        (id) => !id.toLowerCase().startsWith(UNCONFIRMED),
        'Use the account id exactly as Meta shows it.',
      )
      .nullable(),
  })
  .strict()
const confirmInput = z.object({ channel: z.enum(socialChannels) }).strict()

/**
 * V4: the owner's Instagram account, Facebook Page and WhatsApp Business number, so messages to
 * them reach this studio's inbox. While SALEANE waits for Meta's approval the owner types each
 * account's id; signing in with Meta replaces that once SALEANE is approved.
 *
 * Anyone can type an id, so an account added this way waits, unconfirmed: messages to it reach no
 * studio and the AI receptionist does not answer them until the owner proves it is theirs by
 * signing in with Meta. In test mode a labelled step stands in for that sign-in. Once one studio
 * has confirmed an account, no other studio can add it.
 */
export function socialRoutes(options: SocialOptions) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, body, reply } = route
    const confirming = path.length === 5 && path[4] === 'confirm'
    if (path[1] !== 'workspaces' || path[3] !== 'social' || (path.length !== 4 && !confirming))
      return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role !== 'owner') fail(403, 'Only the owner can connect the studio’s social accounts.')
    const sample = operations(org.state).mode === 'sandbox'
    const waiting = unconfirmedId(org.id, '')
    const list = () => ({
      mode: options.mode,
      sample,
      accounts: ctx.db
        .all<{ channel: string; account_id: string; connected_at: number }>(
          'SELECT channel,account_id,connected_at FROM social_accounts WHERE organisation_id=? ORDER BY channel',
          org.id,
        )
        .map((row) => {
          const confirmed = !row.account_id.startsWith(UNCONFIRMED)
          return {
            channel: row.channel,
            accountId: confirmed ? row.account_id : row.account_id.slice(waiting.length),
            confirmed,
            connectedAt: new Date(row.connected_at).toISOString(),
          }
        }),
    })
    /** Another studio has already confirmed this account. */
    const claimed = (channel: string, accountId: string) =>
      ctx.db.get<{ organisation_id: string }>(
        'SELECT organisation_id FROM social_accounts WHERE channel=? AND account_id=? AND organisation_id<>?',
        channel,
        accountId,
        org.id,
      )
    if (confirming) {
      if (method !== 'POST') fail(405, 'Use POST.')
      const { channel } = confirmInput.parse(body)
      if (options.mode !== 'test')
        fail(409, 'Confirming an account needs signing in with Meta, which is not ready yet.')
      ctx.db.transaction(() => {
        const row = ctx.db.get<{ account_id: string }>(
          'SELECT account_id FROM social_accounts WHERE organisation_id=? AND channel=?',
          org.id,
          channel,
        )
        if (!row) fail(404, `Add the ${socialLabel[channel]} account first.`)
        if (!row!.account_id.startsWith(UNCONFIRMED)) return
        const accountId = row!.account_id.slice(waiting.length)
        if (claimed(channel, accountId))
          fail(409, `This ${socialLabel[channel]} account is connected to another studio.`)
        ctx.db.run(
          'UPDATE social_accounts SET account_id=?,connected_at=? WHERE organisation_id=? AND channel=?',
          accountId,
          ctx.now(),
          org.id,
          channel,
        )
        ctx.audit(org, actor.id, 'social.confirmed', channel)
      })
      reply(200, list())
      return true
    }
    if (method === 'GET') {
      reply(200, list())
      return true
    }
    if (method !== 'POST') fail(405, 'Use GET or POST.')
    const input = accountInput.parse(body)
    if (sample && input.accountId)
      fail(409, 'A sample studio never connects to Instagram, Facebook or WhatsApp.')
    ctx.db.transaction(() => {
      if (!input.accountId) {
        ctx.db.run(
          'DELETE FROM social_accounts WHERE organisation_id=? AND channel=?',
          org.id,
          input.channel,
        )
        ctx.audit(org, actor.id, 'social.disconnected', input.channel)
        return
      }
      const current = ctx.db.get<{ account_id: string }>(
        'SELECT account_id FROM social_accounts WHERE organisation_id=? AND channel=?',
        org.id,
        input.channel,
      )
      // The same account again keeps whatever it had: confirmed stays confirmed.
      if (
        current &&
        (current.account_id === input.accountId ||
          current.account_id === unconfirmedId(org.id, input.accountId))
      )
        return
      if (claimed(input.channel, input.accountId))
        fail(409, `This ${socialLabel[input.channel]} account is connected to another studio.`)
      ctx.db.run(
        'DELETE FROM social_accounts WHERE organisation_id=? AND channel=?',
        org.id,
        input.channel,
      )
      ctx.db.run(
        'INSERT INTO social_accounts(channel,account_id,organisation_id,connected_at) VALUES(?,?,?,?)',
        input.channel,
        unconfirmedId(org.id, input.accountId),
        org.id,
        ctx.now(),
      )
      ctx.audit(org, actor.id, 'social.added', input.channel)
    })
    reply(200, list())
    return true
  }
}

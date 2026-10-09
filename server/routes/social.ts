import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { operations } from '../../src/domain/operations'
import { socialChannels, socialLabel } from '../../src/domain/inboxSchema'
import type { SocialOptions } from '../messaging/meta'

const accountInput = z
  .object({
    channel: z.enum(socialChannels),
    /** The account's id as Meta shows it; null disconnects it. */
    accountId: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z_.:-]{3,100}$/, 'Use the account id exactly as Meta shows it.')
      .nullable(),
  })
  .strict()

/**
 * V4: the owner's Instagram account, Facebook Page and WhatsApp Business number, so messages to
 * them reach this studio's inbox. While SALEANE waits for Meta's approval the owner types each
 * account's id; signing in with Meta replaces that once SALEANE is approved.
 */
export function socialRoutes(options: SocialOptions) {
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'social' || path.length !== 4) return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (org.role !== 'owner') fail(403, 'Only the owner can connect the studio’s social accounts.')
    const sample = operations(org.state).mode === 'sandbox'
    const list = () => ({
      mode: options.mode,
      sample,
      accounts: ctx.db
        .all<{ channel: string; account_id: string; connected_at: number }>(
          'SELECT channel,account_id,connected_at FROM social_accounts WHERE organisation_id=? ORDER BY channel',
          org.id,
        )
        .map((row) => ({
          channel: row.channel,
          accountId: row.account_id,
          connectedAt: new Date(row.connected_at).toISOString(),
        })),
    })
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
      const taken = ctx.db.get<{ organisation_id: string }>(
        'SELECT organisation_id FROM social_accounts WHERE channel=? AND account_id=?',
        input.channel,
        input.accountId,
      )
      if (taken && taken.organisation_id !== org.id)
        fail(409, `This ${socialLabel[input.channel]} account is connected to another studio.`)
      ctx.db.run(
        'DELETE FROM social_accounts WHERE organisation_id=? AND channel=?',
        org.id,
        input.channel,
      )
      ctx.db.run(
        'INSERT INTO social_accounts(channel,account_id,organisation_id,connected_at) VALUES(?,?,?,?)',
        input.channel,
        input.accountId,
        org.id,
        ctx.now(),
      )
      ctx.audit(org, actor.id, 'social.connected', input.channel)
    })
    reply(200, list())
    return true
  }
}

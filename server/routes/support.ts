import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fail } from '../http'
import type { Context, Route } from '../context'
import { SUPPORT_TOPICS, supportTopicWords } from '../../src/domain/help'
import type { SupportRequestView, SupportStatus } from '../../src/domain/help'
import { roleNames } from '../../src/domain/operations'

/** One person can write to the SALEANE team this many times an hour. */
export const SUPPORT_PER_HOUR = 5
const input = z
  .object({
    topic: z.enum(SUPPORT_TOPICS),
    message: z.string().trim().min(10, 'Say a little more, so the team can help.').max(4000),
    /** The screen they were on, such as /settings?section=billing. */
    page: z
      .string()
      .max(200)
      .regex(/^\/[^#\s]*$/)
      .optional(),
    /** The studio they were in, checked against their own memberships. */
    workspaceId: z.string().min(1).max(100).optional(),
  })
  .strict()

/** The address help requests go to, from the server's settings. Unset keeps them here. */
export function supportAddressFromEnv(env: Record<string, string | undefined> = process.env) {
  const address = env.SALEANE_SUPPORT_EMAIL?.trim()
  if (!address) return null
  if (!z.email().safeParse(address).success)
    throw new Error('SALEANE_SUPPORT_EMAIL must be an email address.')
  return address
}

type Row = {
  id: string
  topic: (typeof SUPPORT_TOPICS)[number]
  message: string
  page: string | null
  status: SupportStatus
  studio: string | null
  created_at: number
}

/**
 * NEXT-06: anyone signed in can write to the SALEANE team from Help. The request is kept first,
 * then emailed to the team's address through the email provider; the record says honestly what
 * happened (kept here, test mode, accepted, failed or not known), never that it was read.
 */
export function supportRoutes(address: string | null) {
  return async function routes(ctx: Context, route: Route): Promise<boolean> {
    const { request, method, path, body, reply } = route
    if (path[1] !== 'support' || path.length !== 2) return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const mine = () =>
      ctx.db
        .all<Row>(
          `SELECT r.id,r.topic,r.message,r.page,r.status,r.created_at,json_extract(o.state,'$.organisation.name') AS studio
           FROM support_requests r LEFT JOIN organisations o ON o.id=r.organisation_id
           WHERE r.account_id=? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 20`,
          actor.id,
        )
        .map((row): SupportRequestView => ({
          id: row.id,
          topic: row.topic,
          message: row.message,
          page: row.page,
          studio: row.studio,
          status: row.status,
          createdAt: row.created_at,
        }))
    const answer = () => ({
      requests: mine(),
      email: actor.email,
      /** Where requests go: nowhere yet, the test email provider, or a real inbox. */
      delivery: !address ? 'kept' : ctx.messaging.email.live ? 'email' : 'test',
    })
    if (method === 'GET') {
      reply(200, answer())
      return true
    }
    if (method !== 'POST') fail(405, 'Use GET or POST.')
    ctx.rateLimit(request, 'support', 10, 60 * 60000)
    const data = input.parse(body)
    const recent = ctx.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM support_requests WHERE account_id=? AND created_at>?',
      actor.id,
      ctx.now() - 60 * 60000,
    )!.n
    if (recent >= SUPPORT_PER_HOUR)
      fail(429, 'You have written to the team several times this hour. Try again a little later.')
    const org = data.workspaceId ? ctx.orgFor(data.workspaceId, actor, { area: true }) : null
    const id = randomUUID()
    const provider = ctx.messaging.email
    ctx.db.run(
      `INSERT INTO support_requests(id,account_id,organisation_id,role,topic,message,page,status,provider,detail,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      actor.id,
      org?.id ?? null,
      org?.role ?? null,
      data.topic,
      data.message,
      data.page ?? null,
      address ? 'unknown' : 'kept',
      address ? provider.name : null,
      address
        ? 'Handed to the email service; no answer yet.'
        : 'No help address is set on this server, so it is kept here.',
      ctx.now(),
    )
    if (!address && !process.env.VITEST)
      console.log(
        `[SALEANE] A help request was kept on this server (${id}); no help address is set.`,
      )
    if (address) {
      let status: SupportStatus = 'unknown'
      let ref: string | null = null
      let detail: string | null = null
      try {
        const result = await provider.send({
          id,
          channel: 'email',
          to: address,
          subject: `Help request: ${supportTopicWords[data.topic]} (${id.slice(0, 8)})`,
          body: [
            `From: ${actor.name} <${actor.email}>`,
            org
              ? `Studio: ${org.state.organisation.name} (${roleNames[org.role]})`
              : 'Studio: none open',
            `Screen: ${data.page ?? 'not given'}`,
            `About: ${supportTopicWords[data.topic]}`,
            '',
            data.message,
            '',
            `Reply to ${actor.email}.`,
          ].join('\n'),
          fromName: 'SALEANE Help',
        })
        status = result.outcome
        if (result.outcome === 'accepted') ref = result.providerRef
        if (result.outcome === 'failed' || result.outcome === 'unknown') detail = result.detail
      } catch (error) {
        detail = error instanceof Error ? error.message : 'The email provider did not answer.'
      }
      if (status === 'test' && !process.env.VITEST)
        console.log(
          `[SALEANE] Email is not connected, so help request ${id} was kept on this server and not sent.`,
        )
      ctx.db.run(
        'UPDATE support_requests SET status=?,provider_ref=?,detail=? WHERE id=?',
        status,
        ref,
        detail,
        id,
      )
    }
    reply(200, { ...answer(), id })
    return true
  }
}

import { dispatch } from '../../src/domain/commands'
import type { Context } from '../context'
import type { InboundReply } from './providers'

/**
 * V1.5: writes down a call the studio's phone line says nobody answered, for the desk to call
 * back. A withheld or unreadable number is left alone: there is no one to call or text.
 * Returns whether a call was recorded.
 */
export function recordPhoneCall(ctx: Context, slug: string, from: string) {
  const { db, now } = ctx
  return db.transaction(() => {
    const row = db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
    const org = row && ctx.systemOrg(row.id)
    if (!org) return false
    const result = dispatch(
      org.state,
      { type: 'missed-call', number: from.slice(0, 30), source: 'phone' },
      'Phone line',
      new Date(now()).toISOString(),
    )
    if (!result.ok || result.state === org.state) return false
    ctx.persist(org, result.state, null, 'phone.missed-call', result.recordId)
    return true
  })
}

/**
 * V1.5: keeps a guest's reply from the studio's email or text line for the inbox. A reply the
 * provider sends again is kept once. Returns whether a new reply was kept.
 */
export function recordReply(
  ctx: Context,
  slug: string,
  channel: 'email' | 'sms',
  reply: InboundReply,
) {
  const { db, now } = ctx
  return db.transaction(() => {
    const row = db.get<{ id: string }>('SELECT id FROM organisations WHERE slug=?', slug)
    const org = row && ctx.systemOrg(row.id)
    if (!org) return false
    const result = dispatch(
      org.state,
      {
        type: 'reply-received',
        channel,
        from: reply.from.slice(0, 320),
        body: reply.body.slice(0, 20000),
        providerRef: reply.providerRef.slice(0, 200),
      },
      channel === 'sms' ? 'Text line' : 'Email line',
      new Date(now()).toISOString(),
    )
    if (!result.ok || result.state === org.state) return false
    ctx.persist(org, result.state, null, 'inbox.reply', result.recordId)
    return true
  })
}

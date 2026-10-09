import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SocialChannel } from '../../src/domain/inboxSchema'

/**
 * V4: messages to a studio's Instagram account, Facebook Page and WhatsApp Business number. Meta
 * posts each one to a single webhook for the whole app, signed with the app secret; the account
 * it was sent to says which studio it is for. Off unless the server is started with
 * SALEANE_SOCIAL=test and the app's secret and verify token. Test mode reads what comes in and
 * sends nothing back: answers stay in the outbox. Field names follow Meta's Messenger Platform,
 * Instagram Messaging and WhatsApp Cloud API webhook references as read on 8 October 2026.
 */

export type SocialOptions = { mode: 'off' | 'test'; appSecret: string; verifyToken: string }

/**
 * An account the owner has added but not yet confirmed is kept in social_accounts under this
 * prefix and the studio's id, so the lookups that route messages by the account's own id never
 * find it, and two studios can each wait to confirm the same id. Confirming keeps the plain id.
 */
export const UNCONFIRMED = 'unconfirmed:'
export const unconfirmedId = (organisationId: string, accountId: string) =>
  `${UNCONFIRMED}${organisationId}:${accountId}`

export function socialFromEnv(env: Record<string, string | undefined>): SocialOptions {
  const mode = env.SALEANE_SOCIAL?.trim() || 'off'
  if (mode === 'off') return { mode: 'off', appSecret: '', verifyToken: '' }
  if (mode !== 'test')
    throw new Error(`Unknown social messages mode "${mode}". Use "off" or "test".`)
  const appSecret = env.META_APP_SECRET?.trim() ?? ''
  const verifyToken = env.META_VERIFY_TOKEN?.trim() ?? ''
  if (appSecret.length < 16 || verifyToken.length < 16)
    throw new Error('Social messages need a long META_APP_SECRET and META_VERIFY_TOKEN.')
  return { mode, appSecret, verifyToken }
}

const same = (a: string | undefined, b: string) => {
  if (!a || !b) return false
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Meta's check when the webhook is set up: echo the challenge only for our own verify token. */
export function metaChallenge(options: SocialOptions, params: URLSearchParams) {
  if (params.get('hub.mode') !== 'subscribe') return null
  if (!same(params.get('hub.verify_token') ?? '', options.verifyToken)) return null
  return params.get('hub.challenge') ?? null
}

/** Meta signs the raw body: X-Hub-Signature-256 is "sha256=" and an HMAC-SHA256 in hex. */
export function metaSignature(appSecret: string, body: string) {
  return `sha256=${createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')}`
}
export const metaGenuine = (options: SocialOptions, body: string, header: string | undefined) =>
  same(header, metaSignature(options.appSecret, body))

/** One guest message as it arrived, before it is matched to a studio or a client. */
export type SocialMessage = {
  channel: SocialChannel
  /** The studio's account it was sent to: Instagram account, Page or WhatsApp number id. */
  account: string
  /** The guest's id on that app; for WhatsApp, their number with its country code. */
  from: string
  name?: string
  text: string
  ref: string
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * The guests' messages in one webhook post. Echoes of the studio's own messages, receipts and
 * anything else are left out. A message with no words (a photo, a sticker) keeps an empty text.
 */
export function metaMessages(payload: unknown): SocialMessage[] {
  const event = obj(payload)
  const found: SocialMessage[] = []
  if (event.object === 'instagram' || event.object === 'page') {
    const channel: SocialChannel = event.object === 'instagram' ? 'instagram' : 'facebook'
    for (const entry of list(event.entry))
      for (const item of list(obj(entry).messaging)) {
        const messaging = obj(item)
        const message = obj(messaging.message)
        if (message.is_echo === true) continue
        const from = text(obj(messaging.sender).id)
        const account = text(obj(messaging.recipient).id) || text(obj(entry).id)
        const ref = text(message.mid)
        if (!from || !account || !ref) continue
        found.push({ channel, account, from, text: text(message.text), ref })
      }
  }
  if (event.object === 'whatsapp_business_account') {
    for (const entry of list(event.entry))
      for (const change of list(obj(entry).changes)) {
        if (obj(change).field !== 'messages') continue
        const value = obj(obj(change).value)
        const account = text(obj(value.metadata).phone_number_id)
        const names = new Map(
          list(value.contacts).map((c) => [text(obj(c).wa_id), text(obj(obj(c).profile).name)]),
        )
        for (const item of list(value.messages)) {
          const message = obj(item)
          const digits = text(message.from).replace(/\D/g, '')
          const ref = text(message.id)
          if (!account || !digits || !ref) continue
          const name = names.get(text(message.from))
          found.push({
            channel: 'whatsapp',
            account,
            from: `+${digits}`,
            ...(name ? { name } : {}),
            text: message.type === 'text' ? text(obj(message.text).body) : '',
            ref,
          })
        }
      }
  }
  return found
}

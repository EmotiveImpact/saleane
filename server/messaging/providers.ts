import { createHmac } from 'node:crypto'
import type { OutboxChannel } from '../../src/domain/reminders'
import { isResult, post, sameText } from './wire'
import type { Fetch } from './wire'
import {
  googleProvider,
  mailgunProvider,
  mailgunReceipts,
  microsoftProvider,
  resendProvider,
  resendReceipts,
  sendgridProvider,
  sendgridReceipts,
  sesProvider,
  smtpProvider,
} from './emailSenders'
import type { EmailSenderName } from './emailSenders'

/**
 * PILOT-01 provider seam. Each channel has one provider. The default is test mode, which sends
 * nothing: the outbox keeps the message so the studio can read exactly what would have gone.
 *
 * Live adapters are written against each provider's published API but have not been run against
 * a real account. They switch on only when every key is present, and fail loudly otherwise.
 */
export type OutgoingMessage = {
  id: string
  channel: OutboxChannel
  to: string
  subject: string
  body: string
  /** Shown as the sender's name on email. */
  fromName: string
  /** V4: the studio's Instagram account, Page or WhatsApp number an answer goes from. */
  account?: string
  /**
   * NEXT-13: email only. The designed email, made from `body`, which still goes with it as the
   * plain-text part.
   */
  html?: string
  /**
   * NEXT-13: email only. `broadcast` for news and keeping in touch, which providers want kept
   * apart from visit messages so one guest's complaint never holds up another's confirmation.
   */
  stream?: 'transactional' | 'broadcast'
  /**
   * NEXT-13: email news only. The guest's own address to stop the news in one click, sent as
   * List-Unsubscribe with List-Unsubscribe-Post (RFC 8058) so mail apps can offer it.
   */
  unsubscribeUrl?: string
}
export type SendResult =
  | { outcome: 'test' }
  | { outcome: 'accepted'; providerRef: string }
  /** The provider refused it. `retry` is true only when the refusal says to try again later. */
  | { outcome: 'failed'; detail: string; retry: boolean }
  /** The request may or may not have reached the provider, so sending again could duplicate it. */
  | { outcome: 'unknown'; detail: string }

export type MessageProvider = {
  name: 'test' | 'twilio' | EmailSenderName
  live: boolean
  channel: OutboxChannel
  send: (message: OutgoingMessage) => Promise<SendResult>
}
/** A delivery receipt the provider posted back, already verified. */
export type Receipt = { provider: string; providerRef: string; delivered: boolean; detail?: string }
export type ReceiptRequest = {
  url: string
  headers: Record<string, string | undefined>
  body: string
}
export type Providers = {
  email: MessageProvider
  sms: MessageProvider
  /** V4: answers on the studio's social accounts. Test mode only until Meta approves SALEANE. */
  instagram?: MessageProvider
  facebook?: MessageProvider
  whatsapp?: MessageProvider
  /** Verifies and reads a receipt for the named provider; null when it is not genuine. */
  receipt: (provider: string, request: ReceiptRequest) => Receipt[] | null
  /**
   * V1.5: verifies how a call to the studio's phone line ended, for missed-call text-back. Only
   * Twilio, and only when it sends the studio's texts. Null when it is not genuine.
   */
  voice?: (slug: string, request: ReceiptRequest) => VoiceCall | null
  /**
   * V1.5: verifies a guest's reply that came in on the studio's text line (Twilio) or email
   * address (Postmark inbound), for the inbox. Null when it is not genuine or the line is not
   * connected; an empty list when it carries nothing to keep.
   */
  inbound?: (provider: string, slug: string, request: ReceiptRequest) => InboundReply[] | null
}
/** A guest's reply as it arrived, before it is matched to a client. */
export type InboundReply = { from: string; body: string; providerRef: string }
/** A call to the studio's line that has ended. `missed` when nobody picked up. */
export type VoiceCall = { from: string; missed: boolean }
/** Twilio's <Dial> outcomes that mean the studio did not speak to the caller. */
const MISSED_DIAL = new Set(['busy', 'no-answer', 'failed', 'canceled'])

export function testProvider(channel: OutboxChannel): MessageProvider {
  return { name: 'test', live: false, channel, send: async () => ({ outcome: 'test' }) }
}
/** The provider for a channel; a social app without one is in test mode. */
export const providerFor = (providers: Providers, channel: OutboxChannel) =>
  providers[channel] ?? testProvider(channel)

/** Postmark transactional email. https://postmarkapp.com/developer/api/email-api */
export function postmarkProvider(config: {
  token: string
  from: string
  /**
   * The Stream ID of the Postmark broadcast stream for news and keeping in touch, exactly as the
   * Postmark server names it. There is no safe guess: a stream that does not exist refuses them.
   */
  broadcastStream: string
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  return {
    name: 'postmark',
    live: true,
    channel: 'email',
    async send(message) {
      const result = await post(fetcher, 'https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': config.token,
        },
        body: JSON.stringify({
          From: `${message.fromName.replace(/["<>]/g, '')} <${config.from}>`,
          To: message.to,
          Subject: message.subject,
          TextBody: message.body,
          ...(message.html ? { HtmlBody: message.html } : {}),
          ...(message.unsubscribeUrl
            ? {
                Headers: [
                  { Name: 'List-Unsubscribe', Value: `<${message.unsubscribeUrl}>` },
                  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ],
              }
            : {}),
          MessageStream: message.stream === 'broadcast' ? config.broadcastStream : 'outbound',
          Metadata: { outbox: message.id },
        }),
      })
      if (isResult(result)) return result
      const errorCode = Number(result.json.ErrorCode ?? -1)
      if (result.status === 200 && errorCode === 0 && typeof result.json.MessageID === 'string')
        return { outcome: 'accepted', providerRef: result.json.MessageID }
      return {
        outcome: 'failed',
        detail: String(result.json.Message ?? `Email provider refused it (${result.status}).`),
        retry: result.status === 429 || result.status >= 500,
      }
    },
  }
}

/** Twilio Programmable Messaging. https://www.twilio.com/docs/messaging/api/message-resource */
export function twilioProvider(config: {
  accountSid: string
  authToken: string
  from: string
  statusCallback?: string
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  return {
    name: 'twilio',
    live: true,
    channel: 'sms',
    async send(message) {
      const form = new URLSearchParams({ To: message.to, Body: message.body })
      // A Messaging Service SID starts with MG; anything else is a sending number.
      form.set(config.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', config.from)
      if (config.statusCallback) form.set('StatusCallback', config.statusCallback)
      const result = await post(
        fetcher,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      )
      if (isResult(result)) return result
      if (result.status === 201 && typeof result.json.sid === 'string')
        return { outcome: 'accepted', providerRef: result.json.sid }
      const code = Number(result.json.code)
      return {
        outcome: 'failed',
        detail:
          code === 21610
            ? 'This number has replied STOP, so texts to it are blocked.'
            : String(result.json.message ?? `Text provider refused it (${result.status}).`),
        retry: result.status === 429 || result.status >= 500,
      }
    },
  }
}

/** Twilio signs each callback: base64 HMAC-SHA1 of the URL followed by sorted form pairs. */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams) {
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const data = url + pairs.map(([key, value]) => key + value).join('')
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

/**
 * Reads providers from the environment. Unset means test mode. Naming a live provider without
 * all of its keys stops the server rather than quietly falling back to test mode.
 */
export function providersFromEnv(
  env: Record<string, string | undefined> = process.env,
  origin = 'http://127.0.0.1:5173',
  fetcher?: Fetch,
): Providers {
  const need = (...names: string[]) => {
    const missing = names.filter((name) => !env[name]?.trim())
    if (missing.length) throw new Error(`Set ${missing.join(' and ')} to send real messages.`)
    return names.map((name) => env[name]!.trim())
  }
  const emailName = env.SALEANE_EMAIL_PROVIDER?.trim() || 'test'
  const smsName = env.SALEANE_SMS_PROVIDER?.trim() || 'test'
  let email = testProvider('email'),
    sms = testProvider('sms')
  let postmarkSecret: string | undefined, twilioToken: string | undefined
  /** NEXT-13: the chosen email sender's own receipts, verified its own way. */
  let emailReceipts: ((request: ReceiptRequest) => Receipt[] | null) | undefined
  const optional = (name: string) => env[name]?.trim() || undefined
  const eu = (name: string) => optional(name)?.toLowerCase() === 'eu'
  if (emailName === 'postmark') {
    const [token, from, broadcastStream] = need(
      'POSTMARK_SERVER_TOKEN',
      'SALEANE_EMAIL_FROM',
      'POSTMARK_BROADCAST_STREAM',
    )
    postmarkSecret = optional('POSTMARK_WEBHOOK_SECRET')
    email = postmarkProvider({ token, from, broadcastStream, fetcher })
  } else if (emailName === 'resend') {
    const [apiKey, from] = need('RESEND_API_KEY', 'SALEANE_EMAIL_FROM')
    email = resendProvider({ apiKey, from, fetcher })
    const secret = optional('RESEND_WEBHOOK_SECRET')
    if (secret) emailReceipts = (request) => resendReceipts(secret, request)
  } else if (emailName === 'sendgrid') {
    const [apiKey, from] = need('SENDGRID_API_KEY', 'SALEANE_EMAIL_FROM')
    email = sendgridProvider({ apiKey, from, eu: eu('SENDGRID_REGION'), fetcher })
    const key = optional('SENDGRID_WEBHOOK_PUBLIC_KEY')
    if (key) emailReceipts = (request) => sendgridReceipts(key, request)
  } else if (emailName === 'mailgun') {
    const [apiKey, domain, from] = need('MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'SALEANE_EMAIL_FROM')
    email = mailgunProvider({ apiKey, domain, from, eu: eu('MAILGUN_REGION'), fetcher })
    const key = optional('MAILGUN_WEBHOOK_SIGNING_KEY')
    if (key) emailReceipts = (request) => mailgunReceipts(key, request)
  } else if (emailName === 'ses') {
    const [region, accessKeyId, secretAccessKey, from] = need(
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'SALEANE_EMAIL_FROM',
    )
    const sessionToken = optional('AWS_SESSION_TOKEN')
    email = sesProvider({
      region,
      keys: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
      from,
      configurationSet: optional('SES_CONFIGURATION_SET'),
      fetcher,
    })
  } else if (emailName === 'smtp') {
    const [host, from] = need('SMTP_HOST', 'SALEANE_EMAIL_FROM')
    const port = Number(optional('SMTP_PORT') ?? 587)
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Set SMTP_PORT to the mail server’s port, such as 587 or 465.')
    const user = optional('SMTP_USER')
    if (user) need('SMTP_PASSWORD')
    email = smtpProvider({ host, port, user, password: optional('SMTP_PASSWORD'), from })
  } else if (emailName === 'google') {
    const [json, from] = need('GOOGLE_SERVICE_ACCOUNT_JSON', 'SALEANE_EMAIL_FROM')
    let account: { client_email?: unknown; private_key?: unknown }
    try {
      account = JSON.parse(json) as typeof account
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be the service account’s JSON key.')
    }
    if (typeof account.client_email !== 'string' || typeof account.private_key !== 'string')
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be the service account’s JSON key.')
    email = googleProvider({
      clientEmail: account.client_email,
      privateKey: account.private_key,
      from,
      fetcher,
    })
  } else if (emailName === 'microsoft') {
    const [tenantId, clientId, clientSecret, from] = need(
      'MICROSOFT_TENANT_ID',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'SALEANE_EMAIL_FROM',
    )
    email = microsoftProvider({ tenantId, clientId, clientSecret, from, fetcher })
  } else if (emailName !== 'test') throw new Error(`Unknown email provider "${emailName}".`)
  const twilioCallback = `${origin.replace(/\/$/, '')}/api/hooks/twilio`
  if (smsName === 'twilio') {
    const [accountSid, authToken, from] = need(
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_FROM',
    )
    twilioToken = authToken
    sms = twilioProvider({ accountSid, authToken, from, statusCallback: twilioCallback, fetcher })
  } else if (smsName !== 'test') throw new Error(`Unknown text provider "${smsName}".`)
  const voiceBase = `${origin.replace(/\/$/, '')}/api/hooks/twilio/voice/`
  const textBase = `${origin.replace(/\/$/, '')}/api/hooks/twilio/sms/`
  /** Postmark sends the webhook's basic-auth credentials, set as user:secret in its URL. */
  const postmarkGenuine = (request: ReceiptRequest) => {
    if (!postmarkSecret) return false
    const auth = request.headers.authorization ?? ''
    const supplied = auth.startsWith('Basic ')
      ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':')
      : ''
    return sameText(supplied, postmarkSecret)
  }
  return {
    email,
    sms,
    instagram: testProvider('instagram'),
    facebook: testProvider('facebook'),
    whatsapp: testProvider('whatsapp'),
    voice(slug, request) {
      if (!twilioToken) return null
      const params = new URLSearchParams(request.body)
      const expected = twilioSignature(twilioToken, voiceBase + slug, params)
      if (!sameText(request.headers['x-twilio-signature'], expected)) return null
      const status = params.get('DialCallStatus') ?? params.get('CallStatus') ?? ''
      return { from: params.get('From') ?? '', missed: MISSED_DIAL.has(status) }
    },
    inbound(provider, slug, request) {
      if (provider === 'twilio' && twilioToken) {
        const params = new URLSearchParams(request.body)
        const expected = twilioSignature(twilioToken, textBase + slug, params)
        if (!sameText(request.headers['x-twilio-signature'], expected)) return null
        const from = params.get('From') ?? '',
          ref = params.get('MessageSid') ?? ''
        if (!from || !ref) return []
        return [{ from, body: params.get('Body') ?? '', providerRef: ref }]
      }
      if (provider === 'postmark' && postmarkGenuine(request)) {
        let event: Record<string, unknown>
        try {
          event = JSON.parse(request.body) as Record<string, unknown>
        } catch {
          return null
        }
        const full = event.FromFull as { Email?: unknown } | undefined
        const from = typeof full?.Email === 'string' ? full.Email : String(event.From ?? '')
        const ref = typeof event.MessageID === 'string' ? event.MessageID : ''
        if (!from || !ref) return []
        // The guest's new words without the quoted message below them, when Postmark finds it.
        const body = [event.StrippedTextReply, event.TextBody].find(
          (text): text is string => typeof text === 'string' && !!text.trim(),
        )
        return [{ from, body: body ?? '', providerRef: ref }]
      }
      return null
    },
    receipt(provider, request) {
      if (provider === 'twilio' && twilioToken) {
        const params = new URLSearchParams(request.body)
        const expected = twilioSignature(twilioToken, twilioCallback, params)
        if (!sameText(request.headers['x-twilio-signature'], expected)) return null
        const ref = params.get('MessageSid'),
          status = params.get('MessageStatus')
        if (!ref || !status) return []
        if (status === 'delivered') return [{ provider, providerRef: ref, delivered: true }]
        if (status === 'undelivered' || status === 'failed')
          return [
            {
              provider,
              providerRef: ref,
              delivered: false,
              detail: `The phone network reported it ${status}${params.get('ErrorCode') ? ` (error ${params.get('ErrorCode')})` : ''}.`,
            },
          ]
        return []
      }
      if (provider === 'postmark' && postmarkSecret) {
        if (!postmarkGenuine(request)) return null
        let event: Record<string, unknown>
        try {
          event = JSON.parse(request.body) as Record<string, unknown>
        } catch {
          return null
        }
        const ref = typeof event.MessageID === 'string' ? event.MessageID : ''
        if (!ref) return []
        if (event.RecordType === 'Delivery')
          return [{ provider, providerRef: ref, delivered: true }]
        if (event.RecordType === 'Bounce')
          return [
            {
              provider,
              providerRef: ref,
              delivered: false,
              detail: String(event.Description ?? 'The email bounced.'),
            },
          ]
        return []
      }
      if (provider === email.name && provider !== 'postmark' && emailReceipts)
        return emailReceipts(request)
      return null
    },
  }
}

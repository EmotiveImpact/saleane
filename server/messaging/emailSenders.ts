import { createHmac, createPrivateKey, createSign, verify } from 'node:crypto'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { signAws } from './aws'
import type { AwsKeys } from './aws'
import type {
  MessageProvider,
  OutgoingMessage,
  Receipt,
  ReceiptRequest,
  SendResult,
} from './providers'
import { isResult, post, refused, sameText } from './wire'
import type { Fetch } from './wire'

/**
 * NEXT-13 part 2: SALEANE's guest email can go through any of these, chosen with
 * SALEANE_EMAIL_PROVIDER. Each is written against the provider's published API and checked with
 * simulated answers; none has been run against a real account. Postmark lives in providers.ts.
 *
 * Every sender gets the same message: the plain text, the designed email, the studio's name as the
 * sender's name, a stream (visit messages apart from news) and, for news, a one-click unsubscribe
 * (RFC 8058). Only an answer that says the provider took the message counts as accepted; a
 * delivery receipt, where the provider sends one, is the only thing that makes it "delivered".
 */
export type EmailSenderName =
  'postmark' | 'resend' | 'sendgrid' | 'mailgun' | 'ses' | 'smtp' | 'google' | 'microsoft'

/** The sender's name as a mail header shows it, with nothing that could break the header. */
const displayName = (name: string) => name.replace(/[\p{Cc}"<>\\]/gu, '').trim() || 'SALEANE'
const fromLine = (message: OutgoingMessage, address: string) =>
  `"${displayName(message.fromName)}" <${address}>`
/** RFC 8058: the address a mail app calls to unsubscribe in one click, for news only. */
function unsubscribeHeaders(message: OutgoingMessage): Record<string, string> {
  if (!message.unsubscribeUrl) return {}
  return {
    'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
/** Our own Message-ID, for senders that give back no reference of their own. */
const messageIdFor = (message: OutgoingMessage, from: string) =>
  `<${message.id}@${from.split('@')[1] ?? 'saleane.invalid'}>`

/** The whole email as one MIME message, for senders that take it that way. */
export async function mimeOf(message: OutgoingMessage, from: string, messageId: string) {
  return new MailComposer({
    from: { name: displayName(message.fromName), address: from },
    to: message.to,
    subject: message.subject,
    text: message.body,
    ...(message.html ? { html: message.html } : {}),
    messageId,
    headers: unsubscribeHeaders(message),
    // Nothing in a message may make SALEANE read a file or fetch an address while building it.
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build()
}

/** Resend. https://resend.com/docs/api-reference/emails/send-email */
export function resendProvider(config: {
  apiKey: string
  from: string
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  return {
    name: 'resend',
    live: true,
    channel: 'email',
    async send(message) {
      const result = await post(fetcher, 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromLine(message, config.from),
          to: [message.to],
          subject: message.subject,
          text: message.body,
          ...(message.html ? { html: message.html } : {}),
          headers: unsubscribeHeaders(message),
          tags: [
            { name: 'outbox', value: message.id },
            { name: 'stream', value: message.stream ?? 'transactional' },
          ],
        }),
      })
      if (isResult(result)) return result
      if (result.status === 200 && typeof result.json.id === 'string' && result.json.id)
        return { outcome: 'accepted', providerRef: result.json.id }
      return refused(
        result.status,
        String(result.json.message ?? `Resend refused it (${result.status}).`),
      )
    },
  }
}

/** Twilio SendGrid. https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send */
export function sendgridProvider(config: {
  apiKey: string
  from: string
  /** SendGrid's EU host, for an EU subuser. */
  eu?: boolean
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  const host = config.eu ? 'https://api.eu.sendgrid.com' : 'https://api.sendgrid.com'
  return {
    name: 'sendgrid',
    live: true,
    channel: 'email',
    async send(message) {
      const headers = unsubscribeHeaders(message)
      const result = await post(fetcher, `${host}/v3/mail/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: config.from, name: displayName(message.fromName) },
          subject: message.subject,
          content: [
            { type: 'text/plain', value: message.body },
            ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
          ],
          ...(Object.keys(headers).length ? { headers } : {}),
          custom_args: { outbox: message.id },
          categories: [message.stream ?? 'transactional'],
        }),
      })
      if (isResult(result)) return result
      const ref = result.headers.get('x-message-id')
      if (result.status === 202 && ref) return { outcome: 'accepted', providerRef: ref }
      if (result.status === 202)
        return {
          outcome: 'unknown',
          detail: 'SendGrid took it without a reference. Check its activity feed first.',
        }
      const errors = result.json.errors as { message?: unknown }[] | undefined
      return refused(
        result.status,
        String(errors?.[0]?.message ?? `SendGrid refused it (${result.status}).`),
      )
    },
  }
}

/** Mailgun. https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages */
export function mailgunProvider(config: {
  apiKey: string
  domain: string
  from: string
  /** Mailgun's EU region. */
  eu?: boolean
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  const host = config.eu ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  return {
    name: 'mailgun',
    live: true,
    channel: 'email',
    async send(message) {
      const form = new FormData()
      form.set('from', fromLine(message, config.from))
      form.set('to', message.to)
      form.set('subject', message.subject)
      form.set('text', message.body)
      if (message.html) form.set('html', message.html)
      for (const [name, value] of Object.entries(unsubscribeHeaders(message)))
        form.set(`h:${name}`, value)
      form.set('v:outbox', message.id)
      form.set('o:tag', message.stream ?? 'transactional')
      const result = await post(
        fetcher,
        `${host}/v3/${encodeURIComponent(config.domain)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`,
          },
          body: form,
        },
      )
      if (isResult(result)) return result
      const id = typeof result.json.id === 'string' ? bare(result.json.id) : ''
      if (result.status === 200 && id) return { outcome: 'accepted', providerRef: id }
      return refused(
        result.status,
        String(result.json.message ?? `Mailgun refused it (${result.status}).`),
      )
    },
  }
}
/** A message id without its angle brackets, as Mailgun's receipts give it. */
const bare = (id: string) => id.trim().replace(/^<|>$/g, '')

/** Amazon SES, version 2. https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html */
export function sesProvider(config: {
  region: string
  keys: AwsKeys
  from: string
  /** An SES configuration set, for SES's own delivery events. */
  configurationSet?: string
  fetcher?: Fetch
  now?: () => Date
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  const now = config.now ?? (() => new Date())
  const url = `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`
  return {
    name: 'ses',
    live: true,
    channel: 'email',
    async send(message) {
      const headers = Object.entries(unsubscribeHeaders(message)).map(([Name, Value]) => ({
        Name,
        Value,
      }))
      const body = JSON.stringify({
        FromEmailAddress: fromLine(message, config.from),
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.body, Charset: 'UTF-8' },
              ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
            },
            ...(headers.length ? { Headers: headers } : {}),
          },
        },
        EmailTags: [
          { Name: 'outbox', Value: message.id },
          { Name: 'stream', Value: message.stream ?? 'transactional' },
        ],
        ...(config.configurationSet ? { ConfigurationSetName: config.configurationSet } : {}),
      })
      const signed = signAws({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body,
        region: config.region,
        service: 'ses',
        keys: config.keys,
        now: now(),
      })
      const result = await post(fetcher, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signed },
        body,
      })
      if (isResult(result)) return result
      if (result.status === 200 && typeof result.json.MessageId === 'string')
        return { outcome: 'accepted', providerRef: result.json.MessageId }
      return refused(
        result.status,
        String(
          result.json.message ?? result.json.Message ?? `Amazon SES refused it (${result.status}).`,
        ),
      )
    },
  }
}

/** The part of nodemailer's transport SALEANE uses, so tests can stand in for a mail server. */
export type SmtpTransport = {
  sendMail: (mail: Record<string, unknown>) => Promise<{ messageId?: string }>
}
type SmtpError = { code?: string; command?: string; responseCode?: number; response?: string }
/** Errors that come before the server has the message: trying again cannot send it twice. */
const BEFORE_MESSAGE = new Set(['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'])

/**
 * Any mail server that speaks SMTP: a studio's own Google Workspace (an app password with
 * smtp.gmail.com, or the SMTP relay), Microsoft 365 where password sign-in is still allowed, or
 * any other. Always encrypted: port 465 straight away, otherwise STARTTLS is required.
 */
export function smtpProvider(config: {
  host: string
  port: number
  user?: string
  password?: string
  from: string
  transport?: SmtpTransport
}): MessageProvider {
  const secure = config.port === 465
  const transport =
    config.transport ??
    (nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      requireTLS: !secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    }) as unknown as SmtpTransport)
  return {
    name: 'smtp',
    live: true,
    channel: 'email',
    async send(message) {
      const messageId = messageIdFor(message, config.from)
      try {
        await transport.sendMail({
          from: { name: displayName(message.fromName), address: config.from },
          to: message.to,
          subject: message.subject,
          text: message.body,
          ...(message.html ? { html: message.html } : {}),
          messageId,
          headers: unsubscribeHeaders(message),
          disableFileAccess: true,
          disableUrlAccess: true,
        })
        return { outcome: 'accepted', providerRef: bare(messageId) }
      } catch (caught) {
        return smtpFailure(caught as SmtpError)
      }
    },
  }
}
function smtpFailure(error: SmtpError): SendResult {
  if (error.code === 'EAUTH')
    return {
      outcome: 'failed',
      detail: 'The mail server refused SALEANE’s sign-in. Check the user name and password.',
      retry: false,
    }
  const code = error.responseCode
  if (code && code >= 400)
    return {
      outcome: 'failed',
      detail: `The mail server refused it: ${String(error.response ?? code).slice(0, 200)}`,
      // A 4xx reply means "not now"; the server did not take the message.
      retry: code < 500,
    }
  if (!error.command || BEFORE_MESSAGE.has(error.command))
    return { outcome: 'failed', detail: 'The mail server could not be reached.', retry: true }
  return {
    outcome: 'unknown',
    detail:
      'The connection dropped while the mail server had the message. Check before sending again.',
  }
}

/** A short-lived access token, fetched again a minute before it runs out. */
function tokenKeeper(fetchToken: () => Promise<{ token: string; seconds: number } | SendResult>) {
  let held: { token: string; until: number } | null = null
  return async (): Promise<string | SendResult> => {
    if (held && held.until > Date.now()) return held.token
    const got = await fetchToken()
    if (isResult(got)) return got
    held = { token: got.token, until: Date.now() + Math.max(0, got.seconds - 60) * 1000 }
    return got.token
  }
}
/** Asking for a token sends no email, so any failure here is safe to try again. */
function tokenFailure(result: SendResult | { status: number }, who: string): SendResult {
  if ('outcome' in result)
    return result.outcome === 'failed'
      ? result
      : { outcome: 'failed', detail: `${who} could not be reached.`, retry: true }
  return {
    outcome: 'failed',
    detail:
      result.status >= 500 || result.status === 429
        ? `${who} was busy. SALEANE will try again.`
        : `${who} refused SALEANE’s sign-in (${result.status}). Check its settings.`,
    retry: result.status >= 500 || result.status === 429,
  }
}
const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

/**
 * A Google Workspace mailbox through the Gmail API, with a service account the Workspace admin
 * has allowed to send as that address (domain-wide delegation, gmail.send only).
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
 */
export function googleProvider(config: {
  clientEmail: string
  privateKey: string
  from: string
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  // A key that cannot sign would fail every email after it was queued, so it stops the server now.
  let privateKey: ReturnType<typeof createPrivateKey>
  try {
    privateKey = createPrivateKey(config.privateKey)
  } catch {
    throw new Error(
      'The Google service account’s private key cannot be read. Paste its JSON key as it was downloaded.',
    )
  }
  const token = tokenKeeper(async () => {
    const at = Math.floor(Date.now() / 1000)
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64url(
      JSON.stringify({
        iss: config.clientEmail,
        sub: config.from,
        scope: 'https://www.googleapis.com/auth/gmail.send',
        aud: 'https://oauth2.googleapis.com/token',
        iat: at,
        exp: at + 3600,
      }),
    )
    const signature = createSign('RSA-SHA256')
      .update(`${head}.${claims}`)
      .sign(privateKey, 'base64url')
    const result = await post(fetcher, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${head}.${claims}.${signature}`,
      }).toString(),
    })
    if (isResult(result)) return tokenFailure(result, 'Google')
    if (result.status !== 200 || typeof result.json.access_token !== 'string')
      return tokenFailure(result, 'Google')
    return { token: result.json.access_token, seconds: Number(result.json.expires_in ?? 3600) }
  })
  return {
    name: 'google',
    live: true,
    channel: 'email',
    async send(message) {
      const access = await token()
      if (typeof access !== 'string') return access
      const raw = await mimeOf(message, config.from, messageIdFor(message, config.from))
      const result = await post(
        fetcher,
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: base64url(raw) }),
        },
      )
      if (isResult(result)) return result
      if (result.status === 200 && typeof result.json.id === 'string')
        return { outcome: 'accepted', providerRef: result.json.id }
      const error = result.json.error as
        { message?: unknown; errors?: { reason?: unknown }[] } | undefined
      const detail = String(error?.message ?? `Google refused it (${result.status}).`)
      // Gmail says "slow down" with a 403 as well as a 429, and asks for it to be tried again.
      // https://developers.google.com/workspace/gmail/api/guides/handle-errors
      const slowDown = (error?.errors ?? []).some(
        (each) => each?.reason === 'rateLimitExceeded' || each?.reason === 'userRateLimitExceeded',
      )
      if (result.status === 403 && slowDown) return { outcome: 'failed', detail, retry: true }
      return refused(result.status, detail)
    },
  }
}

/**
 * A Microsoft 365 mailbox through Microsoft Graph, with an app the studio's Microsoft admin
 * registered with the Mail.Send application permission (best limited to this one mailbox).
 * https://learn.microsoft.com/en-us/graph/api/user-sendmail
 */
export function microsoftProvider(config: {
  tenantId: string
  clientId: string
  clientSecret: string
  from: string
  fetcher?: Fetch
}): MessageProvider {
  const fetcher = config.fetcher ?? fetch
  const token = tokenKeeper(async () => {
    const result = await post(
      fetcher,
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      },
    )
    if (isResult(result)) return tokenFailure(result, 'Microsoft')
    if (result.status !== 200 || typeof result.json.access_token !== 'string')
      return tokenFailure(result, 'Microsoft')
    return { token: result.json.access_token, seconds: Number(result.json.expires_in ?? 3600) }
  })
  return {
    name: 'microsoft',
    live: true,
    channel: 'email',
    async send(message) {
      const access = await token()
      if (typeof access !== 'string') return access
      const messageId = messageIdFor(message, config.from)
      const raw = await mimeOf(message, config.from, messageId)
      const result = await post(
        fetcher,
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.from)}/sendMail`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'text/plain' },
          body: raw.toString('base64'),
        },
      )
      if (isResult(result)) return result
      // Graph answers 202 with no body: our own Message-ID is the reference.
      if (result.status === 202) return { outcome: 'accepted', providerRef: bare(messageId) }
      const error = result.json.error as { message?: unknown } | undefined
      return refused(
        result.status,
        String(error?.message ?? `Microsoft refused it (${result.status}).`),
      )
    },
  }
}

/** Receipts older than this are refused, so a captured one cannot be played back later. */
const RECEIPT_WINDOW_S = 5 * 60
const fresh = (seconds: number, now: number) =>
  Number.isFinite(seconds) && Math.abs(now / 1000 - seconds) <= RECEIPT_WINDOW_S
const parse = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/**
 * Resend's webhooks, signed the Svix way: base64 HMAC-SHA256 of "id.timestamp.body" with the
 * secret after its "whsec_". https://resend.com/docs/webhooks/verify-webhooks-requests
 */
export function resendReceipts(
  secret: string,
  request: ReceiptRequest,
  now = Date.now(),
): Receipt[] | null {
  const id = request.headers['svix-id'],
    stamp = request.headers['svix-timestamp'],
    given = request.headers['svix-signature']
  if (!id || !stamp || !given || !fresh(Number(stamp), now)) return null
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key)
    .update(`${id}.${stamp}.${request.body}`, 'utf8')
    .digest('base64')
  const genuine = given
    .split(' ')
    .some((part) => part.startsWith('v1,') && sameText(part.slice(3), expected))
  if (!genuine) return null
  const event = parse(request.body) as { type?: unknown; data?: { email_id?: unknown } } | undefined
  const ref = typeof event?.data?.email_id === 'string' ? event.data.email_id : ''
  if (!ref) return []
  if (event!.type === 'email.delivered')
    return [{ provider: 'resend', providerRef: ref, delivered: true }]
  // Each way Resend can end without delivering it. https://resend.com/docs/dashboard/webhooks/event-types
  const failures: Record<string, string> = {
    'email.bounced': 'The guest’s email provider sent it back (bounced).',
    'email.failed': 'Resend could not send it.',
    'email.suppressed':
      'Resend did not send it, as the address is on its suppression list after an earlier bounce or complaint.',
  }
  const failed = typeof event!.type === 'string' ? failures[event!.type] : undefined
  if (failed) return [{ provider: 'resend', providerRef: ref, delivered: false, detail: failed }]
  return []
}

/**
 * SendGrid's Event Webhook, signed with an elliptic-curve key: the signature covers the timestamp
 * followed by the body, and SendGrid shows the public key to check it with.
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
export function sendgridReceipts(
  publicKey: string,
  request: ReceiptRequest,
  now = Date.now(),
): Receipt[] | null {
  const given = request.headers['x-twilio-email-event-webhook-signature'],
    stamp = request.headers['x-twilio-email-event-webhook-timestamp']
  if (!given || !stamp || !fresh(Number(stamp), now)) return null
  const genuine = (() => {
    try {
      return verify(
        'sha256',
        Buffer.from(stamp + request.body, 'utf8'),
        { key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' },
        Buffer.from(given, 'base64'),
      )
    } catch {
      // A key or signature that cannot even be read proves nothing.
      return false
    }
  })()
  if (!genuine) return null
  const events = parse(request.body)
  if (!Array.isArray(events)) return []
  const receipts: Receipt[] = []
  for (const event of events as {
    event?: unknown
    sg_message_id?: unknown
    reason?: unknown
    outbox?: unknown
  }[]) {
    // SendGrid's event id is the X-Message-Id it answered with (which may hold dots), then
    // ".filter…" or ".stfilter-…". A bounce that comes back later may have no id, but carries the
    // outbox row SALEANE sent in custom_args.
    const ref =
      typeof event.sg_message_id === 'string' ? event.sg_message_id.split(/\.(?:st)?filter/)[0] : ''
    const outbox = typeof event.outbox === 'string' ? event.outbox : ''
    if (!ref && !outbox) continue
    const which = {
      provider: 'sendgrid',
      providerRef: ref,
      ...(outbox ? { outboxId: outbox } : {}),
    }
    if (event.event === 'delivered') receipts.push({ ...which, delivered: true })
    else if (event.event === 'bounce' || event.event === 'dropped')
      receipts.push({
        ...which,
        delivered: false,
        detail:
          event.event === 'bounce'
            ? 'The guest’s email provider sent it back (bounced).'
            : `SendGrid did not send it${typeof event.reason === 'string' ? `: ${event.reason.slice(0, 200)}` : '.'}`,
      })
  }
  return receipts
}

/**
 * Mailgun's webhooks: hex HMAC-SHA256 of the timestamp and token with the webhook signing key.
 * https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
 */
export function mailgunReceipts(
  signingKey: string,
  request: ReceiptRequest,
  now = Date.now(),
): Receipt[] | null {
  const event = parse(request.body) as
    | {
        signature?: { timestamp?: unknown; token?: unknown; signature?: unknown }
        'event-data'?: {
          event?: unknown
          severity?: unknown
          message?: { headers?: { 'message-id'?: unknown } }
          'delivery-status'?: { message?: unknown; description?: unknown }
        }
      }
    | undefined
  const { timestamp, token, signature } = event?.signature ?? {}
  if (typeof timestamp !== 'string' || typeof token !== 'string' || typeof signature !== 'string')
    return null
  if (!fresh(Number(timestamp), now)) return null
  const expected = createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex')
  if (!sameText(signature, expected)) return null
  const data = event!['event-data']
  const id = data?.message?.headers?.['message-id']
  const ref = typeof id === 'string' ? bare(id) : ''
  if (!ref) return []
  if (data!.event === 'delivered')
    return [{ provider: 'mailgun', providerRef: ref, delivered: true }]
  // A temporary failure is one Mailgun will try again itself.
  if (data!.event === 'failed' && data!.severity === 'permanent') {
    const why = data!['delivery-status']?.description || data!['delivery-status']?.message
    return [
      {
        provider: 'mailgun',
        providerRef: ref,
        delivered: false,
        detail: `The guest’s email provider refused it${typeof why === 'string' && why ? `: ${why.slice(0, 200)}` : '.'}`,
      },
    ]
  }
  return []
}

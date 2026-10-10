// @vitest-environment node
import { createHmac, createVerify, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  googleProvider,
  mailgunProvider,
  mailgunReceipts,
  microsoftProvider,
  mimeOf,
  resendProvider,
  resendReceipts,
  sendgridProvider,
  sendgridReceipts,
  sesProvider,
  smtpProvider,
} from './emailSenders'
import { postmarkProvider, providersFromEnv } from './providers'
import type { OutgoingMessage } from './providers'

// NEXT-13 part 2: every email sender, with each provider's answers simulated. No real account.
const message: OutgoingMessage = {
  id: 'out-1',
  channel: 'email',
  to: 'guest@example.invalid',
  subject: 'Your visit on Tuesday',
  body: 'See you on Tuesday.',
  html: '<p>See you on Tuesday.</p>',
  fromName: 'Linden "Studio"',
  stream: 'transactional',
}
const news: OutgoingMessage = {
  ...message,
  id: 'out-2',
  subject: 'Spring at Linden',
  stream: 'broadcast',
  unsubscribeUrl: 'https://studio.example.invalid/stop/abc',
}
type Call = { url: string; init: RequestInit }
/** A pretend provider: records each request and gives back the answers in turn. */
function provider(...answers: (Response | Error)[]) {
  const calls: Call[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = answers.shift() ?? new Response('{}', { status: 500 })
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { calls, fetcher }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as Record<string, unknown>
const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)
const dropped = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
const unreachable = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })

describe('Resend', () => {
  it('sends the plain and designed email, with one-click unsubscribe for news', async () => {
    const { calls, fetcher } = provider(json({ id: 're-1' }), json({ id: 're-2' }))
    const sender = resendProvider({ apiKey: 're_key', from: 'hello@example.invalid', fetcher })
    expect(await sender.send(message)).toEqual({ outcome: 'accepted', providerRef: 're-1' })
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect(header(calls[0], 'authorization')).toBe('Bearer re_key')
    expect(bodyOf(calls[0])).toEqual({
      from: '"Linden Studio" <hello@example.invalid>',
      to: ['guest@example.invalid'],
      subject: 'Your visit on Tuesday',
      text: 'See you on Tuesday.',
      html: '<p>See you on Tuesday.</p>',
      headers: {},
      tags: [
        { name: 'outbox', value: 'out-1' },
        { name: 'stream', value: 'transactional' },
      ],
    })
    await sender.send(news)
    expect(bodyOf(calls[1]).headers).toEqual({
      'List-Unsubscribe': '<https://studio.example.invalid/stop/abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })
  it('tries again only when Resend is busy, and leaves a dropped line for a person', async () => {
    const { fetcher } = provider(
      json({ message: 'Too many requests' }, 429),
      json({ message: 'The from address is not verified.' }, 403),
      dropped(),
      unreachable(),
    )
    const sender = resendProvider({ apiKey: 'k', from: 'f@example.invalid', fetcher })
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Too many requests',
      retry: true,
    })
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'The from address is not verified.',
      retry: false,
    })
    expect((await sender.send(message)).outcome).toBe('unknown')
    expect(await sender.send(message)).toMatchObject({ outcome: 'failed', retry: true })
  })
})

describe('SendGrid', () => {
  it('sends both parts and takes the X-Message-Id it answers with', async () => {
    const { calls, fetcher } = provider(
      new Response(null, { status: 202, headers: { 'X-Message-Id': 'sg-1' } }),
      new Response(null, { status: 202 }),
      json({ errors: [{ message: 'The from address does not match a verified Sender.' }] }, 403),
    )
    const sender = sendgridProvider({ apiKey: 'SG.key', from: 'hello@example.invalid', fetcher })
    expect(await sender.send(news)).toEqual({ outcome: 'accepted', providerRef: 'sg-1' })
    expect(calls[0].url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect(header(calls[0], 'authorization')).toBe('Bearer SG.key')
    expect(bodyOf(calls[0])).toEqual({
      personalizations: [{ to: [{ email: 'guest@example.invalid' }] }],
      from: { email: 'hello@example.invalid', name: 'Linden Studio' },
      subject: 'Spring at Linden',
      content: [
        { type: 'text/plain', value: 'See you on Tuesday.' },
        { type: 'text/html', value: '<p>See you on Tuesday.</p>' },
      ],
      headers: {
        'List-Unsubscribe': '<https://studio.example.invalid/stop/abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      custom_args: { outbox: 'out-2' },
      categories: ['broadcast'],
    })
    // Taken, but with nothing to match a receipt to: a person checks before sending again.
    expect((await sender.send(message)).outcome).toBe('unknown')
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'The from address does not match a verified Sender.',
      retry: false,
    })
    const eu = provider(new Response(null, { status: 202, headers: { 'X-Message-Id': 'x' } }))
    await sendgridProvider({
      apiKey: 'k',
      from: 'f@example.invalid',
      eu: true,
      fetcher: eu.fetcher,
    }).send(message)
    expect(eu.calls[0].url).toBe('https://api.eu.sendgrid.com/v3/mail/send')
  })
})

describe('Mailgun', () => {
  it('posts a form to the domain, in the EU when asked, and keeps the bare message id', async () => {
    const { calls, fetcher } = provider(
      json({ id: '<20261010.1@mg.example.invalid>', message: 'Queued. Thank you.' }),
      json({ message: 'Domain not found' }, 404),
    )
    const sender = mailgunProvider({
      apiKey: 'key-1',
      domain: 'mg.example.invalid',
      from: 'hello@example.invalid',
      eu: true,
      fetcher,
    })
    expect(await sender.send(news)).toEqual({
      outcome: 'accepted',
      providerRef: '20261010.1@mg.example.invalid',
    })
    expect(calls[0].url).toBe('https://api.eu.mailgun.net/v3/mg.example.invalid/messages')
    expect(header(calls[0], 'authorization')).toBe(
      `Basic ${Buffer.from('api:key-1').toString('base64')}`,
    )
    const form = calls[0].init.body as FormData
    expect(Object.fromEntries(form.entries())).toEqual({
      from: '"Linden Studio" <hello@example.invalid>',
      to: 'guest@example.invalid',
      subject: 'Spring at Linden',
      text: 'See you on Tuesday.',
      html: '<p>See you on Tuesday.</p>',
      'h:List-Unsubscribe': '<https://studio.example.invalid/stop/abc>',
      'h:List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'v:outbox': 'out-2',
      'o:tag': 'broadcast',
    })
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Domain not found',
      retry: false,
    })
  })
})

describe('Amazon SES', () => {
  it('signs each request for SES in its region and reads the MessageId', async () => {
    const { calls, fetcher } = provider(
      json({ MessageId: 'ses-1' }),
      json({ message: 'Email address is not verified.' }, 400),
    )
    const sender = sesProvider({
      region: 'eu-west-2',
      keys: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'example-secret' },
      from: 'hello@example.invalid',
      configurationSet: 'saleane',
      fetcher,
      now: () => new Date('2026-10-10T09:00:00Z'),
    })
    expect(await sender.send(news)).toEqual({ outcome: 'accepted', providerRef: 'ses-1' })
    expect(calls[0].url).toBe('https://email.eu-west-2.amazonaws.com/v2/email/outbound-emails')
    expect(header(calls[0], 'x-amz-date')).toBe('20261010T090000Z')
    expect(header(calls[0], 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261010\/eu-west-2\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    )
    expect(bodyOf(calls[0])).toEqual({
      FromEmailAddress: '"Linden Studio" <hello@example.invalid>',
      Destination: { ToAddresses: ['guest@example.invalid'] },
      Content: {
        Simple: {
          Subject: { Data: 'Spring at Linden', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'See you on Tuesday.', Charset: 'UTF-8' },
            Html: { Data: '<p>See you on Tuesday.</p>', Charset: 'UTF-8' },
          },
          Headers: [
            { Name: 'List-Unsubscribe', Value: '<https://studio.example.invalid/stop/abc>' },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
        },
      },
      EmailTags: [
        { Name: 'outbox', Value: 'out-2' },
        { Name: 'stream', Value: 'broadcast' },
      ],
      ConfigurationSetName: 'saleane',
    })
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Email address is not verified.',
      retry: false,
    })
  })
})

describe('any mail server (SMTP)', () => {
  it('hands the whole email to the server, with our own Message-ID as the reference', async () => {
    const mails: Record<string, unknown>[] = []
    const sender = smtpProvider({
      host: 'smtp.example.invalid',
      port: 587,
      from: 'hello@example.invalid',
      transport: { sendMail: async (mail) => (mails.push(mail), { messageId: 'x' }) },
    })
    expect(await sender.send(news)).toEqual({
      outcome: 'accepted',
      providerRef: 'out-2@example.invalid',
    })
    expect(mails[0]).toMatchObject({
      from: { name: 'Linden Studio', address: 'hello@example.invalid' },
      to: 'guest@example.invalid',
      text: 'See you on Tuesday.',
      html: '<p>See you on Tuesday.</p>',
      messageId: '<out-2@example.invalid>',
      headers: {
        'List-Unsubscribe': '<https://studio.example.invalid/stop/abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  })
  it('tries again only when the server did not take the message', async () => {
    const failing = (error: Record<string, unknown>) =>
      smtpProvider({
        host: 'smtp.example.invalid',
        port: 465,
        from: 'hello@example.invalid',
        transport: {
          sendMail: async () => {
            throw Object.assign(new Error('smtp'), error)
          },
        },
      }).send(message)
    expect(
      await failing({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }),
    ).toMatchObject({ outcome: 'failed', retry: false, detail: expect.stringContaining('sign-in') })
    expect(
      await failing({
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 450,
        response: '450 busy',
      }),
    ).toMatchObject({ outcome: 'failed', retry: true })
    expect(
      await failing({ code: 'EMESSAGE', command: 'DATA', responseCode: 550, response: '550 spam' }),
    ).toMatchObject({ outcome: 'failed', retry: false })
    expect(await failing({ code: 'ECONNECTION', command: 'CONN' })).toMatchObject({
      outcome: 'failed',
      retry: true,
    })
    expect(await failing({ code: 'ETIMEDOUT' })).toMatchObject({ outcome: 'failed', retry: true })
    // The line dropped after the message was handed over: it may have gone.
    expect((await failing({ code: 'ESOCKET', command: 'DATA' })).outcome).toBe('unknown')
  })
})

describe('the email as one MIME message', () => {
  it('carries both parts, the studio as sender and the unsubscribe headers', async () => {
    const raw = (await mimeOf(news, 'hello@example.invalid', '<out-2@example.invalid>')).toString()
    expect(raw).toMatch(/^From: Linden Studio <hello@example\.invalid>\r?$/m)
    expect(raw).toMatch(/^To: guest@example\.invalid\r?$/m)
    expect(raw).toMatch(/^Message-ID: <out-2@example\.invalid>\r?$/m)
    expect(raw).toMatch(/^List-Unsubscribe: <https:\/\/studio\.example\.invalid\/stop\/abc>\r?$/m)
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click\r?$/m)
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('text/plain')
    expect(raw).toContain('text/html')
    const plain = (await mimeOf(message, 'hello@example.invalid', '<out-1@x>')).toString()
    expect(plain).not.toContain('List-Unsubscribe')
  })
})

describe('Google Workspace', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  it('signs in as the service account for the sending address, then sends through Gmail', async () => {
    const { calls, fetcher } = provider(
      json({ access_token: 'ya29.token', expires_in: 3600 }),
      json({ id: 'gm-1', threadId: 't-1' }),
      json({ id: 'gm-2', threadId: 't-2' }),
    )
    const sender = googleProvider({
      clientEmail: 'saleane@project.iam.gserviceaccount.com',
      privateKey: pem,
      from: 'hello@example.invalid',
      fetcher,
    })
    expect(await sender.send(news)).toEqual({ outcome: 'accepted', providerRef: 'gm-1' })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(String(calls[0].init.body))
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [head, claims, signature] = form.get('assertion')!.split('.')
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: 'saleane@project.iam.gserviceaccount.com',
      sub: 'hello@example.invalid',
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
    })
    expect(
      createVerify('RSA-SHA256')
        .update(`${head}.${claims}`)
        .verify(publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true)
    expect(calls[1].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(header(calls[1], 'authorization')).toBe('Bearer ya29.token')
    const raw = Buffer.from(String(bodyOf(calls[1]).raw), 'base64url').toString()
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click')
    expect(raw).toContain('Subject: Spring at Linden')
    // The token is used again until it nearly runs out.
    expect(await sender.send(message)).toEqual({ outcome: 'accepted', providerRef: 'gm-2' })
    expect(calls).toHaveLength(3)
  })
  it('sends nothing when Google refuses the sign-in, and says so', async () => {
    const { calls, fetcher } = provider(json({ error: 'unauthorized_client' }, 401))
    const sender = googleProvider({
      clientEmail: 'a@b.invalid',
      privateKey: pem,
      from: 'hello@example.invalid',
      fetcher,
    })
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Google refused SALEANE’s sign-in (401). Check its settings.',
      retry: false,
    })
    expect(calls).toHaveLength(1)
  })
})

describe('Microsoft 365', () => {
  it('signs in as the studio’s app, then sends the MIME message through Graph', async () => {
    const { calls, fetcher } = provider(
      json({ access_token: 'eyJ.token', expires_in: 3599 }),
      new Response(null, { status: 202 }),
      json({ error: { message: 'Access is denied.' } }, 403),
      dropped(),
    )
    const sender = microsoftProvider({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      from: 'hello@example.invalid',
      fetcher,
    })
    expect(await sender.send(news)).toEqual({
      outcome: 'accepted',
      providerRef: 'out-2@example.invalid',
    })
    expect(calls[0].url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({
      client_id: 'client-1',
      client_secret: 'secret-1',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    })
    expect(calls[1].url).toBe(
      'https://graph.microsoft.com/v1.0/users/hello%40example.invalid/sendMail',
    )
    expect(header(calls[1], 'content-type')).toBe('text/plain')
    const raw = Buffer.from(String(calls[1].init.body), 'base64').toString()
    expect(raw).toContain('Message-ID: <out-2@example.invalid>')
    expect(raw).toContain('List-Unsubscribe: <https://studio.example.invalid/stop/abc>')
    expect(await sender.send(message)).toEqual({
      outcome: 'failed',
      detail: 'Access is denied.',
      retry: false,
    })
    expect((await sender.send(message)).outcome).toBe('unknown')
  })
})

describe('delivery receipts', () => {
  const now = Date.parse('2026-10-10T09:00:00Z')
  const stamp = String(now / 1000)
  it('reads Resend’s receipts only when Svix’s signature holds and is recent', () => {
    const secret = `whsec_${Buffer.from('resend-webhook-secret').toString('base64')}`
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 're-1' } })
    const signed = (text: string, at = stamp) =>
      `v1,${createHmac('sha256', Buffer.from('resend-webhook-secret')).update(`msg_1.${at}.${text}`).digest('base64')}`
    const read = (text: string, signature: string, at = stamp) =>
      resendReceipts(
        secret,
        {
          url: '',
          headers: { 'svix-id': 'msg_1', 'svix-timestamp': at, 'svix-signature': signature },
          body: text,
        },
        now,
      )
    expect(read(body, `v1,forged ${signed(body)}`)).toEqual([
      { provider: 'resend', providerRef: 're-1', delivered: true },
    ])
    expect(read(body, 'v1,forged')).toBeNull()
    const old = String(now / 1000 - 600)
    expect(read(body, signed(body, old), old)).toBeNull()
    const bounced = JSON.stringify({ type: 'email.bounced', data: { email_id: 're-2' } })
    expect(read(bounced, signed(bounced))).toEqual([
      {
        provider: 'resend',
        providerRef: 're-2',
        delivered: false,
        detail: 'The guest’s email provider sent it back (bounced).',
      },
    ])
    const opened = JSON.stringify({ type: 'email.opened', data: { email_id: 're-3' } })
    expect(read(opened, signed(opened))).toEqual([])
  })

  it('reads SendGrid’s receipts only with its elliptic-curve signature', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const body = JSON.stringify([
      { event: 'processed', sg_message_id: 'sg-1.filter0001.1.2' },
      { event: 'delivered', sg_message_id: 'sg-1.filter0001.1.2' },
      { event: 'bounce', sg_message_id: 'sg-2.filter0002.3.4', reason: '550 no such user' },
      { event: 'dropped', sg_message_id: 'sg-3.filter0003.5.6', reason: 'Unsubscribed Address' },
    ])
    const signature = sign('sha256', Buffer.from(stamp + body), privateKey).toString('base64')
    const read = (text: string, given: string) =>
      sendgridReceipts(
        key,
        {
          url: '',
          headers: {
            'x-twilio-email-event-webhook-signature': given,
            'x-twilio-email-event-webhook-timestamp': stamp,
          },
          body: text,
        },
        now,
      )
    expect(read(body, signature)).toEqual([
      { provider: 'sendgrid', providerRef: 'sg-1', delivered: true },
      {
        provider: 'sendgrid',
        providerRef: 'sg-2',
        delivered: false,
        detail: 'The guest’s email provider sent it back (bounced).',
      },
      {
        provider: 'sendgrid',
        providerRef: 'sg-3',
        delivered: false,
        detail: 'SendGrid did not send it: Unsubscribed Address',
      },
    ])
    expect(read(body.replace('sg-1', 'sg-9'), signature)).toBeNull()
    expect(read(body, 'bm90IGEgc2lnbmF0dXJl')).toBeNull()
  })

  it('reads Mailgun’s receipts only with its signing key, and leaves its own retries to it', () => {
    const event = (data: Record<string, unknown>, key = 'mailgun-signing-key', at = stamp) => {
      const token = 'token-1'
      return JSON.stringify({
        signature: {
          timestamp: at,
          token,
          signature: createHmac('sha256', key)
            .update(at + token)
            .digest('hex'),
        },
        'event-data': data,
      })
    }
    const read = (body: string) =>
      mailgunReceipts('mailgun-signing-key', { url: '', headers: {}, body }, now)
    const message = { headers: { 'message-id': '20261010.1@mg.example.invalid' } }
    expect(read(event({ event: 'delivered', message }))).toEqual([
      { provider: 'mailgun', providerRef: '20261010.1@mg.example.invalid', delivered: true },
    ])
    expect(read(event({ event: 'delivered', message }, 'wrong-key'))).toBeNull()
    expect(
      read(event({ event: 'delivered', message }, undefined, String(now / 1000 - 3600))),
    ).toBeNull()
    expect(read(event({ event: 'failed', severity: 'temporary', message }))).toEqual([])
    expect(
      read(
        event({
          event: 'failed',
          severity: 'permanent',
          message,
          'delivery-status': { description: 'No such mailbox' },
        }),
      ),
    ).toEqual([
      {
        provider: 'mailgun',
        providerRef: '20261010.1@mg.example.invalid',
        delivered: false,
        detail: 'The guest’s email provider refused it: No such mailbox',
      },
    ])
  })
})

describe('choosing the sender', () => {
  const base = { SALEANE_EMAIL_FROM: 'hello@example.invalid' }
  it('needs every key for the sender named, and names what is missing', () => {
    const missing: [string, string][] = [
      ['resend', 'Set RESEND_API_KEY to send real messages.'],
      ['sendgrid', 'Set SENDGRID_API_KEY to send real messages.'],
      ['mailgun', 'Set MAILGUN_API_KEY and MAILGUN_DOMAIN to send real messages.'],
      [
        'ses',
        'Set AWS_REGION and AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to send real messages.',
      ],
      ['smtp', 'Set SMTP_HOST to send real messages.'],
      ['google', 'Set GOOGLE_SERVICE_ACCOUNT_JSON to send real messages.'],
      [
        'microsoft',
        'Set MICROSOFT_TENANT_ID and MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to send real messages.',
      ],
    ]
    for (const [name, error] of missing)
      expect(() => providersFromEnv({ ...base, SALEANE_EMAIL_PROVIDER: name })).toThrow(error)
    expect(() =>
      providersFromEnv({
        ...base,
        SALEANE_EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_USER: 'hello@example.invalid',
      }),
    ).toThrow('Set SMTP_PASSWORD')
    expect(() =>
      providersFromEnv({
        ...base,
        SALEANE_EMAIL_PROVIDER: 'google',
        GOOGLE_SERVICE_ACCOUNT_JSON: 'not json',
      }),
    ).toThrow('GOOGLE_SERVICE_ACCOUNT_JSON must be the service account’s JSON key.')
    expect(() => providersFromEnv({ ...base, SALEANE_EMAIL_PROVIDER: 'pigeon' })).toThrow(
      'Unknown email provider "pigeon".',
    )
  })

  it('starts the sender named, live, and checks only its own receipts', () => {
    const chosen = (env: Record<string, string>) => providersFromEnv({ ...base, ...env }).email.name
    expect(chosen({ SALEANE_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' })).toBe('resend')
    expect(chosen({ SALEANE_EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'k' })).toBe('sendgrid')
    expect(
      chosen({ SALEANE_EMAIL_PROVIDER: 'mailgun', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'd' }),
    ).toBe('mailgun')
    expect(
      chosen({
        SALEANE_EMAIL_PROVIDER: 'ses',
        AWS_REGION: 'eu-west-2',
        AWS_ACCESS_KEY_ID: 'a',
        AWS_SECRET_ACCESS_KEY: 's',
      }),
    ).toBe('ses')
    expect(chosen({ SALEANE_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.invalid' })).toBe(
      'smtp',
    )
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(
      chosen({
        SALEANE_EMAIL_PROVIDER: 'google',
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: 'a@b.invalid',
          private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        }),
      }),
    ).toBe('google')
    expect(
      chosen({
        SALEANE_EMAIL_PROVIDER: 'microsoft',
        MICROSOFT_TENANT_ID: 't',
        MICROSOFT_CLIENT_ID: 'c',
        MICROSOFT_CLIENT_SECRET: 's',
      }),
    ).toBe('microsoft')
    const providers = providersFromEnv({
      ...base,
      SALEANE_EMAIL_PROVIDER: 'mailgun',
      MAILGUN_API_KEY: 'k',
      MAILGUN_DOMAIN: 'd',
      MAILGUN_WEBHOOK_SIGNING_KEY: 'signing',
    })
    expect(providers.email.live).toBe(true)
    // A receipt for a sender SALEANE is not using is never believed.
    expect(providers.receipt('resend', { url: '', headers: {}, body: '{}' })).toBeNull()
    expect(providers.receipt('mailgun', { url: '', headers: {}, body: '{}' })).toBeNull()
    expect(
      providersFromEnv({ ...base, SALEANE_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }).receipt(
        'resend',
        { url: '', headers: {}, body: '{}' },
      ),
    ).toBeNull()
  })

  it('adds one-click unsubscribe to Postmark news too', async () => {
    const { calls, fetcher } = provider(json({ ErrorCode: 0, MessageID: 'pm-1' }))
    await postmarkProvider({
      token: 't',
      from: 'hello@example.invalid',
      broadcastStream: 'broadcasts',
      fetcher,
    }).send(news)
    expect(bodyOf(calls[0]).Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://studio.example.invalid/stop/abc>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })
})

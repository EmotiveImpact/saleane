// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { providersFromEnv, twilioSignature } from './messaging/providers'
import type { MessageProvider, OutgoingMessage } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// V1.5: the inbox through the server. Approved messages go out once; replies come in verified.
const origin = 'http://127.0.0.1:5173'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
let sent: OutgoingMessage[]

function recording(channel: 'email' | 'sms'): MessageProvider {
  return {
    name: channel === 'email' ? 'postmark' : 'twilio',
    live: true,
    channel,
    send: async (message) => {
      // Account emails (NEXT-03) are tested in accountMail.test.ts.
      if (message.fromName === 'SALEANE') return { outcome: 'test' }
      sent.push(message)
      return { outcome: 'accepted', providerRef: `ref-${sent.length}` }
    },
  }
}
beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: {
      email: recording('email'),
      sms: recording('sms'),
      receipt: () => null,
      // Stands in for each provider's own check, which is tested on its own below.
      inbound: (provider, _slug, request) => {
        if (request.headers['x-test-signature'] !== 'good') return null
        const form = new URLSearchParams(request.body)
        return [
          {
            from: form.get('From') ?? '',
            body: form.get('Body') ?? '',
            providerRef: `${provider}-${form.get('Ref')}`,
          },
        ]
      },
    },
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample: false },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
async function run(login: Login, command: Command) {
  const { state } = await workspace(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
const rows = () => api.database.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at')
const client = (owner: Login) =>
  run(owner, {
    type: 'client',
    contact: {
      name: 'Rosa Field',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: false,
    },
  })

describe('the inbox through the server', () => {
  it('sends an approved message once, by the channel chosen, and lists it against the message', async () => {
    const owner = await register()
    const clientId = await client(owner)
    const messageId = await run(owner, {
      type: 'message',
      input: {
        clientId,
        purpose: 'appointment',
        channel: 'sms',
        subject: 'Your visit',
        body: 'We can see you at 10:30 on Thursday.',
      },
    })
    await api.outbox.tick()
    expect(sent).toEqual([])
    await run(owner, { type: 'message-queue', messageId })
    await api.outbox.tick()
    await api.outbox.tick()
    expect(sent.map((m) => [m.channel, m.to, m.body])).toEqual([
      ['sms', '+447700900456', 'We can see you at 10:30 on Thursday.'],
    ])
    expect(rows()).toMatchObject([{ kind: 'message', status: 'accepted', client_id: clientId }])
    const listed = await api.inject({
      url: `/api/workspaces/${owner.orgId}/outbox`,
      headers: headers(owner),
    })
    expect(listed.json<{ messages: { messageId?: string }[] }>().messages[0].messageId).toBe(
      messageId,
    )
  })

  it('does not send email news once the guest has stopped it', async () => {
    const owner = await register()
    const clientId = await client(owner)
    await run(owner, { type: 'consent', clientId, consent: true })
    const messageId = await run(owner, {
      type: 'message',
      input: { clientId, purpose: 'marketing', subject: 'Autumn', body: 'Autumn news.' },
    })
    await run(owner, { type: 'message-queue', messageId })
    await run(owner, { type: 'consent', clientId, consent: false })
    await api.outbox.tick()
    expect(sent).toEqual([])
  })

  it('keeps a verified reply from the text line with the guest, once', async () => {
    const owner = await register()
    const clientId = await client(owner)
    const { slug } = await workspace(owner)
    const hook = (signature: string, form: Record<string, string>, path = `twilio/sms/${slug}`) =>
      api.inject({
        method: 'POST',
        url: `/api/hooks/${path}`,
        headers: {
          'x-test-signature': signature,
          origin: 'https://api.twilio.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        rawPayload: new URLSearchParams(form).toString(),
      })
    const text = { From: '+447700900456', Body: 'Thursday is perfect, thank you.', Ref: '1' }
    expect((await hook('forged', text)).statusCode).toBe(403)
    const answer = await hook('good', text)
    expect(answer.statusCode).toBe(200)
    expect(answer.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>')
    await hook('good', text)
    expect((await hook('good', text, 'twilio/sms/no-such-studio')).statusCode).toBe(200)
    const email = await hook(
      'good',
      { From: 'stranger@example.invalid', Body: 'Do you open on Sundays?', Ref: '2' },
      `postmark/inbound/${slug}`,
    )
    expect(email.json()).toEqual({ ok: true })
    const { state } = await workspace(owner)
    expect(state.replies).toMatchObject([
      {
        clientId,
        channel: 'sms',
        body: 'Thursday is perfect, thank you.',
        actor: 'Text line',
        providerRef: 'twilio-1',
      },
      { channel: 'email', from: 'stranger@example.invalid', actor: 'Email line' },
    ])
    expect(state.replies![1].clientId).toBeUndefined()
  })

  it('reads a reply only with a genuine Twilio signature or Postmark secret', () => {
    const providers = providersFromEnv(
      {
        SALEANE_SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'secret',
        TWILIO_FROM: 'MG123',
        SALEANE_EMAIL_PROVIDER: 'postmark',
        POSTMARK_SERVER_TOKEN: 'token',
        SALEANE_EMAIL_FROM: 'hello@studio.example.invalid',
        POSTMARK_WEBHOOK_SECRET: 'hook-secret',
      },
      'https://studio.example.invalid',
    )
    const body = new URLSearchParams({
      From: '+447700900456',
      Body: 'Yes please',
      MessageSid: 'SM1',
    })
    const signature = twilioSignature(
      'secret',
      'https://studio.example.invalid/api/hooks/twilio/sms/linden',
      body,
    )
    const text = (slug: string, sig: string) =>
      providers.inbound!('twilio', slug, {
        url: '',
        headers: { 'x-twilio-signature': sig },
        body: body.toString(),
      })
    expect(text('linden', signature)).toEqual([
      { from: '+447700900456', body: 'Yes please', providerRef: 'SM1' },
    ])
    expect(text('another-studio', signature)).toBeNull()
    expect(text('linden', 'forged')).toBeNull()
    const email = (secret: string) =>
      providers.inbound!('postmark', 'linden', {
        url: '',
        headers: { authorization: `Basic ${Buffer.from(`user:${secret}`).toString('base64')}` },
        body: JSON.stringify({
          FromFull: { Email: 'rosa@example.invalid' },
          MessageID: 'pm-1',
          TextBody: 'Yes please\n\nOn Tuesday, the studio wrote: ...',
          StrippedTextReply: 'Yes please',
        }),
      })
    expect(email('hook-secret')).toEqual([
      { from: 'rosa@example.invalid', body: 'Yes please', providerRef: 'pm-1' },
    ])
    expect(email('wrong')).toBeNull()
    expect(
      providersFromEnv({}).inbound!('twilio', 'linden', { url: '', headers: {}, body: '' }),
    ).toBeNull()
  })
})

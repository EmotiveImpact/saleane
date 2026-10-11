// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { testProvider } from './messaging/providers'
import type { MessageProvider, OutgoingMessage, Providers } from './messaging/providers'
import type { OutboxRow } from './messaging/outbox'

// Stage 1: STOP and START replies to the studio's text line, through the server.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const ROSA = '+447700900456'
const STRANGER = '+447700900999'
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
/** A server whose text line is live (recorded here) or, with `smsTest`, in test mode. */
function serve(smsTest = false) {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  sent = []
  const providers: Providers = {
    email: recording('email'),
    sms: smsTest ? testProvider('sms') : recording('sms'),
    receipt: () => null,
    // Stand in for Twilio's own signature checks, which providers tests cover.
    inbound: (provider, _slug, request) => {
      const form = new URLSearchParams(request.body)
      return [
        {
          from: form.get('From') ?? '',
          body: form.get('Body') ?? '',
          providerRef: `${provider}-${form.get('Ref')}`,
        },
      ]
    },
    voice: (_slug, request) => {
      const form = new URLSearchParams(request.body)
      return { from: form.get('From') ?? '', missed: true }
    },
  }
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers,
  })
}
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, extra: Record<string, unknown>, name = 'Ada Owner') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email, password, ...extra },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
async function command(login: Login, cmd: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command: cmd },
  })
}
async function run(login: Login, cmd: Command) {
  const response = await command(login, cmd)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
let serviceId = ''
let staffId = ''
let rosaId = ''
let saraId = ''
/** A studio of its own with the AI receptionist answering texts, and Rosa and her sister Sara. */
async function studio(sample = false) {
  const owner = await register('owner@example.invalid', {
    workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
  })
  if (sample) return { owner, slug: (await workspace(owner)).slug }
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 0,
      resourceType: 'treatment',
    },
  })
  staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  rosaId = await run(owner, {
    type: 'client',
    contact: {
      name: 'Rosa Field',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: true,
    },
  })
  saraId = await run(owner, {
    type: 'client',
    contact: {
      name: 'Sara Field',
      email: 'sara@example.invalid',
      phone: '+44 7700 900456',
      marketingConsent: false,
    },
  })
  const { name, locationName, address, timeZone } = (await workspace(owner)).state.organisation
  await run(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  await run(owner, {
    type: 'receptionist',
    settings: { enabled: true, handOver: true, texts: true },
  })
  return { owner, slug: (await workspace(owner)).slug }
}
let ref = 0
const text = (slug: string, body: string, from = ROSA, same?: string) =>
  api.inject({
    method: 'POST',
    url: `/api/hooks/twilio/sms/${slug}`,
    headers: {
      origin: 'https://api.twilio.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    rawPayload: new URLSearchParams({
      From: from,
      Body: body,
      Ref: same ?? String(++ref),
    }).toString(),
  })
const rows = (kind?: string) =>
  api.database.all<OutboxRow>(
    `SELECT * FROM outbox WHERE ${kind ? 'kind=?' : '1=1'} ORDER BY created_at,rowid`,
    ...(kind ? [kind] : []),
  )
const toNumber = (number: string) => rows().filter((r) => r.recipient === number)
const clientOf = async (login: Login, id: string) =>
  (await workspace(login)).state.clients.find((c) => c.id === id)!

describe('STOP and START by text, through the server', () => {
  it('turns texts off for everyone on the number, answers nothing and keeps it once', async () => {
    serve()
    const { owner, slug } = await studio()
    await text(slug, 'When are you open?')
    expect(rows('receptionist')).toHaveLength(1)
    clock += 2 * 60000
    expect((await text(slug, 'Stop', ROSA, 'stop-1')).statusCode).toBe(200)
    // The provider tries again: still one reply, one record, no answer.
    expect((await text(slug, 'Stop', ROSA, 'stop-1')).statusCode).toBe(200)
    const { state } = await workspace(owner)
    const stops = state.replies!.filter((r) => r.body === 'Stop')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ keyword: 'stop', readBy: 'Text line' })
    expect(state.events.filter((e) => e.title === 'Texts turned off')).toHaveLength(2)
    for (const id of [rosaId, saraId])
      expect(state.clients.find((c) => c.id === id)).toMatchObject({ noTextReminders: true })
    expect(state.clients.find((c) => c.id === rosaId)?.marketingConsent).toBe(true)
    expect(rows('receptionist')).toHaveLength(1)
    // An ordinary question afterwards waits for the team: nothing is texted to the number.
    clock += 2 * 60000
    await text(slug, 'Can I still book on Friday?')
    expect(rows('receptionist')).toHaveLength(1)
    // A visit booked now is confirmed by email only.
    await run(owner, {
      type: 'book',
      input: {
        serviceId,
        staffId,
        date: '2026-10-08',
        startMinutes: 600,
        clientId: rosaId,
        source: 'desk',
      },
    })
    await api.outbox.tick()
    expect(rows('confirmation').map((r) => r.channel)).toEqual(['email'])
    // Even the answer written before the STOP did not go: nothing was texted to the number.
    expect(rows('receptionist')).toMatchObject([{ status: 'skipped' }])
    expect(sent.filter((m) => m.to === ROSA)).toEqual([])
  })

  it('refuses at the last moment a text queued before the number said STOP', async () => {
    serve()
    const { slug } = await studio()
    // A caller the studio does not know asks something; the answer waits in the outbox.
    await text(slug, 'Do you have time on Friday?', STRANGER)
    expect(toNumber(STRANGER)).toMatchObject([{ kind: 'receptionist', status: 'pending' }])
    clock += 60000
    await text(slug, 'STOP', STRANGER)
    await api.outbox.tick()
    expect(toNumber(STRANGER)).toMatchObject([
      {
        status: 'skipped',
        detail: 'This number replied STOP, so SALEANE does not text it until they text START.',
      },
    ])
    expect(sent).toEqual([])
  })

  it('sends no missed-call text to a number that replied STOP, until it texts START', async () => {
    serve()
    const { owner, slug } = await studio()
    await run(owner, {
      type: 'reminders',
      settings: {
        confirmations: true,
        reminders: true,
        hoursBefore: 24,
        email: true,
        sms: true,
        missedCall: true,
      },
    })
    const ring = () =>
      api.inject({
        method: 'POST',
        url: `/api/hooks/twilio/voice/${slug}`,
        headers: {
          origin: 'https://api.twilio.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        rawPayload: new URLSearchParams({ From: STRANGER }).toString(),
      })
    await text(slug, 'STOP', STRANGER)
    await ring()
    await api.outbox.tick()
    expect(rows('missed_call')).toEqual([])
    // After START, the next missed call is texted back once.
    clock += 5 * 60000
    await text(slug, 'START', STRANGER)
    const kept = (await workspace(owner)).state.replies!.at(-1)!
    expect(kept).toMatchObject({ keyword: 'start' })
    expect((await workspace(owner)).state.textStops![0].startedAt).toBeDefined()
    await ring()
    await api.outbox.tick()
    expect(rows('missed_call')).toMatchObject([{ status: 'accepted', recipient: STRANGER }])
    // START is never answered by the AI receptionist.
    expect(rows('receptionist')).toEqual([])
  })

  it('turns texts back on with START, and HELP gets no automatic answer', async () => {
    serve()
    const { owner, slug } = await studio()
    await text(slug, 'STOP')
    clock += 60000
    await text(slug, 'HELP')
    const help = (await workspace(owner)).state.replies!.at(-1)!
    expect(help).toMatchObject({ keyword: 'help' })
    expect(help.readAt).toBeUndefined()
    clock += 60000
    await text(slug, 'start')
    expect(await clientOf(owner, rosaId)).not.toHaveProperty('noTextReminders')
    expect(await clientOf(owner, saraId)).not.toHaveProperty('noTextReminders')
    expect(rows('receptionist')).toEqual([])
    // Once texts are back on, an ordinary question is answered again.
    clock += 60000
    await text(slug, 'When are you open?')
    expect(rows('receptionist')).toHaveLength(1)
  })

  it('needs the team to confirm the client asked before the desk turns texts back on', async () => {
    serve()
    const { owner, slug } = await studio()
    await text(slug, 'STOP')
    const refused = await command(owner, {
      type: 'contact-preferences',
      clientId: rosaId,
      email: true,
      sms: true,
    })
    expect(refused.statusCode).toBe(422)
    expect(refused.json<{ error: string }>().error).toContain('Rosa replied STOP by text')
    await run(owner, {
      type: 'contact-preferences',
      clientId: rosaId,
      email: true,
      sms: true,
      askedAfterStop: true,
    })
    expect(await clientOf(owner, rosaId)).not.toHaveProperty('noTextReminders')
    // The number still replied STOP, so the outbox still refuses to text it.
    await run(owner, {
      type: 'book',
      input: {
        serviceId,
        staffId,
        date: '2026-10-08',
        startMinutes: 600,
        clientId: rosaId,
        source: 'desk',
      },
    })
    await api.outbox.tick()
    expect(rows('confirmation').map((r) => r.channel)).toEqual(['email'])
  })
})

describe('a test text, in test mode', () => {
  const deliver = (login: Login, payload: Record<string, unknown>) =>
    api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/test-text`,
      headers: headers(login),
      payload,
    })

  it('takes the same path as a real text, once per ref, recorded as the owner’s test', async () => {
    serve(true)
    const { owner } = await studio()
    const first = await deliver(owner, { from: '+44 7700 900456', body: 'STOP', ref: 'try-0001' })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toMatchObject({ kept: true, keyword: 'stop', answered: false })
    const again = await deliver(owner, { from: '+44 7700 900456', body: 'STOP', ref: 'try-0001' })
    expect(again.json()).toMatchObject({ kept: false, keyword: 'stop' })
    const { state } = await workspace(owner)
    const kept = state.replies!.filter((r) => r.providerRef === 'test-try-0001')
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ actor: 'Text line (test mode)', keyword: 'stop' })
    expect(state.clients.find((c) => c.id === rosaId)).toMatchObject({ noTextReminders: true })
    const audit = api.database.all<{ action: string; actor_id: string | null }>(
      "SELECT action,actor_id FROM audit_events WHERE action='inbox.test-text'",
    )
    expect(audit).toHaveLength(1)
    expect(audit[0].actor_id).toBeTruthy()
    // An ordinary text is answered by the AI receptionist, in test mode: nothing is sent.
    const start = await deliver(owner, { from: ROSA, body: 'START' })
    expect(start.json()).toMatchObject({ kept: true, keyword: 'start', answered: false })
    clock += 60000
    const question = await deliver(owner, { from: ROSA, body: 'When are you open?' })
    expect(question.json()).toMatchObject({ kept: true, keyword: null, answered: true })
    await api.outbox.tick()
    expect(rows('receptionist')).toMatchObject([{ status: 'test', provider: 'test' }])
    expect(sent).toEqual([])
  })

  it('checks the number, and is only for the owner or a manager', async () => {
    serve(true)
    const { owner } = await studio()
    expect((await deliver(owner, { from: '07700 900456', body: 'STOP' })).statusCode).toBe(400)
    expect((await deliver(owner, { from: ROSA, body: '   ' })).statusCode).toBe(400)
    for (const role of ['reception', 'practitioner'] as const) {
      const invitation = await api.inject({
        method: 'POST',
        url: `/api/workspaces/${owner.orgId}/invitations`,
        headers: headers(owner),
        payload: {
          email: `${role}@example.invalid`,
          role,
          ...(role === 'practitioner' ? { staffId } : {}),
        },
      })
      expect(invitation.statusCode, invitation.body).toBe(201)
      const member = await register(
        `${role}@example.invalid`,
        { invitation: invitation.json<{ invitation: string }>().invitation },
        'Team Member',
      )
      const refused = await deliver({ ...member, orgId: owner.orgId }, { from: ROSA, body: 'STOP' })
      expect(refused.statusCode).toBe(403)
      if (role === 'practitioner') {
        // Their own day never carries the numbers that replied STOP.
        const own = await api.inject({
          url: `/api/workspaces/${owner.orgId}`,
          headers: headers({ ...member, orgId: owner.orgId }),
        })
        expect(own.json<{ view: string }>().view).toBe('practitioner')
        expect(own.body).not.toContain('textStops')
      }
    }
    expect((await workspace(owner)).state.replies ?? []).toEqual([])
  })

  it('is off once texts are live in a studio of its own', async () => {
    serve(false)
    const { owner } = await studio()
    const refused = await deliver(owner, { from: ROSA, body: 'STOP' })
    expect(refused.statusCode).toBe(409)
    expect(await clientOf(owner, rosaId)).not.toHaveProperty('noTextReminders')
  })

  it('records a sample studio’s STOP the same way, and never texts anyone', async () => {
    serve(false)
    const { owner } = await studio(true)
    const ellie = '+447700900003'
    const response = await deliver(owner, { from: ellie, body: 'STOP' })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({ kept: true, keyword: 'stop', answered: false })
    const { state } = await workspace(owner)
    expect(state.clients.find((c) => c.id === 'client-3')).toMatchObject({
      noTextReminders: true,
    })
    expect(state.textStops).toMatchObject([{ number: ellie }])
    await api.outbox.tick()
    expect(rows()).toEqual([])
    expect(sent).toEqual([])
  })
})

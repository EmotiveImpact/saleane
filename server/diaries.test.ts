// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// NEXT-10: team diaries in Google or Apple Calendar, read through a private link.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string; userId: string }
type Link = {
  id: string
  who: string
  kind: string
  detail: string
  madeBy: string
  mine: boolean
  lastReadAt: string | null
  stoppedWorking?: string
}
type Listing = {
  links: Link[]
  sample: boolean
  daysAhead: number
  choices: {
    own: { staffId: string; name: string } | null
    people: { id: string; name: string }[]
    locations: { id: string; name: string }[]
    studio: boolean
  }
  link?: string
  created?: string
}
let api: ApiHandler
let clock: number
beforeEach(() => {
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock, turnstile: null })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, name: string, invitation?: string, sample = false) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email,
      password,
      ...(invitation
        ? { invitation }
        : { workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample } }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: cookie(response),
    userId: '',
  }
  login.userId = (await api.inject({ url: '/api/session', headers: headers(login) })).json<{
    user: { id: string }
  }>().user.id
  return login
}
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const state = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    state: BusinessState
  }>().state
async function run(login: Login, command: Command) {
  const { revision } = await state(login)
  const response = await post(
    login,
    '/commands',
    { revision, command },
    { 'idempotency-key': crypto.randomUUID() },
  )
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function invite(owner: Login, email: string, name: string, access: Record<string, string>) {
  const invitation = await post(owner, '/invitations', { email, ...access })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, name, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
let ids: { maya: string; sophia: string; serviceId: string; grace: string; olivia: string }
/** A real studio in test mode: Maya sees Grace and Sophia sees Olivia on 7 October at 10:00. */
async function studio() {
  const owner = await register('owner@example.invalid', 'Ada Owner')
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  await run(owner, { type: 'resource', input: { name: 'Room Two', type: 'treatment' } })
  const serviceId = await run(owner, {
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
  const person = (name: string) =>
    run(owner, {
      type: 'staff',
      input: { name, role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
    })
  const maya = await person('Maya Lewis')
  const sophia = await person('Sophia Reed')
  const client = (name: string, email: string, phone: string) =>
    run(owner, { type: 'client', contact: { name, email, phone, marketingConsent: false } })
  const grace = await client('Grace Chen', 'grace@example.invalid', '+44 7700 900123')
  const olivia = await client('Olivia James', 'olivia@example.invalid', '+44 7700 900124')
  ids = { maya, sophia, serviceId, grace, olivia }
  await book(owner, maya, grace)
  await book(owner, sophia, olivia)
  return owner
}
const book = (login: Login, staffId: string, clientId: string, date = '2026-10-07') =>
  run(login, {
    type: 'book',
    input: { serviceId: ids.serviceId, staffId, date, startMinutes: 600, clientId, source: 'desk' },
  })
const links = async (login: Login) => {
  const response = await api.inject({
    url: `/api/workspaces/${login.orgId}/diary-links`,
    headers: headers(login),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Listing>()
}
const make = (login: Login, scope: Record<string, string>, detail = 'names') =>
  post(login, '/diary-links', { scope, detail })
async function made(login: Login, scope: Record<string, string>, detail = 'names') {
  const response = await make(login, scope, detail)
  expect(response.statusCode, response.body).toBe(201)
  const body = response.json<Listing>()
  return { ...body, path: new URL(body.link!).pathname }
}
/** A calendar app asks with the link alone: no session, no cookie. */
const read = (path: string, method = 'GET') => api.inject({ method, url: path })
const audits = (action: string) =>
  api.database.all('SELECT * FROM audit_events WHERE action=?', action)

describe('team diaries in Google or Apple Calendar (NEXT-10)', () => {
  it('shows the link once, and a calendar app reads the diary with it alone', async () => {
    const owner = await studio()
    const studioLink = await made(owner, { kind: 'studio' })
    expect(studioLink.link).toMatch(
      /^http:\/\/127\.0\.0\.1:5173\/api\/diary\/sd_[a-f0-9]{8}_[A-Za-z0-9_-]{32}\.ics$/,
    )
    const token = studioLink.path.split('/').pop()!.replace('.ics', '')
    expect(studioLink.links).toMatchObject([
      { who: 'Everyone at the studio', madeBy: 'Ada Owner', mine: true, lastReadAt: null },
    ])
    // Never shown again, and only its hash is kept.
    expect(JSON.stringify(await links(owner))).not.toContain(token)
    expect(JSON.stringify(api.database.all('SELECT * FROM diary_links'))).not.toContain(token)
    expect(audits('diary-link.made')).toHaveLength(1)

    const diary = await read(studioLink.path)
    expect(diary.statusCode, diary.body).toBe(200)
    expect(diary.headers['content-type']).toBe('text/calendar; charset=utf-8')
    const body = diary.body.replace(/\r\n /g, '')
    expect(body).toContain('X-WR-CALNAME:Linden Studio\r\n')
    expect(body).toContain('SUMMARY:Grace\\, Restorative facial with Maya\r\n')
    expect(body).toContain('SUMMARY:Olivia\\, Restorative facial with Sophia\r\n')
    expect(body).toContain('DTSTART:20261007T090000Z\r\n')
    for (const hidden of ['Chen', 'grace@example.invalid', '900123', '£', '95.00'])
      expect(body).not.toContain(hidden)
    expect((await links(owner)).links[0].lastReadAt).toBe('2026-10-06T07:00:00.000Z')

    const head = await read(studioLink.path, 'HEAD')
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    // Only the whole link works.
    const wrong = studioLink.path.replace(/_[A-Za-z0-9_-]{32}\.ics$/, `_${'A'.repeat(32)}.ics`)
    expect((await read(wrong)).statusCode).toBe(404)
    expect((await read('/api/diary/not-a-link.ics')).statusCode).toBe(404)
    expect((await read(studioLink.path.replace('.ics', ''))).statusCode).toBe(404)
    // A treatment-only diary names nobody.
    const quiet = await made(owner, { kind: 'person', staffId: ids.maya }, 'treatment')
    const quietBody = (await read(quiet.path)).body
    expect(quietBody).toContain('SUMMARY:Restorative facial\r\n')
    expect(quietBody).not.toContain('Grace')
    expect(quietBody).not.toContain('Olivia')
  })

  it('lets a practitioner link only their own visits, and stops the link with their access', async () => {
    const owner = await studio()
    const maya = await invite(owner, 'maya@example.invalid', 'Maya Lewis', {
      role: 'practitioner',
      staffId: ids.maya,
    })
    const own = await links(maya)
    expect(own.choices).toEqual({
      own: { staffId: ids.maya, name: 'Maya Lewis' },
      people: [],
      locations: [],
      studio: false,
    })
    expect(own.daysAhead).toBe(28)
    const refused = await make(maya, { kind: 'person', staffId: ids.sophia })
    expect(refused.statusCode).toBe(403)
    expect(refused.json<{ error: string }>().error).toBe(
      'You can make a diary link for your own visits only.',
    )
    expect((await make(maya, { kind: 'studio' })).statusCode).toBe(403)
    const mine = await made(maya, { kind: 'person', staffId: ids.maya })
    const diary = (await read(mine.path)).body.replace(/\r\n /g, '')
    expect(diary).toContain('X-WR-CALNAME:Maya Lewis at Linden Studio\r\n')
    expect(diary).toContain('SUMMARY:Grace\\, Restorative facial\r\n')
    expect(diary).not.toContain('Olivia')

    // The owner sees every link; Maya sees only her own.
    const studioLink = await made(owner, { kind: 'studio' })
    expect((await links(owner)).links.map((l) => [l.who, l.madeBy, l.mine])).toEqual([
      ['Maya Lewis', 'Maya Lewis', false],
      ['Everyone at the studio', 'Ada Owner', true],
    ])
    expect((await links(maya)).links.map((l) => l.who)).toEqual(['Maya Lewis'])
    expect((await post(maya, `/diary-links/${studioLink.created}/stop`, {})).statusCode).toBe(404)

    // Her access ends, so her link stops; the owner still sees it, to stop it on purpose.
    expect(
      (await post(owner, '/membership', { accountId: maya.userId, role: 'remove' })).statusCode,
    ).toBe(200)
    const gone = await read(mine.path)
    expect(gone.statusCode).toBe(404)
    expect(gone.json<{ error: string }>().error).toBe(
      'This diary link no longer works. Ask for a new one.',
    )
    expect((await links(owner)).links[0]).toMatchObject({
      who: 'Maya Lewis',
      stoppedWorking: 'The person who made it no longer has access.',
    })
    const stopped = await post(owner, `/diary-links/${mine.created}/stop`, {})
    expect(stopped.statusCode, stopped.body).toBe(200)
    expect(stopped.json<Listing>().links.map((l) => l.who)).toEqual(['Everyone at the studio'])
    expect(audits('diary-link.stopped')).toHaveLength(1)
    expect((await post(owner, `/diary-links/${mine.created}/stop`, {})).statusCode).toBe(404)
  })

  it('reaches four weeks ahead for a practitioner and half a year for the studio', async () => {
    const owner = await studio()
    await book(owner, ids.maya, ids.olivia, '2026-11-17')
    const maya = await invite(owner, 'maya@example.invalid', 'Maya Lewis', {
      role: 'practitioner',
      staffId: ids.maya,
    })
    const hers = await made(maya, { kind: 'person', staffId: ids.maya })
    const owners = await made(owner, { kind: 'person', staffId: ids.maya })
    expect((await read(hers.path)).body).not.toContain('20261117')
    expect((await read(owners.path)).body).toContain('DTSTART:20261117T100000Z')
    expect((await links(owner)).daysAhead).toBe(182)
  })

  it('lets a general manager link their own location and nothing wider', async () => {
    const owner = await studio()
    await run(owner, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
    const islington = (await state(owner)).operations!.locations![0].id
    const gia = await invite(owner, 'gia@example.invalid', 'Gia General', {
      role: 'general',
      locationId: islington,
    })
    expect((await links(gia)).choices).toEqual({
      own: null,
      people: [],
      locations: [{ id: islington, name: 'Islington' }],
      studio: false,
    })
    expect((await make(gia, { kind: 'studio' })).statusCode).toBe(403)
    const main = (await state(owner)).organisation.locationId
    expect((await make(gia, { kind: 'location', locationId: main })).statusCode).toBe(403)
    const branch = await made(gia, { kind: 'location', locationId: islington })
    expect(branch.links[0].who).toBe('Everyone at Islington')
    // London's visits are not at Islington.
    expect((await read(branch.path)).body).not.toContain('Grace')
    // Owners can choose any open location when there is more than one.
    expect((await links(owner)).choices.locations.map((l) => l.name)).toEqual([
      'London',
      'Islington',
    ])
  })

  it('shares nothing from a sample studio', async () => {
    const owner = await register('sample@example.invalid', 'Ada Owner', undefined, true)
    expect((await links(owner)).sample).toBe(true)
    const refused = await make(owner, { kind: 'studio' })
    expect(refused.statusCode).toBe(409)
    expect(refused.json<{ error: string }>().error).toMatch(/never shares anything outside/)
  })

  it('keeps reading while read only, stops once locked, and lets a link be stopped', async () => {
    const owner = await studio()
    const link = await made(owner, { kind: 'studio' })
    api.database.run("UPDATE studio_plans SET status='stopped',stop_reason='unpaid'")
    expect((await read(link.path)).statusCode).toBe(200)
    expect((await make(owner, { kind: 'studio' })).statusCode).toBe(402)
    api.database.run('UPDATE studio_plans SET locked_at=1')
    expect((await read(link.path)).statusCode).toBe(402)
    expect((await post(owner, `/diary-links/${link.created}/stop`, {})).statusCode).toBe(200)
  })

  it('limits how often one link is read', async () => {
    const owner = await studio()
    const link = await made(owner, { kind: 'studio' })
    for (let i = 0; i < 30; i += 1) expect((await read(link.path)).statusCode).toBe(200)
    expect((await read(link.path)).statusCode).toBe(429)
    clock += 61000
    expect((await read(link.path)).statusCode).toBe(200)
  })

  it('gives reception without visits of their own nothing to link', async () => {
    const owner = await studio()
    const rae = await invite(owner, 'rae@example.invalid', 'Rae Reception', { role: 'reception' })
    expect((await links(rae)).choices).toEqual({
      own: null,
      people: [],
      locations: [],
      studio: false,
    })
    expect((await make(rae, { kind: 'person', staffId: ids.maya })).statusCode).toBe(403)
  })
})

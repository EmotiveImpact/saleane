// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { ChangeEntry } from '../src/domain/changeRecord'
import { defaultPatchTestSettings } from '../src/domain/patchTestsSchema'

// Stage 3: the studio's rule that stops online booking when a patch test is missing or out of
// date. One rule, onlinePatchTestStop, decides for every way a guest books without the desk: the
// booking page (and the AI receptionist, whose times are booked there), Book with Google and a
// guest moving their own visit. The desk is never stopped.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const partner = {
  mode: 'test' as const,
  username: 'google-partner',
  password: 'a-long-test-password-2026',
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London, the sample studio's day.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    googleBooking: partner,
  })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email = 'owner@example.invalid', sample = true, invitation?: string) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      ...(invitation
        ? { invitation }
        : { workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample } }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function studio(login: Login) {
  return (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ slug: string; state: BusinessState }>()
}
async function run(login: Login, command: Command) {
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: (await studio(login)).state.revision, command },
  })
}
async function ok(login: Login, command: Command) {
  const response = await run(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** The studio's patch test rules, with the rule to stop online booking on or off. */
async function rule(login: Login, stopOnline: boolean, testServiceId?: string) {
  const current = (await studio(login)).state.operations?.patchTests ?? defaultPatchTestSettings
  const keep = testServiceId ?? current.testServiceId
  await ok(login, {
    type: 'patch-test-settings',
    settings: { ...current, stopOnline, ...(keep ? { testServiceId: keep } : {}) },
  })
}
/** A patch test, with who did it left unrecorded. */
const test = (clientId: string, testedAt: string, outcome?: 'clear' | 'reaction'): Command => ({
  type: 'patch-test',
  input: { clientId, testedAt, product: 'Gloss toner 7.1', notes: '' },
  ...(outcome ? { result: { outcome, notes: '' } } : {}),
})
/**
 * The sample's patch test stories: Ellie (client-3) clear, Grace (client-6) waiting for her
 * result and Luca (client-9) with none. Two more are added: Amelia's (client-1) clear test from
 * March is out of date by 8 October, and Olivia (client-2) reacted.
 */
async function sampleStories(owner: Login) {
  await ok(owner, test('client-1', '2026-03-01T10:00:00.000Z', 'clear'))
  await ok(owner, test('client-2', '2026-09-20T10:00:00.000Z', 'reaction'))
}
const contactOf = (state: BusinessState, clientId: string) => {
  const c = state.clients.find((x) => x.id === clientId)!
  return { name: c.name, email: c.email, phone: c.phone, marketingConsent: false }
}
const madeUp = {
  name: 'Made Up Guest',
  email: 'made.up@example.invalid',
  phone: '+44 7700 900111',
  marketingConsent: false,
}
/** Each guest books from their own address, as guests do. */
const hold = (
  slug: string,
  serviceId: string,
  staffId: string,
  startMinutes: number,
  date = '2026-10-08',
  from = '127.0.0.1',
) =>
  api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date, startMinutes },
    remoteAddress: from,
  })
const book = (slug: string, held: string, contact: Record<string, unknown>, from = '127.0.0.1') =>
  api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held, contact, policy: true },
    remoteAddress: from,
  })
/** The first free time for a colour with Theo, from 8 October. */
async function freeColour(slug: string) {
  for (let day = 8; day < 22; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`
    const free = await api.inject({
      url: `/api/public/${slug}/availability?serviceId=service-gloss&staffId=staff-theo&date=${date}`,
    })
    const [start] = free.json<{ times: number[] }>().times
    if (start !== undefined) return { date, start }
  }
  throw new Error('No free time for a colour')
}
/**
 * A made-up guest, guests giving the details of Ellie (clear), Grace (waiting), Luca (none),
 * Amelia (out of date) and Olivia (reaction), and strangers giving only Ellie's email or phone.
 */
const guests = (state: BusinessState) => [
  madeUp,
  ...['client-3', 'client-6', 'client-9', 'client-1', 'client-2'].map((id) => contactOf(state, id)),
  { ...madeUp, email: contactOf(state, 'client-3').email },
  { ...madeUp, phone: contactOf(state, 'client-3').phone },
]
const errorOf = (response: InjectResponse) => response.json<{ error: string }>().error
const COLOUR_FIRST =
  'Gloss & Tone needs a patch test first, so it cannot be booked online. Book a patch test, or if you have had one recently, contact the studio to book.'

describe('the booking page with the patch test rule', () => {
  it('books a colour online as before while the rule is off, for every guest', async () => {
    const owner = await register()
    await sampleStories(owner)
    const { slug, state } = await studio(owner)
    const catalog = (await api.inject({ url: `/api/public/${slug}` })).json<
      Record<string, unknown>
    >()
    expect(catalog.patchTestFirst).toBeUndefined()
    // Whatever details are typed, and whatever the client's test says, the colour books.
    let n = 10
    for (const contact of guests(state)) {
      const from = `198.51.100.${(n += 1)}`
      const { date, start } = await freeColour(slug)
      const held = await hold(slug, 'service-gloss', 'staff-theo', start, date, from)
      expect(held.statusCode, held.body).toBe(201)
      const booked = await book(slug, held.json<{ hold: string }>().hold, contact, from)
      expect(booked.statusCode, booked.body).toBe(200)
    }
  })

  it('stops every guest before a time is held, with the same words and nothing written', async () => {
    const owner = await register()
    await sampleStories(owner)
    // A hold taken before the rule is turned on, to try the last step too.
    const { slug } = await studio(owner)
    const early = await hold(slug, 'service-gloss', 'staff-theo', 840)
    expect(early.statusCode, early.body).toBe(201)
    await rule(owner, true)
    const before = (await studio(owner)).state
    const catalog = (await api.inject({ url: `/api/public/${slug}` })).json<
      Record<string, unknown>
    >()
    expect(catalog.patchTestFirst).toEqual({ testServiceId: 'service-patch-test' })

    // No time is held, so nothing is ever asked or taken.
    const refused = await hold(slug, 'service-gloss', 'staff-theo', 960)
    expect(refused.statusCode).toBe(422)
    expect(errorOf(refused)).toBe(COLOUR_FIRST)
    const free = await api.inject({
      url: `/api/public/${slug}/availability?serviceId=service-gloss&staffId=staff-theo&date=2026-10-08`,
    })
    expect(free.json<{ times: number[] }>().times).toContain(960)

    // At the last step, a made-up guest and strangers typing the email and phone of Ellie (clear
    // test), Grace (waiting), Luca (none), Amelia (out of date) and Olivia (reaction) all read the
    // same answer. Nobody learns who is a client or who has had a test.
    const answers = new Set<string>()
    for (const contact of guests(before)) {
      const response = await book(slug, early.json<{ hold: string }>().hold, contact)
      answers.add(`${response.statusCode} ${response.body}`)
    }
    expect([...answers]).toEqual([`422 ${JSON.stringify({ error: COLOUR_FIRST })}`])
    const after = (await studio(owner)).state
    expect(after.revision).toBe(before.revision)
    expect(after.clients).toHaveLength(before.clients.length)
    expect(after.appointments).toHaveLength(before.appointments.length)
    expect(after.payments).toHaveLength(before.payments.length)
  })

  it('books treatments that need no test, including the patch test itself', async () => {
    const owner = await register()
    await rule(owner, true)
    const { slug, state } = await studio(owner)
    for (const [serviceId, staffId, start, contact] of [
      ['service-facial', 'staff-maya', 780, contactOf(state, 'client-9')],
      ['service-patch-test', 'staff-theo', 840, madeUp],
    ] as const) {
      const held = await hold(slug, serviceId, staffId, start)
      expect(held.statusCode, held.body).toBe(201)
      expect((await book(slug, held.json<{ hold: string }>().hold, contact)).statusCode).toBe(200)
    }
  })

  it('asks guests to contact the studio when it offers no patch test online', async () => {
    const owner = await register()
    const { state } = await studio(owner)
    const rest = { ...state.operations!.patchTests! }
    delete rest.testServiceId
    await ok(owner, { type: 'patch-test-settings', settings: { ...rest, stopOnline: true } })
    const { slug } = await studio(owner)
    expect((await api.inject({ url: `/api/public/${slug}` })).json()).toMatchObject({
      patchTestFirst: { testServiceId: null },
    })
    const refused = await hold(slug, 'service-gloss', 'staff-theo', 840)
    expect(errorOf(refused)).toBe(
      'Gloss & Tone needs a patch test first, so it cannot be booked online. Contact the studio to arrange one, or to book if you have had one recently.',
    )
  })
})

describe('the AI receptionist with the patch test rule', () => {
  const say = (slug: string, text: string) =>
    api.inject({
      method: 'POST',
      url: `/api/public/${slug}/receptionist`,
      payload: { text },
      remoteAddress: '198.51.100.7',
    })
  type Answer = { text: string; proposals: unknown[]; times: unknown[] }

  it('offers colour times while the rule is off, and the same calm answer to everyone once on', async () => {
    const owner = await register()
    await ok(owner, { type: 'receptionist', settings: { enabled: true, handOver: true } })
    const { slug } = await studio(owner)
    const asked = 'Any times for a gloss and tone on Thursday?'
    const before = (await say(slug, asked)).json<Answer>()
    expect(before.text).toMatch(/^Gloss & Tone on Thursday 8 October: /)
    expect(before.times.length).toBeGreaterThan(0)
    await rule(owner, true)
    const stopped = (await say(slug, asked)).json<Answer>()
    expect(stopped).toMatchObject({ text: COLOUR_FIRST, proposals: [], times: [] })
    // The patch test, and a treatment that needs none, are offered as before.
    expect(
      (await say(slug, 'Any times for a colour patch test on Thursday?')).json<Answer>().times
        .length,
    ).toBeGreaterThan(0)
    expect(
      (await say(slug, 'Any times for a facial on Thursday?')).json<Answer>().times.length,
    ).toBeGreaterThan(0)
  })
})

describe('Book with Google with the patch test rule', () => {
  type Entry = {
    service_id: string
    start_sec: number
    duration_sec: number
    resources: { staff_id: string }
  }
  const basic = `Basic ${Buffer.from(`${partner.username}:${partner.password}`).toString('base64')}`
  const call = (method: string, payload: unknown) =>
    api.inject({
      method: 'POST',
      url: `/api/partners/google/v3/${method}`,
      headers: { authorization: basic, 'content-type': 'application/json' },
      rawPayload: JSON.stringify(payload),
    })
  /** A real studio on Google: a colour without a deposit, its patch test and one professional. */
  async function googleStudio() {
    const owner = await register('owner@example.invalid', false)
    await ok(owner, { type: 'resource', input: { name: 'Chair One', type: 'chair' } })
    const service = (name: string, patchTest: boolean, durationMinutes: number) =>
      ok(owner, {
        type: 'service',
        input: {
          name,
          description: 'A fictional treatment',
          category: 'Hair',
          durationMinutes,
          bufferMinutes: 0,
          priceMinor: patchTest ? 6500 : 0,
          depositMinor: 0,
          resourceType: 'chair',
          ...(patchTest ? { patchTest } : {}),
        },
      })
    const colour = await service('Gloss colour', true, 45)
    const patch = await service('Patch test', false, 15)
    await ok(owner, {
      type: 'staff',
      input: { name: 'Theo Lind', role: 'Colourist', serviceIds: [colour, patch], tone: 'sand' },
    })
    const { name, locationName, address, timeZone } = (await studio(owner)).state.organisation
    await ok(owner, {
      type: 'organisation',
      name,
      locationName,
      address,
      timeZone,
      bookingEnabled: true,
    })
    await ok(owner, { type: 'google-booking', settings: { enabled: true } })
    // Clients the desk knows: one clear, one out of date, one who reacted and one with none.
    const people: Record<string, string> = {}
    for (const [key, n] of [
      ['clear', 1],
      ['old', 2],
      ['reacted', 3],
      ['none', 4],
    ] as const) {
      const contact = {
        name: `Guest ${key}`,
        email: `${key}@example.invalid`,
        phone: `+44 7700 90020${n}`,
        marketingConsent: false,
      }
      people[key] = await ok(owner, { type: 'client', contact })
    }
    await ok(owner, test(people.clear, '2026-09-20T10:00:00.000Z', 'clear'))
    await ok(owner, test(people.old, '2026-02-01T10:00:00.000Z', 'clear'))
    await ok(owner, test(people.reacted, '2026-09-20T10:00:00.000Z', 'reaction'))
    return { owner, colour, patch }
  }
  const feed = async (login: Login, name: string) =>
    (
      await api.inject({
        url: `/api/workspaces/${login.orgId}/google/${name}`,
        headers: headers(login),
      })
    ).json<Record<string, { service_id?: string; availability?: Entry[] }[]>>()
  const user = (key: string, n: number) => ({
    user_id: `google-${key}`,
    given_name: 'Guest',
    family_name: key,
    telephone: `+44 7700 90020${n}`,
    email: `${key}@example.invalid`,
  })

  /**
   * Google's guests: clients whose test is clear, out of date, reacted or missing, a stranger,
   * and strangers giving only the clear client's email or phone.
   */
  const everyone = [
    user('clear', 1),
    user('old', 2),
    user('reacted', 3),
    user('none', 4),
    user('stranger', 9),
    { ...user('stranger', 9), email: 'clear@example.invalid' },
    { ...user('stranger', 9), telephone: '+44 7700 900201' },
  ]

  it('books a colour on Google for anyone while the rule is off, and keeps it off Google once on', async () => {
    const { owner, colour, patch } = await googleStudio()
    const { state } = await studio(owner)
    const times = async () =>
      (await feed(owner, 'availability')).service_availability[0].availability!
    // Colour times that do not overlap: one for each guest, and one more.
    const picks: Entry[] = []
    for (const e of (await times()).filter((x) => x.service_id === colour)) {
      const last = picks[picks.length - 1]
      if (!last || e.start_sec >= last.start_sec + last.duration_sec) picks.push(e)
    }
    expect(picks.length).toBeGreaterThan(everyone.length)
    const slot = (e: Entry) => ({
      merchant_id: state.organisation.id,
      service_id: e.service_id,
      start_sec: e.start_sec,
      duration_sec: e.duration_sec,
      resources: { staff_id: e.resources.staff_id },
    })
    const offBooking = (i: number) =>
      call('CreateBooking', {
        slot: slot(picks[i]),
        user_information: everyone[i],
        idempotency_token: `off-${i}`,
      })
    for (let i = 0; i < everyone.length; i += 1)
      expect((await offBooking(i)).json()).toMatchObject({ booking: { status: 'CONFIRMED' } })

    await rule(owner, true, patch)
    const before = (await studio(owner)).state
    // The colour leaves the feeds; its patch test stays.
    expect((await feed(owner, 'services')).service.map((x) => x.service_id)).toEqual([patch])
    expect((await times()).every((e) => e.service_id === patch)).toBe(true)
    const later = slot(picks[everyone.length])
    expect((await call('CheckAvailability', { slot: later })).json()).toMatchObject({
      count_available: 0,
    })
    // Every Google guest reads the same answer, whoever's details Google sends.
    const answers = new Set<string>()
    for (const [i, guest] of everyone.entries()) {
      const response = await call('CreateBooking', {
        slot: later,
        user_information: guest,
        idempotency_token: `on-${i}`,
      })
      answers.add(response.body)
    }
    expect([...answers].map((body) => JSON.parse(body) as unknown)).toEqual([
      {
        booking_failure: {
          cause: 'SLOT_UNAVAILABLE',
          description:
            'Gloss colour needs a patch test first, so it cannot be booked online. Book a patch test, or if you have had one recently, contact the studio to book.',
        },
      },
    ])
    const after = (await studio(owner)).state
    expect(after.revision).toBe(before.revision)
    expect(after.clients).toHaveLength(before.clients.length)
    // A booking made before the rule is still answered as it was.
    expect((await offBooking(0)).json()).toMatchObject({ booking: { status: 'CONFIRMED' } })
    // The patch test itself books on Google.
    const test = (await times()).find((e) => e.service_id === patch)!
    expect(
      (
        await call('CreateBooking', {
          slot: slot(test),
          user_information: user('stranger', 9),
          idempotency_token: 'patch-1',
        })
      ).json(),
    ).toMatchObject({ booking: { status: 'CONFIRMED' } })
  })
})

describe('a guest moving their own visit with the patch test rule', () => {
  type MoveTimes = { times: { startMinutes: number }[]; patchTest?: boolean }
  async function link(owner: Login, appointmentId: string) {
    const response = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/guest-links`,
      headers: headers(owner),
      payload: { appointmentId },
    })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<{ url: string }>().url.split('#')[1]
  }
  const times = (token: string, date: string) =>
    api.inject({ method: 'POST', url: '/api/guest/move-times', payload: { token, date } })
  const move = (token: string, date: string, startMinutes: number) =>
    api.inject({
      method: 'POST',
      url: '/api/guest/move',
      payload: { token, date, startMinutes, requestKey: crypto.randomUUID() },
    })
  /** A colour at the desk for a client, two weeks ahead. */
  const colourFor = (owner: Login, clientId: string, startMinutes: number) =>
    ok(owner, {
      type: 'book',
      input: {
        serviceId: 'service-gloss',
        staffId: 'staff-theo',
        date: '2026-10-21',
        startMinutes,
        clientId,
        source: 'desk',
      },
    })

  it('offers and takes only times a clear test covers, for the guest the link belongs to', async () => {
    const owner = await register()
    await sampleStories(owner)
    // Luca's clear test from 20 April counts until 20 October, so a later colour is out of date.
    await ok(owner, test('client-9', '2026-04-20T10:00:00.000Z', 'clear'))
    // Colours at the desk for Noor (client-4), who has had no test, and Olivia, who reacted.
    const missing = await colourFor(owner, 'client-4', 600)
    const reacted = await colourFor(owner, 'client-2', 720)
    await rule(owner, true)
    const tokens = {
      clear: await link(owner, 'visit-gloss-ellie'),
      waiting: await link(owner, 'visit-gloss-grace'),
      dated: await link(owner, 'visit-gloss-luca'),
      missing: await link(owner, missing),
      reacted: await link(owner, reacted),
    }
    // Ellie's clear test covers the 13th: times are offered, and she can move there.
    const ellie = (await times(tokens.clear, '2026-10-13')).json<MoveTimes>()
    expect(ellie.patchTest).toBe(true)
    expect(ellie.times.length).toBeGreaterThan(0)
    expect((await move(tokens.clear, '2026-10-13', ellie.times[0].startMinutes)).statusCode).toBe(
      200,
    )
    // Luca's covers the 15th but not the 22nd.
    expect(
      (await times(tokens.dated, '2026-10-15')).json<MoveTimes>().times.length,
    ).toBeGreaterThan(0)
    expect((await times(tokens.dated, '2026-10-22')).json<MoveTimes>().times).toEqual([])
    const late = await move(tokens.dated, '2026-10-22', 600)
    expect(late.statusCode).toBe(422)
    expect(errorOf(late)).toBe(
      'Gloss & Tone needs a clear patch test that covers the new time, so it cannot be moved there online. Choose one of the times shown, or contact the studio to move it.',
    )
    expect((await move(tokens.dated, '2026-10-15', 600)).statusCode).toBe(200)
    // Waiting for a result, no test and a reaction: nothing to choose, and a move is refused.
    for (const token of [tokens.waiting, tokens.missing, tokens.reacted]) {
      expect((await times(token, '2026-10-14')).json<MoveTimes>()).toMatchObject({
        times: [],
        patchTest: true,
      })
      expect((await move(token, '2026-10-14', 600)).statusCode).toBe(422)
    }
    // A stranger without the private link learns nothing, as before.
    const stranger = await move('x'.repeat(43), '2026-10-14', 600)
    expect(stranger.statusCode).toBe(404)
  })

  it('moves as before while the rule is off, and for a treatment that needs no test', async () => {
    const owner = await register()
    await sampleStories(owner)
    await ok(owner, test('client-9', '2026-04-20T10:00:00.000Z', 'clear'))
    const missing = await colourFor(owner, 'client-4', 600)
    const reacted = await colourFor(owner, 'client-2', 720)
    // Clear, waiting for a result, out of date by then, no test and a reaction: each moves.
    const visits = ['visit-gloss-ellie', 'visit-gloss-grace', 'visit-gloss-luca', missing, reacted]
    for (const visit of visits) {
      const token = await link(owner, visit)
      const offered = (await times(token, '2026-10-22')).json<MoveTimes>()
      expect(offered.patchTest).toBeUndefined()
      const moved = await move(token, '2026-10-22', offered.times[0].startMinutes)
      expect(moved.statusCode, moved.body).toBe(200)
    }
    await rule(owner, true)
    const { slug } = await studio(owner)
    const held = await hold(slug, 'service-facial', 'staff-maya', 780)
    const booked = await book(slug, held.json<{ hold: string }>().hold, madeUp)
    const facial = booked.json<{ manage: { url: string } }>().manage.url.split('#')[1]
    const free = (await times(facial, '2026-10-14')).json<MoveTimes>()
    expect(free.patchTest).toBeUndefined()
    expect((await move(facial, '2026-10-14', free.times[0].startMinutes)).statusCode).toBe(200)
  })
})

describe('the setting itself, and the desk', () => {
  it('is changed by owners and managers, never reception, and shows in who changed what', async () => {
    const owner = await register()
    const invite = async (email: string, role: string) => {
      const response = await api.inject({
        method: 'POST',
        url: `/api/workspaces/${owner.orgId}/invitations`,
        headers: headers(owner),
        payload: { email, role },
      })
      expect(response.statusCode, response.body).toBe(201)
      const login = await register(email, true, response.json<{ invitation: string }>().invitation)
      return { ...login, orgId: owner.orgId }
    }
    const manager = await invite('manager@example.invalid', 'manager')
    const reception = await invite('desk@example.invalid', 'reception')
    const settings = {
      ...defaultPatchTestSettings,
      stopOnline: true,
      testServiceId: 'service-patch-test',
    }
    expect((await run(reception, { type: 'patch-test-settings', settings })).statusCode).toBe(403)
    expect((await run(manager, { type: 'patch-test-settings', settings })).statusCode).toBe(200)
    const page = (
      await api.inject({ url: `/api/workspaces/${owner.orgId}/changes`, headers: headers(owner) })
    ).json<{ entries: ChangeEntry[] }>()
    const entry = page.entries.find((e) => e.what === 'Changed the patch test rules')!
    expect(entry.lines).toEqual([
      { what: 'stop online booking without a patch test', from: 'no', to: 'yes' },
    ])
    await ok(owner, { type: 'patch-test-settings', settings: { ...settings, stopOnline: false } })
    const again = (
      await api.inject({ url: `/api/workspaces/${owner.orgId}/changes`, headers: headers(owner) })
    ).json<{ entries: ChangeEntry[] }>()
    expect(again.entries[0].lines).toEqual([
      { what: 'stop online booking without a patch test', from: 'yes', to: 'no' },
    ])
  })

  it('never stops the desk, which can book the patch test first or the colour anyway', async () => {
    const owner = await register()
    await rule(owner, true)
    for (const serviceId of ['service-patch-test', 'service-gloss'])
      await ok(owner, {
        type: 'book',
        input: {
          serviceId,
          staffId: 'staff-theo',
          date: '2026-10-08',
          startMinutes: serviceId === 'service-gloss' ? 840 : 780,
          clientId: 'client-9',
          source: 'desk',
        },
      })
  })
})

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import { aiFromEnv, testAi } from './ai'
import type { AiSupplier } from './ai'
import {
  noTranscriber,
  openaiTranscriber,
  TranscribeError,
  TRANSCRIBE_WORST_MINOR,
} from './transcribe'
import type { Transcriber } from './transcribe'
import { VOICE_NOTE_BYTES, WRITE_UP_WORST_MINOR } from './routes/writeUp'
import type { Usage } from '../lumane'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { PractitionerView } from '../src/domain/practitioner'

// NEXT-16: writing up a visit from a voice note or typed words, on the server.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
afterEach(() => api?.close())

function start(ai: AiSupplier = testAi, transcriber: Transcriber = noTranscriber) {
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => Date.parse('2026-10-06T08:00:00.000Z'),
    turnstile: null,
    ai,
    transcriber,
  })
}
const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: email.split('@')[0],
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: {
              name: 'Linden Studio',
              locationName: 'London',
              region: 'UK',
              sample: false,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const post = (login: Login, path: string, payload: unknown) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: headers(login),
    payload,
  })
const studio = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    state: BusinessState
  }>().state
async function run(login: Login, command: Command) {
  // A professional reads only their own view, which carries the same revision.
  const read = (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ state?: { revision: number }; practitioner?: { revision: number } }>()
  const revision = (read.state ?? read.practitioner)!.revision
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': `c-${Math.random()}` },
    payload: { revision, command },
  })
  return response
}
async function saved(login: Login, command: Command) {
  const response = await run(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}

/** A studio of its own with two professionals, and a visit for each this morning. */
async function linden() {
  const owner = await register('owner@example.invalid')
  await saved(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  await saved(owner, { type: 'resource', input: { name: 'Room Two', type: 'treatment' } })
  const serviceId = await saved(owner, {
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
  const staff = async (name: string) =>
    saved(owner, {
      type: 'staff',
      input: { name, role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
    })
  const maya = await staff('Maya Lind')
  const ines = await staff('Ines Cole')
  const visit = async (staffId: string, name: string) =>
    saved(owner, {
      type: 'book',
      input: {
        serviceId,
        staffId,
        date: '2026-10-06',
        startMinutes: 600,
        source: 'desk',
        contact: {
          name,
          email: `${name.split(' ')[0].toLowerCase()}@example.invalid`,
          phone: '+44 7700 900123',
          marketingConsent: false,
        },
      },
    })
  return {
    owner,
    maya,
    mine: await visit(maya, 'Amara Okoye'),
    theirs: await visit(ines, 'Priya Shah'),
  }
}
async function practitioner(owner: Login, staffId: string) {
  const invitation = await post(owner, '/invitations', {
    email: 'maya@example.invalid',
    role: 'practitioner',
    staffId,
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(
    'maya@example.invalid',
    invitation.json<{ invitation: string }>().invitation,
  )
  return { ...login, orgId: owner.orgId }
}
const typed = (login: Login, visitId: string, words: string) =>
  post(login, `/visits/${visitId}/write-up`, { words })
const spoken = (login: Login, visitId: string, audio: Buffer, type = 'audio/webm;codecs=opus') =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/visits/${visitId}/voice-note`,
    headers: { ...headers(login), 'content-type': type },
    rawPayload: audio,
  })
const usage = (login: Login) =>
  JSON.parse(
    api.database.get<{ usage: string }>(
      'SELECT usage FROM assistant_usage WHERE organisation_id=?',
      login.orgId,
    )?.usage ?? '{"used":{},"spendByDay":{}}',
  ) as Usage
const said =
  'Used the rose oil and she loved it, so use it again. Avoid the sun for the next two days. Drink plenty of water tonight.'

describe('writing up a visit in test mode', () => {
  it('sorts typed words into a note and aftercare, free, and offers no listening', async () => {
    start()
    const { owner, mine } = await linden()
    // Not before the guest has arrived, for anyone.
    const early = await typed(owner, mine, said)
    expect(early.statusCode).toBe(409)
    expect(early.json()).toEqual({ error: 'Write up a visit once the guest has arrived.' })
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect(
      (
        await api.inject({
          url: `/api/workspaces/${owner.orgId}/write-up`,
          headers: headers(owner),
        })
      ).json(),
    ).toEqual({ mode: 'test', listens: false })
    const written = await typed(owner, mine, said)
    expect(written.statusCode, written.body).toBe(200)
    expect(written.json()).toEqual({
      heard: said,
      note: 'Used the rose oil and she loved it, so use it again.',
      aftercare: 'Avoid the sun for the next two days. Drink plenty of water tonight.',
    })
    expect(usage(owner).used.typed ?? 0).toBe(0)
    expect((await spoken(owner, mine, Buffer.from('fake audio'))).statusCode).toBe(409)
  })

  it('says whether aftercare saved now still goes in the visit’s aftercare email', async () => {
    start()
    const { owner, maya, mine, theirs } = await linden()
    const ahead = async (login: Login, visitId: string) =>
      (
        await api.inject({
          url: `/api/workspaces/${login.orgId}/write-up?visit=${visitId}`,
          headers: headers(login),
        })
      ).json<{ aftercareEmail?: boolean }>().aftercareEmail
    // Still to come: there is nothing to write up, so nothing to add.
    expect(await ahead(owner, mine)).toBe(false)
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect(await ahead(owner, mine)).toBe(true)
    // A professional hears nothing about someone else's visit.
    expect(await ahead(await practitioner(owner, maya), theirs)).toBeUndefined()
    // Once the aftercare email is in the outbox, saved aftercare cannot join it.
    const at = Date.parse('2026-10-06T08:00:00.000Z')
    api.database.run(
      `INSERT INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
       VALUES('sent-care',?,?,?,'client','aftercare','email','slot','amara@example.invalid','Care','Body','accepted',?,?,?)`,
      owner.orgId,
      `${mine}:aftercare:email:slot`,
      mine,
      at,
      at,
      at,
    )
    expect(await ahead(owner, mine)).toBe(false)
  })

  it('keeps a professional to their own visits, once the guest has arrived', async () => {
    start()
    const { owner, maya, mine, theirs } = await linden()
    const login = await practitioner(owner, maya)
    const early = await typed(login, mine, said)
    expect(early.statusCode).toBe(403)
    expect(early.body).toContain('Write up a visit once the guest has arrived.')
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect((await typed(login, mine, said)).statusCode).toBe(200)
    const other = await typed(login, theirs, said)
    expect(other.statusCode).toBe(403)
    expect(other.body).toContain('This visit is not assigned to you.')

    // Saving is the ordinary command: the note goes on the guest's record with the visit, and the
    // aftercare on the visit, where its professional sees it.
    await saved(login, {
      type: 'visit-write-up',
      appointmentId: mine,
      note: 'Used the rose oil and she loved it.',
      aftercare: 'Avoid the sun for the next two days.',
    })
    const after = await studio(owner)
    const visit = after.appointments.find((a) => a.id === mine)!
    expect(visit.aftercare).toMatchObject({
      text: 'Avoid the sun for the next two days.',
      staffId: maya,
    })
    expect(after.events.at(-1)).toMatchObject({
      type: 'note',
      title: 'Note after the visit',
      appointmentId: mine,
      detail: 'Used the rose oil and she loved it.',
    })
    const view = (
      await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(login) })
    ).json<{ practitioner: PractitionerView }>().practitioner
    expect(view.appointments.find((a) => a.id === mine)?.aftercare).toBe(
      'Avoid the sun for the next two days.',
    )
    const refused = await run(login, {
      type: 'visit-write-up',
      appointmentId: theirs,
      note: 'Hello',
    })
    expect(refused.statusCode).toBe(403)
  })

  it('refuses a cancelled visit and anything but a recording as a voice note', async () => {
    start()
    const { owner, mine } = await linden()
    expect((await spoken(owner, mine, Buffer.from('{}'), 'application/json')).statusCode).toBe(415)
    await saved(owner, { type: 'cancel', appointmentId: mine, reason: 'Guest asked' } as Command)
    const cancelled = await typed(owner, mine, said)
    expect(cancelled.statusCode).toBe(409)
  })
})

/** Claude, pretended: it writes the visit up with its tool, and counts what it would cost. */
function claude(reply: Record<string, unknown> = {}) {
  const requests: { system: { text: string }[]; messages: { content: unknown }[] }[] = []
  const fetcher = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return new Response(
      JSON.stringify({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'write_up',
            input: {
              note: 'Rose oil used; she loved it. Use it again.',
              aftercare: 'Please keep out of the sun for the next two days.',
            },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1000, output_tokens: 100 },
        ...reply,
      }),
      { status: 200 },
    )
  }) as unknown as typeof fetch
  return {
    ai: aiFromEnv({ SALEANE_AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k' }, fetcher),
    requests,
  }
}
function listening(text = said, fail?: Error) {
  const heard: { bytes: number; type: string }[] = []
  const transcriber: Transcriber = {
    name: 'openai',
    live: true,
    async transcribe(audio, type) {
      heard.push({ bytes: audio.length, type })
      if (fail) throw fail
      return { text, costMinor: 0.25 }
    },
  }
  return { transcriber, heard }
}

describe('writing up a visit with a real AI', () => {
  it('writes down the recording, has Claude write it up, and counts one question at its cost', async () => {
    const { ai, requests } = claude()
    const { transcriber, heard } = listening()
    start(ai, transcriber)
    const { owner, mine } = await linden()
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect(
      (
        await api.inject({
          url: `/api/workspaces/${owner.orgId}/write-up`,
          headers: headers(owner),
        })
      ).json(),
    ).toEqual({ mode: 'live', listens: true })
    const audio = Buffer.alloc(48_000, 7)
    const written = await spoken(owner, mine, audio)
    expect(written.statusCode, written.body).toBe(200)
    expect(written.json()).toEqual({
      heard: said,
      note: 'Rose oil used; she loved it. Use it again.',
      aftercare: 'Please keep out of the sun for the next two days.',
    })
    expect(heard).toEqual([{ bytes: 48_000, type: 'audio/webm;codecs=opus' }])
    // Claude is told the treatment, the guest's first name and the studio's tone, never more.
    const facts = requests[0].system.map((part) => part.text).join('\n')
    expect(facts).toContain('The treatment was Restorative facial.')
    expect(facts).toContain("The guest's first name is Amara.")
    expect(facts).not.toContain('Okoye')
    expect(JSON.stringify(requests[0].messages)).toContain('Avoid the sun')
    const used = usage(owner)
    expect(used.used.typed).toBe(1)
    // Claude at 1,000 tokens in and 100 out, and the recording at 0.25.
    expect(Object.values(used.spendByDay)[0]).toBeCloseTo(0.2 + 0.1 + 0.25, 5)
    expect(used.holds ?? []).toEqual([])
  })

  it('holds the most a voice note could cost before sending it, and refuses one too large', async () => {
    expect(WRITE_UP_WORST_MINOR + TRANSCRIBE_WORST_MINOR).toBe(6)
    const { ai } = claude()
    start(ai, listening().transcriber)
    const { owner, mine } = await linden()
    const big = await spoken(owner, mine, Buffer.alloc(VOICE_NOTE_BYTES + 1, 1))
    expect(big.statusCode).toBe(413)
  })

  it('counts what a failed write-up cost, but not the question, and saves nothing', async () => {
    const { ai } = claude()
    start(ai, listening(said, new TranscribeError('OpenAI could not be reached.', 3)).transcriber)
    const { owner, mine } = await linden()
    await saved(owner, { type: 'arrive', appointmentId: mine })
    const before = (await studio(owner)).revision
    const failed = await spoken(owner, mine, Buffer.alloc(1000, 1))
    expect(failed.json()).toMatchObject({
      status: 'unavailable',
      text: 'It could not be written up just now. Nothing was saved. Try again, or type it yourself.',
    })
    const used = usage(owner)
    expect(used.used.typed ?? 0).toBe(0)
    expect(Object.values(used.spendByDay)[0]).toBe(3)
    expect((await studio(owner)).revision).toBe(before)
  })

  it('says so when nothing was heard, and when Claude does not write it up', async () => {
    const quiet = claude()
    start(quiet.ai, listening('  ').transcriber)
    const { owner, mine } = await linden()
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect((await spoken(owner, mine, Buffer.alloc(1000, 1))).json()).toEqual({
      status: 'unheard',
      text: 'Nothing was heard clearly. Try again, or type it.',
    })
    api.close()
    const chatty = claude({
      content: [{ type: 'text', text: 'Here you go!' }],
      stop_reason: 'end_turn',
    })
    start(chatty.ai, listening().transcriber)
    const again = await linden()
    await saved(again.owner, { type: 'arrive', appointmentId: again.mine })
    expect((await typed(again.owner, again.mine, said)).json()).toMatchObject({
      status: 'unavailable',
      heard: said,
    })
    expect(usage(again.owner).used.typed ?? 0).toBe(0)
  })

  it('does not count a write-up with nothing in it worth keeping', async () => {
    const empty = claude({
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'write_up', input: { note: ' ', aftercare: '' } },
      ],
    })
    start(empty.ai)
    const { owner, mine } = await linden()
    await saved(owner, { type: 'arrive', appointmentId: mine })
    expect((await typed(owner, mine, 'Hmm, nothing much.')).json()).toEqual({
      status: 'unheard',
      heard: 'Hmm, nothing much.',
      text: 'Nothing in it could be written up, so it was not counted. Add a little more and try again.',
    })
    const used = usage(owner)
    expect(used.used.typed ?? 0).toBe(0)
    // What Claude cost still counts.
    expect(Object.values(used.spendByDay)[0]).toBeGreaterThan(0)
    expect(used.holds ?? []).toEqual([])
  })

  it('stays in test mode for a sample studio, with nothing sent to any AI', async () => {
    const { ai, requests } = claude()
    const { transcriber, heard } = listening()
    start(ai, transcriber)
    const response = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Sample Owner',
        email: 'sample@example.invalid',
        password,
        workspace: { name: 'Reference Studio', locationName: 'London', region: 'UK', sample: true },
      },
    })
    const sample = { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
    const visit = (await studio(sample)).appointments.find((a) => a.date === '2026-10-06')!
    expect((await typed(sample, visit.id, said)).json()).toMatchObject({
      note: 'Used the rose oil and she loved it, so use it again.',
    })
    expect((await spoken(sample, visit.id, Buffer.alloc(100, 1))).statusCode).toBe(409)
    expect(requests).toEqual([])
    expect(heard).toEqual([])
  })
})

describe('OpenAI writing down a voice note', () => {
  it('sends the recording with its type, and counts its tokens at the published price', async () => {
    const calls: { url: string; form: FormData }[] = []
    const transcriber = openaiTranscriber({
      apiKey: 'sk-test',
      fetcher: (async (url: string, init: RequestInit) => {
        calls.push({ url, form: init.body as FormData })
        return new Response(
          JSON.stringify({
            text: ' Avoid the sun. ',
            usage: { type: 'tokens', input_tokens: 800, output_tokens: 20, total_tokens: 820 },
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch,
    })
    const result = await transcriber.transcribe(Buffer.from('abc'), 'audio/webm;codecs=opus')
    expect(result).toEqual({
      text: 'Avoid the sun.',
      costMinor: (800 * 125 + 20 * 500) / 1_000_000,
    })
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(calls[0].form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect((calls[0].form.get('file') as File).name).toBe('note.webm')
    expect((calls[0].form.get('file') as File).type).toBe('audio/webm')
  })

  it('counts the most a note could cost when OpenAI cannot be reached or gives no usage', async () => {
    const unreachable = openaiTranscriber({
      apiKey: 'sk-test',
      fetcher: (async () => {
        throw new Error('down')
      }) as unknown as typeof fetch,
    })
    await expect(unreachable.transcribe(Buffer.from('a'), 'audio/ogg')).rejects.toMatchObject({
      costMinor: TRANSCRIBE_WORST_MINOR,
    })
    const vague = openaiTranscriber({
      apiKey: 'sk-test',
      fetcher: (async () =>
        new Response(JSON.stringify({ text: 'Hello' }), {
          status: 200,
        })) as unknown as typeof fetch,
    })
    expect((await vague.transcribe(Buffer.from('a'), 'audio/ogg')).costMinor).toBe(
      TRANSCRIBE_WORST_MINOR,
    )
  })
})

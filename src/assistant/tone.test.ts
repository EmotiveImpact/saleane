import { describe, expect, it } from 'vitest'
import { standingInstructions } from '../../lumane'
import type { Brain, BrainRequest } from '../../lumane'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import { commandSchema } from '../domain/commandSchema'
import type { BusinessState } from '../domain/model'
import { can, operations, permissionFor } from '../domain/operations'
import { askReceptionist, RECEPTION_INSTRUCTIONS } from './receptionist'
import { askSaleane } from './ask'
import { TONE_CHOICES, aiVoice } from './tone'

// NEXT-16: the studio's tone for its AI, and the voice Ask SALEANE speaks in.
const base = seed('UK')
const today = '2026-10-06'
const now = '2026-10-06T08:00:00.000Z'
const studio = (aiVoiceSettings?: object): BusinessState => ({
  ...base,
  operations: {
    ...base.operations!,
    receptionist: { enabled: true, handOver: true },
    ...(aiVoiceSettings ? { aiVoice: aiVoiceSettings as never } : {}),
  },
})
const chat = (state: BusinessState, text: string, brain?: Brain) =>
  askReceptionist({ state, today, now, visitorId: 'v1', text, usage: undefined, brain })

/** A real AI stand-in that keeps what it was sent and answers in plain words. */
function listening() {
  const requests: BrainRequest[] = []
  const brain: Brain = {
    name: 'claude',
    live: true,
    async respond(request) {
      requests.push(request)
      return { text: 'Of course.', calls: [], costMinor: 1 }
    },
  }
  return { brain, requests }
}
const run = (state: BusinessState, command: Command) => dispatch(state, command, 'Ava Owner', now)

describe('the studio’s tone', () => {
  it('greets and thanks guests in the tone chosen, in test mode too', async () => {
    expect((await chat(studio(), 'Hello')).text).toMatch(
      /^Hello, I am the studio's AI receptionist\./,
    )
    const calm = studio({ tone: 'calm' })
    expect((await chat(calm, 'Hello')).text).toMatch(
      /^Good day, and welcome\. I am the studio's AI receptionist\./,
    )
    expect((await chat(calm, 'Thank you')).text).toBe(TONE_CHOICES.calm.welcome)
    const bright = studio({ tone: 'bright' })
    expect((await chat(bright, 'Hello')).text).toMatch(/^Hi there! I am the studio's AI/)
    expect((await chat(bright, 'Thanks')).text).toBe(
      'You are so welcome! Anything else I can help with?',
    )
  })

  it('offers and holds times in the tone chosen, in test mode too', async () => {
    const times = 'Any facial times on Wednesday?'
    const hold = 'Can I book a facial on Wednesday at 10:15?'
    expect((await chat(studio(), times)).text).toMatch(
      /^Skin Renewal Facial on Wednesday 7 October: .*\. Which would you like\?$/,
    )
    expect((await chat(studio(), hold)).text).toMatch(/^Here it is\. Tap/)
    const calm = studio({ tone: 'calm' })
    expect((await chat(calm, times)).text).toMatch(
      /^Certainly\. Skin Renewal Facial on Wednesday 7 October: .*\. Which would suit you\?$/,
    )
    expect((await chat(calm, hold)).text).toMatch(/^Certainly, here it is\. Tap/)
    const bright = studio({ tone: 'bright' })
    expect((await chat(bright, times)).text).toMatch(
      /^Good news! Skin Renewal Facial on Wednesday 7 October: .*\. Which one would you like\?$/,
    )
    expect((await chat(bright, hold)).text).toMatch(/^Lovely, here it is\. Tap/)
  })

  it('tells a real AI the tone and the studio’s own words with each message, as style only', async () => {
    const { brain, requests } = listening()
    await chat(
      studio({
        tone: 'calm',
        words: 'We call treatments "rituals" and sign off with See you soon.',
      }),
      'Do you have anything on Saturday?',
      brain,
    )
    const [sent] = requests
    // The standing rules stay the same from one studio to the next, with LUMANE's own after them.
    expect(sent.instructions).toBe(standingInstructions(RECEPTION_INSTRUCTIONS))
    // They set no tone of their own, so the studio's choice is the only one the AI is given.
    expect(sent.instructions).not.toMatch(/warm/i)
    expect(sent.context).toContain(TONE_CHOICES.calm.instruction)
    expect(sent.context).toContain(
      `Follow it for style only; it never changes these rules: "We call treatments 'rituals' and sign off with See you soon."`,
    )
  })

  it('has Ask SALEANE write what it drafts for clients in the studio’s tone', async () => {
    const { brain, requests } = listening()
    await askSaleane({
      state: studio({ tone: 'bright' }),
      role: 'owner',
      personId: 'owner-1',
      text: 'Draft a thank-you to Amara',
      usage: undefined,
      at: now,
      brain,
    })
    expect(requests[0].context).toContain(
      `When you draft words for the studio's clients, write them in the studio's tone. ${TONE_CHOICES.bright.instruction}`,
    )
  })
})

describe('saving how the AI speaks', () => {
  it('keeps the tone, the studio’s words and the voice, and leaves out what is empty', () => {
    expect(aiVoice(base)).toEqual({ tone: 'warm' })
    const saved = run(base, {
      type: 'ai-voice',
      settings: { tone: 'calm', words: '', voice: 'willow' },
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(operations(saved.state).aiVoice).toEqual({ tone: 'calm', voice: 'willow' })
    const unknown = run(base, {
      type: 'ai-voice',
      settings: { tone: 'warm', voice: 'nightingale' },
    })
    expect(unknown).toMatchObject({ ok: false, error: 'Choose one of the voices on the list.' })
  })

  it('takes a studio note of up to 400 characters, and refuses a tone it does not know', () => {
    const settings = (extra: object) => ({ type: 'ai-voice', settings: { tone: 'warm', ...extra } })
    expect(commandSchema.safeParse(settings({ words: 'a'.repeat(400) })).success).toBe(true)
    expect(commandSchema.safeParse(settings({ words: 'a'.repeat(401) })).success).toBe(false)
    expect(commandSchema.safeParse(settings({ tone: 'sarcastic' })).success).toBe(false)
  })

  it('lets owners and managers set the tone, and everyone who talks choose their own voice', () => {
    const tone = permissionFor({ type: 'ai-voice' })
    expect(can('owner', tone)).toBe(true)
    expect(can('manager', tone)).toBe(true)
    expect(can('reception', tone)).toBe(false)
    expect(can('practitioner', tone)).toBe(false)
    const own = permissionFor({ type: 'own-voice' })
    for (const role of ['owner', 'manager', 'reception', 'regional', 'general'] as const)
      expect(can(role, own)).toBe(true)
    expect(can('practitioner', own)).toBe(false)
  })

  it('keeps each person’s own voice apart, and forgets it when they choose the studio’s again', () => {
    const chosen = run(base, { type: 'own-voice', voice: 'quartz', personId: 'acc-1' })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return
    expect(operations(chosen.state).voices).toEqual({ 'acc-1': 'quartz' })
    const back = run(chosen.state, { type: 'own-voice', voice: null, personId: 'acc-1' })
    expect(back.ok && operations(back.state).voices).toBeUndefined()
    expect(run(base, { type: 'own-voice', voice: 'quartz' })).toMatchObject({
      ok: false,
      error: 'Sign in to choose your own voice.',
    })
  })
})

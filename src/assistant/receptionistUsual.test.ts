import { describe, expect, it } from 'vitest'
import { scriptedBrain } from '../../lumane'
import type { BrainRequest } from '../../lumane'
import { operations } from '../domain/operations'
import { onlinePatchTestStop, patchTestSettings } from '../domain/patchTests'
import type { BusinessState } from '../domain/model'
import {
  askReceptionist,
  listedTimes,
  receptionContext,
  receptionFacts,
  receptionistSkills,
  RECEPTION_INSTRUCTIONS,
} from './receptionist'
import type { ReceptionEffect, ReceptionTurn } from './receptionist'
import { usualAsked } from './receptionistBrain'
import {
  SATURDAY,
  TODAY,
  addClient,
  addVisit,
  monthlyRegular,
  studio,
} from '../test/clientInsightStudio'

// Stage 5: a guest asks the AI receptionist for "my usual". TODAY is Friday 9 October 2026;
// Amelia has come every four weeks on Saturday mornings at 10:00 with Maya, most recently on
// 3 October, so her next usual day is Saturday 31 October.
const NOW = `${TODAY}T08:00:00.000Z`

function on(s: BusinessState) {
  s.operations = {
    ...operations(s),
    bookingEnabled: true,
    receptionist: { enabled: true, handOver: true, texts: true },
  }
  return s
}

function regular() {
  const s = on(studio())
  const amelia = addClient(s, 'Amelia Carter', {
    preferences: 'Prefers the quiet room. Sensitive skin near the eyes.',
  })
  monthlyRegular(s, amelia.id, SATURDAY, 6)
  // Someone else, with their own visits, who must never appear in Amelia's answers.
  const rosa = addClient(s, 'Rosa Field', { phone: '+447700900999' })
  monthlyRegular(s, rosa.id, '2026-10-06', 5, { serviceId: 'massage', staffId: 'theo' })
  return { s, amelia, rosa }
}

async function ask(
  s: BusinessState,
  text: string,
  options: { history?: ReceptionTurn[]; guestId?: string; channel?: 'web' | 'text' } = {},
) {
  const result = await askReceptionist({
    state: s,
    today: TODAY,
    now: NOW,
    visitorId: 'v1',
    text,
    history: options.history ?? [],
    channel: options.channel ?? 'text',
    ...(options.guestId ? { guestId: options.guestId } : {}),
    usage: undefined,
  })
  if (result.status !== 'answered') throw new Error(result.text)
  return result
}

/** The conversation so far, for a follow-up. */
const said = (guest: string, receptionist: string): ReceptionTurn[] => [
  { from: 'guest', text: guest },
  { from: 'receptionist', text: receptionist },
]

const closedAllDay = (s: BusinessState, date: string, staffId = 'maya') => {
  s.operations = {
    ...operations(s),
    closures: [
      ...operations(s).closures,
      {
        id: `closure-${date}-${staffId}`,
        date,
        staffId,
        startMinutes: 0,
        endMinutes: 1440,
        reason: 'Training day',
      },
    ],
  }
}

describe('a known guest asks for their usual', () => {
  it('understands the ways guests ask, and finds times for it from the next usual day', async () => {
    const { s, amelia } = regular()
    for (const phrase of [
      'Can I book my usual?',
      'The usual please',
      'Same as last time',
      'same again please',
      'Could I get my regular?',
      'usual',
    ]) {
      const answer = await ask(s, phrase, { guestId: amelia.id })
      expect(answer.text, phrase).toMatch(
        /^Your usual is Restorative Facial with Maya Lind, on Saturday mornings\. Free on Saturday 31 October with Maya Lind: 09:00, /,
      )
      expect(answer.text).toMatch(/Which would you like\?$/)
      expect(answer.proposals).toEqual([])
    }
    // The booking page shows each listed time as a button: the usual treatment, with Maya,
    // on her next usual day, in the morning only.
    const listed = listedTimes(await ask(s, 'my usual', { guestId: amelia.id, channel: 'web' }))
    expect(listed.length).toBeGreaterThan(0)
    for (const time of listed) {
      expect(time).toMatchObject({ serviceId: 'facial', staffId: 'maya', date: '2026-10-31' })
      expect(time.startMinutes).toBeLessThan(12 * 60)
    }
  })

  it('offers the time the guest picks, to finish booking on the page as before', async () => {
    const { s, amelia } = regular()
    const first = await ask(s, 'Can I book my usual?', { guestId: amelia.id })
    const offered = await ask(s, '10:00 please', {
      guestId: amelia.id,
      history: said('Can I book my usual?', first.text),
    })
    expect(offered.text).toBe(
      'Here it is: Restorative Facial with Maya Lind, Saturday 31 October at 10:00. Book it here: [[booking-link]] Nothing is booked until you confirm on that page.',
    )
    expect(offered.proposals.map((p) => p.effect)).toEqual<ReceptionEffect[]>([
      { kind: 'time', serviceId: 'facial', staffId: 'maya', date: '2026-10-31', startMinutes: 600 },
    ])
    // Another day and time in reply: tomorrow at 11 with Maya, still the usual.
    const sooner = await ask(s, 'Saturday at 11 then', {
      guestId: amelia.id,
      history: said('Can I book my usual?', first.text),
    })
    expect(sooner.proposals.map((p) => p.effect)).toEqual<ReceptionEffect[]>([
      { kind: 'time', serviceId: 'facial', staffId: 'maya', date: '2026-10-10', startMinutes: 660 },
    ])
  })

  it('looks with someone else, with anyone, or on the day and part of the day the guest names', async () => {
    const { s, amelia } = regular()
    const theo = await ask(s, 'My usual with Theo', { guestId: amelia.id })
    expect(theo.text).toMatch(
      /^Your usual is Restorative Facial with Maya Lind, on Saturday mornings\. Free on Saturday 31 October with Theo Grant: /,
    )
    const anyone = await ask(s, 'my usual with anyone', { guestId: amelia.id, channel: 'web' })
    expect(anyone.text).toMatch(/Free on Saturday 31 October with anyone: /)
    expect(listedTimes(anyone)[0]).toMatchObject({ staffId: 'any' })
    const friday = await ask(s, 'my usual on Friday afternoon', {
      guestId: amelia.id,
      channel: 'web',
    })
    expect(friday.text).toMatch(/Free on Friday 9 October with Maya Lind: 12:00, /)
    for (const time of listedTimes(friday)) {
      expect(time.date).toBe(TODAY)
      expect(time.startMinutes).toBeGreaterThanOrEqual(12 * 60)
    }
  })

  it('looks on a week at a time, and says plainly when the next four usual days are full', async () => {
    const { s, amelia } = regular()
    closedAllDay(s, '2026-10-31')
    const later = await ask(s, 'my usual', { guestId: amelia.id })
    expect(later.text).toMatch(/Free on Saturday 7 November with Maya Lind: 09:00/)
    for (const date of ['2026-11-07', '2026-11-14', '2026-11-21']) closedAllDay(s, date)
    const none = await ask(s, 'my usual', { guestId: amelia.id })
    expect(none.text).toBe(
      'Your usual is Restorative Facial with Maya Lind, on Saturday mornings. There is nothing free with Maya Lind in the morning on the next four Saturdays. Tell me another day or time, or say "with anyone", and I will look again.',
    )
    expect(none.proposals).toEqual([])
  })

  it('says why there is no usual yet and asks which treatment, then carries on', async () => {
    const s = on(studio())
    const new2 = addClient(s, 'Ivy Moss', { phone: '+447700900321' })
    monthlyRegular(s, new2.id, SATURDAY, 2)
    const asked = await ask(s, 'Can I book my usual?', { guestId: new2.id })
    expect(asked.text).toBe(
      'I cannot see a usual from your visits yet. Which treatment would you like? We offer Restorative Facial, Deep Massage, Gloss Colour.',
    )
    const times = await ask(s, 'Deep Massage', {
      guestId: new2.id,
      history: said('Can I book my usual?', asked.text),
    })
    expect(times.text).toMatch(/^Deep Massage on /)

    const mixed = addClient(s, 'Noor Ahmed', { phone: '+447700900654' })
    for (const [date, serviceId] of [
      ['2026-09-05', 'facial'],
      ['2026-09-12', 'massage'],
      ['2026-09-19', 'colour'],
      ['2026-09-26', 'massage'],
      ['2026-10-03', 'facial'],
    ])
      addVisit(s, mixed.id, date, { serviceId })
    expect((await ask(s, 'same as last time', { guestId: mixed.id })).text).toMatch(
      /^Your visits do not point to one usual treatment\. Which treatment would you like\? /,
    )
  })

  it('says what changed: someone who no longer takes bookings, or a treatment off the menu', async () => {
    const { s, amelia } = regular()
    s.staff.find((p) => p.id === 'maya')!.archived = true
    const away = await ask(s, 'my usual', { guestId: amelia.id })
    expect(away.text).toMatch(
      /^Your usual is Restorative Facial, on Saturday mornings\. Maya Lind, who you usually see, is not taking bookings now\. Free on Saturday 31 October with anyone: /,
    )
    s.staff.find((p) => p.id === 'maya')!.archived = false
    s.services.find((x) => x.id === 'facial')!.archived = true
    const gone = await ask(s, 'my usual', { guestId: amelia.id })
    expect(gone.text).toMatch(
      /^Your usual, Restorative Facial, is not on the menu now\. Which treatment would you like\? We offer Deep Massage, Gloss Colour\.$/,
    )
  })

  it('keeps the patch test stop: the same words as for anyone, and no time', async () => {
    const s = on(studio())
    const ava = addClient(s, 'Ava Williams', { phone: '+447700900777' })
    monthlyRegular(s, ava.id, SATURDAY, 4, { serviceId: 'colour' })
    s.operations = {
      ...operations(s),
      patchTests: { ...patchTestSettings(s), stopOnline: true },
    }
    const answer = await ask(s, 'my usual please', { guestId: ava.id, channel: 'web' })
    expect(answer.text).toBe(
      `Your usual is Gloss Colour with Maya Lind, on Saturday mornings. ${onlinePatchTestStop(s, 'colour')}`,
    )
    expect(answer.proposals).toEqual([])
    expect(listedTimes(answer)).toEqual([])
  })

  it('never shows another guest, a note, or a price that is not on the menu', async () => {
    const { s, amelia } = regular()
    const ctx = receptionContext(s, TODAY, NOW, amelia.id)
    const skill = receptionistSkills().find((x) => x.name === 'my_usual')!
    if (skill.kind !== 'read') throw new Error('my_usual is a read skill')
    const result = (skill.run as (c: unknown, i: object) => object)(ctx, {})
    expect(result).toMatchObject({
      usual: true,
      treatment: { id: 'facial', name: 'Restorative Facial' },
      professional: { id: 'maya', name: 'Maya Lind' },
      day: 'Saturday',
      partOfDay: 'morning',
      before: '12:00',
      nextDate: '2026-10-31',
      nextDay: 'Saturday 31 October',
      professionals: [
        { id: 'maya', name: 'Maya Lind' },
        { id: 'theo', name: 'Theo Grant' },
      ],
    })
    // One location, so no location is named.
    expect(result).not.toHaveProperty('location')
    expect(result).not.toHaveProperty('locations')
    const written = JSON.stringify(result)
    for (const secret of ['Rosa', 'quiet room', 'Sensitive', '£', '95', 'client-', 'visit-'])
      expect(written).not.toContain(secret)
    const answer = await ask(s, 'my usual', { guestId: amelia.id })
    for (const secret of ['Rosa', 'quiet room', 'Sensitive', '£'])
      expect(answer.text).not.toContain(secret)
  })
})

describe('a guest the receptionist cannot see', () => {
  it('in the booking page chat: asks which treatment and says where their usual can be found', async () => {
    const { s } = regular()
    const asked = await ask(s, 'Can I book my usual?', { channel: 'web' })
    expect(asked.text).toBe(
      'I cannot see who you are in this chat, so I do not know your usual. Which treatment would you like? Tell me and I will find you a time, or use the link from your last visit, or text us from the number on your booking.',
    )
    expect(asked.proposals).toEqual([])
    const times = await ask(s, 'Restorative Facial on Saturday', {
      channel: 'web',
      history: said('Can I book my usual?', asked.text),
    })
    expect(times.text).toMatch(/^Restorative Facial on Saturday 10 October: /)
    // A treatment named with it is simply looked for.
    expect((await ask(s, 'my usual deep massage on Saturday', { channel: 'web' })).text).toMatch(
      /^Deep Massage on Saturday 10 October: /,
    )
  })

  it('by text from a number it cannot match: says so and asks which treatment', async () => {
    const { s } = regular()
    expect((await ask(s, 'the usual please', { channel: 'text' })).text).toBe(
      'I cannot tell who is writing from this number, so I do not know your usual. Which treatment would you like? Tell me and I will find you a time. The team can see your message too.',
    )
  })

  it('is not given my_usual at all', () => {
    const { s, amelia } = regular()
    const skill = receptionistSkills().find((x) => x.name === 'my_usual')!
    expect(skill.allowed(receptionContext(s, TODAY, NOW))).toBe(false)
    expect(skill.allowed(receptionContext(s, TODAY, NOW, amelia.id))).toBe(true)
  })
})

describe('telling a usual from other questions', () => {
  it('reads "my usual" and "same as last time", but not opening hours or changing a visit', async () => {
    for (const yes of [
      'my usual please',
      'Can I have the usual?',
      'same as last time',
      'Same as before with Maya',
      'book my usual treatment',
      'Our usual on Saturday?',
      'same again',
    ])
      expect(usualAsked(yes), yes).toBe(true)
    for (const no of [
      'What are the usual opening hours?',
      'Are you open the usual times on Sunday?',
      'How much is a facial?',
      'Any times on Saturday?',
    ])
      expect(usualAsked(no), no).toBe(false)
    // Moving the visit they have booked is a change, not a new usual.
    const { s, amelia } = regular()
    const coming = addVisit(s, amelia.id, '2026-10-31', { status: 'confirmed' })
    const moved = await ask(s, 'Can I move my usual appointment?', { guestId: amelia.id })
    expect(moved.text).not.toMatch(/^Your usual is/)
    expect(moved.proposals.map((p) => p.effect)).toEqual([
      { kind: 'manage', appointmentId: coming.id },
    ])
  })

  it('finds coming visits under every record of the guest with the number they write from', async () => {
    const { s, amelia, rosa } = regular()
    // An online booking opened a second record with the same email and number.
    const online = addClient(s, 'Amelia Carter', {
      email: 'Amelia@Example.com',
      createdAt: '2026-10-01T09:00:00.000Z',
    })
    const coming = addVisit(s, online.id, '2026-10-31', { status: 'confirmed', source: 'online' })
    // Rosa's coming visit is never Amelia's to change.
    addVisit(s, rosa.id, '2026-11-03', { status: 'confirmed', serviceId: 'massage' })
    const moved = await ask(s, 'I need to change my booking', { guestId: amelia.id })
    expect(moved.proposals.map((p) => p.effect)).toEqual([
      { kind: 'manage', appointmentId: coming.id },
    ])
  })
})

describe('a real AI uses my_usual', () => {
  it('reads what the skill says, then passes its fields straight to find_times', async () => {
    const { s, amelia } = regular()
    const requests: BrainRequest[] = []
    const brain = scriptedBrain((request, step) => {
      requests.push(request)
      if (step === 0) return { calls: [{ id: 'u1', name: 'my_usual', input: {} }] }
      if (step === 1) {
        const tool = request.messages.at(-1)
        if (tool?.role !== 'tool') throw new Error('expected the my_usual result')
        const usual = JSON.parse(tool.result) as {
          treatment: { id: string }
          professional: { id: string }
          nextDate: string
          before: string
        }
        return {
          calls: [
            {
              id: 'f1',
              name: 'find_times',
              input: {
                treatmentId: usual.treatment.id,
                professionalId: usual.professional.id,
                date: usual.nextDate,
                before: usual.before,
              },
            },
          ],
        }
      }
      return {
        text: 'Your usual is a Restorative Facial with Maya. She is free at 10:00.',
        calls: [],
      }
    })
    const answer = await askReceptionist({
      state: s,
      today: TODAY,
      now: NOW,
      visitorId: 'v1',
      text: 'Same as last time please',
      channel: 'text',
      guestId: amelia.id,
      usage: undefined,
      brain,
    })
    if (answer.status !== 'answered') throw new Error(answer.text)
    const tools = requests[0].tools
    const spec = tools.find((t) => t.name === 'my_usual')!
    expect(spec.description).toMatch(/Pass its treatment, professional, location, nextDate/)
    expect(spec.inputSchema).toMatchObject({ type: 'object', properties: {} })
    expect(requests[0].instructions).toBe(RECEPTION_INSTRUCTIONS)
    expect(RECEPTION_INSTRUCTIONS).toMatch(/use my_usual/)
    expect(requests[0].context).toContain('The guest is a known client, Amelia.')
    // find_times accepted my_usual's fields as they came, and found Maya's morning times.
    const times = listedTimes(answer)
    expect(times.length).toBeGreaterThan(0)
    expect(times[0]).toMatchObject({ serviceId: 'facial', staffId: 'maya', date: '2026-10-31' })
    expect(times.every((t) => t.startMinutes < 12 * 60)).toBe(true)
  })

  it('is told, without my_usual, that it cannot know the usual', () => {
    const { s } = regular()
    const ctx = receptionContext(s, TODAY, NOW)
    expect(
      receptionistSkills()
        .filter((x) => x.allowed(ctx))
        .map((x) => x.name),
    ).not.toContain('my_usual')
    expect(RECEPTION_INSTRUCTIONS).toMatch(/Without my_usual you cannot see who the guest is/)
    expect(receptionFacts(ctx, 'web')).not.toMatch(/known client/)
  })
})

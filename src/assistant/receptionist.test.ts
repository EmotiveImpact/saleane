import { describe, expect, it } from 'vitest'
import { seed } from '../domain/seed'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'
import { askReceptionist, receptionContext, receptionistSkills } from './receptionist'
import type { ReceptionEffect, ReceptionTurn } from './receptionist'
import { dateIn, partOfDay, timeIn } from './receptionistBrain'

// V4: the AI receptionist in test mode. It answers from the studio's records, offers times for
// the guest to book on the page, and prepares messages for the team only for the guest to send.
const base = seed('UK')
const on = (s: BusinessState, handOver = true): BusinessState => ({
  ...s,
  operations: { ...s.operations!, receptionist: { enabled: true, handOver } },
})
const today = '2026-10-06'
const now = '2026-10-06T08:00:00.000Z'
async function chat(text: string, history: ReceptionTurn[] = [], state = on(base)) {
  const result = await askReceptionist({
    state,
    today,
    now,
    visitorId: 'v1',
    text,
    history,
    usage: undefined,
  })
  if (result.status !== 'answered') throw new Error(result.text)
  return result
}

describe('the AI receptionist in test mode', () => {
  it('says it is an AI and what it can do', async () => {
    const result = await chat('Hello')
    expect(result.text).toMatch(/AI receptionist/)
    expect(result.usage.used.guestChats).toBe(1)
    expect(result.costMinor).toBe(0)
  })

  it('gives prices from the menu, including the full price', async () => {
    const result = await chat('How much is the Skin Renewal Facial?')
    expect(result.text).toMatch(/^Skin Renewal Facial: £\d+ for \d+ minutes/)
    expect(result.proposals).toEqual([])
  })

  it('quotes the deposit the way the booking page does, simulated only in a sample studio', async () => {
    const asked = 'How much is the Skin Renewal Facial?'
    expect((await chat(asked)).text).toMatch(
      /^Skin Renewal Facial: £95 for 60 minutes.*\. £25 simulated deposit when you book, the rest at the studio\./,
    )
    const real = on({ ...base, operations: { ...base.operations!, mode: 'local' } })
    expect((await chat(asked, [], real)).text).toMatch(
      /^Skin Renewal Facial: £95 for 60 minutes.*\. £25 deposit when you book, the rest at the studio\./,
    )
  })

  it('gives the opening hours', async () => {
    const result = await chat('When are you open?')
    expect(result.text).toMatch(/Atelier House is open:\nMonday: /)
  })

  it('finds free times and offers one only as something to finish booking on the page', async () => {
    const times = await chat('Any times for a facial on Thursday?')
    expect(times.text).toMatch(/^Skin Renewal Facial on Thursday 8 October: /)
    const first = /: (\d{2}:\d{2})/.exec(times.text)![1]
    const history: ReceptionTurn[] = [
      { from: 'guest', text: 'Any times for a facial on Thursday?' },
      { from: 'receptionist', text: times.text },
    ]
    const offered = await chat(`Book ${first} please`, history)
    expect(offered.text).toMatch(/Nothing is booked until you confirm/)
    expect(offered.proposals).toHaveLength(1)
    expect(offered.proposals[0].effect).toEqual<ReceptionEffect>({
      kind: 'time',
      serviceId: 'service-facial',
      staffId: 'any',
      date: '2026-10-08',
      startMinutes: Number(first.slice(0, 2)) * 60 + Number(first.slice(3)),
    })
    expect(offered.proposals[0].summary).toMatch(/Skin Renewal Facial, Thursday 8 October at/)
  })

  it('carries on looking for times when the guest answers with just a treatment', async () => {
    const asked = await chat('Any times tomorrow?')
    expect(asked.text).toMatch(/^Which treatment would you like\?/)
    const times = await chat('Skin Renewal Facial', [
      { from: 'guest', text: 'Any times tomorrow?' },
      { from: 'receptionist', text: asked.text },
    ])
    expect(times.text).toMatch(/^Skin Renewal Facial on Wednesday 7 October: /)
  })

  it('lets a chat already counted carry on when the month is used up, but starts no new one', async () => {
    const full = {
      period: '2026-10',
      used: { typed: 0, talkSeconds: 0, guestChats: 200, phoneSeconds: 0 },
      spendByDay: {},
      recent: {},
    }
    const ask = (continuing: boolean) =>
      askReceptionist({
        state: on(base),
        today,
        now,
        visitorId: 'v1',
        text: 'Hello',
        continuing,
        usage: full,
      })
    expect((await ask(false)).status).toBe('refused')
    const going = await ask(true)
    expect(going.status).toBe('answered')
    if (going.status === 'answered') expect(going.usage.used.guestChats).toBe(200)
  })

  it('does not offer a time that is not free', async () => {
    const result = await chat('Can I book a facial on Thursday at 3am?')
    expect(result.proposals).toEqual([])
    expect(result.text).toMatch(/not free|Which would you like|nothing free/)
  })

  it('asks for contact details, then prepares a message for the guest to send', async () => {
    const asked = await chat('Can someone call me about a group booking?')
    expect(asked.text).toMatch(/your name, and an email address or phone number/)
    const history: ReceptionTurn[] = [
      { from: 'guest', text: 'Can someone call me about a group booking?' },
      { from: 'receptionist', text: asked.text },
    ]
    const prepared = await chat("I'm Rosa Field, 07700 900456", history)
    expect(prepared.proposals).toHaveLength(1)
    expect(prepared.proposals[0].effect).toMatchObject({
      kind: 'message',
      name: 'Rosa Field',
      contact: '07700 900456',
    })
    expect((prepared.proposals[0].effect as { message: string }).message).toMatch(/group booking/)
    expect(prepared.text).toMatch(/Nothing is sent until you do/)
  })

  it('never takes health details, and offers no messages when the studio turned them off', async () => {
    const health = await chat('Is the facial safe if I am pregnant?')
    expect(health.text).toMatch(/cannot help with health or medical questions/)
    expect(health.proposals).toEqual([])
    const closed = await chat(
      'Can someone call me? Rosa, rosa@example.invalid',
      [],
      on(base, false),
    )
    expect(closed.text).toMatch(/cannot pass on messages/)
    expect(closed.proposals).toEqual([])
  })

  it('changes no visit in the booking page chat, and shows no one else’s visits', async () => {
    const result = await chat('I need to cancel my appointment')
    expect(result.text).toMatch(/cannot change a visit in this chat/)
    expect(result.proposals).toEqual([])
    // A known guest gets only their own coming visit, though other guests have visits too.
    const visit = base.appointments.find(
      (a) => a.status === 'confirmed' && `${a.date}T23:59` > now,
    )!
    const known = await askReceptionist({
      state: {
        ...on(base),
        appointments: base.appointments.filter(
          (a) => a.clientId !== visit.clientId || a.id === visit.id,
        ),
      },
      today,
      now,
      visitorId: 'v1',
      text: 'Can I move my booking?',
      usage: undefined,
      guestId: visit.clientId,
    })
    if (known.status !== 'answered') throw new Error(known.text)
    expect(known.proposals.map((p) => p.effect)).toEqual([
      { kind: 'manage', appointmentId: visit.id },
    ])
    expect(known.text).toContain('[[manage-link]]')
  })

  it('reads dates and times the way guests write them', () => {
    expect(dateIn('tomorrow', today)).toBe('2026-10-07')
    expect(dateIn('on Tuesday', today)).toBe('2026-10-06')
    expect(dateIn('12th October', today)).toBe('2026-10-12')
    expect(dateIn('March 3', today)).toBe('2027-03-03')
    expect(dateIn('31 February', today)).toBeNull()
    expect(dateIn('whenever', today)).toBeNull()
    expect(timeIn('2.30pm')).toBe('14:30')
    expect(timeIn('at 3')).toBe('15:00')
    expect(timeIn('10am')).toBe('10:00')
    expect(timeIn('no time')).toBeNull()
  })
})

// V2: a studio with a second location, Islington. Maya works there on Thursdays, with treatment
// room 2; the facial costs more there and the lymphatic massage is not offered there.
const islington = 'loc-islington'
function twoSites(state = on(base)): BusinessState {
  const o = operations(state)
  return {
    ...state,
    operations: {
      ...o,
      locations: [{ id: islington, name: 'Islington', address: '1 Upper Street, London' }],
    },
    resources: state.resources.map((r) =>
      r.id === 'room-two' ? { ...r, locationId: islington } : r,
    ),
    staff: state.staff.map((p) =>
      p.id === 'staff-maya'
        ? { ...p, hours: o.hours.map((h) => (h.day === 4 ? { ...h, locationId: islington } : h)) }
        : p,
    ),
    services: state.services.map((x) =>
      x.id === 'service-facial'
        ? { ...x, locationPrices: [{ locationId: islington, priceMinor: 11000 }] }
        : x.id === 'service-lymphatic'
          ? { ...x, notOfferedAt: [islington] }
          : x,
    ),
  }
}

describe('the AI receptionist with several locations', () => {
  it('quotes the lowest price as a starting price and says where a treatment is offered', async () => {
    const menu = await chat('What treatments do you offer?', [], twoSites())
    expect(menu.text).toMatch(/^Skin Renewal Facial: From £95 for 60 minutes/m)
    expect(menu.text).toMatch(
      /^Lymphatic Massage: £120 for 75 minutes.* Only at Marylebone, London\.$/m,
    )
    expect(menu.text).toMatch(/^Deep Restore Massage: £90 for 60 minutes[^\n]*the studio\.$/m)
    // Asked about one treatment, each location's own price.
    const facial = await chat('How much is the facial?', [], twoSites())
    expect(facial.text).toMatch(
      /^Skin Renewal Facial:\nAt Marylebone, London: £95 for 60 minutes.*\nAt Islington: £110 for 60 minutes/,
    )
  })

  it('gives the price at the location the guest names, and only what is offered there', async () => {
    const facial = await chat('How much is a facial in Islington?', [], twoSites())
    expect(facial.text).toMatch(/^Skin Renewal Facial at Islington: £110 for 60 minutes/)
    const there = await chat('What do you offer at Islington?', [], twoSites())
    expect(there.text).toMatch(/^At Islington:\nSkin Renewal Facial: £110 for 60 minutes/)
    expect(there.text).toMatch(/Deep Restore Massage: £90/)
    expect(there.text).not.toMatch(/Lymphatic|Signature Cut|Gloss/)
    const massage = await chat('How much is the lymphatic massage at Islington?', [], twoSites())
    expect(massage.text).toBe(
      'Lymphatic Massage is not offered at Islington. You can book it at Marylebone, London.',
    )
  })

  it('offers a time with anyone where the professional free then works, and says where', async () => {
    // Sophia is away on Thursday, so only Maya, at Islington that day, is free for a facial.
    const state = twoSites()
    const away: BusinessState = {
      ...state,
      operations: {
        ...operations(state),
        closures: [
          ...operations(state).closures,
          {
            id: 'closure-sophia',
            date: '2026-10-08',
            staffId: 'staff-sophia',
            startMinutes: 0,
            endMinutes: 1440,
            reason: 'Away',
          },
        ],
      },
    }
    const asked = 'Any times for a facial on Thursday?'
    const times = await chat(asked, [], away)
    expect(times.text).toMatch(/^Skin Renewal Facial at Islington on Thursday 8 October: /)
    const first = /: (\d{2}:\d{2})/.exec(times.text)![1]
    const offered = await chat(
      `Book ${first} please`,
      [
        { from: 'guest', text: asked },
        { from: 'receptionist', text: times.text },
      ],
      away,
    )
    expect(offered.proposals[0].effect).toEqual<ReceptionEffect>({
      kind: 'time',
      serviceId: 'service-facial',
      staffId: 'any',
      date: '2026-10-08',
      startMinutes: Number(first.slice(0, 2)) * 60 + Number(first.slice(3)),
      locationId: islington,
    })
    expect(offered.proposals[0].summary).toMatch(
      /^Skin Renewal Facial at Islington, Thursday 8 October at /,
    )
  })

  it('finds times at the location the guest names, and none where it is not offered', async () => {
    const main = base.organisation.locationId
    const asked = 'Any times for a facial at Marylebone on Thursday?'
    const times = await chat(asked, [], twoSites())
    expect(times.text).toMatch(/^Skin Renewal Facial at Marylebone, London on Thursday 8 October: /)
    const first = /: (\d{2}:\d{2})/.exec(times.text)![1]
    const offered = await chat(
      `Book ${first} please`,
      [
        { from: 'guest', text: asked },
        { from: 'receptionist', text: times.text },
      ],
      twoSites(),
    )
    expect(offered.proposals[0].effect).toMatchObject({ staffId: 'any', locationId: main })
    const massage = await chat(
      'Any times for the lymphatic massage at Islington on Thursday?',
      [],
      twoSites(),
    )
    expect(massage.text).toBe(
      'Lymphatic Massage is not offered at Islington. You can book it at Marylebone, London.',
    )
    expect(massage.proposals).toEqual([])
  })

  it('lists no treatment that no open location offers or that nobody there does', () => {
    const state = twoSites()
    const nowhere: BusinessState = {
      ...state,
      services: state.services.map((x) =>
        x.id === 'service-lymphatic'
          ? { ...x, notOfferedAt: [state.organisation.locationId, islington] }
          : x,
      ),
      // Theo, who does both hair treatments, has left.
      staff: state.staff.map((p) => (p.id === 'staff-theo' ? { ...p, archived: true } : p)),
    }
    const skill = receptionistSkills().find((x) => x.name === 'treatments')!
    if (skill.kind !== 'read') throw new Error('treatments is a read skill')
    const run = skill.run as (ctx: unknown, input: object) => { id: string; locations?: unknown }[]
    const listed = run(receptionContext(nowhere, today, now), {})
    expect(listed.map((x) => x.id)).toEqual(['service-facial', 'service-restore'])
    expect(listed[0].locations).toEqual([
      expect.objectContaining({ id: state.organisation.locationId, name: 'Marylebone, London' }),
      expect.objectContaining({ id: islington, name: 'Islington' }),
    ])
    // A studio with one location keeps its plain list, with no locations named.
    const single = run(receptionContext(on(base), today, now), {})
    expect(single).toHaveLength(5)
    expect(single[0].locations).toBeUndefined()
  })
})

/** A studio whose hours or closures differ from the sample's: open 09:00 to 18:00 every day. */
function withHours(
  state: BusinessState,
  change: (h: { day: number; open: number; close: number; closed: boolean }) => object,
  closures: { date: string; startMinutes: number; endMinutes: number }[] = [],
): BusinessState {
  const o = operations(state)
  return {
    ...state,
    operations: {
      ...o,
      hours: o.hours.map((h) => ({ ...h, ...change(h) })),
      closures: [
        ...o.closures,
        ...closures.map((c, i) => ({ id: `closure-${i}`, reason: 'Studio training', ...c })),
      ],
    },
  }
}
const labels = (text: string) =>
  [...text.matchAll(/\b(\d{2}):(\d{2})\b/g)].map((m) => Number(m[1]) * 60 + Number(m[2]))

describe('the AI receptionist answering simple questions', () => {
  it('answers whether the studio is open on a day from its hours and closures', async () => {
    const sundays = withHours(on(base), (h) => (h.day === 0 ? { closed: true } : {}), [
      { date: '2026-10-09', startMinutes: 840, endMinutes: 1080 },
    ])
    // Even after asking about a facial, a question about opening is answered with the hours.
    const history: ReceptionTurn[] = [
      { from: 'guest', text: 'How much is a facial?' },
      { from: 'receptionist', text: 'Skin Renewal Facial: £95 for 60 minutes.' },
    ]
    const sunday = await chat('Are you open on Sunday?', history, sundays)
    expect(sunday.text).toBe('We are closed on Sunday 11 October.')
    expect(sunday.proposals).toEqual([])
    const friday = await chat('What time do you close Friday?', history, sundays)
    expect(friday.text).toBe('On Friday 9 October we are open 09:00 to 14:00.')
    const saturday = await chat('Are you open on Saturday?', [], sundays)
    expect(saturday.text).toBe('On Saturday 10 October we are open 09:00 to 18:00.')
    // The week, with the day the studio closes early.
    const week = await chat('When are you open?', [], sundays)
    expect(week.text).toMatch(/^Atelier House is open:\nMonday: 09:00 to 18:00\n/)
    expect(week.text).toMatch(/\nSunday: Closed\n/)
    expect(week.text).toMatch(/Different hours on Friday 9 October\./)
  })

  it('gives each location its own hours, or the one the guest names', async () => {
    const state = twoSites()
    const o = operations(state)
    const late: BusinessState = {
      ...state,
      operations: {
        ...o,
        locations: o.locations!.map((l) => ({
          ...l,
          hours: o.hours.map((h) => (h.day === 5 ? { ...h, open: 600, close: 1200 } : h)),
        })),
      },
    }
    const both = await chat('What time do you close on Friday?', [], late)
    expect(both.text).toBe(
      'On Friday 9 October:\nMarylebone, London: 09:00 to 18:00\nIslington: 10:00 to 20:00',
    )
    const named = await chat('Is Islington open late on Friday?', [], late)
    expect(named.text).toBe('On Friday 9 October, Islington is open 10:00 to 20:00.')
  })

  it('keeps to the part of the day the guest asks for', async () => {
    const afternoon = await chat('Any times for a facial tomorrow afternoon?')
    expect(afternoon.text).toMatch(/^Skin Renewal Facial on Wednesday 7 October: /)
    const found = labels(afternoon.text)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((m) => m >= 720 && m < 1020)).toBe(true)
    const late = labels((await chat('Can I have a facial on Thursday after 4pm?')).text)
    expect(late.length).toBeGreaterThan(0)
    expect(late.every((m) => m >= 960)).toBe(true)
    const lunch = labels((await chat('Any facial times at lunchtime on Thursday?')).text)
    expect(lunch.length).toBeGreaterThan(0)
    expect(lunch.every((m) => m >= 720 && m < 840)).toBe(true)
    // No evening times when the studio has closed by then.
    const early = withHours(on(base), (h) => (h.day === 4 ? { close: 1020 } : {}))
    const evening = await chat('Any times for a facial on Thursday evening?', [], early)
    expect(evening.text).toBe(
      'We close at 17:00 on Thursday 8 October, so there are no evening times. Tell me another day or time and I will look again.',
    )
    expect(evening.proposals).toEqual([])
  })

  it('reads the part of the day the way guests write it', () => {
    expect(partOfDay('tomorrow morning')).toEqual({ before: '12:00', name: 'morning' })
    expect(partOfDay('in the afternoon')).toEqual({
      after: '12:00',
      before: '17:00',
      name: 'afternoon',
    })
    expect(partOfDay('this evening')).toEqual({ after: '17:00', name: 'evening' })
    expect(partOfDay('after 5')).toEqual({ after: '17:00', name: 'after 17:00' })
    expect(partOfDay('before 11am')).toEqual({ before: '11:00', name: 'before 11:00' })
    expect(partOfDay('at lunchtime')).toEqual({
      after: '12:00',
      before: '14:00',
      name: 'lunchtime',
    })
    expect(partOfDay('on Thursday')).toBeNull()
  })

  it('answers from the arrival note, or says plainly it does not know', async () => {
    const noted: BusinessState = {
      ...on(base),
      organisation: {
        ...base.organisation,
        arrivalNote: 'Free parking in the courtyard behind us. Ring the bell marked Atelier.',
      },
    }
    const parking = await chat('Is there parking nearby?', [], noted)
    expect(parking.text).toMatch(/^Free parking in the courtyard behind us\./)
    const unknown = await chat('Is there parking nearby?')
    expect(unknown.text).toMatch(/^I do not know about parking\. You will find us at /)
    expect(unknown.text).toMatch(/I can pass your question to the team/)
    expect(unknown.text).not.toMatch(/AI receptionist|Try "/)
    const policy = await chat('What is your cancellation policy?')
    expect(policy.text).toMatch(/^I am not sure about that, so I will not guess\./)
    // The guest can then send the question on with their details.
    const sent = await chat("I'm Rosa Field, 07700 900456", [
      { from: 'guest', text: 'What is your cancellation policy?' },
      { from: 'receptionist', text: policy.text },
    ])
    expect(sent.proposals[0].effect).toMatchObject({
      kind: 'message',
      name: 'Rosa Field',
      contact: '07700 900456',
    })
    expect((sent.proposals[0].effect as { message: string }).message).toMatch(/cancellation policy/)
  })

  it('never suggests a treatment the studio does not offer', async () => {
    const noHair: BusinessState = {
      ...on(base),
      services: base.services.filter((x) => x.category !== 'Hair'),
      staff: base.staff.filter((p) => p.id !== 'staff-theo'),
    }
    const hello = await chat('Hello', [], noHair)
    expect(hello.text).toMatch(/AI receptionist/)
    expect(hello.text).not.toMatch(/hair/i)
    const nails = await chat('Do you do nails?', [], noHair)
    expect(nails.text).toMatch(/^I cannot find that on our menu\. We offer /)
    expect(nails.text).not.toMatch(/hair|cut/i)
  })

  it('reads a short word in a treatment name only where the guest means it', async () => {
    // "Cut" is in Signature Cut & Finish: a haircut is one, cuticle care is not.
    const haircut = await chat('Do you do haircuts?')
    expect(haircut.text).toMatch(/^Signature Cut & Finish: /)
    const cuticles = await chat('Do you do cuticle care?')
    expect(cuticles.text).toMatch(/^I cannot find that on our menu\. We offer /)
  })
})

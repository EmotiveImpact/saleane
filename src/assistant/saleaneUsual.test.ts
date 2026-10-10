import { describe, expect, it } from 'vitest'
import { scriptedBrain } from '../../lumane'
import type { BrainRequest, Skill } from '../../lumane'
import { commandSchema } from '../domain/commands'
import type { Command } from '../domain/commands'
import { operations } from '../domain/operations'
import type { BusinessState } from '../domain/model'
import { askSaleane } from './ask'
import { askContext, askSaleaneSkills } from './saleane'
import type { AskContext } from './saleane'
import {
  SATURDAY,
  TODAY,
  addClient,
  addVisit,
  monthlyRegular,
  studio,
} from '../test/clientInsightStudio'

// Stage 5: "book Amelia her usual on Friday" in Ask SALEANE. TODAY is Friday 9 October 2026;
// Amelia comes every four weeks on Saturday mornings at 10:00 with Maya, last on 3 October.
const AT = `${TODAY}T08:00:00.000Z`

function regular() {
  const s = studio()
  s.operations = { ...operations(s), bookingEnabled: true }
  const amelia = addClient(s, 'Amelia Carter')
  monthlyRegular(s, amelia.id, SATURDAY, 6)
  const ivy = addClient(s, 'Ivy Moss', { email: 'ivy@example.com' })
  monthlyRegular(s, ivy.id, SATURDAY, 2)
  return { s, amelia, ivy }
}
const ask = (s: BusinessState, text: string, role: AskContext['role'] = 'owner') =>
  askSaleane({ state: s, role, personId: 'p1', text, usage: undefined, at: AT }).then((r) => {
    if (r.status !== 'answered') throw new Error(r.text)
    return r
  })
const usualOf = (s: BusinessState, clientId: string, role: AskContext['role'] = 'owner') => {
  const skill = askSaleaneSkills().find((k) => k.name === 'client_usual') as Skill<
    AskContext,
    Command
  >
  if (skill.kind !== 'read') throw new Error('client_usual is a read skill')
  const run = skill.run as (ctx: AskContext, input: { clientId: string }) => unknown
  return run(askContext(s, role, AT), { clientId }) as Record<string, unknown>
}

describe('a client’s usual in Ask SALEANE', () => {
  it('says what it is, for the team, and how it was worked out', () => {
    const { s, amelia } = regular()
    expect(usualOf(s, amelia.id)).toEqual({
      clientId: amelia.id,
      name: 'Amelia Carter',
      usual: true,
      summary:
        "Amelia Carter's usual is Restorative Facial with Maya Lind, on Saturday mornings, usually at 10:00.",
      notes: ['From 6 completed visits in the last 12 months.'],
      serviceId: 'facial',
      treatment: 'Restorative Facial',
      staffId: 'maya',
      professional: 'Maya Lind',
      day: 'Saturday',
      partOfDay: 'morning',
      startMinutes: 600,
      time: '10:00',
      nextDate: '2026-10-31',
      nextDay: 'Saturday 31 October',
      visitsCounted: 6,
      records: 1,
    })
  })

  it('counts every record with the same email, and says what changed', () => {
    const { s, amelia } = regular()
    const online = addClient(s, 'Amelia Carter', { email: 'Amelia@Example.com' })
    addVisit(s, online.id, '2026-10-07', { startMinutes: 630 })
    s.staff.find((p) => p.id === 'maya')!.archived = true
    expect(usualOf(s, online.id)).toMatchObject({
      usual: true,
      summary:
        "Amelia Carter's usual is Restorative Facial, on Saturday mornings, usually at 10:00.",
      notes: [
        'Maya Lind, who they usually see, no longer takes bookings.',
        'From 7 completed visits in the last 12 months, across 2 client records with the same email.',
      ],
      visitsCounted: 7,
      records: 2,
    })
    expect(usualOf(s, online.id)).not.toHaveProperty('staffId')
    // The same from either record.
    expect(usualOf(s, amelia.id)).toMatchObject({ visitsCounted: 7, records: 2 })
  })

  it('is for those who see clients, not practitioners or regional managers', () => {
    const { s } = regular()
    const has = (role: AskContext['role']) =>
      askSaleaneSkills()
        .filter((k) => k.allowed(askContext(s, role, AT)))
        .some((k) => k.name === 'client_usual')
    expect(has('owner')).toBe(true)
    expect(has('manager')).toBe(true)
    expect(has('reception')).toBe(true)
    expect(has('practitioner')).toBe(false)
  })
})

describe('booking a client’s usual through the test brain', () => {
  it('proposes the usual at their usual time on the day asked, for approval', async () => {
    const { s, amelia } = regular()
    const answer = await ask(s, 'Book Amelia her usual on Saturday')
    expect(answer.text).toBe(
      "Amelia Carter's usual is Restorative Facial with Maya Lind, on Saturday mornings, usually at 10:00. I have prepared the booking below. Nothing is booked until you approve it.",
    )
    expect(answer.proposals).toHaveLength(1)
    const command = commandSchema.parse(answer.proposals[0].effect)
    expect(command).toMatchObject({
      type: 'book',
      input: {
        clientId: amelia.id,
        serviceId: 'facial',
        staffId: 'maya',
        date: '2026-10-10',
        startMinutes: 600,
        source: 'desk',
      },
    })
    // Nothing is booked until someone approves it.
    expect(s.appointments.filter((a) => a.status === 'confirmed')).toEqual([])
    expect(answer.proposals[0].summary).toMatch(/Amelia Carter/)
  })

  it('books on the next usual day when no day is named, and at the time named', async () => {
    const { s } = regular()
    const next = await ask(s, 'book Amelia in for the usual')
    expect(next.proposals[0].effect).toMatchObject({
      input: { date: '2026-10-31', startMinutes: 600 },
    })
    const at11 = await ask(s, 'Book Amelia Carter’s usual on Saturday at 11')
    expect(at11.proposals[0].effect).toMatchObject({
      input: { date: '2026-10-10', startMinutes: 660 },
    })
    // Friday is today, so "on Friday" is next Friday, as for any booking.
    const friday = await ask(s, 'book Amelia her usual on Friday')
    expect(friday.proposals[0].effect).toMatchObject({ input: { date: '2026-10-16' } })
    // A date written out wins over the weekday beside it.
    const dated = await ask(s, 'Book Amelia her usual on Saturday 31 October')
    expect(dated.proposals[0].effect).toMatchObject({ input: { date: '2026-10-31' } })
    const us = await ask(s, 'book Amelia her usual on October 24th')
    expect(us.proposals[0].effect).toMatchObject({ input: { date: '2026-10-24' } })
  })

  it('lists free times in their usual part of the day when the usual time is taken', async () => {
    const { s, ivy } = regular()
    addVisit(s, ivy.id, '2026-10-31', { status: 'confirmed', startMinutes: 570 })
    const answer = await ask(s, 'book Amelia in for the usual')
    expect(answer.proposals).toEqual([])
    expect(answer.text).toMatch(
      /^Amelia Carter's usual is Restorative Facial with Maya Lind, on Saturday mornings, usually at 10:00\. From 6 completed visits in the last 12 months\. Amelia's usual time is taken on Saturday 31 October\. Free on Saturday 31 October: Maya at /,
    )
    expect(answer.text).toMatch(
      /Ask again with a time, such as "book Amelia in for the usual on Saturday at \d\d:\d\d"\.$/,
    )
    // Only morning times, as she usually comes.
    const times = answer.text.match(/\b\d\d:\d\d\b/g)!.slice(1, -1)
    expect(times.every((t) => t < '12:00')).toBe(true)
  })

  it('says it, asked what it is, and asks which treatment when there is none', async () => {
    const { s } = regular()
    expect((await ask(s, "What is Amelia's usual?")).text).toBe(
      "Amelia Carter's usual is Restorative Facial with Maya Lind, on Saturday mornings, usually at 10:00. From 6 completed visits in the last 12 months. Their next usual day is Saturday 31 October.",
    )
    const none = await ask(s, 'book Ivy her usual on Friday')
    expect(none.proposals).toEqual([])
    expect(none.text).toBe(
      'Ivy Moss has no usual yet: it takes three completed visits in the last 12 months. From 2 completed visits in the last 12 months. Say which treatment, such as "book Ivy for a facial on Friday".',
    )
    expect((await ask(s, 'book Zara her usual')).text).toBe(
      'I could not find a client called Zara.',
    )
  })

  it('treats a guest who booked online again as one client, never asking which record', async () => {
    const { s, amelia } = regular()
    // Her online booking opened a second record with her email in capitals.
    const online = addClient(s, 'Amelia Carter', { email: 'Amelia@Example.com' })
    addVisit(s, online.id, '2026-10-07', { startMinutes: 600 })
    const what = await ask(s, "What is Amelia's usual?")
    expect(what.text).toMatch(/^Amelia Carter's usual is Restorative Facial with Maya Lind/)
    expect(what.text).not.toMatch(/Which one/)
    const booking = await ask(s, 'Book Amelia her usual on Saturday')
    expect(booking.proposals).toHaveLength(1)
    // Booked under the record she last visited under.
    expect(commandSchema.parse(booking.proposals[0].effect)).toMatchObject({
      type: 'book',
      input: { clientId: online.id, serviceId: 'facial', date: '2026-10-10' },
    })
    // Someone else with the same name and their own email is still a different client.
    addClient(s, 'Amelia Carter', { email: 'another.amelia@example.com' })
    expect((await ask(s, "What is Amelia's usual?")).text).toMatch(/Which one do you mean\?$/)
    expect(amelia.id).not.toBe(online.id)
  })

  it('does not let a practitioner book or see it', async () => {
    const { s } = regular()
    const answer = await ask(s, 'book Amelia her usual on Friday', 'practitioner')
    expect(answer.proposals).toEqual([])
    expect(answer.text).not.toMatch(/Restorative Facial/)
  })
})

describe('a real AI uses client_usual', () => {
  it('follows the steps its description gives, and the booking still waits for approval', async () => {
    const { s, amelia } = regular()
    let seen: BrainRequest | undefined
    const brain = scriptedBrain((request, step) => {
      seen ??= request
      const last = request.messages.at(-1)
      const data = last?.role === 'tool' ? JSON.parse(last.result) : null
      if (step === 0)
        return { calls: [{ id: 'c1', name: 'find_client', input: { name: 'Amelia' } }] }
      if (step === 1)
        return {
          calls: [{ id: 'c2', name: 'client_usual', input: { clientId: data[0].clientId } }],
        }
      if (step === 2)
        return {
          calls: [
            {
              id: 'c3',
              name: 'free_times',
              input: { serviceId: data.serviceId, staffId: data.staffId, date: data.nextDate },
            },
          ],
        }
      if (step === 3) {
        const usual = JSON.parse((request.messages.at(-3) as { result: string }).result) as Record<
          string,
          string | number
        >
        return {
          calls: [
            {
              id: 'c4',
              name: 'book_visit',
              input: {
                clientId: usual.clientId,
                serviceId: usual.serviceId,
                staffId: usual.staffId,
                date: usual.nextDate,
                startMinutes: usual.startMinutes,
              },
            },
          ],
        }
      }
      return { text: 'Here is the booking for Amelia. Approve it to book.', calls: [] }
    })
    const answer = await askSaleane({
      state: s,
      role: 'reception',
      personId: 'p1',
      text: 'Book Amelia her usual',
      usage: undefined,
      at: AT,
      brain,
    })
    if (answer.status !== 'answered') throw new Error(answer.text)
    const spec = seen!.tools.find((t) => t.name === 'client_usual')!
    expect(spec.description).toMatch(/To book their usual: find_client, then this, then free_times/)
    expect(spec.inputSchema).toMatchObject({ required: ['clientId'] })
    expect(answer.proposals.map((p) => p.effect)).toMatchObject([
      {
        type: 'book',
        input: {
          clientId: amelia.id,
          serviceId: 'facial',
          staffId: 'maya',
          date: '2026-10-31',
          startMinutes: 600,
        },
      },
    ])
  })
})

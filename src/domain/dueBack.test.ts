import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { defaultOperations } from './operations'
import { dueClients } from './selectors'
import { dueBackOn } from './dueBack'
import {
  BOOK_LINK,
  aftercareDue,
  aftercareEmailAhead,
  composeMessage,
  dueBackDue,
  planMessages,
} from './reminders'
import type { RecordedMessage } from './reminders'

// V1.5: aftercare advice after a visit, and a "due back" note weeks later.
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, '2026-10-06T12:00:00.000Z', () => `due-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

/** A local studio where one guest has a single completed Gloss & Tone, paid at 10:00 BST. */
function studio() {
  const state = seed('UK')
  state.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
  const visit = state.appointments.find((a) => a.status === 'completed')!
  const client = state.clients.find((c) => c.id === visit.clientId)!
  state.appointments = state.appointments.filter(
    (a) => a.clientId !== client.id || a.id === visit.id,
  )
  Object.assign(visit, { serviceId: 'service-gloss', date: '2026-10-06', startMinutes: 9 * 60 })
  delete visit.bookedServiceName
  state.sales.find((sale) => sale.appointmentId === visit.id)!.paidAt = '2026-10-06T09:00:00.000Z'
  // Feedback is already in, so only the new messages are planned.
  state.feedback = [
    ...(state.feedback ?? []).filter((f) => f.appointmentId !== visit.id),
    {
      id: 'fb-x',
      organisationId: state.organisation.id,
      appointmentId: visit.id,
      clientId: client.id,
      staffId: visit.staffId,
      visitRating: 5,
      practitionerRating: 5,
      comment: '',
      createdAt: '2026-10-06T12:00:00.000Z',
    },
  ]
  client.marketingConsent = true
  client.email = 'guest@example.com'
  return { state, visit, client }
}
const kinds = (s: BusinessState, at: string, recorded: RecordedMessage[] = []) =>
  planMessages(s, at, recorded).map((m) => `${m.appointmentId}:${m.kind}:${m.channel}`)

describe('aftercare advice', () => {
  it('emails the treatment advice once, from half an hour to two days after checkout', () => {
    const { state, visit } = studio()
    expect(kinds(state, '2026-10-06T09:20:00.000Z')).not.toContain(`${visit.id}:aftercare:email`)
    const plan = planMessages(state, '2026-10-06T09:45:00.000Z', [])
    const care = plan.filter((m) => m.kind === 'aftercare' && m.appointmentId === visit.id)
    expect(care).toHaveLength(1)
    expect(care[0].body).toContain('colour-safe shampoo')
    expect(care[0].subject).toBe('Looking after your Gloss & Tone')
    // Not a booking message: no visit time, no manage link.
    expect(care[0].body).not.toContain('{{manage_link}}')
    const recorded: RecordedMessage[] = care.map((m) => ({ ...m, status: 'test' }))
    expect(kinds(state, '2026-10-06T10:00:00.000Z', recorded)).not.toContain(
      `${visit.id}:aftercare:email`,
    )
    expect(aftercareDue(state, visit, Date.parse('2026-10-08T09:01:00.000Z'))).toBe(false)
  })

  it('sends nothing for a treatment without advice, or when the studio turns it off', () => {
    const { state, visit } = studio()
    const at = Date.parse('2026-10-06T10:00:00.000Z')
    const plain = structuredClone(state)
    delete plain.services.find((x) => x.id === 'service-gloss')!.aftercareNote
    expect(aftercareDue(plain, visit, at)).toBe(false)
    const off = structuredClone(state)
    off.operations!.reminders = { ...off.operations!.reminders!, aftercare: false }
    expect(aftercareDue(off, visit, at)).toBe(false)
    expect(aftercareDue(state, visit, at)).toBe(true)
  })

  it('lets owners write and clear aftercare without touching the before notes', () => {
    const s = seed('UK')
    const prep = s.services.find((x) => x.id === 'service-facial')!.prepNote
    const next = apply(s, {
      type: 'guest-notes',
      arrivalNote: s.organisation.arrivalNote ?? '',
      prepNotes: [],
      aftercareNotes: [
        { serviceId: 'service-facial', note: '  Drink plenty of water.  ' },
        { serviceId: 'service-gloss', note: '' },
      ],
    })
    expect(next.services.find((x) => x.id === 'service-facial')).toMatchObject({
      aftercareNote: 'Drink plenty of water.',
    })
    expect(next.services.find((x) => x.id === 'service-facial')!.prepNote).toBe(prep)
    expect(next.services.find((x) => x.id === 'service-gloss')!.aftercareNote).toBeUndefined()
  })
})

describe('aftercare written up after the visit', () => {
  // NEXT-16: the professional's own aftercare joins the treatment's in the aftercare email.
  const words = { text: 'Skip hot tools until Friday.', at: '2026-10-06T10:00:00.000Z' }

  it('saves the note to the history and the aftercare on the visit, and can remove it', () => {
    const s = seed('UK')
    const visit = s.appointments.find((a) => a.status === 'completed')!
    const next = apply(s, {
      type: 'visit-write-up',
      appointmentId: visit.id,
      note: 'Shade 9 gold with a warm toner.',
      aftercare: 'Skip hot tools until Friday.',
    })
    expect(next.appointments.find((a) => a.id === visit.id)!.aftercare).toMatchObject({
      text: 'Skip hot tools until Friday.',
      staffId: visit.staffId,
    })
    expect(next.events.find((e) => e.title === 'Note after the visit')).toMatchObject({
      clientId: visit.clientId,
      appointmentId: visit.id,
      detail: 'Shade 9 gold with a warm toner.',
    })
    const cleared = apply(next, {
      type: 'visit-write-up',
      appointmentId: visit.id,
      aftercare: null,
    })
    expect(cleared.appointments.find((a) => a.id === visit.id)!.aftercare).toBeUndefined()
  })

  it('sends their aftercare after the treatment advice, never the studio note', () => {
    const { state, visit } = studio()
    const first = state.staff.find((p) => p.id === visit.staffId)!.name.split(' ')[0]
    visit.aftercare = { ...words, staffId: visit.staffId }
    const care = planMessages(state, '2026-10-06T09:45:00.000Z', []).find(
      (m) => m.kind === 'aftercare' && m.appointmentId === visit.id,
    )!
    expect(care.body).toContain(`A note from ${first}: Skip hot tools until Friday.`)
    expect(care.body.indexOf('colour-safe shampoo')).toBeLessThan(
      care.body.indexOf(`A note from ${first}`),
    )
  })

  it('sends their aftercare even when the treatment has none', () => {
    const { state, visit } = studio()
    delete state.services.find((x) => x.id === 'service-gloss')!.aftercareNote
    const at = Date.parse('2026-10-06T10:00:00.000Z')
    expect(aftercareDue(state, visit, at)).toBe(false)
    visit.aftercare = { ...words, staffId: visit.staffId }
    expect(aftercareDue(state, visit, at)).toBe(true)
    expect(composeMessage(state, visit, 'aftercare', 'email').body).toContain(
      'Skip hot tools until Friday.',
    )
  })

  it('knows when aftercare saved now can no longer go in the aftercare email', () => {
    const { state, visit } = studio()
    const soon = Date.parse('2026-10-06T12:00:00.000Z')
    expect(aftercareEmailAhead(state, visit, soon, false)).toBe(true)
    // Its email has gone, or it is more than two days since checkout.
    expect(aftercareEmailAhead(state, visit, soon, true)).toBe(false)
    expect(aftercareEmailAhead(state, visit, Date.parse('2026-10-08T09:00:00.000Z'), false)).toBe(
      false,
    )
    // A sample studio sends nothing.
    expect(aftercareEmailAhead(seed('UK'), visit, soon, false)).toBe(false)
    const client = state.clients.find((c) => c.id === visit.clientId)!
    const noEmail = {
      ...state,
      clients: state.clients.map((c) => (c === client ? { ...c, email: '' } : c)),
    }
    expect(aftercareEmailAhead(noEmail, visit, soon, false)).toBe(false)
  })

  it('refuses a visit that did not go ahead, and a write-up with nothing in it', () => {
    const s = seed('UK')
    const visit = s.appointments.find((a) => a.status === 'completed')!
    const at = '2026-10-06T12:00:00.000Z'
    expect(execute(s, { type: 'visit-write-up', appointmentId: visit.id }, at)).toMatchObject({
      ok: false,
      error: 'Write a note for the studio or aftercare for the guest.',
    })
    const booked = s.appointments.find((a) => a.status === 'confirmed')!
    const gone = apply(s, { type: 'cancel', appointmentId: booked.id, reason: 'Unwell' } as Command)
    expect(
      execute(gone, { type: 'visit-write-up', appointmentId: booked.id, note: 'Gold.' }, at),
    ).toMatchObject({
      ok: false,
      error: 'This visit did not go ahead, so there is nothing to write up.',
    })
  })
})

describe('due back', () => {
  // Six weeks after 6 October is 17 November; the note may go from the 14th.
  const early = '2026-11-13T12:00:00.000Z'
  const due = '2026-11-14T12:00:00.000Z'

  it('emails a guest who agreed to hear, near the date the treatment sets, once', () => {
    const { state, visit } = studio()
    expect(dueBackOn(state, visit)).toBe('2026-11-17')
    expect(kinds(state, early)).not.toContain(`${visit.id}:due_back:email`)
    const plan = planMessages(state, due, []).filter((m) => m.kind === 'due_back')
    expect(plan.map((m) => m.appointmentId)).toEqual([visit.id])
    expect(plan[0].body).toContain('about 6 weeks since your Gloss & Tone')
    expect(plan[0].body).toContain(BOOK_LINK)
    expect(plan[0].body).toContain('To stop these, reply to this email')
    const recorded: RecordedMessage[] = plan.map((m) => ({ ...m, status: 'skipped' }))
    expect(kinds(state, due, recorded)).not.toContain(`${visit.id}:due_back:email`)
    // Two weeks after the date it stops trying.
    expect(dueBackDue(state, visit, '2026-12-01T12:00:00.000Z')).toBe(true)
    expect(dueBackDue(state, visit, '2026-12-02T12:00:00.000Z')).toBe(false)
  })

  it('goes only in the daytime on the studio clock', () => {
    const { state, visit } = studio()
    expect(dueBackDue(state, visit, '2026-11-14T07:59:00.000Z')).toBe(false)
    expect(dueBackDue(state, visit, '2026-11-14T09:00:00.000Z')).toBe(true)
    expect(dueBackDue(state, visit, '2026-11-14T19:00:00.000Z')).toBe(false)
  })

  it('waits for consent, a set return time, and nothing booked', () => {
    const { state, visit, client } = studio()
    const at = due
    const noConsent = structuredClone(state)
    noConsent.clients.find((c) => c.id === client.id)!.marketingConsent = false
    expect(dueBackDue(noConsent, visit, at)).toBe(false)
    const noWeeks = structuredClone(state)
    delete noWeeks.services.find((x) => x.id === 'service-gloss')!.returnWeeks
    expect(dueBackDue(noWeeks, visit, at)).toBe(false)
    const off = structuredClone(state)
    off.operations!.reminders = { ...off.operations!.reminders!, dueBack: false }
    expect(dueBackDue(off, visit, at)).toBe(false)
    const booked = structuredClone(state)
    booked.appointments.push({
      ...visit,
      id: 'visit-next',
      date: '2026-11-20',
      status: 'confirmed',
    })
    expect(dueBackDue(booked, visit, at)).toBe(false)
    // A later visit replaces this one as the one to count from.
    const later = structuredClone(state)
    later.appointments.push({ ...visit, id: 'visit-later', date: '2026-10-20' })
    expect(dueBackDue(later, visit, at)).toBe(false)
    expect(dueBackDue(state, visit, at)).toBe(true)
  })

  it('treats records with the same email as one guest', () => {
    const { state, visit, client } = studio()
    const twin = { ...client, id: 'client-twin', email: client.email.toUpperCase() }
    const booked = structuredClone(state)
    booked.clients.push(twin)
    booked.appointments.push({
      ...visit,
      id: 'visit-twin',
      clientId: twin.id,
      date: '2026-11-20',
      status: 'confirmed',
    })
    expect(dueBackDue(booked, visit, due)).toBe(false)
    const declined = structuredClone(state)
    declined.clients.push({ ...twin, marketingConsent: false })
    expect(dueBackDue(declined, visit, due)).toBe(false)
    const newer = structuredClone(state)
    newer.clients.push(twin)
    newer.appointments.push({ ...visit, id: 'visit-twin', clientId: twin.id, date: '2026-10-20' })
    expect(dueBackDue(newer, visit, due)).toBe(false)
  })

  it('counts only one of two visits at the same moment as the latest', () => {
    const { state, visit } = studio()
    const twin = { ...visit, id: `${visit.id}-z` }
    state.appointments.push(twin)
    expect([dueBackDue(state, visit, due), dueBackDue(state, twin, due)]).toEqual([false, true])
  })

  it('asks the guest to get in touch when online booking is off', () => {
    const { state, visit } = studio()
    state.operations!.bookingEnabled = false
    const email = composeMessage(state, visit, 'due_back', 'email')
    expect(email.body).not.toContain(BOOK_LINK)
    expect(email.body).toContain('Call us or reply to book')
  })

  it('follows the treatment on the due back list, with four weeks otherwise', () => {
    const { state, client } = studio()
    const at = (date: string) => ({
      ...state,
      operations: { ...state.operations!, mode: 'local' as const },
      appointments: state.appointments.map((a) => (a.clientId === client.id ? { ...a, date } : a)),
    })
    // Gloss & Tone is six weeks, so five weeks ago is not yet due.
    const today = new Date().toISOString().slice(0, 10)
    const ago = (days: number) =>
      new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
    expect(dueClients(at(ago(35))).map((c) => c.id)).not.toContain(client.id)
    expect(dueClients(at(ago(43))).map((c) => c.id)).toContain(client.id)
  })

  it('lets a treatment set or clear its return time', () => {
    const s = seed('UK')
    const gloss = s.services.find((x) => x.id === 'service-gloss')!
    const input = {
      name: gloss.name,
      description: gloss.description,
      category: gloss.category,
      durationMinutes: gloss.durationMinutes,
      bufferMinutes: gloss.bufferMinutes,
      priceMinor: gloss.priceMinor,
      depositMinor: gloss.depositMinor,
      resourceType: gloss.resourceType,
      patchTest: true,
    }
    const eight = apply(s, { type: 'service', id: gloss.id, input: { ...input, returnWeeks: 8 } })
    expect(eight.services.find((x) => x.id === gloss.id)!.returnWeeks).toBe(8)
    const kept = apply(eight, { type: 'service', id: gloss.id, input })
    expect(kept.services.find((x) => x.id === gloss.id)!.returnWeeks).toBe(8)
    const cleared = apply(eight, {
      type: 'service',
      id: gloss.id,
      input: { ...input, returnWeeks: null },
    })
    expect(cleared.services.find((x) => x.id === gloss.id)).not.toHaveProperty('returnWeeks')
    const fresh = apply(s, {
      type: 'service',
      input: { ...input, name: 'Root touch-up', returnWeeks: null },
    })
    expect(fresh.services.find((x) => x.name === 'Root touch-up')).not.toHaveProperty('returnWeeks')
  })
})

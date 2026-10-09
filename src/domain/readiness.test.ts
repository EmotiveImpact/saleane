import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { defaultOperations } from './operations'
import { bookable, readySteps } from './readiness'
import type { ReadyStep } from './readiness'
import { createWorkspace } from './workspace'

// "Get your studio ready": every step ticks itself from the studio record.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, ...commands: Command[]) {
  for (const command of commands) {
    const result = execute(s, command, now, () => `ready-${++sequence}`)
    if (!result.ok) throw new Error(result.error)
    s = result.state
  }
  return s
}
const done = (s: BusinessState, confirmed: ReadyStep[] = []) =>
  Object.fromEntries(readySteps(s, new Set(confirmed)).map((step) => [step.id, step.done]))
const fresh = () => createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
const facial: Command = {
  type: 'service',
  input: {
    name: 'Restorative facial',
    description: 'A fictional treatment',
    category: 'Skin',
    durationMinutes: 60,
    bufferMinutes: 15,
    priceMinor: 9500,
    depositMinor: 0,
    resourceType: 'treatment',
  },
}
/** A studio with one facial, Maya who does it, and a treatment room. */
function stocked() {
  const s = apply(fresh(), facial)
  return apply(
    s,
    {
      type: 'staff',
      input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [s.services[0].id], tone: 'sage' },
    },
    { type: 'resource', input: { name: 'Room One', type: 'treatment' } },
  )
}

describe('getting a new studio ready', () => {
  it('starts with every step still to do', () => {
    expect(done(fresh())).toMatchObject({
      hours: false,
      treatments: false,
      team: false,
      rooms: false,
      tax: false,
      deposits: false,
      online: false,
    })
    expect(bookable(fresh())).toBe(false)
  })

  it('ticks treatments, team and rooms once a guest could book something', () => {
    const s = apply(fresh(), facial)
    expect(done(s)).toMatchObject({ treatments: true, team: false, rooms: false })
    // Someone with no treatments yet is not "who does what".
    const unassigned = apply(s, {
      type: 'staff',
      input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [], tone: 'sage' },
    })
    expect(done(unassigned)).toMatchObject({ team: false })
    expect(done(stocked())).toMatchObject({ treatments: true, team: true, rooms: true })
    expect(bookable(stocked())).toBe(true)
    // A chair does not seat a facial, and archived treatments do not count.
    const chairOnly = stocked()
    chairOnly.resources = chairOnly.resources.map((room) => ({ ...room, type: 'chair' as const }))
    expect(bookable(chairOnly)).toBe(false)
    const archived = stocked()
    archived.services = archived.services.map((service) => ({ ...service, archived: true }))
    expect(done(archived)).toMatchObject({ treatments: false, team: false })
    expect(bookable(archived)).toBe(false)
  })

  it('counts any chosen tax rate, 0% included, but not none at all', () => {
    expect(done(fresh())).toMatchObject({ tax: false })
    const none = apply(fresh(), { type: 'tax', label: 'VAT', rateBps: 0, inclusive: true })
    expect(done(none)).toMatchObject({ tax: true })
  })

  it('counts deposit and fee rules once chosen, or confirmed as none', () => {
    const fee = apply(fresh(), { type: 'protection', settings: { saveCard: true, feePercent: 50 } })
    expect(done(fee)).toMatchObject({ deposits: true })
    const deposit = stocked()
    deposit.services = deposit.services.map((service) => ({ ...service, depositMinor: 2000 }))
    expect(done(deposit)).toMatchObject({ deposits: true })
    expect(done(fresh(), ['deposits'])).toMatchObject({ deposits: true })
  })

  it('counts opening hours once changed or confirmed as right', () => {
    const s = fresh()
    expect(done(s, ['hours'])).toMatchObject({ hours: true })
    const sundays = apply(s, { type: 'hours', hours: defaultOperations().hours })
    expect(done(sundays)).toMatchObject({ hours: true })
    // A confirmation means only what it says.
    expect(done(s, ['hours'])).toMatchObject({ tax: false, deposits: false })
  })

  it('counts online booking once switched on', () => {
    const s = stocked()
    const online = apply(s, {
      type: 'organisation',
      name: s.organisation.name,
      locationName: s.organisation.locationName,
      address: s.organisation.address,
      timeZone: s.organisation.timeZone,
      bookingEnabled: true,
    })
    expect(done(online)).toMatchObject({ online: true })
  })

  it('asks for the phone number or email guests see', () => {
    expect(done(fresh())).toMatchObject({ contact: false })
    const reachable = fresh()
    Object.assign(reachable.organisation, { phone: '01225 900456' })
    expect(done(reachable)).toMatchObject({ contact: true })
    const written = fresh()
    Object.assign(written.organisation, { email: 'hello@example.invalid' })
    expect(done(written)).toMatchObject({ contact: true })
  })
})

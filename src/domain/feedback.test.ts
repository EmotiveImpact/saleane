import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can, defaultOperations } from './operations'
import { feedbackSummary, ownRating, withoutFeedback } from './feedback'
import { planMessages } from './reminders'
import { practitionerView } from './practitioner'
import { guestView } from './guest'
import { clientExport } from './privacy'

// V1.5: private guest feedback after a visit.
const now = '2026-10-06T12:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command, at = now) {
  const result = execute(s, command, at, () => `fb-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const run = (s: BusinessState, command: Command) =>
  execute(s, command, now, () => `fb-${++sequence}`)
/** A completed sample visit nobody has rated yet. */
function unrated(s: BusinessState) {
  return s.appointments.find(
    (a) => a.status === 'completed' && !s.feedback?.some((f) => f.appointmentId === a.id),
  )!
}
const answer = { visitRating: 5, practitionerRating: 4, comment: '  Very calm, thank you  ' }

describe('guest feedback', () => {
  it('records one answer for a completed visit, about its professional', () => {
    const s = seed('UK')
    const a = unrated(s)
    const next = apply(s, { type: 'feedback', appointmentId: a.id, ...answer })
    expect(next.feedback!.find((f) => f.appointmentId === a.id)).toMatchObject({
      clientId: a.clientId,
      staffId: a.staffId,
      comment: 'Very calm, thank you',
    })
    // The same answer again lands once; a different one cannot replace it.
    expect(apply(next, { type: 'feedback', appointmentId: a.id, ...answer }).feedback).toHaveLength(
      next.feedback!.length,
    )
    expect(run(next, { type: 'feedback', appointmentId: a.id, ...answer, visitRating: 1 }).ok).toBe(
      false,
    )
  })

  it('opens only once the visit is complete, and only for whole stars', () => {
    const s = seed('UK')
    const upcoming = s.appointments.find((a) => a.status === 'confirmed')!
    expect(run(s, { type: 'feedback', appointmentId: upcoming.id, ...answer }).ok).toBe(false)
    expect(
      run(s, { type: 'feedback', appointmentId: unrated(s).id, ...answer, visitRating: 6 }).ok,
    ).toBe(false)
    expect(
      run(s, {
        type: 'feedback',
        appointmentId: unrated(s).id,
        ...answer,
        comment: 'x'.repeat(1001),
      }).ok,
    ).toBe(false)
  })

  it('is never written by anyone in the studio', () => {
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const)
      expect(can(role, 'feedback')).toBe(false)
  })

  it('rejects an answer that does not match its visit', () => {
    const s = seed('UK')
    const broken = structuredClone(s)
    broken.feedback![0].staffId = 'staff-theo'
    expect(() => parseState(broken, 'UK')).toThrow()
  })
})

describe('who sees what', () => {
  it('gives owners averages by professional and hides answers from reception', () => {
    const s = seed('UK')
    const summary = feedbackSummary(s)
    expect(summary.count).toBe(s.feedback!.length)
    expect(summary.byStaff.find((r) => r.staff.id === 'staff-maya')).toMatchObject({
      count: 4,
      average: 4.8,
    })
    expect(withoutFeedback(s).feedback).toBeUndefined()
    const latest = s
      .feedback!.map((f) => f.createdAt)
      .sort()
      .at(-1)!
    expect(feedbackSummary(s, latest).count).toBe(
      s.feedback!.filter((f) => f.createdAt >= latest).length,
    )
    expect(feedbackSummary(s, '2999-01-01T00:00:00.000Z').count).toBe(0)
  })

  it('gives a practitioner their own average only once three guests have rated them', () => {
    const s = seed('UK')
    expect(ownRating(s, 'staff-maya')).toEqual({ count: 4, average: 4.8 })
    expect(ownRating(s, 'staff-theo')).toEqual({ count: 2, average: null })
    const view = practitionerView(s, 'staff-maya', '2026-10-06')
    expect(view.rating).toEqual({ count: 4, average: 4.8 })
    expect(JSON.stringify(view)).not.toContain('remembered exactly')
    // One regular rating three visits is still one guest, so no average yet.
    const regular = structuredClone(s)
    regular.feedback = regular.feedback!.filter((f) => f.staffId !== 'staff-maya')
    for (const [n, f] of s
      .feedback!.filter((r) => r.staffId === 'staff-maya')
      .slice(0, 3)
      .entries())
      regular.feedback.push({ ...f, id: `same-${n}`, clientId: 'one-guest' })
    expect(ownRating(regular, 'staff-maya')).toEqual({ count: 3, average: null })
  })

  it('shows the guest only their own ratings, and only after a completed visit', () => {
    const s = seed('UK')
    const a = unrated(s)
    const start = Date.parse(`${a.date}T12:00:00.000Z`)
    expect(guestView(s, a.id, start).feedback).toEqual({ open: true, given: null })
    const next = apply(s, { type: 'feedback', appointmentId: a.id, ...answer })
    const view = guestView(next, a.id, start)
    expect(view.feedback).toEqual({ open: false, given: { visitRating: 5, practitionerRating: 4 } })
    expect(JSON.stringify(view)).not.toContain('Very calm')
    // A week after the visit, feedback closes.
    expect(guestView(s, a.id, start + 8 * 86400000).feedback?.open).toBe(false)
    const upcoming = s.appointments.find((x) => x.status === 'confirmed')!
    expect(guestView(s, upcoming.id, start).feedback).toBeUndefined()
  })

  it('puts the client’s own answers in their data export', () => {
    const s = seed('UK')
    const row = s.feedback![0]
    expect(clientExport(s, row.clientId, {} as never).feedback).toContainEqual(
      expect.objectContaining({ visitRating: row.visitRating, comment: row.comment }),
    )
  })
})

describe('the request email', () => {
  function local() {
    const s = seed('UK')
    s.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
    const a = unrated(s)
    const sale = s.sales.find((x) => x.appointmentId === a.id)!
    sale.paidAt = '2026-10-06T09:00:00.000Z'
    // Only this visit's checkout is recent.
    for (const other of s.sales) if (other !== sale) other.paidAt = '2026-09-01T09:00:00.000Z'
    return { s, a }
  }
  const mine = (s: BusinessState, at: string, id: string) =>
    planMessages(s, at, []).filter((m) => m.appointmentId === id && m.kind === 'feedback')

  it('goes once by email, a little after checkout, with the private link', () => {
    const { s, a } = local()
    expect(mine(s, '2026-10-06T10:00:00.000Z', a.id)).toHaveLength(0)
    const plan = mine(s, '2026-10-06T11:30:00.000Z', a.id)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ channel: 'email' })
    expect(plan[0].body).toContain('{{manage_link}}')
    expect(plan[0].body).toContain('Only the studio')
    expect(
      planMessages(s, '2026-10-06T11:30:00.000Z', [{ ...plan[0], status: 'test' }]).filter(
        (m) => m.kind === 'feedback',
      ),
    ).toHaveLength(0)
    // Too late after checkout, it is not sent at all.
    expect(mine(s, '2026-10-09T11:30:00.000Z', a.id)).toHaveLength(0)
  })

  it('is not sent when the studio turns it off or the guest has already answered', () => {
    const { s, a } = local()
    s.operations!.reminders = { ...s.operations!.reminders!, feedback: false }
    expect(mine(s, '2026-10-06T11:30:00.000Z', a.id)).toHaveLength(0)
    const fresh = local()
    fresh.s.feedback!.push({
      ...fresh.s.feedback![0],
      id: 'answered',
      appointmentId: fresh.a.id,
      clientId: fresh.a.clientId,
      staffId: fresh.a.staffId,
    })
    expect(mine(fresh.s, '2026-10-06T11:30:00.000Z', fresh.a.id)).toHaveLength(0)
  })
})

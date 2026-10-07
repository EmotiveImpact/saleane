import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { addDays } from './format'
import { can } from './operations'
import { clientConsultations, latestVersion, visitConsultation } from './consultations'
import type { ConsultationContent } from './consultationsSchema'
import { practitionerView } from './practitioner'
import { clientExport, clientExportText, erasureReview } from './privacy'

// V1.5: consultations, kept by version and carried into the visits booked from them.
let sequence = 0
const makeId = () => `consult-test-${++sequence}`
const NOW = `${DEMO_DATE}T08:00:00.000Z`
function run(s: BusinessState, command: Command, actor = 'Maya') {
  const result = dispatch(s, command, actor, NOW)
  if (!result.ok) throw new Error(result.error)
  return result
}
const content: ConsultationContent = {
  serviceIds: ['service-facial'],
  wants: 'Brighter, calmer-looking skin before a wedding.',
  plan: 'Two facials a fortnight apart, the second a week before the day.',
  quoteMinor: 19000,
  notes: '',
}
const record = (
  s: BusinessState,
  extra: Partial<Extract<Command, { type: 'consultation-save' }>> = {},
) =>
  run(s, {
    type: 'consultation-save',
    clientId: 'client-1',
    staffId: 'staff-maya',
    heldOn: DEMO_DATE,
    content,
    ...extra,
  })
const bookFrom = (s: BusinessState, consultationId: string, startMinutes = 600) =>
  run(s, {
    type: 'book',
    input: {
      clientId: 'client-1',
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: addDays(DEMO_DATE, 2),
      startMinutes,
      source: 'desk',
      consultationId,
    },
  })

describe('consultations (V1.5)', () => {
  it('records a consultation on the client, with who saved it and a timeline entry', () => {
    const saved = record(seed('UK'))
    const [c] = clientConsultations(saved.state, 'client-1')
    expect(c).toMatchObject({ id: saved.recordId, heldOn: DEMO_DATE, staffId: 'staff-maya' })
    expect(c.versions).toEqual([{ ...content, version: 1, savedAt: NOW, savedBy: 'Maya' }])
    expect(saved.state.events.at(-1)).toMatchObject({
      clientId: 'client-1',
      type: 'consultation',
      title: 'Consultation recorded',
    })
  })

  it('keeps every version, and a save with no change makes none', () => {
    let s = record(seed('UK')).state
    const id = clientConsultations(s, 'client-1')[0].id
    const again = dispatch(
      s,
      { type: 'consultation-save', id, clientId: 'client-1', heldOn: DEMO_DATE, content },
      'Maya',
      NOW,
    )
    expect(again.ok && again.state).toBe(s)
    s = run(
      s,
      {
        type: 'consultation-save',
        id,
        clientId: 'client-1',
        heldOn: DEMO_DATE,
        content: { ...content, quoteMinor: 18000 },
      },
      'Priya',
    ).state
    const c = clientConsultations(s, 'client-1')[0]
    expect(c.versions.map((v) => [v.version, v.quoteMinor, v.savedBy])).toEqual([
      [1, 19000, 'Maya'],
      [2, 18000, 'Priya'],
    ])
  })

  it('carries the version agreed into a visit booked from it, even after a later change', () => {
    let s = record(seed('UK')).state
    const id = clientConsultations(s, 'client-1')[0].id
    const booked = bookFrom(s, id)
    s = booked.state
    const visit = s.appointments.find((a) => a.id === booked.recordId)!
    expect(visit.consultation).toEqual({ id, version: 1 })
    s = run(s, {
      type: 'consultation-save',
      id,
      clientId: 'client-1',
      heldOn: DEMO_DATE,
      content: { ...content, plan: 'One facial only, a week before the day.' },
    }).state
    const carried = visitConsultation(
      s,
      s.appointments.find((a) => a.id === visit.id)!,
    )!
    expect(carried.version.plan).toBe(content.plan)
    expect(carried.changedSince).toBe(true)
    // A new booking takes the latest version.
    const next = bookFrom(s, id, 780)
    expect(next.state.appointments.find((a) => a.id === next.recordId)!.consultation).toEqual({
      id,
      version: 2,
    })
  })

  it('shows the practitioner what was agreed for their visit', () => {
    let s = record(seed('UK')).state
    const id = clientConsultations(s, 'client-1')[0].id
    const booked = bookFrom(s, id)
    s = booked.state
    const view = practitionerView(s, 'staff-maya', DEMO_DATE)
    expect(view.appointments.find((a) => a.id === booked.recordId)?.consultation).toEqual({
      heldOn: DEMO_DATE,
      version: 1,
      wants: content.wants,
      plan: content.plan,
      changedSince: false,
    })
  })

  it('refuses health details, other clients’ consultations, online bookings and future dates', () => {
    const s = record(seed('UK')).state
    const id = clientConsultations(s, 'client-1')[0].id
    const health = execute(
      s,
      {
        type: 'consultation-save',
        clientId: 'client-1',
        heldOn: DEMO_DATE,
        content: { ...content, notes: 'Mentioned a nut allergy.' },
      },
      NOW,
      makeId,
    )
    expect(health.ok || health.error).toMatch(/cannot record health details \(“allergy”\)/)
    const other = execute(
      s,
      {
        type: 'book',
        input: {
          clientId: 'client-2',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: addDays(DEMO_DATE, 2),
          startMinutes: 600,
          source: 'desk',
          consultationId: id,
        },
      },
      NOW,
      makeId,
    )
    expect(other.ok || other.error).toBe('That consultation is not on this client.')
    const later = execute(
      s,
      {
        type: 'consultation-save',
        clientId: 'client-1',
        heldOn: addDays(DEMO_DATE, 3),
        content,
      },
      NOW,
      makeId,
    )
    expect(later.ok || later.error).toBe('Record a consultation once it has happened.')
  })

  it('lets the desk record consultations, not practitioners on their own', () => {
    expect(can('reception', 'consultation')).toBe(true)
    expect(can('manager', 'consultation')).toBe(true)
    expect(can('practitioner', 'consultation')).toBe(false)
  })

  it('refuses a visit pointing at a version that does not exist', () => {
    const s = seed('UK')
    s.appointments.find((a) => a.id === 'visit-gloss-ellie')!.consultation = {
      id: 'consult-ellie',
      version: 9,
    }
    expect(() => parseState(s, 'UK')).toThrow('does not match its consultation')
  })

  it('puts every version and the visits booked from it in the client’s export', () => {
    const s = seed('UK')
    const file = clientExport(s, 'client-3', { generatedAt: NOW, generatedBy: 'Maya' })
    expect(file.consultations).toHaveLength(1)
    expect(file.consultations[0].versions.map((v) => v.version)).toEqual([1, 2])
    expect(file.consultations[0].visitsBooked).toEqual([expect.objectContaining({ version: 2 })])
    expect(clientExportText(file)).toContain('CONSULTATIONS (1)')
    expect(latestVersion(s.consultations![0]).plan).toContain('Trim the ends')
    expect(
      erasureReview(s, 'client-3', DEMO_DATE).kept.find((k) => k.label === 'Consultations')?.count,
    ).toBe(1)
  })
})

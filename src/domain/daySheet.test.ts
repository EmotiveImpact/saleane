import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import { operations } from './operations'
import { DAY_SHEET_MAX_HOURS, daySheet, daySheetSchema } from './daySheet'

// OFF-01: the read-only day sheet carries only the approved daily fields for the reader.
const morning = '2026-10-06T08:00:00.000Z'
const owner = { role: 'owner' as const, staffId: null }
const maya = { role: 'practitioner' as const, staffId: 'staff-maya' }

describe('the offline day sheet (OFF-01)', () => {
  it('gives desk roles today’s studio visits with time, service, professional, room and phone', () => {
    const state = seed('UK')
    const sheet = daySheet(state, { role: 'reception', staffId: null }, morning)
    const today = state.appointments.filter((a) => a.date === DEMO_DATE && a.status !== 'cancelled')
    expect(sheet.audience).toBe('studio')
    expect(sheet.date).toBe(DEMO_DATE)
    expect(sheet.visits.map((v) => v.id).sort()).toEqual(today.map((a) => a.id).sort())
    const first = sheet.visits.find((v) => v.id === 'visit-amelia')!
    const client = state.clients.find(
      (c) => c.id === today.find((a) => a.id === first.id)!.clientId,
    )!
    expect(first).toMatchObject({
      startMinutes: 570,
      serviceName: expect.any(String),
      professionalName: expect.any(String),
      roomName: expect.any(String),
      clientName: client.name,
      clientPhone: client.phone,
    })
    expect(first.endMinutes).toBeGreaterThan(first.startMinutes)
    expect(sheet.visits.map((v) => v.startMinutes)).toEqual(
      [...sheet.visits.map((v) => v.startMinutes)].sort((a, b) => a - b),
    )
  })

  it('never carries email, money, consent, notes or other days', () => {
    const state = seed('UK')
    const sheet = daySheet(state, owner, morning)
    const body = JSON.stringify(sheet)
    for (const client of state.clients) {
      expect(body).not.toContain(client.email)
      if (client.preferences) expect(body).not.toContain(client.preferences)
    }
    for (const event of state.events) if (event.detail) expect(body).not.toContain(event.detail)
    for (const field of [
      'email',
      'priceMinor',
      'depositMinor',
      'bookedPriceMinor',
      'sales',
      'payments',
      'receipt',
      'marketingConsent',
      'notes',
      'preferences',
      'events',
      'messages',
    ])
      expect(body).not.toContain(`"${field}"`)
    const elsewhere = state.appointments.filter((a) => a.date !== DEMO_DATE).map((a) => a.id)
    for (const visit of elsewhere) expect(body).not.toContain(`"${visit}"`)
  })

  it('gives a practitioner only their own visits and no phone numbers', () => {
    const state = seed('UK')
    const sheet = daySheet(state, maya, morning)
    expect(sheet.audience).toBe('practitioner')
    expect(sheet.professional).toEqual({ id: 'staff-maya', name: expect.any(String) })
    const mine = state.appointments.filter(
      (a) => a.date === DEMO_DATE && a.staffId === 'staff-maya' && a.status !== 'cancelled',
    )
    expect(sheet.visits.map((v) => v.id).sort()).toEqual(mine.map((a) => a.id).sort())
    expect(sheet.visits.every((v) => v.clientPhone === undefined)).toBe(true)
    const body = JSON.stringify(sheet)
    expect(body).not.toContain('"clientPhone"')
    for (const client of state.clients) if (client.phone) expect(body).not.toContain(client.phone)
    for (const other of state.appointments.filter((a) => a.staffId !== 'staff-maya'))
      expect(body).not.toContain(`"${other.id}"`)
  })

  it('refuses an archived or unlinked practitioner and a forged phone on their sheet', () => {
    const state = seed('UK')
    expect(() => daySheet(state, { role: 'practitioner', staffId: null }, morning)).toThrow()
    state.staff = state.staff.map((p) => (p.id === 'staff-maya' ? { ...p, archived: true } : p))
    expect(() => daySheet(state, maya, morning)).toThrow()
    const sheet = daySheet(seed('UK'), maya, morning)
    const forged = {
      ...sheet,
      visits: sheet.visits.map((v) => ({ ...v, clientPhone: '07000 000000' })),
    }
    expect(daySheetSchema.safeParse(forged).success).toBe(false)
    expect(daySheetSchema.safeParse({ ...sheet, email: 'x@example.invalid' }).success).toBe(false)
  })

  it('leaves cancelled visits out', () => {
    const state = seed('UK')
    state.appointments = state.appointments.map((a) =>
      a.id === 'visit-noor' ? { ...a, status: 'cancelled' } : a,
    )
    expect(daySheet(state, owner, morning).visits.some((v) => v.id === 'visit-noor')).toBe(false)
  })

  it('expires at closing time in venue time, and never more than the bounded window', () => {
    const state = seed('UK')
    state.operations = { ...operations(state), mode: 'local' }
    // 18:00 in London during British Summer Time is 17:00 UTC.
    expect(daySheet(state, owner, morning).expiresAt).toBe('2026-10-06T17:00:00.000Z')
    // After closing, the sheet lasts until midnight venue time.
    expect(daySheet(state, owner, '2026-10-06T19:30:00.000Z').expiresAt).toBe(
      '2026-10-06T23:00:00.000Z',
    )
    // An early start is capped at the maximum window.
    const early = daySheet(state, owner, '2026-10-06T03:00:00.000Z')
    expect(Date.parse(early.expiresAt) - Date.parse(early.generatedAt)).toBe(
      DAY_SHEET_MAX_HOURS * 3600000,
    )
    // The fictional sandbox keeps a fixed date; its sheet still expires within the window.
    const sandbox = daySheet(seed('UK'), owner, '2027-01-01T10:00:00.000Z')
    expect(sandbox.date).toBe(DEMO_DATE)
    expect(Date.parse(sandbox.expiresAt)).toBeGreaterThan(Date.parse(sandbox.generatedAt))
  })
})

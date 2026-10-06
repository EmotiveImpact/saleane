import { describe, expect, it } from 'vitest'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { seed } from './seed'
import {
  canPrivacy,
  clientExport,
  clientExportText,
  erasureReview,
  previewClientExport,
  previewStudioExport,
  studioExport,
} from './privacy'

const now = '2026-10-06T08:00:00.000Z'
const meta = { generatedAt: now, generatedBy: 'Studio Owner' }
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `test-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** Amelia (client-1) with a refund, an unsent draft and a referral to Olivia (client-2). */
function studio() {
  let s = seed('UK')
  const sale = s.sales.find(
    (x) => s.appointments.find((a) => a.id === x.appointmentId)?.clientId === 'client-1',
  )!
  s = apply(s, {
    type: 'refund',
    saleId: sale.id,
    amountMinor: 500,
    reason: 'Goodwill after a late start',
    reference: 'REF-1',
  })
  s = apply(s, {
    type: 'message',
    input: {
      clientId: 'client-1',
      purpose: 'appointment',
      subject: 'Your next facial',
      body: 'We look forward to seeing you.',
    },
  })
  return s
}

describe('privacy roles (LOCAL-03 defaults)', () => {
  it('lets owners and managers handle client requests and only owners export the studio', () => {
    expect(canPrivacy('owner', 'client.export')).toBe(true)
    expect(canPrivacy('manager', 'client.export')).toBe(true)
    expect(canPrivacy('manager', 'client.erasure')).toBe(true)
    for (const role of ['reception', 'practitioner'] as const) {
      expect(canPrivacy(role, 'client.export')).toBe(false)
      expect(canPrivacy(role, 'client.erasure')).toBe(false)
    }
    expect(canPrivacy('owner', 'studio.export')).toBe(true)
    for (const role of ['manager', 'reception', 'practitioner'] as const)
      expect(canPrivacy(role, 'studio.export')).toBe(false)
  })
})

describe('client export', () => {
  it('includes the subject’s profile, visits, money and timeline with visit references', () => {
    const s = studio()
    const file = clientExport(s, 'client-1', meta)
    const visits = s.appointments.filter((a) => a.clientId === 'client-1')
    expect(file.format).toBe('saleane.client-export')
    expect(file.subject).toMatchObject({ name: 'Amelia Carter', email: expect.any(String) })
    expect(file.visits).toHaveLength(visits.length)
    expect(file.visits.map((v) => v.visit)).toEqual(visits.map((_, i) => `V${i + 1}`))
    expect(file.receipts.length).toBe(
      s.sales.filter((x) => visits.some((a) => a.id === x.appointmentId)).length,
    )
    expect(file.payments.every((p) => /^V\d+$/.test(p.visit))).toBe(true)
    expect(file.refunds).toEqual([
      expect.objectContaining({ amountMinor: 500, reference: 'REF-1', visit: expect.any(String) }),
    ])
    expect(file.timeline.length).toBe(s.events.filter((e) => e.clientId === 'client-1').length)
  })

  it('withholds other clients and internal identifiers', () => {
    const s = studio()
    const text = JSON.stringify(clientExport(s, 'client-1', meta))
    for (const other of s.clients.filter((c) => c.id !== 'client-1')) {
      expect(text).not.toContain(other.name)
      expect(text).not.toContain(other.email)
      expect(text).not.toContain(other.phone)
    }
    expect(text).not.toContain('Olivia')
    for (const internal of [
      'client-1"',
      'organisationId',
      'clientId',
      'appointmentId',
      'saleId',
      s.organisation.id,
      'relationship-amelia-olivia',
      'sale-',
      'event-',
      'test-',
    ])
      expect(text).not.toContain(internal)
  })

  it('keeps a connection as its type only', () => {
    const amelia = clientExport(studio(), 'client-1', meta)
    expect(amelia.connections).toEqual([
      { type: 'referral', role: 'Introduced another client', since: '2026-07-07T12:00:00.000Z' },
    ])
    const relationship = amelia.timeline.find((t) => t.type === 'relationship')!
    expect(relationship.title).toBe('Client connection')
    expect(relationship.detail).toMatch(/withheld as third-party data/)
    const olivia = clientExport(studio(), 'client-2', meta)
    expect(olivia.connections[0].role).toBe('Introduced by another client')
    // Structured fields never carry the other person; free text written by staff is flagged in
    // the preview instead (Olivia's seeded preference mentions who introduced her).
    const { subject, ...structured } = olivia
    expect(subject.goodToRemember).toContain('Amelia')
    expect(JSON.stringify(structured)).not.toContain('Amelia')
  })

  it('reports unsent messages honestly and never as sent', () => {
    const file = clientExport(studio(), 'client-1', meta)
    expect(file.messages).toHaveLength(1)
    expect(file.messages[0]).toMatchObject({ status: 'draft', delivery: 'Draft. Not sent.' })
    expect(JSON.stringify(file.messages)).not.toMatch(/"sent"|delivered/i)
  })

  it('previews counts, exclusions and the note to read free text before sending', () => {
    const file = clientExport(studio(), 'client-1', meta)
    const preview = previewClientExport(file)
    expect(preview.sections).toContainEqual({ label: 'Refunds', count: 1 })
    expect(preview.sections).toContainEqual({
      label: 'Visits with their booked terms',
      count: file.visits.length,
    })
    expect(preview.excluded.join(' ')).toMatch(/passwords/i)
    expect(preview.excluded.join(' ')).toMatch(/audit log/i)
    expect(preview.notes.join(' ')).toMatch(/Read them before sending/)
    expect(clientExportText(file)).toContain('MESSAGES (1), none sent')
  })

  it('refuses a client from elsewhere', () => {
    expect(() => clientExport(studio(), 'client-unknown', meta)).toThrow('not found')
  })
})

describe('studio export', () => {
  it('holds the one studio with its team and no credentials', () => {
    const s = studio()
    const file = studioExport(s, meta, [
      { name: 'Studio Owner', email: 'owner@example.invalid', role: 'owner' },
      {
        name: 'Maya Lewis',
        email: 'maya@example.invalid',
        role: 'practitioner',
        professional: 'Maya Lewis',
      },
    ])
    expect(file.records.clients).toHaveLength(s.clients.length)
    expect(file.records.organisation.id).toBe(s.organisation.id)
    const text = JSON.stringify(file)
    for (const secret of ['password', 'hash', 'token', 'csrf', 'session'])
      expect(text.toLowerCase()).not.toContain(secret)
    const preview = previewStudioExport(file)
    expect(preview.sections).toContainEqual({
      label: 'Team members (name, email and role)',
      count: 2,
    })
    expect(preview.excluded.join(' ')).toMatch(/other studio/i)
  })
})

describe('erasure review', () => {
  it('separates what could be removed from what must be kept, and deletes nothing', () => {
    const s = studio()
    const before = JSON.stringify(s)
    const review = erasureReview(s, 'client-1', '2026-10-06')
    expect(JSON.stringify(s)).toBe(before)
    expect(review.removable.map((i) => i.label)).toContain('Email address and telephone number')
    expect(review.removable.find((i) => i.label.startsWith('Unsent messages'))!.count).toBe(1)
    const kept = Object.fromEntries(review.kept.map((i) => [i.label, i.count]))
    expect(kept.Receipts).toBeGreaterThan(0)
    expect(kept.Refunds).toBe(1)
    expect(review.kept.every((i) => i.reason.length > 10)).toBe(true)
    // Amelia is in the studio today, so her visit must be settled before any removal.
    expect(review.upcomingVisits).toBe(1)
    expect(review.decisions.join(' ')).toMatch(/upcoming visit/)
  })
})

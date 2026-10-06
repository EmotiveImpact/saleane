import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitWorkspace,
  loadBrowserWorkspace,
  loadWorkspace,
  resetWorkspace,
  storageKey,
} from './storage'
import { seed } from '../domain/seed'
import { DEMO_DATE } from '../domain/model'

describe('browser persistence and recovery', () => {
  beforeEach(() => localStorage.clear())
  it('keeps the app readable when access to browser storage itself is denied', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    try {
      const loaded = loadBrowserWorkspace('UK')
      expect(loaded.blocked).toBe(true)
      expect(loaded.state.clients).toHaveLength(15)
      expect(loaded.warning).toContain('storage is unavailable')
    } finally {
      getter.mockRestore()
    }
  })
  it('keeps reset revisions above persisted state and rejects pre-reset tabs after another write', () => {
    const original = seed('UK')
    const first = commitWorkspace(localStorage, 'UK', original, {
      type: 'note',
      clientId: 'client-1',
      text: 'Before reset.',
    })
    if (!first.ok) throw new Error(first.error)
    const reset = resetWorkspace(localStorage, 'UK', original)
    expect(reset.revision).toBe(first.state.revision + 1)
    const next = commitWorkspace(localStorage, 'UK', reset, {
      type: 'note',
      clientId: 'client-1',
      text: 'After reset.',
    })
    expect(next.ok).toBe(true)
    const stale = commitWorkspace(localStorage, 'UK', first.state, {
      type: 'note',
      clientId: 'client-1',
      text: 'Stale overwrite.',
    })
    expect(stale.ok).toBe(false)
    expect(loadWorkspace(localStorage, 'UK').state.events.at(-1)?.detail).toBe('After reset.')
  })
  it('supports explicit reset of unreadable data without reusing the current revision', () => {
    localStorage.setItem(storageKey('UK'), 'broken')
    const reset = resetWorkspace(localStorage, 'UK', seed('UK'))
    expect(reset.revision).toBeGreaterThan(0)
    expect(loadWorkspace(localStorage, 'UK').blocked).toBe(false)
  })
  it('persists a command and reloads the linked records', () => {
    const result = commitWorkspace(localStorage, 'UK', seed('UK'), {
      type: 'note',
      clientId: 'client-1',
      text: 'Prefers a quiet Tuesday.',
    })
    expect(result.ok).toBe(true)
    const loaded = loadWorkspace(localStorage, 'UK')
    expect(loaded.state.events.at(-1)?.detail).toBe('Prefers a quiet Tuesday.')
    expect(loaded.blocked).toBe(false)
  })
  it.each(['cancel', 'no-show'] as const)(
    'reloads a moved appointment and its %s history while retaining the deposit',
    (type) => {
      const original = seed('UK')
      const moved = commitWorkspace(localStorage, 'UK', original, {
        type: 'reschedule',
        appointmentId: 'visit-noor',
        staffId: 'staff-maya',
        date: DEMO_DATE,
        startMinutes: 675,
      })
      expect(moved.ok).toBe(true)
      if (!moved.ok) throw new Error(moved.error)
      const reloaded = loadWorkspace(localStorage, 'UK')
      expect(reloaded.blocked).toBe(false)
      expect(reloaded.state).toEqual(moved.state)
      expect(reloaded.state.events.at(-1)?.allocationChange).toMatchObject({
        from: { startMinutes: 660 },
        to: { startMinutes: 675 },
      })
      const ended = commitWorkspace(localStorage, 'UK', reloaded.state, {
        type,
        appointmentId: 'visit-noor',
        reason: 'Unable to attend',
      })
      expect(ended.ok).toBe(true)
      if (!ended.ok) throw new Error(ended.error)
      const final = loadWorkspace(localStorage, 'UK')
      expect(final.blocked).toBe(false)
      expect(final.state).toEqual(ended.state)
      expect(final.state.payments).toEqual(original.payments)
      expect(final.state.sales).toEqual(original.sales)
      expect(final.state.appointments.find((a) => a.id === 'visit-noor')?.status).toBe(
        type === 'cancel' ? 'cancelled' : 'no_show',
      )
      const writer = vi.spyOn(Storage.prototype, 'setItem')
      const repeated = commitWorkspace(localStorage, 'UK', final.state, {
        type,
        appointmentId: 'visit-noor',
        reason: 'Repeated request',
      })
      expect(repeated.ok).toBe(true)
      if (repeated.ok) expect(repeated.state).toBe(final.state)
      expect(writer).not.toHaveBeenCalled()
    },
  )
  it('rejects stale cancellation without losing the newer allocation or its history', () => {
    const stale = seed('UK')
    const moved = commitWorkspace(localStorage, 'UK', stale, {
      type: 'reschedule',
      appointmentId: 'visit-noor',
      staffId: 'staff-maya',
      date: DEMO_DATE,
      startMinutes: 675,
    })
    expect(moved.ok).toBe(true)
    const saved = localStorage.getItem(storageKey('UK'))
    const result = commitWorkspace(localStorage, 'UK', stale, {
      type: 'cancel',
      appointmentId: 'visit-noor',
      reason: 'Stale request',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('another tab')
    expect(localStorage.getItem(storageKey('UK'))).toBe(saved)
    expect(
      loadWorkspace(localStorage, 'UK').state.appointments.find((a) => a.id === 'visit-noor'),
    ).toMatchObject({ status: 'confirmed', startMinutes: 675 })
    expect(loadWorkspace(localStorage, 'UK').state.events.at(-1)?.type).toBe('rescheduled')
  })
  it('rejects a stale tab without overwriting newer changes', () => {
    const stale = seed('UK')
    commitWorkspace(localStorage, 'UK', stale, {
      type: 'note',
      clientId: 'client-1',
      text: 'First change.',
    })
    const result = commitWorkspace(localStorage, 'UK', stale, {
      type: 'note',
      clientId: 'client-1',
      text: 'Stale change.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('another tab')
    expect(loadWorkspace(localStorage, 'UK').state.events.at(-1)?.detail).toBe('First change.')
  })
  it('preserves unreadable bytes and blocks changes', () => {
    localStorage.setItem(storageKey('UK'), '{broken-json')
    const loaded = loadWorkspace(localStorage, 'UK')
    expect(loaded.blocked).toBe(true)
    expect(loaded.warning).toContain('preserve')
    expect(localStorage.getItem(storageKey('UK'))).toBe('{broken-json')
  })
  it('preserves a future schema version rather than resetting it', () => {
    const raw = JSON.stringify({ ...seed('UK'), schemaVersion: 99 })
    localStorage.setItem(storageKey('UK'), raw)
    expect(loadWorkspace(localStorage, 'UK').blocked).toBe(true)
    expect(localStorage.getItem(storageKey('UK'))).toBe(raw)
  })
  it('does not report success when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const s = seed('UK')
    const result = commitWorkspace(localStorage, 'UK', s, {
      type: 'note',
      clientId: 'client-1',
      text: 'Unsaved change.',
    })
    expect(result.ok).toBe(false)
    expect(s.revision).toBe(0)
  })
  it('keeps UK and US records in distinct persisted workspaces', () => {
    commitWorkspace(localStorage, 'UK', seed('UK'), {
      type: 'note',
      clientId: 'client-1',
      text: 'London only.',
    })
    expect(
      loadWorkspace(localStorage, 'US').state.events.some((e) => e.detail === 'London only.'),
    ).toBe(false)
    expect(loadWorkspace(localStorage, 'UK').state.events.at(-1)?.detail).toBe('London only.')
  })
})

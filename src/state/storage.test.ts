import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitWorkspace, loadBrowserWorkspace, loadWorkspace, storageKey } from './storage'
import { seed } from '../domain/seed'

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

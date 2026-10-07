import { afterEach, describe, expect, it, vi } from 'vitest'
import { readInboxView, saveInboxView } from './inboxView'

describe('the Inbox layout preference', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps a choice for this visit when the browser will not store it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is full')
    })
    saveInboxView('user-unstored', 'panel')
    expect(readInboxView('user-unstored')).toBe('panel')
    expect(readInboxView('someone-else')).toBe('columns')
  })
})

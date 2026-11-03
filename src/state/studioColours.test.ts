import { afterEach, describe, expect, it } from 'vitest'
import { applyColours, readColours, saveColours } from './studioColours'

describe('studio look on the page', () => {
  afterEach(() => {
    delete document.documentElement.dataset.base
    localStorage.clear()
  })

  it('marks the page clean white, and takes the mark off for warm ivory', () => {
    applyColours({ first: '#2f6b4f', second: '#c27286', base: 'white' })
    expect(document.documentElement.dataset.base).toBe('white')
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#2f6b4f')
    applyColours({ first: '#5f8471', second: '#c27286', base: 'warm' })
    expect(document.documentElement.dataset.base).toBeUndefined()
    applyColours({ first: '#5f8471', second: '#c27286' })
    expect(document.documentElement.dataset.base).toBeUndefined()
  })

  it('remembers the background in this browser, and ignores one it does not know', () => {
    saveColours('org-1', { first: '#2f6b4f', second: '#c27286', base: 'white' })
    expect(readColours('org-1')).toEqual({ first: '#2f6b4f', second: '#c27286', base: 'white' })
    localStorage.setItem(
      'saleane-colours:org-2',
      JSON.stringify({ first: '#2f6b4f', second: '#c27286', base: 'neon' }),
    )
    expect(readColours('org-2')).toEqual({ first: '#2f6b4f', second: '#c27286' })
  })
})

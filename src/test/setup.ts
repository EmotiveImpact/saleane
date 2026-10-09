import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { sampleWithRegulars } from '../domain/seed'

// The sample studio's fifteen named clients carry every story the tests check. Leaving out its
// fictional regulars keeps the times tests book free and the suite quick; sample.test.ts checks
// the full sample.
sampleWithRegulars(false)

// Radix Popover measures its anchor; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

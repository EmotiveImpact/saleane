import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { sampleWithRegulars } from '../domain/seed'

// The sample studio's fifteen named clients carry every story the tests check. Leaving out its
// fictional regulars keeps the times tests book free and the suite quick; sample.test.ts checks
// the full sample.
sampleWithRegulars(false)

// Whole-app journeys open pages on demand, which can take more than the usual second on a busy
// machine, so finding what a page shows waits as long as the journeys' own time allows.
configure({ asyncUtilTimeout: 5000 })

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

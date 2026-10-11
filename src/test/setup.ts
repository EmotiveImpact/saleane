import '@testing-library/jest-dom/vitest'
import { cleanup, configure, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// Radix Select (every choice from a list) captures the pointer and scrolls the chosen option into
// view; jsdom has neither.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// A choice from a list is SALEANE's own Radix list rather than the browser's, so choosing an option
// opens the list and picks it, by its value or its words, the way a person does.
type Writable<T> = { -readonly [K in keyof T]: T[K] }
type User = ReturnType<typeof userEvent.setup>
const setup = userEvent.setup.bind(userEvent)
;(userEvent as Writable<typeof userEvent>).setup = (options) => {
  const user: Writable<User> = setup(options)
  const native = user.selectOptions.bind(user)
  user.selectOptions = async (element, values, ...rest) => {
    if (!(element instanceof HTMLButtonElement) || element.getAttribute('role') !== 'combobox')
      return native(element, values, ...rest)
    for (const value of Array.isArray(values) ? values : [values]) {
      await user.click(element)
      const list = await screen.findByRole('listbox')
      const option = within(list)
        .getAllByRole('option')
        .find((o) =>
          typeof value === 'string'
            ? o.dataset.value === value || o.textContent?.trim() === value
            : o === value,
        )
      if (!option) throw new Error(`"${String(value)}" is not a choice in ${element.textContent}`)
      await user.click(option)
    }
  }
  return user
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

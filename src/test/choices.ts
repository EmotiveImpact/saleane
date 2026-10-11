import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/**
 * What a choice from a list offers. SALEANE's lists (Radix Select) only show their options once
 * opened, so this opens the list the way a person does, reads it, and closes it again.
 */
export async function choicesIn(user: UserEvent, field: HTMLElement) {
  await user.click(field)
  const options = within(await screen.findByRole('listbox')).getAllByRole('option')
  const read = options.map((option) => ({
    text: option.textContent?.trim() ?? '',
    value: option.dataset.value ?? '',
    disabled: option.hasAttribute('data-disabled'),
    chosen: option.getAttribute('data-state') === 'checked',
  }))
  await user.keyboard('{Escape}')
  return read
}

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { TeamToday } from './TeamToday'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { shifts } from '../domain/hours'

// NEXT-07: the desk clocks the team in and out from Today.
let state: BusinessState
let role = 'reception'
const commit = vi.fn(async (command: Command) => {
  const result = dispatch(state, command, 'Rae at the desk')
  if (result.ok) state = result.state
  return result
})
vi.mock('../state/context', () => ({
  useStore: () => ({ state, role, blocked: false, today: '2026-10-06', branch: null, commit }),
}))
beforeEach(() => {
  state = seed('UK')
  role = 'reception'
  commit.mockClear()
})

test('clocks someone in, then out with their break, from Today', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<TeamToday />)
  await user.click(screen.getByRole('button', { name: 'Clock in and out' }))
  let dialog = screen.getByRole('dialog', { name: 'Clock in and out' })
  await user.click(within(dialog).getByRole('button', { name: 'Clock in Maya Lewis' }))
  expect(commit).toHaveBeenLastCalledWith({ type: 'clock-in', staffId: 'staff-maya' })
  expect(within(dialog).getByRole('status')).toHaveTextContent(/^Maya clocked in at \d\d:\d\d\.$/)
  expect(within(dialog).getByText('Maya Lewis').closest('li')).toHaveTextContent(/In since/)
  expect(shifts(state).at(-1)).toMatchObject({ staffId: 'staff-maya', actor: 'Rae at the desk' })

  await user.click(within(dialog).getByRole('button', { name: 'Clock out Maya Lewis' }))
  dialog = screen.getByRole('dialog', { name: 'Clock Maya out' })
  // Back returns to the team without clocking anyone out.
  await user.click(within(dialog).getByRole('button', { name: 'Back' }))
  dialog = screen.getByRole('dialog', { name: 'Clock in and out' })
  await user.click(within(dialog).getByRole('button', { name: 'Clock out Maya Lewis' }))
  dialog = screen.getByRole('dialog', { name: 'Clock Maya out' })
  // Clocked in a moment ago, so any break is longer than the shift and is refused.
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Unpaid break' }), '15')
  await user.click(within(dialog).getByRole('button', { name: 'Clock Maya out' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('The break is as long as the shift.')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Unpaid break' }), '0')
  await user.click(within(dialog).getByRole('button', { name: 'Clock Maya out' }))
  dialog = screen.getByRole('dialog', { name: 'Clock in and out' })
  expect(within(dialog).getByRole('status')).toHaveTextContent(
    /^Maya clocked out at \d\d:\d\d\. Today: \d+ min worked\.$/,
  )
  expect(shifts(state).at(-1)?.endedBy).toBe('Rae at the desk')

  // The strip on Today shows who is in.
  await user.click(within(dialog).getByRole('button', { name: 'Clock in Theo Bennett' }))
  await user.keyboard('{Escape}')
  rerender(<TeamToday />)
  expect(screen.getByText('Theo').closest('li')).toHaveTextContent(/In since \d\d:\d\d/)
  expect(screen.getByText('Maya').closest('li')).not.toHaveTextContent('In since')
})

test('a practitioner clocks in on their own page, not from Today', () => {
  role = 'practitioner'
  render(<TeamToday />)
  expect(screen.queryByRole('button', { name: 'Clock in and out' })).toBeNull()
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { HoursPanel } from './HoursPanel'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { breakLabel, clockTime, hoursPeriod, hoursLabel, shifts } from '../domain/hours'

// NEXT-07: hours worked on Pay, put right by an owner or manager with a reason.
let state: BusinessState
let role = 'owner'
const commit = vi.fn(async (command: Command) => {
  const result = dispatch(state, command, 'Olu Owner')
  if (result.ok) state = result.state
  return result
})
vi.mock('../state/context', () => ({
  useStore: () => ({ state, role, blocked: false, today: '2026-10-06', commit }),
}))
beforeEach(() => {
  state = seed('UK')
  role = 'owner'
  commit.mockClear()
})
const panel = () => screen.getByRole('region', { name: 'Hours worked' })
const show = () => render(<HoursPanel from="2026-10-01" to="2026-10-06" />)

test("shows each person's hours for the period and their shifts when asked", async () => {
  const user = userEvent.setup()
  show()
  const maya = hoursPeriod(state, '2026-10-01', '2026-10-06').get('staff-maya')!
  const row = within(panel()).getByText('Maya Lewis').closest('li')!
  expect(row).toHaveTextContent(`${maya.shifts.length} shifts`)
  expect(row).toHaveTextContent(hoursLabel(maya.minutes))
  await user.click(within(row).getByRole('button', { name: 'Shifts for Maya Lewis' }))
  const list = within(panel()).getByRole('list', { name: 'Shifts for Maya Lewis' })
  // Newest first, with the times on the studio clock and the break.
  const [latest] = maya.shifts
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
    `Mon 5 Oct${clockTime(state, latest.start)} to ${clockTime(state, latest.end!)}, ${breakLabel(latest.breakMinutes)} break`,
  )
})

test('adds missed hours with a reason, and says what was added', async () => {
  const user = userEvent.setup()
  show()
  await user.click(within(panel()).getByRole('button', { name: 'Add hours' }))
  const dialog = screen.getByRole('dialog', { name: 'Add hours' })
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Person' }), 'staff-maya')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Started' }), '09:00')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Finished' }), '13:30')
  await user.click(within(dialog).getByRole('button', { name: 'Add the hours' }))
  // A reason is needed first; what was chosen stays.
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Say why')
  expect(commit).not.toHaveBeenCalled()
  await user.type(within(dialog).getByRole('textbox', { name: 'Why' }), 'Forgot to clock in')
  await user.click(within(dialog).getByRole('button', { name: 'Add the hours' }))
  expect(commit).toHaveBeenCalledWith({
    type: 'shift-save',
    input: {
      staffId: 'staff-maya',
      date: '2026-10-06',
      start: '09:00',
      end: '13:30',
      breakMinutes: 0,
      reason: 'Forgot to clock in',
    },
  })
  expect(within(panel()).getByRole('status')).toHaveTextContent(
    'Maya: 4 h 30 min on Tuesday 6 October.',
  )
  const added = shifts(state).find((x) => x.source === 'added')!
  expect(added.byHand).toMatchObject({ actor: 'Olu Owner', reason: 'Forgot to clock in' })
  // The person's shifts open, with the reason beside the hours added.
  expect(within(panel()).getByRole('list', { name: 'Shifts for Maya Lewis' })).toHaveTextContent(
    'Added by Olu Owner: Forgot to clock in',
  )
})

test('changes and removes hours, keeping them in the record', async () => {
  const user = userEvent.setup()
  show()
  const [latest] = hoursPeriod(state, '2026-10-01', '2026-10-06').get('staff-maya')!.shifts
  await user.click(within(panel()).getByRole('button', { name: 'Shifts for Maya Lewis' }))
  await user.click(
    within(panel()).getByRole('button', {
      name: 'Change hours for Maya Lewis on Monday 5 October',
    }),
  )
  let dialog = screen.getByRole('dialog', { name: 'Hours for Maya Lewis' })
  expect(within(dialog).queryByRole('combobox', { name: 'Person' })).toBeNull()
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Unpaid break' }), '60')
  await user.type(within(dialog).getByRole('textbox', { name: 'Why' }), 'Took a longer lunch')
  await user.click(within(dialog).getByRole('button', { name: 'Save the hours' }))
  expect(shifts(state).find((x) => x.id === latest.id)).toMatchObject({
    breakMinutes: 60,
    byHand: { reason: 'Took a longer lunch' },
  })

  // The times it had before are shown when it is opened again.
  await user.click(
    within(panel()).getByRole('button', {
      name: 'Change hours for Maya Lewis on Monday 5 October',
    }),
  )
  dialog = screen.getByRole('dialog', { name: 'Hours for Maya Lewis' })
  expect(within(dialog).getByText('Before').parentElement).toHaveTextContent(
    `Mon 5 Oct, ${clockTime(state, latest.start)} to ${clockTime(state, latest.end!)}, ${breakLabel(latest.breakMinutes)} breakClocked by Maya Lewis`,
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  await user.click(
    within(panel()).getByRole('button', {
      name: 'Change hours for Maya Lewis on Monday 5 October',
    }),
  )
  dialog = screen.getByRole('dialog', { name: 'Hours for Maya Lewis' })
  await user.click(within(dialog).getByRole('button', { name: 'Remove these hours' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Say why these hours are being removed.',
  )
  await user.type(within(dialog).getByRole('textbox', { name: 'Why' }), 'Was on holiday')
  await user.click(within(dialog).getByRole('button', { name: 'Remove these hours' }))
  expect(within(panel()).getByRole('status')).toHaveTextContent(
    'The hours for Maya on Monday 5 October are removed. The record keeps them, with your reason.',
  )
  expect(shifts(state).some((x) => x.id === latest.id)).toBe(false)
  expect(state.operations!.shifts!.find((x) => x.id === latest.id)?.removed).toMatchObject({
    actor: 'Olu Owner',
    reason: 'Was on holiday',
  })
})

test('points out a forgotten clock-out, and keeps changes from people who cannot make them', () => {
  state.operations!.shifts!.push({
    id: 'shift-open',
    staffId: 'staff-theo',
    date: '2026-10-02',
    start: '2026-10-02T08:00:00.000Z',
    breakMinutes: 0,
    source: 'clock',
    createdAt: '2026-10-02T08:00:00.000Z',
    actor: 'Theo Bennett',
  })
  role = 'reception'
  show()
  expect(
    within(panel()).getByText(/Theo Bennett did not clock out on Friday 2 October/),
  ).toHaveTextContent('An owner or manager can set when they ended so the hours count.')
  expect(within(panel()).getByText('Theo Bennett').closest('li')).toHaveTextContent(
    '1 with no finish time',
  )
  expect(within(panel()).queryByRole('button', { name: 'Add hours' })).toBeNull()
})

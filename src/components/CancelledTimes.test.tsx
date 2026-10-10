import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { CancelledTimes } from './CancelledTimes'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { Appointment, BusinessState } from '../domain/model'
import { defaultReminderSettings } from '../domain/reminderSettings'

// NEXT-11: times a cancellation left free, on the waitlist page.
let state: BusinessState
let role = 'reception'
const commit = vi.fn(async (command: Command) => {
  const result = dispatch(state, command, 'Rae Desk')
  if (result.ok) state = result.state
  return result
})
vi.mock('../state/context', () => ({
  useStore: () => ({ state, role, blocked: false, today: '2026-10-06', commit }),
}))
const change = (command: Command) => {
  const result = dispatch(state, command, 'Rae Desk')
  if (!result.ok) throw new Error(result.error)
  state = result.state
}
/** The sample studio without its waitlist, with or without SALEANE's own invitations. */
function studio(own = true) {
  const s = seed('UK')
  s.waitlist = []
  if (!own)
    s.operations = {
      ...s.operations!,
      reminders: { ...defaultReminderSettings, openingInvites: false },
    } as BusinessState['operations']
  // Emily has had a facial before, in the morning with Sophia.
  s.appointments.push({
    ...s.appointments.find((a) => a.id === 'history-charlotte-1')!,
    id: 'history-emily-facial',
    clientId: 'client-14',
    staffId: 'staff-sophia',
    date: '2026-09-15',
    startMinutes: 600,
  } as Appointment)
  return s
}
const cancelZoe = () =>
  change({ type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' })
const show = () =>
  render(
    <MemoryRouter>
      <CancelledTimes />
    </MemoryRouter>,
  )
const panel = () => screen.getByRole('region', { name: 'Cancelled times' })
beforeEach(() => {
  role = 'reception'
  commit.mockClear()
})

test('shows a freed time with who might like it, and writes the invitations chosen', async () => {
  const user = userEvent.setup()
  state = studio(false)
  cancelZoe()
  show()
  const card = within(panel()).getByText('Tuesday 6 October at 13:30').closest('li')!
  expect(card).toHaveTextContent('Skin Renewal Facial with Maya Lewis')
  expect(card).toHaveTextContent('60 minutes. Cancelled just now.')
  expect(within(panel()).getByText(/one time was freed by cancellations and none/)).toBeVisible()
  const guests = within(card).getByRole('group', {
    name: 'Might like it: Tuesday 6 October at 13:30',
  })
  const charlotte = within(guests).getByRole('checkbox', { name: /Charlotte Hayes/ })
  const emily = within(guests).getByRole('checkbox', { name: /Emily Clarke/ })
  expect(charlotte).toBeChecked()
  expect(emily).toBeChecked()
  expect(
    within(guests)
      .getByText(/Charlotte Hayes/)
      .closest('label'),
  ).toHaveTextContent(
    'Was due back on Tuesday 15 September, has seen Maya before, usually comes in the afternoons',
  )
  await user.click(emily)
  await user.click(within(card).getByRole('button', { name: /Write one invitation/ }))
  expect(commit).toHaveBeenCalledWith({
    type: 'opening-invite',
    appointmentId: 'visit-zoe',
    clientIds: ['client-13'],
  })
  expect(within(card).getByRole('status')).toHaveTextContent(
    'An invitation is waiting in the Inbox for you to approve. Nothing has been sent. Open the Inbox',
  )
})

test('says who SALEANE invited, and offers the time to whoever on the waitlist it suits', async () => {
  const user = userEvent.setup()
  state = studio()
  cancelZoe()
  const { unmount } = show()
  const card = within(panel()).getByText('Tuesday 6 October at 13:30').closest('li')!
  // SALEANE wrote to the best fits when the visit was cancelled; they wait for approval.
  const invited = within(card).getByText('Invited').parentElement!
  expect(invited).toHaveTextContent(
    'Charlotte Hayes: waiting in the Inbox for approval, written by SALEANE',
  )
  expect(invited).toHaveTextContent(
    'Emily Clarke: waiting in the Inbox for approval, written by SALEANE',
  )
  expect(within(card).queryByRole('group')).toBeNull()
  unmount()

  // In the sample studio Charlotte is waiting for an afternoon facial with Maya. She comes first,
  // so nobody else is ticked to start with.
  state = { ...studio(), waitlist: seed('UK').waitlist }
  cancelZoe()
  const again = show()
  expect(within(panel()).getByText(/Charlotte Hayes is waiting for a time like this/)).toBeVisible()
  expect(within(panel()).getByRole('checkbox', { name: /Emily Clarke/ })).not.toBeChecked()
  expect(within(panel()).getByRole('button', { name: /Choose who to invite/ })).toBeDisabled()
  // Offering it to her is one step from here.
  await user.click(within(panel()).getByRole('button', { name: /Offer it to Charlotte/ }))
  const dialog = screen.getByRole('dialog', {
    name: 'Tuesday 6 October at 13:30 for Charlotte Hayes',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Write an offer' }))
  expect(commit).toHaveBeenLastCalledWith({
    type: 'waitlist-offer',
    entryId: 'waitlist-1',
    date: '2026-10-06',
    startMinutes: 810,
    staffId: 'staff-maya',
  })
  // The card then says she has been offered it, rather than offering it again.
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  expect(panel()).toHaveTextContent(
    'Charlotte Hayes: offered this time, waiting in the Inbox for approval',
  )
  expect(within(panel()).queryByRole('button', { name: /Offer it to/ })).toBeNull()
  again.unmount()
  role = 'practitioner'
  show()
  // Someone who cannot write invitations sees no choices.
  expect(within(panel()).queryByRole('checkbox')).toBeNull()
  expect(within(panel()).queryByRole('button')).toBeNull()
})

test('says when nothing has been cancelled and left free', () => {
  state = seed('UK')
  show()
  expect(
    within(panel()).getByText(
      'Nothing booked in the next 14 days has been cancelled and left free.',
    ),
  ).toBeVisible()
})

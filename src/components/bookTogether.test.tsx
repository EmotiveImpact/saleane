import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { execute } from '../domain/commands'
import { seed } from '../domain/seed'

const KEY = 'saleane.demo.v1.UK'
function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
type Stored = {
  id: string
  clientId: string
  staffId: string
  resourceId: string
  date: string
  startMinutes: number
  status: string
  together?: { id: string; lead?: true }
}
const stored = (): Stored[] => JSON.parse(localStorage.getItem(KEY)!).appointments

async function startBooking(user: ReturnType<typeof userEvent.setup>) {
  show('/today')
  await user.click(screen.getAllByRole('button', { name: /New visit/ })[0])
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByRole('searchbox', { name: 'Client' }), 'grace')
  await user.click(within(dialog).getByRole('button', { name: /Grace Chen/ }))
  await user.selectOptions(within(dialog).getByLabelText('Treatment'), 'service-restore')
  await user.selectOptions(within(dialog).getByLabelText('Professional'), 'staff-maya')
  await user.click(within(dialog).getByLabelText('Date'))
  await user.click(screen.getByRole('button', { name: 'Thursday 15 October 2026' }))
  await user.click(within(dialog).getByRole('radio', { name: '10:00' }))
  return dialog
}

// NEXT-08. Each test drives the whole app, which can take several seconds on a busy machine.
describe('booking several people at the desk', { timeout: 30000 }, () => {
  it('books a couple side by side in the room for two', async () => {
    const user = userEvent.setup()
    const dialog = await startBooking(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add someone' }))
    const people = within(dialog).getByRole('list', { name: 'Others coming' })
    await user.type(within(people).getByRole('searchbox', { name: 'Person 2' }), 'olivia')
    await user.click(within(people).getByRole('button', { name: /Olivia James/ }))
    await user.selectOptions(
      within(people).getByLabelText('Treatment for Person 2'),
      'service-restore',
    )
    expect(within(people).getByLabelText('Time for Person 2')).toHaveValue('600')
    expect(people).toHaveTextContent(
      'At 10:00, the same time as Grace. With Sophia in Treatment room 2, beside Grace.',
    )
    // A repeat is for one person, so it is off while others are coming.
    expect(within(dialog).queryByLabelText('How often')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 2 visits' }))
    expect(screen.getByText('Visits to look forward to')).toBeInTheDocument()
    const booked = screen.getByRole('list', { name: 'Visits booked' })
    expect(
      within(booked)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Grace Chen, Deep Restore Massage with Maya at 10:00',
      'Olivia James, Deep Restore Massage with Sophia at 10:00',
    ])
    const party = stored().filter((a) => a.together)
    expect(party.map((a) => [a.clientId, a.staffId, a.resourceId, a.startMinutes])).toEqual([
      ['client-6', 'staff-maya', 'room-two', 600],
      ['client-2', 'staff-sophia', 'room-two', 600],
    ])
    expect(party[0].together).toEqual({ id: party[1].together!.id, lead: true })
  })

  it('asks who each person is and adds someone new with their own details', async () => {
    const user = userEvent.setup()
    const dialog = await startBooking(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add someone' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 2 visits' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Choose who Person 2 is, or add them as someone new.',
    )
    const people = within(dialog).getByRole('list', { name: 'Others coming' })
    await user.click(within(people).getByRole('button', { name: /They are new/ }))
    await user.type(within(people).getByLabelText('Name'), 'Amy Lee')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 2 visits' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter Person 2’s name, email and phone.',
    )
    await user.type(within(people).getByLabelText('Email'), 'amy.lee@example.com')
    await user.type(within(people).getByLabelText('Phone'), '+44 7700 900111')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 2 visits' }))
    expect(await screen.findByText('Visits to look forward to')).toBeInTheDocument()
    const state = JSON.parse(localStorage.getItem(KEY)!)
    const amy = state.clients.find((c: { name: string }) => c.name === 'Amy Lee')
    expect(stored().find((a) => a.clientId === amy.id)!.together).toBeTruthy()
  })

  it('shows who a visit is booked with, and cancels them together', async () => {
    const s = seed('UK')
    const result = execute(s, {
      type: 'book-together',
      booking: {
        clientId: 'client-6',
        serviceId: 'service-restore',
        staffId: 'staff-maya',
        date: '2026-10-15',
        startMinutes: 600,
        source: 'desk',
      },
      guests: [
        {
          clientId: 'client-2',
          serviceId: 'service-restore',
          staffId: 'staff-sophia',
          startMinutes: 600,
        },
      ],
    })
    if (!result.ok) throw new Error(result.error)
    localStorage.setItem(KEY, JSON.stringify(result.state))
    const [lead, guest] = result.state.appointments.filter((a) => a.together)
    const user = userEvent.setup()
    show(`/calendar?date=2026-10-15&appointment=${lead.id}`)
    const panel = await screen.findByRole('dialog', { name: 'Deep Restore Massage' })
    expect(within(panel).getByRole('list', { name: 'Booked together' })).toHaveTextContent(
      'Olivia James, Deep Restore Massage with Sophia at 10:00',
    )
    // The calendar behind the panel marks both visits.
    expect(screen.getAllByRole('img', { name: 'Booked with 1 other', hidden: true })).toHaveLength(
      2,
    )
    await user.click(within(panel).getByRole('button', { name: 'Cancel visit' }))
    const choice = within(panel).getByRole('group', { name: 'Booked together with Olivia James' })
    expect(within(choice).getByRole('radio', { name: 'Just this visit' })).toBeChecked()
    await user.click(
      within(choice).getByRole('radio', { name: 'This visit and the one booked with it' }),
    )
    await user.clear(within(panel).getByLabelText('Operational reason'))
    await user.type(within(panel).getByLabelText('Operational reason'), 'Wedding moved')
    await user.click(within(panel).getByRole('button', { name: 'Confirm cancellation' }))
    expect(
      await within(panel).findByText(/This visit and the one booked with it are cancelled/),
    ).toBeInTheDocument()
    const after = stored()
    expect(after.find((a) => a.id === lead.id)!.status).toBe('cancelled')
    expect(after.find((a) => a.id === guest.id)!.status).toBe('cancelled')
  })
})

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
  date: string
  startMinutes: number
  status: string
  repeat?: { id: string; everyWeeks: number }
}
const stored = (): Stored[] => JSON.parse(localStorage.getItem(KEY)!).appointments

// NEXT-09. Each test drives the whole app, which can take several seconds on a busy machine.
describe('repeat visits at the desk', { timeout: 20000 }, () => {
  it('books a visit every four weeks, showing each later visit and its time', async () => {
    const user = userEvent.setup()
    show('/today')
    await user.click(screen.getAllByRole('button', { name: /New visit/ })[0])
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox', { name: 'Client' }), 'grace')
    await user.click(within(dialog).getByRole('button', { name: /Grace Chen/ }))
    await user.click(within(dialog).getByLabelText('Date'))
    await user.click(screen.getByRole('button', { name: 'Thursday 15 October 2026' }))
    await user.click(within(dialog).getByRole('radio', { name: '10:00' }))
    await user.selectOptions(within(dialog).getByLabelText('How often'), 'Every 4 weeks')
    await user.selectOptions(within(dialog).getByLabelText('Visits in all'), '3 visits')
    const later = within(dialog).getByRole('list', { name: 'The later visits' })
    const rows = within(later).getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('strong')!.textContent)).toEqual([
      'Thursday 12 November',
      'Thursday 10 December',
    ])
    expect(rows[0]).toHaveTextContent('Free at 10:00.')
    // The desk can choose another time for one visit, or leave it out.
    await user.selectOptions(
      within(rows[1]).getByLabelText('Time on Thursday 10 December'),
      '11:00',
    )
    expect(rows[1]).toHaveTextContent('At the time you chose.')
    expect(within(dialog).getByText(/3 visits, each its own booking/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 3 visits' }))
    expect(screen.getByText('Visits to look forward to')).toBeInTheDocument()
    const booked = screen.getByRole('list', { name: 'Visits booked' })
    expect(
      within(booked)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Thursday 15 October at 10:00',
      'Thursday 12 November at 10:00',
      'Thursday 10 December at 11:00',
    ])
    const grace = stored().filter((a) => a.clientId === 'client-6' && a.repeat)
    expect(grace.map((a) => [a.date, a.startMinutes])).toEqual([
      ['2026-10-15', 600],
      ['2026-11-12', 600],
      ['2026-12-10', 660],
    ])
    expect(new Set(grace.map((a) => a.repeat!.id)).size).toBe(1)
  })

  it('leaves out a visit with nothing free and refuses a repeat with every visit left out', async () => {
    const user = userEvent.setup()
    show('/today')
    await user.click(screen.getAllByRole('button', { name: /New visit/ })[0])
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox', { name: 'Client' }), 'grace')
    await user.click(within(dialog).getByRole('button', { name: /Grace Chen/ }))
    await user.click(within(dialog).getByLabelText('Date'))
    await user.click(screen.getByRole('button', { name: 'Thursday 15 October 2026' }))
    await user.click(within(dialog).getByRole('radio', { name: '10:00' }))
    await user.selectOptions(within(dialog).getByLabelText('How often'), 'Every week')
    await user.selectOptions(within(dialog).getByLabelText('Visits in all'), '2 visits')
    await user.selectOptions(
      within(dialog).getByLabelText('Time on Thursday 22 October'),
      'Leave this one out',
    )
    expect(within(dialog).getByText('Left out.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Confirm 1 visits/ })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm demo booking' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Every later visit is left out. Give one a time, or choose Just this visit.',
    )
    expect(localStorage.getItem(KEY) ? stored().some((a) => a.repeat) : false).toBe(false)
  })

  it('shows where a visit sits in its repeat, and cancels it with the ones after it', async () => {
    const s = seed('UK')
    const result = execute(s, {
      type: 'book-repeat',
      booking: {
        clientId: 'client-6',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-15',
        startMinutes: 600,
        source: 'desk',
      },
      everyWeeks: 2,
      visits: [
        { date: '2026-10-29', startMinutes: 600 },
        { date: '2026-11-12', startMinutes: 600 },
      ],
    })
    if (!result.ok) throw new Error(result.error)
    localStorage.setItem(KEY, JSON.stringify(result.state))
    const [, second, third] = result.state.appointments.filter((a) => a.repeat)
    const user = userEvent.setup()
    show(`/calendar?date=2026-10-29&appointment=${second.id}`)
    const panel = await screen.findByRole('dialog', { name: 'Skin Renewal Facial' })
    expect(within(panel).getByText(/Visit 2 of 3, repeating every 2 weeks/)).toHaveTextContent(
      'Visit 2 of 3, repeating every 2 weeks. Next: Thursday 12 November at 10:00.',
    )
    await user.click(within(panel).getByRole('button', { name: 'Cancel visit' }))
    const choice = within(panel).getByRole('group', { name: 'This visit repeats every 2 weeks' })
    expect(within(choice).getByRole('radio', { name: 'Just this visit' })).toBeChecked()
    await user.click(
      within(choice).getByRole('radio', {
        name: 'This visit and the 1 after it, to Thursday 12 November',
      }),
    )
    // Keeping the visit and coming back starts again from this visit alone.
    await user.click(within(panel).getByRole('button', { name: 'Keep visit' }))
    await user.click(within(panel).getByRole('button', { name: 'Cancel visit' }))
    const again = within(panel).getByRole('group', { name: 'This visit repeats every 2 weeks' })
    expect(within(again).getByRole('radio', { name: 'Just this visit' })).toBeChecked()
    await user.click(
      within(again).getByRole('radio', {
        name: 'This visit and the 1 after it, to Thursday 12 November',
      }),
    )
    await user.type(within(panel).getByLabelText('Operational reason'), 'Moving away')
    await user.click(within(panel).getByRole('button', { name: 'Confirm cancellation' }))
    expect(
      await within(panel).findByText(/This visit and the 1 after it are cancelled/),
    ).toBeInTheDocument()
    const after = stored()
    expect(after.find((a) => a.id === second.id)!.status).toBe('cancelled')
    expect(after.find((a) => a.id === third.id)!.status).toBe('cancelled')
    expect(
      after.find((a) => a.repeat?.id === second.repeat!.id && a.date === '2026-10-15')!.status,
    ).toBe('confirmed')
  })
})

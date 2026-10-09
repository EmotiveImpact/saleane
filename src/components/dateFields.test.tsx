import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
const stored = () => JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('dates and times written the studio’s way in staff forms', { timeout: 20000 }, () => {
  it('books a new visit on a day chosen from the calendar', async () => {
    const user = userEvent.setup()
    show('/today')
    await user.click(screen.getAllByRole('button', { name: /New visit/ })[0])
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox', { name: 'Client' }), 'grace')
    await user.click(within(dialog).getByRole('button', { name: /Grace Chen/ }))
    const date = within(dialog).getByLabelText('Date')
    expect(date).toHaveTextContent('Tue 6 Oct 2026')
    await user.click(date)
    await user.click(screen.getByRole('button', { name: 'Thursday 15 October 2026' }))
    expect(date).toHaveTextContent('Thu 15 Oct 2026')
    await user.click(within(dialog).getByRole('radio', { name: '10:00' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm demo booking' }))
    expect(screen.getByText('A visit to look forward to')).toBeInTheDocument()
    expect(
      stored().appointments.find(
        (a: { clientId: string; date: string }) =>
          a.clientId === 'client-6' && a.date === '2026-10-15',
      ),
    ).toMatchObject({ startMinutes: 600, source: 'desk' })
  })

  it('rebooks from the receipt with the rhythm choices and the date field agreeing', async () => {
    const user = userEvent.setup()
    show('/today')
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: /checkout/i }))
    await user.click(screen.getByRole('button', { name: 'Record demo payment' }))
    await user.click(screen.getByRole('button', { name: 'Rebook this client' }))
    const dialog = screen.getByRole('dialog')
    const date = within(dialog).getByLabelText('Date')
    expect(date).toHaveTextContent('Tue 3 Nov 2026')
    await user.click(within(dialog).getByRole('button', { name: /In 6 weeks/ }))
    expect(date).toHaveTextContent('Tue 17 Nov 2026')
    await user.click(within(dialog).getByRole('radio', { name: '09:30' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm demo booking' }))
    expect(
      stored().appointments.find(
        (a: { rebookedFromId?: string }) => a.rebookedFromId === 'visit-amelia',
      ),
    ).toMatchObject({ date: '2026-11-17', startMinutes: 570, source: 'rebook' })
  })

  it('records a till count for an earlier day chosen from the calendar', async () => {
    const user = userEvent.setup()
    show('/business/money')
    const day = await screen.findByLabelText('Day counted')
    expect(day).toHaveTextContent('Tue 6 Oct 2026')
    await user.click(day)
    expect(screen.getByRole('button', { name: 'Wednesday 7 October 2026' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Monday 5 October 2026' }))
    expect(screen.getByRole('heading', { name: 'Counts for Monday 5 October' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Cash counted in the till/), '40')
    await user.click(screen.getByRole('button', { name: 'Record till count' }))
    expect(stored().tillCounts.at(-1)).toMatchObject({ date: '2026-10-05', countedMinor: 4000 })
  })

  it('saves a professional’s own hours from 24-hour time lists', async () => {
    const user = userEvent.setup()
    show('/settings?section=staff')
    await user.click(await screen.findByRole('button', { name: 'Edit Theo Bennett' }))
    // Theo keeps his own week, Tuesday to Saturday, so his days show already.
    expect(
      screen.getByRole('checkbox', { name: 'Follows the venue opening hours' }),
    ).not.toBeChecked()
    const starts = screen.getByRole('combobox', { name: 'Tuesday starts' })
    expect(within(starts).getByRole('option', { name: '09:00' })).toHaveProperty('selected', true)
    await user.selectOptions(starts, '10:30')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tuesday finishes' }), '17:45')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const theo = stored().staff.find((p: { id: string }) => p.id === 'staff-theo')
    expect(theo.hours.find((d: { day: number }) => d.day === 2)).toMatchObject({
      open: 630,
      close: 1065,
    })
  })
})

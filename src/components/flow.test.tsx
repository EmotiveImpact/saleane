import { describe, expect, it } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { usualWeeks } from '../domain/selectors'
import { groupTimes } from '../design'

async function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  // Pages load when they are first opened; wait for this one before looking at it.
  await waitFor(() =>
    expect(document.querySelector('.route-loading, .candidate-loading')).toBeNull(),
  )
}

describe('faster everyday flows', () => {
  it('books from a free space on the calendar with the person and time filled in', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getAllByRole('button', { name: 'Book with Maya Lewis from 09:00' })[0])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Professional')).toHaveValue('staff-maya')
    expect(within(dialog).getByRole('radio', { name: '09:00' })).toBeChecked()
    // The client is found by typing, and their note appears once chosen.
    await user.type(within(dialog).getByRole('searchbox', { name: 'Client' }), 'grace')
    await user.click(within(dialog).getByRole('button', { name: /Grace Chen/ }))
    expect(within(dialog).getByText('Good to remember')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm demo booking' }))
    expect(screen.getByText('A visit to look forward to')).toBeInTheDocument()
  })

  it('asks for a client before a new booking can be confirmed', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getAllByRole('button', { name: 'Book with Maya Lewis from 09:00' })[0])
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm demo booking' }),
    ).toBeDisabled()
  })

  it('shows the whole week and opens a day from it', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    await user.click(screen.getByRole('radio', { name: 'Week' }))
    expect(screen.getByRole('heading', { name: /Week of Monday 5 October/ })).toBeInTheDocument()
    const tuesday = screen.getByRole('region', { name: 'Tuesday 6 October' })
    expect(within(tuesday).getByRole('button', { name: /Amelia Carter/ })).toBeInTheDocument()
    await user.click(within(tuesday).getByRole('button', { name: /Tue/ }))
    expect(screen.getByRole('heading', { name: 'Tuesday 6 October' })).toBeInTheDocument()
  })

  it('lands on today, shows the month, and opens a day or a visit from it', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Month' }))
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    const tuesday = screen.getByRole('region', { name: 'Tuesday 6 October' })
    await user.click(within(tuesday).getAllByRole('button', { name: /^\d{2}:\d{2} / })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('region', { name: 'Tuesday 10 November' })).getByRole('button', {
        name: /^Tuesday 10 November/,
      }),
    )
    expect(screen.getByRole('heading', { name: 'Tuesday 10 November' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Today' })).not.toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Today' }))
    expect(screen.getByRole('heading', { name: 'Tuesday 6 October' })).toBeInTheDocument()
  })

  it('keeps discount before the tip at checkout and folds a custom tip into Other', async () => {
    const user = userEvent.setup()
    await show('/today')
    await user.click(screen.getAllByRole('button', { name: /Amelia Carter/ })[0])
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText(/Custom tip/)).not.toBeInTheDocument()
    const discount = within(dialog).getByLabelText(/Discount/)
    const tip = within(dialog).getByRole('group', { name: 'Optional tip' })
    expect(discount.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Other' }))
    expect(within(dialog).getByLabelText(/Custom tip/)).toBeInTheDocument()
  })
})

describe('rhythm and grouping helpers', () => {
  it('finds a usual gap between visits in whole weeks', () => {
    expect(usualWeeks(['2026-08-04', '2026-09-01', '2026-09-29'])).toBe(4)
    expect(usualWeeks(['2026-09-29'])).toBeNull()
    expect(usualWeeks(['2026-09-28', '2026-09-29', '2026-09-30'])).toBeNull()
  })

  it('groups times into morning, afternoon and evening', () => {
    const groups = groupTimes([540, 720, 1020].map((value) => ({ value })))
    expect(groups.map((group) => group.label)).toEqual(['Morning', 'Afternoon', 'Evening'])
  })
})

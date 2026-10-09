import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

async function show() {
  render(
    <MemoryRouter initialEntries={['/calendar']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  // Pages load when they are first opened; wait for the calendar before looking at it.
  await waitFor(() =>
    expect(document.querySelector('.route-loading, .candidate-loading')).toBeNull(),
  )
}

/** Where a visit sits on the week's timeline, as the stylesheet reads it. */
function placeOf(chip: HTMLElement) {
  const slot = chip.closest('li')!
  return Object.fromEntries(
    ['from', 'length', 'column', 'across'].map((key) => [
      key,
      Number(slot.style.getPropertyValue(`--${key}`)),
    ]),
  )
}

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('the calendar’s week and month', { timeout: 20000 }, () => {
  it('lays the week on one timeline, with visits at the same time side by side', async () => {
    const user = userEvent.setup()
    await show()
    expect(screen.getByText('Turnaround time shown beneath each visit')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Week' }))
    // The week shows each visit's own time, so the note about turnaround stays with the day.
    expect(screen.queryByText('Turnaround time shown beneath each visit')).not.toBeInTheDocument()

    const tuesday = screen.getByRole('region', { name: 'Tuesday 6 October' })
    expect(within(tuesday).getByRole('button', { name: /^Tue/ })).toHaveTextContent(
      'Tue6 Oct12 visits',
    )
    const visits = within(tuesday).getAllByRole('button', { name: /^\d{2}:\d{2} / })
    expect(visits).toHaveLength(12)
    // Amelia is at 09:30 for an hour, beside the two visits that began at 09:00.
    const amelia = within(tuesday).getByRole('button', { name: /Amelia Carter/ })
    expect(amelia).toHaveAccessibleName(/^09:30 Maya Amelia Carter Skin Renewal Facial/)
    expect(placeOf(amelia)).toEqual({ from: 30, length: 60, column: 2, across: 3 })
    // Ruby's visit at 15:00 overlaps no one, so it has the column's full width.
    const ruby = within(tuesday).getByRole('button', { name: /Ruby Taylor/ })
    expect(placeOf(ruby)).toEqual({ from: 360, length: 60, column: 0, across: 1 })
    expect(
      within(screen.getByRole('region', { name: 'Wednesday 7 October' })).getByRole('button', {
        name: /^Wed/,
      }),
    ).toHaveTextContent('No visits')

    await user.click(amelia)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Amelia Carter')
  })

  it('shows how many visits each day of the month has, and opens a day from it', async () => {
    const user = userEvent.setup()
    await show()
    await user.click(screen.getByRole('radio', { name: 'Month' }))
    expect(screen.getByText('Tap a day to open it.')).toBeInTheDocument()
    const tuesday = within(screen.getByRole('region', { name: 'Tuesday 6 October' })).getByRole(
      'button',
      { name: 'Tuesday 6 October, 12 visits' },
    )
    expect(tuesday).toHaveTextContent('612 visits')
    const thursday = within(screen.getByRole('region', { name: 'Thursday 8 October' })).getByRole(
      'button',
      { name: 'Thursday 8 October, 1 visit' },
    )
    expect(thursday).toHaveTextContent('81 visit')
    const empty = within(screen.getByRole('region', { name: 'Tuesday 13 October' })).getByRole(
      'button',
      { name: 'Tuesday 13 October, no visits' },
    )
    expect(empty).toHaveTextContent(/^13$/)

    await user.click(thursday)
    expect(screen.getByRole('heading', { name: 'Thursday 8 October' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Ellie Brooks/ }).length).toBeGreaterThan(0)
  })
})

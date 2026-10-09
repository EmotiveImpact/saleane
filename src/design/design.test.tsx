import { describe, expect, it } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

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

describe('design language in the workspace', () => {
  it('switches the reporting period with a single-choice segmented control', async () => {
    const user = userEvent.setup()
    await show('/business')
    const group = screen.getByRole('radiogroup', { name: 'Reporting period' })
    expect(within(group).getByRole('radio', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(group).getByRole('radio', { name: 'Last 28 days' }))
    expect(within(group).getByRole('radio', { name: 'Last 28 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // Clicking the selected option keeps it selected rather than clearing the period.
    await user.click(within(group).getByRole('radio', { name: 'Last 28 days' }))
    expect(within(group).getByRole('radio', { name: 'Last 28 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/Last 28 days · today/)).toBeInTheDocument()
  })
  it('explains time booked the same way on Today and Business', async () => {
    const user = userEvent.setup()
    await show('/today')
    await user.click(screen.getByRole('button', { name: 'How Time booked is measured' }))
    expect(await screen.findByText(/Booked service minutes divided by/)).toBeInTheDocument()
  })
  it('shows each professional’s free time in the narrow calendar', async () => {
    await show('/calendar')
    expect(screen.getByRole('region', { name: 'Maya Lewis' })).toBeInTheDocument()
    expect(screen.getAllByText(/^Free \d{2}:\d{2} to \d{2}:\d{2}$/).length).toBeGreaterThan(0)
  })
  it('renders the living library inside the workspace', async () => {
    await show('/design-language')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Design language' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Example sections' })).toBeInTheDocument()
  })
})

describe('shared page parts', () => {
  it('pairs each headline figure with its label', async () => {
    await show('/business/pay')
    const label = await screen.findByText('Owed to the team')
    expect(label.tagName).toBe('DT')
    const [figure, detail] = within(label.closest('.stat') as HTMLElement).getAllByRole(
      'definition',
    )
    expect(figure).toHaveTextContent(/^£\d[\d,]*$/)
    expect(detail).toHaveTextContent('Before any deductions')
  })
  it('opens the waitlist with the shared header and its action', async () => {
    await show('/waitlist')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Who would take a time.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Waitlist', { selector: '.eyebrow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to the waitlist' })).toBeInTheDocument()
  })
})

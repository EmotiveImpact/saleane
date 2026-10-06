import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show(route = '/today') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

describe('connected operator journeys', () => {
  it('moves a visit with keyboard time choices and follows it to its new calendar day', async () => {
    const user = userEvent.setup()
    show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed, Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Move appointment' }))
    expect(screen.getByRole('heading', { name: 'Move appointment' })).toHaveFocus()
    await user.clear(screen.getByLabelText('New date'))
    await user.type(screen.getByLabelText('New date'), '2026-10-07')
    const first = screen.getByRole('radio', { name: '09:00' })
    await user.click(first)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '09:30' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save appointment' }))
    expect(screen.getByRole('status')).toHaveTextContent('Appointment saved')
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.appointments.find((a: { id: string }) => a.id === 'visit-noor')).toMatchObject({
      date: '2026-10-07',
      startMinutes: 570,
      bookedPriceMinor: 9500,
    })
    expect(saved.events.filter((e: { type: string }) => e.type === 'rescheduled')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Jump to date')).toHaveValue('2026-10-07')
    expect(
      screen.getAllByRole('button', { name: /Noor Ahmed, Skin Renewal Facial, 09:30/ }).length,
    ).toBeGreaterThan(0)
  })
  it('requires cancellation review and preserves the visit in accessible calendar history', async () => {
    const user = userEvent.setup()
    show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed, Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Cancel appointment' }))
    expect(screen.getByText('£25 deposit remains recorded')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep appointment' }))
    expect(screen.getByRole('button', { name: 'Welcome client' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel appointment' }))
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
    expect(screen.getByRole('status')).toHaveTextContent('Cancellation recorded')
    expect(screen.queryByRole('button', { name: 'Welcome client' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Changes to this day' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Noor Ahmed, Skin Renewal Facial, 11:00, cancelled/ }),
    )
    expect(
      within(screen.getByRole('dialog')).getByText('Cancelled', { exact: true }),
    ).toBeInTheDocument()
    expect(screen.getByText('Deposit review remains open')).toBeInTheDocument()
  })
  it('follows a moved visit when a professional filter was active', async () => {
    const user = userEvent.setup()
    show('/calendar')
    await user.selectOptions(screen.getByLabelText('Filter professional'), 'staff-maya')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed, Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Move appointment' }))
    await user.selectOptions(screen.getByLabelText('Professional'), 'staff-sophia')
    await user.click(screen.getByRole('radio', { name: '12:30' }))
    await user.click(screen.getByRole('button', { name: 'Save appointment' }))
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Filter professional')).toHaveValue('staff-sophia')
    expect(
      screen.getAllByRole('button', { name: /Noor Ahmed, Skin Renewal Facial, 12:30/ }).length,
    ).toBeGreaterThan(0)
  })
  it('records missed attendance through an explicit review without creating a sale', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Noor Ahmed, Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Mark as missed' }))
    expect(screen.getByText(/Confirm that the scheduled visit time has passed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm missed visit' }))
    expect(screen.getByRole('status')).toHaveTextContent('Missed visit recorded')
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.appointments.find((a: { id: string }) => a.id === 'visit-noor').status).toBe(
      'no_show',
    )
    expect(
      saved.sales.some((s: { appointmentId: string }) => s.appointmentId === 'visit-noor'),
    ).toBe(false)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('link', { name: /1 missed. Review today/ })).toBeInTheDocument()
  })
  it('focuses search immediately and restores the initiating control on Escape', async () => {
    const user = userEvent.setup()
    show()
    const trigger = screen.getByRole('button', { name: 'Find a client' })
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Search workspace' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('checks out an arrived visit and presents the linked receipt and rebooking action', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Amelia Carter, Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    await user.click(screen.getByRole('button', { name: '15%' }))
    await user.click(screen.getByRole('button', { name: 'Record demo payment' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('£84.25')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Rebook this client' })).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(
      saved.sales.filter((s: { appointmentId: string }) => s.appointmentId === 'visit-amelia'),
    ).toHaveLength(1)
  })
  it('finds a client and appends an ordinary relationship note', async () => {
    const user = userEvent.setup()
    show('/clients')
    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'Amelia')
    await user.click(screen.getByRole('link', { name: /Amelia Carter/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'Relationship note' }),
      'Prefers a Tuesday afternoon.',
    )
    await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(screen.getByText('Prefers a Tuesday afternoon.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument()
  })
  it('completes public booking with marketing left off and exposes it in the calendar', async () => {
    const user = userEvent.setup()
    show('/booking')
    await user.click(screen.getByRole('button', { name: 'Choose a time' }))
    await user.click(screen.getByRole('button', { name: '09:00' }))
    await user.click(screen.getByRole('button', { name: 'Your details' }))
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Alex Demo')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alex@example.com')
    await user.type(
      screen.getByRole('textbox', { name: 'Phone with country code' }),
      '+44 7700 900111',
    )
    await user.click(screen.getByRole('button', { name: 'Review your visit' }))
    await user.click(screen.getByRole('checkbox', { name: /I understand this is a demo/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm demo visit' }))
    expect(screen.getByText(/Something to/)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(
      saved.clients.find((c: { name: string }) => c.name === 'Alex Demo').marketingConsent,
    ).toBe(false)
    expect(saved.appointments.some((a: { source: string }) => a.source === 'online')).toBe(true)
  })
})

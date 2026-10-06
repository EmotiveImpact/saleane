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

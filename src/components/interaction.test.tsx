import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'

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
    await user.keyboard('{ArrowRight}{ArrowRight}')
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
  it('shows each visit once in the relationship timeline and keeps its filters working', async () => {
    const user = userEvent.setup()
    show('/clients/client-1')
    const visits = new Set(
      seed('UK')
        .events.filter((e) => e.clientId === 'client-1' && e.appointmentId)
        .map((e) => e.appointmentId),
    )
    expect(screen.getAllByRole('button', { name: /View visit/ })).toHaveLength(visits.size)
    const histories = screen.getAllByRole('list', { name: /history$/ })
    expect(histories).toHaveLength(visits.size)
    expect(
      histories.some(
        (list) =>
          within(list).queryByText('Appointment booked') &&
          within(list).queryByText('Visit completed'),
      ),
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.queryByRole('button', { name: /View visit/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Visits & money' }))
    expect(screen.getAllByRole('button', { name: /View visit/ })).toHaveLength(visits.size)
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

describe('local operating surfaces', () => {
  it('edits catalogue pricing without rewriting booked promises and preserves a conflicting closure draft', async () => {
    const user = userEvent.setup()
    show('/business/manage')
    await user.click(await screen.findByRole('button', { name: 'Services' }))
    await user.click(screen.getByRole('button', { name: 'Edit Skin Renewal Facial' }))
    await user.clear(screen.getByLabelText('Price (GBP)'))
    await user.type(screen.getByLabelText('Price (GBP)'), '120')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.services.find((s: { id: string }) => s.id === 'service-facial').priceMinor).toBe(
      12000,
    )
    expect(
      saved.appointments.find((a: { id: string }) => a.id === 'visit-noor').bookedPriceMinor,
    ).toBe(9500)
    await user.click(screen.getByRole('button', { name: 'Hours & closures' }))
    await user.click(screen.getByRole('button', { name: 'Add closure' }))
    await user.type(screen.getByLabelText('Date'), '2026-10-06')
    await user.type(screen.getByLabelText('Reason'), 'Maintenance')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('alert')).not.toBeEmptyDOMElement()
    expect(screen.getByLabelText('Reason')).toHaveValue('Maintenance')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-06')
    expect(
      JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!).operations.closures,
    ).toHaveLength(0)
  })

  it('keeps an unconsented marketing message as an editable unsent draft', async () => {
    const user = userEvent.setup()
    show('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Write a draft' }))
    await user.selectOptions(screen.getByLabelText('Client'), 'client-4')
    await user.selectOptions(screen.getByLabelText('Purpose'), 'marketing')
    await user.type(screen.getByLabelText('Subject'), 'A future invitation')
    await user.type(screen.getByLabelText('Message'), 'We would love to welcome you back.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(screen.getByRole('button', { name: 'Queue for later delivery' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Edit draft A future invitation' }))
    expect(screen.getByLabelText('Client')).toBeDisabled()
    expect(screen.getByLabelText('Purpose')).toBeDisabled()
    await user.clear(screen.getByLabelText('Subject'))
    await user.type(screen.getByLabelText('Subject'), 'Revised invitation')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.operations.messages).toHaveLength(1)
    expect(saved.operations.messages[0]).toMatchObject({
      subject: 'Revised invitation',
      purpose: 'marketing',
      status: 'draft',
      clientId: 'client-4',
    })
    expect(saved.clients.find((c: { id: string }) => c.id === 'client-4').marketingConsent).toBe(
      false,
    )
  })

  it('requires refund provenance confirmation and retains the settled receipt', async () => {
    const user = userEvent.setup()
    show('/business/money')
    await user.click((await screen.findAllByRole('button', { name: /View receipt for/ }))[0])
    await user.click(screen.getByRole('button', { name: 'Record simulated refund' }))
    await user.type(screen.getByLabelText('Amount (GBP)'), '10')
    await user.type(screen.getByLabelText('External reference'), 'simulation-001')
    await user.type(screen.getByLabelText('Reason'), 'Review adjustment')
    await user.click(screen.getByRole('button', { name: 'Record refund' }))
    expect(screen.getByRole('heading', { name: 'Record a simulated refund' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('checkbox', { name: 'I understand this is a simulated refund.' }),
    )
    await user.click(screen.getByRole('button', { name: 'Record refund' }))
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.operations.refunds).toHaveLength(1)
    expect(saved.operations.refunds[0]).toMatchObject({
      amountMinor: 1000,
      reference: 'simulation-001',
    })
    expect(
      saved.sales.some((sale: { id: string }) => sale.id === saved.operations.refunds[0].saleId),
    ).toBe(true)
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(
      'No money moved',
    )
  })
})

describe('reviewed CSV client import', () => {
  it('previews duplicates and invalid rows, ignores consent columns and saves only reviewed contacts', async () => {
    const user = userEvent.setup()
    show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    const csv =
      'name,email,phone,marketingConsent\nAmelia Carter,amelia.carter@example.com,+447700900001,true\nAlex Import,alex.import@example.com,+12125550111,true\n,missing@example.com,+12125550112,true'
    await user.upload(
      screen.getByLabelText('Choose CSV'),
      new File([csv], 'booking-export.csv', { type: 'text/csv' }),
    )
    expect(
      await screen.findByRole('checkbox', { name: 'Import record 3: Alex Import' }),
    ).toBeChecked()
    const submit = screen.getByRole('button', { name: 'Import 1 reviewed client' })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/Exact name and email already exist/)).toBeInTheDocument()
    expect(screen.getByText(/Ignored columns: marketingconsent/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Import source'))
    await user.type(screen.getByLabelText('Import source'), 'Previous booking system')
    await user.click(
      screen.getByRole('checkbox', { name: /I have reviewed these 1 selected records/ }),
    )
    await user.click(submit)
    expect(screen.getByRole('heading', { name: '1 client imported' })).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.clients).toHaveLength(16)
    const imported = saved.clients.find(
      (client: { email: string }) => client.email === 'alex.import@example.com',
    )
    expect(imported.marketingConsent).toBe(false)
    expect(
      saved.events.find((event: { clientId: string }) => event.clientId === imported.id).detail,
    ).toContain('Previous booking system')
  })

  it('retains a reviewed import after a failed save and allows explicit review before retry', async () => {
    const user = userEvent.setup()
    show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    await user.upload(
      screen.getByLabelText('Choose CSV'),
      new File(['name,email,phone\nRetry Person,retry@example.com,+442071234567'], 'retry.csv', {
        type: 'text/csv',
      }),
    )
    await screen.findByRole('checkbox', { name: 'Import record 2: Retry Person' })
    await user.click(
      screen.getByRole('checkbox', { name: /I have reviewed these 1 selected records/ }),
    )
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage unavailable')
    })
    await user.click(screen.getByRole('button', { name: 'Import 1 reviewed client' }))
    write.mockRestore()
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(screen.getByLabelText('Import source')).toHaveValue('retry.csv')
    expect(screen.getByRole('checkbox', { name: 'Import record 2: Retry Person' })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /I have reviewed these 1 selected records/ }),
    ).not.toBeChecked()
    await user.click(
      screen.getByRole('checkbox', { name: /I have reviewed these 1 selected records/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Import 1 reviewed client' }))
    expect(screen.getByRole('heading', { name: '1 client imported' })).toBeInTheDocument()
  })
})

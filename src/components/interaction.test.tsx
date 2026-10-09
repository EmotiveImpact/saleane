import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { withoutFeedback } from '../domain/feedback'
import { withoutPayRates } from '../domain/pay'
import { withoutBranchVisits } from '../domain/branchVisits'
import { withoutRequests } from '../domain/approvals'
import type { Role } from '../domain/operations'
import type { BusinessState } from '../domain/model'
import type { RemoteWorkspace, Session } from '../state/api'

function show(route = '/today') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

/**
 * Opens the app signed in to the sample studio with the given role. The answers mirror the server:
 * the front desk reads the studio record without guests' feedback, pay rates, branch visits or
 * requests (server/projections.ts).
 */
function signedIn(role: Role, route: string, studio?: (state: BusinessState) => void) {
  const sample = seed('UK')
  studio?.(sample)
  const state =
    role === 'reception'
      ? withoutRequests(withoutBranchVisits(withoutPayRates(withoutFeedback(sample))))
      : sample
  const workspace: RemoteWorkspace = {
    id: state.organisation.id,
    slug: 'sample-studio',
    view: 'studio',
    state,
    role,
    today: '2026-10-06',
    mode: 'sandbox',
  }
  const session: Session = {
    user: { id: 'account-desk', name: 'Rosa Desk', email: 'desk@example.invalid' },
    csrf: 'csrf-token',
    workspaces: [
      {
        id: workspace.id,
        slug: workspace.slug,
        name: state.organisation.name,
        region: 'UK',
        mode: 'sandbox',
        role,
      },
    ],
    services: { email: false, payments: false },
    localOnly: true,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const body =
        path === '/api/session'
          ? session
          : path === `/api/workspaces/${workspace.id}`
            ? workspace
            : null
      return new Response(JSON.stringify(body ?? { error: 'Not in this test.' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  sessionStorage.setItem('saleane.workspace', workspace.id)
  show(route)
}

async function chooseFacial(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Skin/ }))
  await user.click(screen.getByRole('button', { name: /Skin Renewal Facial/ }))
}

describe('connected operator journeys', () => {
  it('moves a visit with keyboard time choices and follows it to its new calendar day', async () => {
    const user = userEvent.setup()
    show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
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
      screen.getAllByRole('button', { name: /09:30 .*Noor Ahmed Skin Renewal Facial/ }).length,
    ).toBeGreaterThan(0)
  })
  it('requires cancellation review and preserves the visit in accessible calendar history', async () => {
    const user = userEvent.setup()
    show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
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
      screen.getByRole('button', { name: /11:00 .*Noor Ahmed Skin Renewal Facial .*Cancelled/ }),
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
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Move appointment' }))
    await user.selectOptions(screen.getByLabelText('Professional'), 'staff-sophia')
    await user.click(screen.getByRole('radio', { name: '12:30' }))
    await user.click(screen.getByRole('button', { name: 'Save appointment' }))
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Filter professional')).toHaveValue('staff-sophia')
    expect(
      screen.getAllByRole('button', { name: /12:30 .*Noor Ahmed Skin Renewal Facial/ }).length,
    ).toBeGreaterThan(0)
  })
  it('records missed attendance through an explicit review without creating a sale', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ }))
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
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
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
    await user.type(
      screen.getByRole('searchbox', { name: 'Search by name, phone or email' }),
      'Amelia',
    )
    await user.click(screen.getByRole('link', { name: /Amelia Carter/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'Relationship note' }),
      'Prefers a Tuesday afternoon.',
    )
    await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(screen.getByText('Prefers a Tuesday afternoon.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument()
  })
  it('edits what is good to remember about a client in place', async () => {
    const user = userEvent.setup()
    show('/clients')
    await user.type(
      screen.getByRole('searchbox', { name: 'Search by name, phone or email' }),
      'Amelia',
    )
    await user.click(screen.getByRole('link', { name: /Amelia Carter/ }))
    await user.click(screen.getByRole('button', { name: 'Edit good to remember' }))
    const field = screen.getByRole('textbox', { name: 'Good to remember' })
    await user.clear(field)
    await user.type(field, 'Unscented oil only. Likes a warm room.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Unscented oil only. Likes a warm room.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Good to remember' })).not.toBeInTheDocument()
    expect(screen.getByText('Client details updated')).toBeInTheDocument()
  })
  it('opens treatments by kind, or by search, before a treatment is chosen', async () => {
    const user = userEvent.setup()
    show('/booking')
    expect(screen.queryByRole('button', { name: 'Choose a time' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Hair/ }))
    expect(screen.getByRole('button', { name: /Signature Cut/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Skin Renewal Facial/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose a time' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All kinds of treatment' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search treatments' }), 'massage')
    expect(screen.getByRole('button', { name: /Lymphatic Massage/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deep Restore Massage/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Signature Cut/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Deep Restore Massage/ }))
    expect(screen.getByRole('button', { name: 'Choose a time' })).toBeInTheDocument()
  })
  it('completes public booking with marketing left off and exposes it in the calendar', async () => {
    const user = userEvent.setup()
    show('/booking')
    await chooseFacial(user)
    await user.click(screen.getByRole('button', { name: 'Choose a time' }))
    await user.click(screen.getByRole('radio', { name: '09:00' }))
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
  it('books anyone available in the afternoon and gives the visit to a professional free then', async () => {
    const user = userEvent.setup()
    show('/booking')
    await chooseFacial(user)
    await user.click(screen.getByRole('button', { name: 'Choose a time' }))
    expect(screen.getByRole('button', { name: /Anyone available/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('radio', { name: '14:00' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Afternoon/ }))
    await user.click(screen.getByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Your details' }))
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Robin Anyone')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'robin@example.com')
    await user.type(
      screen.getByRole('textbox', { name: 'Phone with country code' }),
      '+44 7700 900222',
    )
    await user.click(screen.getByRole('button', { name: 'Review your visit' }))
    await user.click(screen.getByRole('checkbox', { name: /I understand this is a demo/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm demo visit' }))
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    const robin = saved.clients.find((c: { name: string }) => c.name === 'Robin Anyone')
    const visit = saved.appointments.find((a: { clientId: string }) => a.clientId === robin.id)
    expect(visit.startMinutes).toBe(840)
    expect(saved.staff.find((p: { id: string }) => p.id === visit.staffId).serviceIds).toContain(
      visit.serviceId,
    )
  })
})

describe('local operating surfaces', () => {
  it('edits catalogue pricing without rewriting booked promises and preserves a conflicting closure draft', async () => {
    const user = userEvent.setup()
    show('/settings')
    await user.click(await screen.findByRole('tab', { name: 'Services' }))
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
    await user.click(screen.getByRole('tab', { name: 'Hours & closures' }))
    await user.click(screen.getByRole('button', { name: 'Add closure' }))
    await user.type(screen.getByLabelText('Date'), '2026-10-06')
    await user.type(screen.getByLabelText('Reason'), 'Maintenance')
    // LOCAL-04: the affected visits are named before saving, and saving waits until they move.
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/upcoming visits would be affected/)).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: 'Tue 6 Oct 09:30, Amelia with Maya Lewis' }),
    ).toHaveAttribute('href', '/calendar?date=2026-10-06&appointment=visit-amelia')
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveValue('Maintenance')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-06')
    expect(
      JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!).operations.closures,
    ).toHaveLength(0)
  })

  it('previews affected visits for opening hours and lists the change in schedule history', async () => {
    const user = userEvent.setup()
    show('/settings')
    await user.click(await screen.findByRole('tab', { name: 'Hours & closures' }))
    expect(screen.getByText(/No schedule changes recorded yet/)).toBeInTheDocument()
    const tuesday = screen.getByRole('checkbox', { name: 'Tuesday' })
    await user.click(tuesday)
    expect(screen.getByText(/upcoming visits would be affected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save opening hours' })).toBeDisabled()
    await user.click(tuesday)
    expect(screen.queryByText(/upcoming visits would be affected/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Friday closes'), { target: { value: '17:00' } })
    await user.click(screen.getByRole('button', { name: 'Save opening hours' }))
    expect(
      await screen.findByText(
        'Opening hours changed: Friday 09:00 to 18:00 became 09:00 to 17:00.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Maya · demo operator/)).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Approve and queue' })).toBeDisabled()
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

  it('reads a guest’s reply, answers by text from a saved reply and matches an unknown number', async () => {
    const user = userEvent.setup()
    show('/inbox')
    expect((await screen.findByText('New replies')).parentElement).toHaveTextContent('New replies2')
    await user.click(screen.getByRole('button', { name: /Ellie Brooks/ }))
    const thread = await screen.findByRole('list', { name: 'Conversation with Ellie Brooks' })
    expect(within(thread).getByText(/half an hour later on Thursday/)).toBeInTheDocument()
    const stored = () => JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    await waitFor(() =>
      expect(
        stored().replies.find((r: { id: string }) => r.id === 'reply-ellie').readAt,
      ).toBeTruthy(),
    )
    await user.click(screen.getByRole('button', { name: 'Write to Ellie' }))
    await user.selectOptions(screen.getByLabelText('Send by'), 'sms')
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Start from a saved reply'), 'saved-move')
    expect(screen.getByLabelText('Message')).toHaveValue(
      'Of course. We can move you to a time that suits. Let us know which day works best and we will change it for you.',
    )
    await user.click(screen.getByRole('button', { name: 'Approve and queue' }))
    expect(
      await screen.findByText(
        'Approved and queued. Sending is not connected in this sample, so nothing was sent.',
      ),
    ).toBeInTheDocument()
    expect(stored().operations.messages.at(-1)).toMatchObject({
      clientId: 'client-3',
      channel: 'sms',
      status: 'queued',
    })
    await user.click(screen.getByRole('button', { name: /\+44 7700 900999/ }))
    await user.selectOptions(screen.getByLabelText('This is'), 'client-6')
    await user.click(screen.getByRole('button', { name: 'Match to this client' }))
    expect(
      await screen.findByText('Matched. The conversation is now with the client.'),
    ).toBeInTheDocument()
    expect(stored().replies.find((r: { id: string }) => r.id === 'reply-unknown').clientId).toBe(
      'client-6',
    )
  })

  it('opens the inbox in two columns and lets each person choose the side panel on the Settings page', async () => {
    const user = userEvent.setup()
    show('/inbox')
    expect(await screen.findByRole('list', { name: /Conversation with/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /your preferences/ }))
    expect(await screen.findByRole('tab', { name: 'Your preferences' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Two columns, like email' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'List with a side panel' }))
    expect(localStorage.getItem('saleane-inbox-view:demo')).toBe('panel')
    await user.click(screen.getAllByRole('link', { name: /Inbox/ })[0])
    expect(await screen.findByRole('heading', { name: 'A considered word.' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Conversation with/ })).not.toBeInTheDocument()
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

describe('front desk access to Business', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('opens Money, Stock, Rota and Gift cards, and lands Business on Money', async () => {
    const user = userEvent.setup()
    signedIn('reception', '/business')
    expect(await screen.findByRole('heading', { name: 'Money, clearly.' })).toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Business sections' })
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Money', 'Stock', 'Rota', 'Gift cards'])
    const business = screen.getByRole('link', { name: 'Business' })
    expect(business).toHaveAttribute('href', '/business/money')
    expect(business).toHaveAttribute('aria-current', 'page')
    await user.click(within(sections).getByRole('link', { name: 'Stock' }))
    expect(
      await screen.findByRole('heading', { name: 'What is on the shelf.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Business' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(sections).getByRole('link', { name: 'Rota' }))
    expect(
      await screen.findByRole('heading', { name: 'Who is in, and who is away.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add time off/ })).not.toBeInTheDocument()
    await user.click(within(sections).getByRole('link', { name: 'Gift cards' }))
    expect(
      await screen.findByRole('heading', { name: 'Gift cards and vouchers.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sell a gift card/ })).toBeInTheDocument()
  })

  it('sends the desk back to Money from pages that stay with owners and managers', async () => {
    for (const page of ['pay', 'accounts', 'feedback', 'visits', 'requests', 'areas']) {
      signedIn('reception', `/business/${page}`)
      expect(await screen.findByRole('heading', { name: 'Money, clearly.' })).toBeInTheDocument()
      cleanup()
      vi.unstubAllGlobals()
      sessionStorage.clear()
    }
  })

  it('shows receipts to the desk without a refund it could not record', async () => {
    const user = userEvent.setup()
    signedIn('reception', '/business/money')
    await user.click((await screen.findAllByRole('button', { name: /View receipt for/ }))[0])
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument()
  })

  it('keeps every Business section for an owner', async () => {
    signedIn('owner', '/business')
    expect(await screen.findByRole('heading', { name: 'A clearer view.' })).toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Business sections' })
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(
      expect.arrayContaining(['Overview', 'Money', 'Pay', 'Accounts', 'Feedback', 'Client areas']),
    )
    expect(screen.getByRole('link', { name: 'Business' })).toHaveAttribute('href', '/business')
  })
})

describe('the Business tab bar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('leaves out Branch visits and Requests while the studio has one location', () => {
    show('/business')
    const sections = screen.getByRole('navigation', { name: 'Business sections' })
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Overview',
      'Money',
      'Stock',
      'Rota',
      'Gift cards',
      'Pay',
      'Accounts',
      'Feedback',
      'Client areas',
    ])
    expect(within(sections).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows Branch visits and Requests once there is a second location', async () => {
    signedIn('owner', '/business/requests', (state) => {
      state.operations!.locations = [
        { id: 'loc-islington', name: 'Islington', address: '5 Upper Street, London N1' },
      ]
    })
    const sections = await screen.findByRole('navigation', { name: 'Business sections' })
    expect(within(sections).getByRole('link', { name: 'Branch visits' })).toHaveAttribute(
      'href',
      '/business/visits',
    )
    expect(within(sections).getByRole('link', { name: 'Requests' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('the rota week', () => {
  it('marks today and keeps This week ready to press', async () => {
    const user = userEvent.setup()
    show('/business/rota')
    expect(screen.getByRole('heading', { name: 'Week of Monday 5 October' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /6 Oct Today$/ })).toBeInTheDocument()
    const thisWeek = screen.getByRole('button', { name: 'This week' })
    expect(thisWeek).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByRole('heading', { name: 'Week of Monday 12 October' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Today/ })).not.toBeInTheDocument()
    await user.click(thisWeek)
    expect(screen.getByRole('heading', { name: 'Week of Monday 5 October' })).toBeInTheDocument()
  })
})

describe('Business overview wording', () => {
  it('says one completed visit, not one completed visits', () => {
    show('/business')
    const counts = screen
      .getAllByText(/^\d+ completed visits?\b/)
      .map((node) => /^(\d+) completed (visits?)\b/.exec(node.textContent ?? '')!)
    expect(counts.length).toBeGreaterThan(0)
    for (const [, count, word] of counts) expect(word).toBe(count === '1' ? 'visit' : 'visits')
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

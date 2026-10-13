import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
import { choicesIn } from '../test/choices'

async function show(route = '/today') {
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

/**
 * Opens the app signed in to the sample studio with the given role. The answers mirror the server:
 * the front desk reads the studio record without guests' feedback, pay rates, branch visits or
 * requests (server/projections.ts).
 */
async function signedIn(
  role: Role,
  route: string,
  studio?: (state: BusinessState) => void,
  record: Partial<RemoteWorkspace> = {},
) {
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
    ...record,
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
  await show(route)
}

async function chooseFacial(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Skin/ }))
  await user.click(screen.getByRole('button', { name: /Skin Renewal Facial/ }))
}

describe('connected operator journeys', () => {
  // The whole app, from the calendar through the date picker to the moved visit, so this journey
  // can take several seconds on a busy machine: it has 20 seconds rather than the usual 5.
  it('moves a visit with keyboard time choices and follows it to its new calendar day', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Move visit' }))
    expect(screen.getByRole('heading', { name: 'Move visit' })).toHaveFocus()
    // The new date is chosen from the calendar, written out the studio's way.
    expect(screen.getByLabelText('New date')).toHaveTextContent('Tue 6 Oct 2026')
    await user.click(screen.getByLabelText('New date'))
    await user.click(screen.getByRole('button', { name: 'Wednesday 7 October 2026' }))
    expect(screen.getByLabelText('New date')).toHaveTextContent('Wed 7 Oct 2026')
    const first = screen.getByRole('radio', { name: '09:00' })
    await user.click(first)
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: '09:30' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save visit' }))
    expect(screen.getByRole('status')).toHaveTextContent('Visit saved')
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.appointments.find((a: { id: string }) => a.id === 'visit-noor')).toMatchObject({
      date: '2026-10-07',
      startMinutes: 570,
      bookedPriceMinor: 9500,
    })
    expect(saved.events.filter((e: { type: string }) => e.type === 'rescheduled')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Jump to date')).toHaveTextContent('Wed 7 Oct 2026')
    expect(
      screen.getAllByRole('button', { name: /09:30 .*Noor Ahmed Skin Renewal Facial/ }).length,
    ).toBeGreaterThan(0)
  }, 20000)
  it('requires cancellation review and preserves the visit in accessible calendar history', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
    expect(screen.getByText('£25 deposit remains recorded')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep visit' }))
    expect(screen.getByRole('button', { name: 'Welcome client' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
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
    await show('/calendar')
    await user.selectOptions(screen.getByLabelText('Filter professional'), 'staff-maya')
    await user.click(screen.getAllByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ })[0])
    await user.click(screen.getByRole('button', { name: 'Move visit' }))
    await user.selectOptions(screen.getByLabelText('Professional'), 'staff-sophia')
    await user.click(screen.getByRole('radio', { name: '12:30' }))
    await user.click(screen.getByRole('button', { name: 'Save visit' }))
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Filter professional')).toHaveValue('staff-sophia')
    expect(
      screen.getAllByRole('button', { name: /12:30 .*Noor Ahmed Skin Renewal Facial/ }).length,
    ).toBeGreaterThan(0)
  })
  it('records missed attendance through an explicit review without creating a sale', async () => {
    const user = userEvent.setup()
    await show()
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
    await show()
    const trigger = screen.getByRole('button', { name: 'Find a client' })
    await user.click(trigger)
    expect(screen.getByRole('combobox', { name: 'Search clients' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('opens Help on the guides for this screen, and hands over to Ask SALEANE', async () => {
    const user = userEvent.setup()
    await show('/calendar')
    const trigger = screen.getByRole('button', { name: 'Help' })
    await user.click(trigger)
    const help = await screen.findByRole('dialog', { name: 'Help' })
    expect(within(help).getByRole('list', { name: 'On this screen' })).toHaveTextContent(
      'Book a visit',
    )
    expect(help).toHaveTextContent('The browser demo cannot send anything.')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Help' })).getByRole('button', {
        name: 'Ask SALEANE',
      }),
    )
    expect(await screen.findByRole('dialog', { name: 'Ask SALEANE' })).toBeInTheDocument()
  })
  it('checks out an arrived visit and presents the linked receipt and rebooking action', async () => {
    const user = userEvent.setup()
    await show()
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    await user.click(screen.getByRole('button', { name: '15%' }))
    await user.click(screen.getByRole('button', { name: 'Record demo payment' }))
    const dialog = screen.getByRole('dialog')
    // Stage 6: the amount collected heads the receipt under "Settled.", and closes its total line.
    expect(within(dialog).getAllByText('£84.25')).toHaveLength(2)
    expect(
      within(within(dialog).getByRole('region', { name: 'Settled.' })).getByText('£84.25'),
    ).toBeInTheDocument()
    const rebook = within(dialog).getByRole('button', { name: 'Rebook this client' })
    // The next visit comes before the receipt's own buttons, so a printed receipt never hides it.
    const print = within(dialog).getByRole('button', { name: 'Print receipt' })
    expect(rebook.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(
      saved.sales.filter((s: { appointmentId: string }) => s.appointmentId === 'visit-amelia'),
    ).toHaveLength(1)
  })
  it('finds a client and appends an ordinary relationship note', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.type(
      screen.getByRole('searchbox', { name: 'Search by name, phone or email' }),
      'Amelia',
    )
    await user.click(screen.getByRole('link', { name: /Amelia Carter/ }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Relationship note' }),
      'Prefers a Tuesday afternoon.',
    )
    await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(screen.getByText('Prefers a Tuesday afternoon.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument()
  })
  it('edits what is good to remember about a client in place', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.type(
      screen.getByRole('searchbox', { name: 'Search by name, phone or email' }),
      'Amelia',
    )
    await user.click(screen.getByRole('link', { name: /Amelia Carter/ }))
    await user.click(await screen.findByRole('button', { name: 'Edit good to remember' }))
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
    await show('/booking')
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
    await show('/booking')
    await chooseFacial(user)
    await user.click(screen.getByRole('button', { name: 'Choose a time' }))
    await user.click(screen.getByRole('radio', { name: '09:00' }))
    await user.click(screen.getByRole('button', { name: 'Your details' }))
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Alex Demo')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alex@example.com')
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '07700 900111')
    await user.click(screen.getByRole('button', { name: 'Review your visit' }))
    await user.click(screen.getByRole('checkbox', { name: /I understand this is a demo/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm demo visit' }))
    expect(screen.getByText(/Something to/)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    const alex = saved.clients.find((c: { name: string }) => c.name === 'Alex Demo')
    expect(alex.marketingConsent).toBe(false)
    // Typed as a local UK mobile, kept as an international number.
    expect(alex.phone).toBe('+44 7700 900111')
    expect(saved.appointments.some((a: { source: string }) => a.source === 'online')).toBe(true)
  })
  it('books anyone available in the afternoon and gives the visit to a professional free then', async () => {
    const user = userEvent.setup()
    await show('/booking')
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
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '+44 7700 900222')
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
    await show('/settings')
    await user.click(await screen.findByRole('tab', { name: 'Treatments' }))
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
    await user.click(screen.getByLabelText('Date'))
    await user.click(screen.getByRole('button', { name: 'Tuesday 6 October 2026' }))
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
    expect(screen.getByLabelText('Date')).toHaveTextContent('Tue 6 Oct 2026')
    expect(
      JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!).operations.closures,
    ).toHaveLength(0)
  })

  it('previews affected visits for opening hours and lists the change in schedule history', async () => {
    const user = userEvent.setup()
    await show('/settings')
    await user.click(await screen.findByRole('tab', { name: 'Hours & closures' }))
    expect(screen.getByText(/No schedule changes recorded yet/)).toBeInTheDocument()
    const tuesday = screen.getByRole('checkbox', { name: 'Tuesday' })
    await user.click(tuesday)
    expect(screen.getByText(/upcoming visits would be affected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save opening hours' })).toBeDisabled()
    await user.click(tuesday)
    expect(screen.queryByText(/upcoming visits would be affected/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Friday closes'), '17:00')
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
    await show('/inbox')
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
    await show('/inbox')
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
    await user.selectOptions(screen.getByLabelText('Link to a client'), 'client-6')
    await user.click(screen.getByRole('button', { name: 'Match to this client' }))
    expect(
      await screen.findByText('Matched. The conversation is now with the client.'),
    ).toBeInTheDocument()
    expect(stored().replies.find((r: { id: string }) => r.id === 'reply-unknown').clientId).toBe(
      'client-6',
    )
  })

  it('opens the inbox in two columns and lets each person choose the side panel on the You page', async () => {
    const user = userEvent.setup()
    await show('/inbox')
    expect(await screen.findByRole('list', { name: /Conversation with/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /your menu/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Your preferences' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Yours alone.' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Settings sections' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Two columns, like email' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'List with a side panel' }))
    expect(localStorage.getItem('saleane-inbox-view:demo')).toBe('panel')
    await user.click(screen.getAllByRole('link', { name: /Inbox/ })[0])
    expect(await screen.findByRole('heading', { name: 'A considered word.' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Conversation with/ })).not.toBeInTheDocument()
  })

  it('requires refund provenance confirmation and retains the settled receipt', async () => {
    const user = userEvent.setup()
    await show('/money')
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

describe('front desk access to Money and Team', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('opens Money and Team from the sidebar, and leaves Business out', async () => {
    const user = userEvent.setup()
    await signedIn('reception', '/business')
    expect(await screen.findByRole('heading', { name: 'Money, clearly.' })).toBeInTheDocument()
    // Business is the studio's figures and what guests say, none of it the desk's.
    const sidebar = screen.getByRole('complementary', { name: 'Studio navigation' })
    expect(within(sidebar).queryByRole('link', { name: 'Business' })).not.toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: 'Money' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const money = screen.getByRole('navigation', { name: 'Money sections' })
    expect(
      within(money)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Takings', 'Gift cards', 'Stock'])
    await user.click(within(money).getByRole('link', { name: 'Stock' }))
    expect(
      await screen.findByRole('heading', { name: 'What is on the shelf.' }),
    ).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: 'Money' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await user.click(within(money).getByRole('link', { name: 'Gift cards' }))
    expect(
      await screen.findByRole('heading', { name: 'Gift cards and vouchers.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sell a gift card/ })).toBeInTheDocument()
    await user.click(within(sidebar).getByRole('link', { name: 'Team' }))
    const team = await screen.findByRole('navigation', { name: 'Team sections' })
    expect(
      within(team)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['People', 'Rota'])
    await user.click(within(team).getByRole('link', { name: 'Rota' }))
    expect(
      await screen.findByRole('heading', { name: 'Who is in, and who is away.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add time off/ })).not.toBeInTheDocument()
  })

  it('sends the desk to Money or Team from pages that stay with owners and managers', async () => {
    for (const [page, heading] of [
      ['/business/feedback', 'Money, clearly.'],
      ['/business/visits', 'Money, clearly.'],
      ['/business/requests', 'Money, clearly.'],
      ['/business/areas', 'Money, clearly.'],
      ['/money/accounts', 'Money, clearly.'],
      ['/business/accounts', 'Money, clearly.'],
      ['/team/pay', 'Who does what.'],
      ['/business/pay', 'Who does what.'],
    ]) {
      await signedIn('reception', page)
      expect(await screen.findByRole('heading', { level: 1, name: heading }), page).toBeVisible()
      cleanup()
      vi.unstubAllGlobals()
      sessionStorage.clear()
    }
  })

  it('shows receipts to the desk without a refund it could not record', async () => {
    const user = userEvent.setup()
    await signedIn('reception', '/money')
    await user.click((await screen.findAllByRole('button', { name: /View receipt for/ }))[0])
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument()
  })

  it('gives an owner every Money and Team page, and Business its figures', async () => {
    const user = userEvent.setup()
    await signedIn('owner', '/business')
    expect(await screen.findByRole('heading', { name: 'A clearer view.' })).toBeInTheDocument()
    const sidebar = screen.getByRole('complementary', { name: 'Studio navigation' })
    expect(within(sidebar).getByRole('link', { name: 'Business' })).toHaveAttribute(
      'href',
      '/business',
    )
    await user.click(within(sidebar).getByRole('link', { name: 'Money' }))
    expect(
      within(await screen.findByRole('navigation', { name: 'Money sections' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Takings', 'Gift cards', 'Stock', 'Accounts'])
    await user.click(within(sidebar).getByRole('link', { name: 'Team' }))
    expect(
      within(await screen.findByRole('navigation', { name: 'Team sections' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['People', 'Rota', 'Pay'])
  })

  it('opens older links to Money, Gift cards, Stock and the rota in their new places', async () => {
    for (const [page, heading] of [
      ['/business/money', 'Money, clearly.'],
      ['/business/gift-cards', 'Gift cards and vouchers.'],
      ['/business/stock', 'What is on the shelf.'],
      ['/business/rota', 'Who is in, and who is away.'],
    ]) {
      await signedIn('owner', page)
      expect(await screen.findByRole('heading', { level: 1, name: heading }), page).toBeVisible()
      cleanup()
      vi.unstubAllGlobals()
      sessionStorage.clear()
    }
    // What came after an older address goes with it: a scanned barcode still opens a new product.
    await signedIn('owner', '/business/stock?new-barcode=5012345678900')
    const product = await screen.findByRole('dialog', { name: 'Add a product' })
    expect(within(product).getByLabelText('Barcode')).toHaveValue('5012345678900')
  })
})

describe('selling at one of several locations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('asks which location sold a gift card and sends it with the sale', async () => {
    const user = userEvent.setup()
    await signedIn('owner', '/money/gift-cards', (state) => {
      state.operations!.locations = [
        { id: 'loc-islington', name: 'Islington', address: '5 Upper Street, London N1' },
      ]
    })
    await user.click(await screen.findByRole('button', { name: 'Sell a gift card' }))
    const dialog = await screen.findByRole('dialog')
    const soldAt = within(dialog).getByRole('combobox', { name: 'Sold at' })
    expect((await choicesIn(user, soldAt)).map((o) => o.text)).toEqual([
      'Marylebone, London',
      'Islington',
    ])
    await user.selectOptions(soldAt, 'loc-islington')
    await user.type(within(dialog).getByRole('textbox', { name: 'Buyer’s name' }), 'Jo Guest')
    await user.click(within(dialog).getByRole('button', { name: /^Record/ }))
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/commands'))).toBe(
        true,
      ),
    )
    const [, init] = vi
      .mocked(fetch)
      .mock.calls.find(([path]) => String(path).endsWith('/commands'))!
    expect(JSON.parse(String(init!.body)).command).toMatchObject({
      type: 'gift-card-sell',
      locationId: 'loc-islington',
    })
  })

  it('leaves the choice out with one location', async () => {
    const user = userEvent.setup()
    await signedIn('owner', '/money/gift-cards')
    await user.click(await screen.findByRole('button', { name: 'Sell a gift card' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: 'Sold at' })).not.toBeInTheDocument()
  })
})

describe('the Business tab bar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('leaves out Branch visits and Requests while the studio has one location', async () => {
    await signedIn('owner', '/business', (state) => {
      // Stage 4: nothing asked and no sign-off rules, unlike the sample studio.
      delete state.operations!.requests
      delete state.operations!.approvals
    })
    const sections = await screen.findByRole('navigation', { name: 'Business sections' })
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'Feedback', 'Client areas', 'How you compare'])
    expect(within(sections).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows Requests in a studio of one location once something is asked', async () => {
    await show('/business')
    const sections = screen.getByRole('navigation', { name: 'Business sections' })
    expect(within(sections).getByRole('link', { name: 'Requests' })).toHaveAttribute(
      'href',
      '/business/requests',
    )
    expect(within(sections).queryByRole('link', { name: 'Branch visits' })).not.toBeInTheDocument()
  })

  it('shows Branch visits and Requests once there is a second location', async () => {
    await signedIn('owner', '/business/requests', (state) => {
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
    await show('/team/rota')
    expect(
      await screen.findByRole('heading', { name: 'Week of Monday 5 October' }),
    ).toBeInTheDocument()
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
  it('says one completed visit, not one completed visits', async () => {
    await show('/business')
    const counts = screen
      .getAllByText(/^\d+ completed visits?\b/)
      .map((node) => /^(\d+) completed (visits?)\b/.exec(node.textContent ?? '')!)
    expect(counts.length).toBeGreaterThan(0)
    for (const [, count, word] of counts) expect(word).toBe(count === '1' ? 'visit' : 'visits')
  })
})

describe('requests and branch visits before regions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })
  const secondLocation = (state: BusinessState) => {
    state.operations!.locations = [
      { id: 'loc-islington', name: 'Islington', address: '5 Upper Street, London N1' },
    ]
  }

  it('says nothing of regional managers until the studio has a region', async () => {
    const user = userEvent.setup()
    await signedIn('owner', '/business/requests', (state) => {
      secondLocation(state)
      delete state.operations!.requests
      delete state.operations!.approvals
    })
    expect(await screen.findByRole('heading', { name: 'No requests yet' })).toBeInTheDocument()
    expect(
      screen.getByText(/The owner approves or declines it, and every decision is kept/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask for a sign-off' })).toBeInTheDocument()
    expect(screen.queryByText(/regional/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign-off rules' }))
    const rules = await screen.findByRole('dialog', { name: 'Sign-off rules' })
    expect(within(rules).queryByText(/regional/i)).not.toBeInTheDocument()
  })

  it('shows the regional limit once the locations are grouped into a region', async () => {
    await signedIn('owner', '/business/requests', (state) => {
      secondLocation(state)
      state.operations!.regions = [
        {
          id: 'region-london',
          name: 'London',
          locationIds: [state.organisation.locationId, 'loc-islington'],
        },
      ]
    })
    const user = userEvent.setup()
    expect(await screen.findByText(/Regional managers approve up to £500/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign-off rules' }))
    const rules = await screen.findByRole('dialog', { name: 'Sign-off rules' })
    expect(within(rules).getByLabelText(/Regional managers approve up to/)).toHaveValue('500')
  })

  it('explains branch visits and the first step before the first visit', async () => {
    await signedIn('owner', '/business/visits', (state) => {
      secondLocation(state)
      state.operations!.branchVisits = []
    })
    expect(await screen.findByRole('heading', { name: 'No visits yet' })).toBeInTheDocument()
    expect(screen.getByText(/Start with Start a visit, above\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'To put right' })).not.toBeInTheDocument()
  })
})

describe('gift cards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('shows each card as a card, with its balance, code and who it is for', async () => {
    const user = userEvent.setup()
    await show('/money/gift-cards')
    const card = await screen.findByRole('button', { name: /LAKE-7K4M-2QHN/ })
    expect(card).toHaveTextContent('£75')
    expect(card).toHaveTextContent(/for Hannah/)
    await user.click(card)
    expect(screen.getByRole('dialog', { name: 'Gift card' })).toHaveTextContent('For Hannah')
  })

  it('shows what a card looks like before the first one is sold', async () => {
    await signedIn('owner', '/money/gift-cards', (state) => {
      state.giftCards = []
    })
    expect(await screen.findByRole('heading', { name: 'No gift cards yet' })).toBeInTheDocument()
    expect(
      screen.getByText(/Sell the first one with Sell a gift card, above\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('the Settings page', () => {
  it('groups the sections under four headings, with treatments by that name', async () => {
    const user = userEvent.setup()
    await show('/settings')
    const sections = await screen.findByRole('group', { name: 'Settings sections' })
    const lists = within(sections).getAllByRole('tablist')
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual([
      'Studio',
      'Treatments and payments',
      'Guests',
      'Studio account',
    ])
    expect(
      within(lists[1])
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Treatments', 'Packages & memberships', 'Payments & tax', 'Till and printer'])
    // The team and each person's own choices have pages of their own now.
    expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Your preferences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Services' })).not.toBeInTheDocument()
    // Studio details opens first; a narrow screen picks the same sections from one select.
    expect(screen.getByRole('tab', { name: 'Studio details' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const picker = screen.getByRole('combobox', { name: 'Section' })
    expect(picker).toHaveValue('business')
    await user.click(picker)
    expect(
      within(await screen.findByRole('listbox')).getByRole('group', { name: 'Guests' }),
    ).toBeInTheDocument()
  })

  it('finds a setting by the words people use, and says when nothing matches', async () => {
    const user = userEvent.setup()
    await show('/settings')
    const sections = await screen.findByRole('group', { name: 'Settings sections' })
    const find = within(sections).getByRole('searchbox', { name: 'Find a setting' })
    const tabs = () =>
      within(sections)
        .queryAllByRole('tab')
        .map((tab) => tab.textContent)
    await user.type(find, 'VAT')
    expect(tabs()).toEqual(['Payments & tax'])
    await user.clear(find)
    await user.type(find, 'parking')
    expect(tabs()).toEqual(['Before and after a visit'])
    await user.clear(find)
    await user.type(find, 'google')
    expect(tabs()).toEqual(['Booking page & colours', 'Connected software'])
    await user.clear(find)
    await user.type(find, 'zebra')
    expect(tabs()).toEqual([])
    expect(within(sections).getByText('Nothing matches “zebra”.')).toBeVisible()
    await user.clear(find)
    expect(tabs()).toHaveLength(19)
  })

  it('opens older links to the team, your preferences and the diaries in their new places', async () => {
    await show('/settings?section=staff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Who does what.' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Team sections' })).toBeInTheDocument()
    cleanup()
    await show('/settings?section=preferences')
    expect(await screen.findByRole('heading', { level: 1, name: 'Yours alone.' })).toBeVisible()
    cleanup()
    await show('/settings?section=diaries')
    expect(await screen.findByRole('tab', { name: 'Connected software' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('keeps the tax with payments and the online booking switch with the booking page', async () => {
    const user = userEvent.setup()
    await show('/settings?section=payments')
    expect(await screen.findByRole('tab', { name: 'Payments & tax' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Checkout tax' })).toBeInTheDocument()
    cleanup()
    await show('/settings?section=brand')
    const online = await screen.findByRole('region', { name: 'Taking bookings online' })
    expect(within(online).getByRole('checkbox', { name: 'Take bookings online' })).toBeChecked()
    // Closing online booking from here leaves the studio's own details as they were.
    const before = seed('UK').organisation
    await user.click(within(online).getByRole('checkbox', { name: 'Take bookings online' }))
    await user.click(within(online).getByRole('button', { name: 'Save online booking' }))
    expect(await within(online).findByText('Online booking saved.')).toBeInTheDocument()
    const after = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(after.operations.bookingEnabled).toBe(false)
    expect(after.organisation).toEqual(before)
    cleanup()
    await show('/settings')
    expect(await screen.findByRole('tab', { name: 'Studio details' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('checkbox', { name: 'Take bookings online' })).not.toBeInTheDocument()
  })

  it('shows who changed what to the owner only (NEXT-05)', async () => {
    await signedIn('manager', '/settings?section=changes')
    expect(await screen.findByRole('tab', { name: 'Studio details' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('tab', { name: 'Who changed what' })).not.toBeInTheDocument()
    cleanup()
    await signedIn('owner', '/settings?section=changes')
    expect(await screen.findByRole('tab', { name: 'Who changed what' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Who changed what' })).toBeInTheDocument()
  })

  it('shows the SALEANE plan to the owner only, and a line above every screen when it needs them (NEXT-02)', async () => {
    const user = userEvent.setup()
    await signedIn('manager', '/settings?section=billing', undefined, {
      billing: { readOnly: true },
    })
    expect(await screen.findByRole('tab', { name: 'Studio details' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('tab', { name: 'Plan and billing' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This studio is read only until the owner pays its SALEANE bill. You can still see everything.',
    )
    // Nobody but the owner is offered a way to pay.
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
    cleanup()
    await signedIn('owner', '/today', undefined, {
      billing: {
        readOnly: false,
        status: 'trial',
        trialEndsAt: Date.now() + 3 * 86400000,
        hasCard: false,
      },
    })
    const notice = await screen.findByText(/Your free trial ends on/)
    expect(notice.parentElement).toHaveTextContent('Add a card to carry on without a break.')
    await user.click(screen.getByRole('button', { name: 'Add a card' }))
    expect(await screen.findByRole('tab', { name: 'Plan and billing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Plan and billing' })).toBeInTheDocument()
    expect(screen.getByText(/Sample studios are never charged/)).toBeInTheDocument()
    cleanup()
    // Locked: whatever address the owner opens, only paying and downloading are offered.
    await signedIn('owner', '/calendar', undefined, {
      billing: { readOnly: true, locked: true, stopReason: 'unpaid', hasCard: true },
    })
    const name = seed('UK').organisation.name
    expect(await screen.findByRole('heading', { name: `${name} is locked` })).toBeInTheDocument()
    expect(screen.getByText(/Your team cannot open it, and online booking is closed/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download the studio’s records' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Plan and billing' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('keeps the old section addresses and shows a photograph beside each treatment', async () => {
    const user = userEvent.setup()
    await show('/settings?section=service')
    expect(await screen.findByRole('heading', { name: 'Treatments' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Treatments' })).toHaveAttribute('aria-selected', 'true')
    const rows = document.querySelectorAll('.ops-record')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.querySelector('.ops-record-photo')).not.toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section' }), 'receptionist')
    expect(screen.getByRole('heading', { name: 'AI receptionist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save receptionist settings' })).toHaveClass(
      'button-primary',
    )
  })
})

describe('moving clients in from another system', () => {
  const fresha =
    'First name,Last name,Email,Mobile number,Accepts marketing,Accepts SMS marketing,Birthday,Note\n' +
    'Amelia,Carter,amelia.carter@example.com,07700 900001,Yes,No,,\n' +
    'Alex,Import,alex.import@example.com,07700 900123,Yes,Yes,14/03/1990,Prefers mornings\n' +
    ',,,,No,No,,'

  it('walks through four steps to bring a Fresha client list across with notes, birthdays and recorded marketing', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    expect(screen.getByRole('heading', { name: 'Where are you moving from?' })).toBeInTheDocument()
    const next = () => screen.getByRole('button', { name: 'Continue' })
    expect(next()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Fresha' }))
    expect(screen.getByRole('button', { name: 'Fresha' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(next())

    expect(screen.getByRole('heading', { name: 'Add your Fresha files' })).toHaveFocus()
    expect(screen.getByText(/In Fresha, go to Clients/)).toBeInTheDocument()
    expect(next()).toBeDisabled()
    await user.upload(
      screen.getByLabelText(/Drop files here/),
      new File([fresha], 'export_customer_list.csv', { type: 'text/csv' }),
    )
    expect(await screen.findByText(/Fresha client list · 3 rows/)).toBeInTheDocument()
    await user.click(next())

    expect(screen.getByRole('heading', { name: 'Check your clients' })).toBeInTheDocument()
    const summary = document.querySelector('.ops-summary')!
    expect(
      within(summary as HTMLElement).getByText('Ready to come across').nextSibling,
    ).toHaveTextContent('1')
    expect(screen.getByText(/1 agreed to marketing, 1 with birthdays/)).toBeInTheDocument()
    await user.click(next())

    expect(screen.getByRole('heading', { name: 'Bring them across' })).toBeInTheDocument()
    expect(screen.getByText('1 client is ready to come across from Fresha.')).toBeInTheDocument()
    expect(screen.getByText(/1 already in SALEANE stays exactly as they are/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Bring 1 client across' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I have checked the 1 client against/ }))
    await user.click(submit)
    expect(
      await screen.findByRole('heading', { name: '1 client brought across from Fresha' }),
    ).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.clients).toHaveLength(16)
    const moved = saved.clients.find(
      (client: { email: string }) => client.email === 'alex.import@example.com',
    )
    expect(moved).toMatchObject({
      phone: '+447700900123',
      birthday: '03-14',
      marketingConsent: true,
    })
    expect(moved.preferences).toContain('Prefers mornings')
    expect(
      saved.consentRecords.find((record: { clientId: string }) => record.clientId === moved.id),
    ).toMatchObject({ source: 'previous system', evidence: expect.stringContaining('Fresha') })
    const amelia = saved.clients.filter(
      (client: { email: string }) => client.email === 'amelia.carter@example.com',
    )
    expect(amelia).toHaveLength(1)
  })

  it('brings upcoming visits across with the client list, each with its quoted price and deposit', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    await user.click(screen.getByRole('button', { name: 'Fresha' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByText(/In Fresha, open Reports and choose Appointments list/),
    ).toBeInTheDocument()
    const headings =
      'Appt. ref.,Client,Team member,Status,Scheduled date,Service,Duration (mins),Appt. slot,Location,Net sales,Upfront payments'
    const appointments = [
      headings,
      'V1,Alex Import,Maya Lewis,Confirmed,"13 Oct 2026, 10:00am",Skin Renewal Facial,60,10:00:00-11:00:00,Main,95.00,20.00',
      'V2,Amelia Carter,Theo Bennett,Booked,"14 Oct 2026, 2:00pm",Gloss & Tone,45,14:00:00-14:45:00,Main,65.00,0.00',
      'V3,Amelia Carter,Maya Lewis,Cancelled,"15 Oct 2026, 9:00am",Skin Renewal Facial,60,09:00:00-10:00:00,Main,95.00,0.00',
      'V4,Somebody Else,Sophia Reed,Confirmed,"15 Oct 2026, 11:00am",Lymphatic Massage,75,11:00:00-12:15:00,Main,120.00,0.00',
    ].join('\n')
    await user.upload(screen.getByLabelText(/Drop files here/), [
      new File([fresha], 'export_customer_list.csv', { type: 'text/csv' }),
      new File([appointments], 'report_appointment-list.csv', { type: 'text/csv' }),
    ])
    expect(await screen.findByText(/Fresha appointments list · 4 rows/)).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Moving in steps' }).querySelectorAll('li'),
    ).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Check your clients' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Check your visits' })).toHaveFocus()
    const summary = document.querySelector('.ops-summary') as HTMLElement
    expect(within(summary).getByText('Ready to come across').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Need a look').nextSibling).toHaveTextContent('1')
    expect(
      screen.getByText(
        /Check these against Fresha: 2 visits from .*£160\.00 booked and £20\.00 in deposits paid there\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 cancelled or missed visit, which stays behind/)).toBeInTheDocument()
    const attention = screen.getByRole('region', { name: 'Visits to look at' })
    expect(within(attention).getByText('1 visit not coming across')).toBeInTheDocument()
    expect(within(attention).getByText(/This client is not in SALEANE/)).toBeInTheDocument()
    expect(within(attention).getByText(/Somebody Else/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByText('1 client and 2 visits are ready to come across from Fresha.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nobody is sent a confirmation/)).toBeInTheDocument()
    await user.click(
      screen.getByRole('checkbox', { name: /I have checked the 1 client and 2 visits against/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Bring 1 client and 2 visits across' }))
    expect(
      await screen.findByRole('heading', {
        name: '1 client and 2 visits brought across from Fresha',
      }),
    ).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    const alex = saved.clients.find(
      (client: { email: string }) => client.email === 'alex.import@example.com',
    )
    const moved = saved.appointments.filter((a: { source: string }) => a.source === 'import')
    expect(
      moved.map(
        (a: { clientId: string; date: string; startMinutes: number; bookedPriceMinor: number }) => [
          a.clientId,
          a.date,
          a.startMinutes,
          a.bookedPriceMinor,
        ],
      ),
    ).toEqual([
      [alex.id, '2026-10-13', 600, 9500],
      ['client-1', '2026-10-14', 840, 6500],
    ])
    expect(
      saved.payments.filter((p: { method: string }) => p.method === 'previous_system'),
    ).toMatchObject([{ appointmentId: moved[0].id, amountMinor: 2000 }])
    // The visit says where its deposit was paid, never that SALEANE took it.
    cleanup()
    await show(`/calendar?date=2026-10-13&appointment=${moved[0].id}`)
    expect(await screen.findByText('Deposit paid before switching')).toBeInTheDocument()
    expect(screen.queryByText('Demo deposit recorded')).not.toBeInTheDocument()
  })

  it('brings gift cards, packages and credit across from Timely’s own reports', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    await user.click(screen.getByRole('button', { name: 'Timely' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByText(/export Customer gift voucher details, Customer package details/),
    ).toBeInTheDocument()
    const csv = (lines: string[]) => lines.join('\n')
    await user.upload(screen.getByLabelText(/Drop files here/), [
      new File(
        [
          csv([
            'FirstName,LastName,CompanyName,isVIP,SMS Number,Email Address,Date of Birth,Gender,SMS marketing',
            'Femi,Adeyemi,,TRUE,07700 900311,femi.adeyemi@example.com,14/02/1990,Male,TRUE',
          ]),
        ],
        'customers.csv',
        { type: 'text/csv' },
      ),
      new File(
        [
          csv([
            'Customer,Gift Voucher,Recipient,Status,Code,Amount,Redeemed,Outstanding',
            'Olivia James,£50 Gift Voucher,Hannah James,Active,GV58214 (expires 31/03/2027),£50.00,£20.00,£30.00',
            'Femi Adeyemi,£95 Gift Voucher,,Active,GV40981 (expires never),£95.00,£0.00,£95.00',
            'Grace Chen,£60 Gift Voucher,Mei Chen,Active,GV11873 (expires 01/09/2026),£60.00,£0.00,£60.00',
            'Total,,,,,£205.00,£20.00,£185.00',
          ]),
        ],
        'Customer gift voucher details.csv',
        { type: 'text/csv' },
      ),
      new File(
        [
          csv([
            'Customer,Package,Status,Expiry,Payment,Visits available,Visits redeemed',
            'Nina Patel,Course of 6 Skin Renewal Facials,Active,30/06/2027,£480.00,4,2',
            'Femi Adeyemi,Massage course of 3,Active,31/01/2027,£210.00,3,0',
          ]),
        ],
        'Customer package details.csv',
        { type: 'text/csv' },
      ),
      new File(
        [
          csv([
            'Customer,Reason,Status,Expiry,Amount,Redeemed,Outstanding',
            'Charlotte Hayes,Refund for a cancelled visit,Active,never,£25.00,£0.00,£25.00',
          ]),
        ],
        'Customer credit details.csv',
        { type: 'text/csv' },
      ),
    ])
    expect(
      await screen.findByText(/Timely customer gift voucher details · 3 rows/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Moving in steps' }).querySelectorAll('li'),
    ).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Check a few things first' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    const questions = document.querySelector('.moving-questions') as HTMLElement
    await user.selectOptions(
      within(questions).getByLabelText('What “Massage course of 3” is'),
      'service-lymphatic',
    )
    expect(
      screen.getByRole('heading', { name: 'Check gift cards, packages and credit' }),
    ).toBeInTheDocument()
    const summary = document.querySelector('.ops-summary') as HTMLElement
    expect(within(summary).getByText('Gift cards').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Packages').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Credit').nextSibling).toHaveTextContent('£25.00')
    expect(
      screen.getByText('Gift cards match the total in Customer gift voucher details.csv'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '£185.00 in all. £125.00 comes across, and £60.00 on 1 gift card that expired stays behind.',
      ),
    ).toBeInTheDocument()
    const attention = screen.getByRole('region', {
      name: 'Gift cards, packages and credit to look at',
    })
    expect(within(attention).getByText('1 gift card staying behind')).toBeInTheDocument()
    expect(within(attention).getByText('Expired on 1 September 2026.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByText(
        '1 client, 2 gift cards, 2 packages and 1 balance are ready to come across from Timely.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/none of it counts as takings in SALEANE/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /I have checked the 1 client, 2 gift/ }))
    await user.click(
      screen.getByRole('button', {
        name: 'Bring 1 client, 2 gift cards, 2 packages and 1 balance across',
      }),
    )
    expect(
      await screen.findByRole('heading', {
        name: '1 client, 2 gift cards, 2 packages and 1 balance brought across from Timely',
      }),
    ).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    const femi = saved.clients.find((c: { name: string }) => c.name === 'Femi Adeyemi')
    const carried = saved.giftCards.filter((c: { carried?: unknown }) => c.carried)
    expect(
      carried.map((c: { code: string; valueMinor: number; clientId?: string }) => [
        c.code,
        c.valueMinor,
        c.clientId,
      ]),
    ).toEqual([
      ['GV58214', 3000, 'client-2'],
      ['GV40981', 9500, femi.id],
    ])
    expect(
      saved.holdings
        .filter((h: { carried?: unknown }) => h.carried)
        .map((h: { clientId: string; visits: number; priceMinor: number }) => [
          h.clientId,
          h.visits,
          h.priceMinor,
        ]),
    ).toEqual([
      ['client-8', 4, 32000],
      [femi.id, 3, 21000],
    ])
    expect(saved.operations.balances).toMatchObject([
      { clientId: 'client-13', kind: 'credit', amountMinor: 2500 },
    ])

    // The client's page counts the visits used in Timely, and says where it was paid for.
    cleanup()
    await show('/clients/client-8')
    expect(await screen.findByText('4 of 6 visits left · use by 30 June 2027')).toBeInTheDocument()
    expect(screen.getByText('Carried over from Timely, where it was paid for')).toBeInTheDocument()
    // Gift cards keep their printed code and are never counted as sold here.
    cleanup()
    await show('/business/gift-cards')
    expect(await screen.findByText('GV58214')).toBeInTheDocument()
    expect(screen.getAllByText('Carried over from Timely')).toHaveLength(2)
    expect(
      screen.getByText(/Cards carried over from Timely were paid for there, so they are not in/),
    ).toBeInTheDocument()
  })

  it('opens the same steps from Settings for gift cards, packages and credit', async () => {
    const user = userEvent.setup()
    await show('/settings?section=switching')
    await user.click(
      screen.getByRole('button', { name: 'Review a file: gift cards, packages and credit' }),
    )
    expect(screen.getByRole('heading', { name: 'Where are you moving from?' })).toBeInTheDocument()
  })

  it('opens the same steps from Settings for upcoming visits', async () => {
    const user = userEvent.setup()
    await show('/settings?section=switching')
    await user.click(screen.getByRole('button', { name: 'Review a file: upcoming visits' }))
    expect(screen.getByRole('heading', { name: 'Where are you moving from?' })).toBeInTheDocument()
  })

  it('says so when more files are chosen than can be read at once', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    await user.click(screen.getByRole('button', { name: 'Something else' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const files = Array.from(
      { length: 22 },
      (_, i) =>
        new File([`name,email\nPerson ${i},p${i}@example.com`], `list-${i}.csv`, {
          type: 'text/csv',
        }),
    )
    await user.upload(screen.getByLabelText(/Drop files here/), files)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only 20 files can be added at once, so the first 20 were added. Add the other 2 next.',
    )
    expect(screen.getByText('list-19.csv')).toBeInTheDocument()
    expect(screen.queryByText('list-20.csv')).toBeNull()
  })

  it('keeps the files after a failed save and asks for the tick again', async () => {
    const user = userEvent.setup()
    await show('/clients')
    await user.click(screen.getByRole('button', { name: 'Import clients' }))
    await user.click(screen.getByRole('button', { name: 'Something else' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.upload(
      screen.getByLabelText(/Drop files here/),
      new File(['name,email,phone\nRetry Person,retry@example.com,+442071234567'], 'retry.csv', {
        type: 'text/csv',
      }),
    )
    await screen.findByText(/Client list · 1 row/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const tick = () => screen.getByRole('checkbox', { name: /I have checked the 1 client against/ })
    await user.click(tick())
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage unavailable')
    })
    await user.click(screen.getByRole('button', { name: 'Bring 1 client across' }))
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeEmptyDOMElement())
    write.mockRestore()
    expect(tick()).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('retry.csv')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(tick())
    await user.click(screen.getByRole('button', { name: 'Bring 1 client across' }))
    expect(
      await screen.findByRole('heading', { name: '1 client brought across from your old system' }),
    ).toBeInTheDocument()
  })
})

describe('the You page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('keeps each person’s own choices together, apart from the studio', async () => {
    await show('/you')
    expect(await screen.findByRole('heading', { level: 1, name: 'Yours alone.' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Two columns, like email' })).toBeInTheDocument()
    // The fictional demo has no accounts, so it says where signing in will be.
    expect(screen.getByRole('region', { name: 'Signing in' })).toHaveTextContent(
      'The fictional demo has no accounts.',
    )
    expect(screen.queryByRole('link', { name: 'Open your accounts' })).not.toBeInTheDocument()
  })

  it('opens at signing in from your name, for the front desk too', async () => {
    const user = userEvent.setup()
    await signedIn('reception', '/money')
    await user.click(await screen.findByRole('button', { name: /your menu/ }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Password, two-step and Face ID' }),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Yours alone.' })).toBeVisible()
    const signingIn = screen.getByRole('region', { name: 'Signing in' })
    expect(within(signingIn).getByText('Change your password')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open your accounts' })).toHaveAttribute(
      'href',
      '/account',
    )
    // The page says whose it is.
    expect(screen.getByText(/Rosa Desk, reception/i)).toBeInTheDocument()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { requests } from '../domain/approvals'
import type { Role } from '../domain/operations'
import type { BusinessState } from '../domain/model'
import type { RemoteWorkspace, Session } from '../state/api'

// Stage 4: sign-offs for refunds, prices and the rota, on the screens that show them.

async function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(document.querySelector('.route-loading, .candidate-loading')).toBeNull(),
  )
}

/** The sample studio from the server, signed in with this role; changes are only recorded. */
async function signedIn(role: Role, route: string, record: Partial<RemoteWorkspace> = {}) {
  const state: BusinessState = seed('UK')
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
    user: { id: 'account-gia', name: 'Gia General', email: 'gia@example.invalid' },
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
  return state
}

/** The command the page sent, once it has sent one. */
async function sent() {
  await waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/commands'))).toBe(
      true,
    ),
  )
  const [, init] = vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith('/commands'))!
  return JSON.parse(String(init!.body)).command
}

describe('requests for a sign-off', { timeout: 20000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('shows the owner each kind with what is asked, who asked and what approving does', async () => {
    const user = userEvent.setup()
    await show('/business/requests')
    const waiting = await screen.findByRole('region', { name: 'Waiting for a sign-off' })
    expect(
      within(waiting).getByText(/· Skin Renewal Facial.* · £60.00 back of £\d+\.00 paid$/),
    ).toBeInTheDocument()
    expect(
      within(waiting).getByText(
        'Approving moves no money. Nadia can then give back £60.00 from this receipt once, within 7 days.',
      ),
    ).toBeInTheDocument()
    expect(within(waiting).getByText(/^£\d+\.00 now, £\d+\.00 from Sun 1 Nov$/)).toBeInTheDocument()
    expect(within(waiting).getByText(/changes by itself on Sunday 1 November/)).toBeInTheDocument()
    expect(
      within(waiting).getByText(/^Theo · Mon 12 Oct · not working now, 10:00 to 16:00 asked$/),
    ).toBeInTheDocument()
    expect(within(waiting).getAllByText(/asked .* by Nadia Ross$/)).toHaveLength(3)
    expect(within(waiting).getAllByText('Waiting on the owner.')).toHaveLength(3)
    expect(
      screen.getByText('General managers give back up to £50.00 on a receipt without a sign-off.'),
    ).toBeInTheDocument()

    // Deciding the rota change shows it before and after, then changes the rota.
    await user.click(within(waiting).getByRole('button', { name: /^Decide: Rota: Theo/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Now').nextSibling).toHaveTextContent('not working')
    expect(within(dialog).getByText('Asked for').nextSibling).toHaveTextContent(
      '10:00 to 16:00 (an extra day)',
    )
    expect(
      within(dialog).getByText(/Waiting on you\. The rota changes as soon as/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    const decided = await screen.findByRole('region', { name: 'Decided' })
    expect(within(decided).getByText('The rota shows the change.')).toBeInTheDocument()
    expect(within(decided).getByText('Approved')).toBeInTheDocument()
  })

  it('lets the owner set the refund limits and the rota rule, with managers’ limit tucked away', async () => {
    const user = userEvent.setup()
    await show('/business/requests')
    await user.click(await screen.findByRole('button', { name: 'Sign-off rules' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign-off rules' })
    const general = within(dialog).getByLabelText(/General managers give back without a sign-off/)
    expect(general).toHaveValue('50.00')
    expect(within(dialog).getByRole('combobox', { name: /rota changes/ })).toHaveValue('extra')
    // Managers' limit is behind More options.
    expect(within(dialog).getByText('More options').closest('details')).not.toHaveAttribute('open')
    await user.clear(general)
    await user.type(general, '40')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /rota changes/ }), 'all')
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }))
    expect(
      await screen.findByText(
        'General managers give back up to £40.00 on a receipt without a sign-off.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Every change a general manager makes to the rota needs a sign-off.'),
    ).toBeInTheDocument()
  })

  it('lets a general manager ask for a new price, with the day it starts', async () => {
    const user = userEvent.setup()
    const state = await signedIn('general', '/business/requests', {
      locationId: seed('UK').organisation.locationId,
    })
    await user.click(await screen.findByRole('button', { name: 'Ask for a sign-off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask for a sign-off' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Kind' }), 'price')
    const treatment = within(dialog).getByRole('combobox', { name: 'Treatment' })
    const massage = state.services.find((x) => x.id !== 'service-facial' && !x.archived)!
    await user.selectOptions(treatment, massage.id)
    await user.type(within(dialog).getByLabelText(/New price/), '120')
    expect(within(dialog).getByText(/Visits already booked keep the price/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send for sign-off' }))
    expect(await sent()).toEqual({
      type: 'request-raise',
      input: {
        locationId: state.organisation.locationId,
        kind: 'price',
        price: { serviceId: massage.id, priceMinor: 120_00, startsOn: '2026-10-06' },
      },
    })
  })

  it('shows a general manager their limit on a receipt and asks for a sign-off from it', async () => {
    const user = userEvent.setup()
    const state = await signedIn('general', '/business/money', {
      locationId: seed('UK').organisation.locationId,
    })
    // The sample's refund is waiting, so its receipt says so and nothing more can be asked.
    const asked = requests(state).find((r) => r.kind === 'refund')!
    const receipt = asked.refund!.receipt
    await user.click(
      (await screen.findAllByRole('button', { name: new RegExp(`${receipt}\\b`) }))[0],
    )
    let dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/You can give back up to £50.00 on a receipt without a sign-off/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/A refund of £60.00 is waiting for a sign-off from the owner/),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Ask for a sign-off' })).toBeNull()
    await user.keyboard('{Escape}')

    // Another receipt: ask for more than the limit, with a reason that names nobody.
    const other = [...state.sales]
      .filter(
        (sale) =>
          sale.id !== asked.refund!.saleId &&
          sale.receiptNumber &&
          !sale.coveredMinor &&
          !sale.giftCardMinor &&
          sale.totalMinor > 50_00,
      )
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0]
    await user.click(
      (await screen.findAllByRole('button', { name: new RegExp(`${other.receiptNumber}\\b`) }))[0],
    )
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Ask for a sign-off' }))
    expect(within(dialog).getByText(/Whoever decides sees the receipt number/)).toBeInTheDocument()
    await user.type(
      within(dialog).getByLabelText(/^Why the money goes back/),
      'Treatment ran short.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Send for sign-off' }))
    expect(await sent()).toMatchObject({
      type: 'request-raise',
      input: {
        kind: 'refund',
        refund: { saleId: other.id },
        note: 'Treatment ran short.',
      },
    })
  })
})

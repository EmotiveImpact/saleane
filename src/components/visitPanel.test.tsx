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

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('the visit panel, one place for a visit in every state', { timeout: 20000 }, () => {
  it('leads with the treatment, then the client, what is good to know and what can be done', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ }))
    const panel = screen.getByRole('dialog', { name: 'Skin Renewal Facial' })
    expect(panel).toHaveAccessibleDescription('Tuesday 6 October, 11:00 to 12:00')
    expect(within(panel).getByText(/60 minutes with Maya Lewis/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Open client page' })).toHaveAttribute(
      'href',
      '/clients/client-4',
    )
    expect(within(panel).getByText('Prefers visit updates by email.')).toBeInTheDocument()
    expect(within(panel).getByText(/before this one\.$|No earlier visits\./)).toBeInTheDocument()
    const actions = within(panel).getByRole('group', { name: 'Manage this visit' })
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Move visit', 'Cancel visit', 'Mark as missed'])
    expect(within(actions).getByRole('link', { name: 'Message Noor' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Welcome client' })).toBeInTheDocument()
  })

  it('writes to the client from the visit as a draft in the Inbox, about this visit', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Noor Ahmed Skin Renewal Facial/ }))
    await user.click(screen.getByRole('link', { name: 'Message Noor' }))
    // The Inbox is loaded when first opened, which can take a moment.
    const draft = await screen.findByRole('dialog', { name: 'Write a draft' }, { timeout: 8000 })
    expect(within(draft).getByLabelText('Client')).toHaveValue('client-4')
    expect(within(draft).getByLabelText('Related visit (optional)')).toHaveValue('visit-noor')
    expect(within(draft).getByLabelText('Send by')).toHaveValue('email')
    await user.type(within(draft).getByLabelText('Subject'), 'Your visit today')
    await user.type(within(draft).getByLabelText('Message'), 'See you at eleven.')
    await user.click(within(draft).getByRole('button', { name: 'Save draft' }))
    expect(screen.queryByRole('dialog', { name: 'Write a draft' })).not.toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.operations.messages.at(-1)).toMatchObject({
      clientId: 'client-4',
      appointmentId: 'visit-noor',
      status: 'draft',
    })
  })

  it('shows what was paid after checkout and invites the next visit, or names the one booked', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Ellie Brooks Signature Cut/ }))
    const receipt = screen.getByRole('dialog', { name: 'A well-finished visit' })
    expect(
      within(receipt).getByRole('heading', { name: 'The next visit is already booked.' }),
    ).toBeInTheDocument()
    expect(within(receipt).getByText(/Thursday 8 October at 10:00/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    await user.click(screen.getByRole('button', { name: 'Record demo payment' }))
    const paid = screen.getByRole('dialog', { name: 'A well-finished visit' })
    expect(
      within(paid).getByRole('heading', { name: 'Give the next visit a place.' }),
    ).toBeInTheDocument()
    expect(within(paid).getByText(/Four weeks on is Tuesday 3 November\./)).toBeInTheDocument()
    expect(within(paid).getByRole('button', { name: 'Rebook this client' })).toBeEnabled()
  })
})

describe('checkout', { timeout: 20000 }, () => {
  it('adds a product from a list of initial tiles and keeps the keyboard on it', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    const checkout = screen.getByRole('dialog', { name: 'Checkout' })
    expect(within(checkout).getByText('£70.00')).toBeInTheDocument()
    await user.click(within(checkout).getByRole('button', { name: 'Add a product' }))
    const shelf = screen.getByRole('dialog', { name: 'Add a product' })
    // Each product on its initial tile, with what is in stock and its price.
    expect(within(shelf).getAllByRole('button')[0]).toHaveTextContent(
      /^CCalming Cleansing Balm\d+ in stock£32\.00$/,
    )
    await user.click(within(shelf).getByRole('button', { name: /Calming Cleansing Balm/ }))
    expect(screen.queryByRole('dialog', { name: 'Add a product' })).not.toBeInTheDocument()
    expect(
      within(checkout).getByRole('button', { name: 'One more Calming Cleansing Balm' }),
    ).toHaveFocus()
    expect(within(checkout).getByText('£102.00')).toBeInTheDocument()
  })

  it('applies a gift card from its code, saying why when it cannot', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Amelia Carter Skin Renewal Facial/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }))
    const checkout = screen.getByRole('dialog', { name: 'Checkout' })
    const apply = within(checkout).getByRole('button', { name: 'Apply' })
    expect(apply).toBeEnabled()
    await user.click(apply)
    expect(within(checkout).getByRole('alert')).toHaveTextContent(
      'Type the code from the gift card or voucher',
    )
    const code = within(checkout).getByLabelText('Gift card or voucher code')
    await user.type(code, 'LAKE-0000-0000')
    await user.click(apply)
    expect(within(checkout).getByRole('alert')).toHaveTextContent('No gift card here has that code')
    await user.clear(code)
    await user.type(code, 'lake-7k4m-2qhn{Enter}')
    expect(within(checkout).getByText(/Gift card LAKE-7K4M-2QHN/)).toBeInTheDocument()
    expect(within(checkout).getByText('£0.00')).toBeInTheDocument()
  })
})

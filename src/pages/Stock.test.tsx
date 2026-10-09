import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show() {
  render(
    <MemoryRouter initialEntries={['/business/stock']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('the shelf', { timeout: 20000 }, () => {
  it('shows each product with its kind, its stock and its actions kept together', async () => {
    show()
    const balm = await screen.findByRole(
      'group',
      { name: 'Stock and details for Calming Cleansing Balm' },
      { timeout: 8000 },
    )
    expect(
      within(balm)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Delivery', 'Used', 'Count', 'Edit'])
    const row = balm.parentElement!
    expect(within(row).getByText('For sale')).toBeInTheDocument()
    expect(within(row).getByLabelText('10 in stock')).toBeInTheDocument()

    const peel = screen.getByRole('group', {
      name: 'Stock and details for Enzyme Peel, professional size',
    }).parentElement!
    expect(within(peel).getByText('Used in treatments')).toBeInTheDocument()
    expect(within(peel).getByText('Running low')).toBeInTheDocument()
    expect(within(peel).getByLabelText('1 in stock')).toBeInTheDocument()
  })

  it('records a delivery from a product’s actions', async () => {
    const user = userEvent.setup()
    show()
    const balm = await screen.findByRole(
      'group',
      { name: 'Stock and details for Calming Cleansing Balm' },
      { timeout: 8000 },
    )
    await user.click(within(balm).getByRole('button', { name: 'Delivery' }))
    const dialog = screen.getByRole('dialog', { name: 'Record a delivery' })
    await user.type(within(dialog).getByLabelText('How many arrived'), '5')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(balm.parentElement!).getByLabelText('15 in stock')).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { stock } from '../domain/operations'

/** How many of a sample product the shelf holds before any test changes it. */
const onShelf = (id: string) => stock(seed('UK'), `product-${id}`)

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
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Delivery', 'More for Calming Cleansing Balm'])
    const row = balm.parentElement!
    expect(within(row).getByText('For sale')).toBeInTheDocument()
    expect(within(row).getByLabelText(`${onShelf('cleansing-balm')} in stock`)).toBeInTheDocument()

    const peel = screen.getByRole('group', {
      name: 'Stock and details for Enzyme Peel, professional size',
    }).parentElement!
    expect(within(peel).getByText('Used in treatments')).toBeInTheDocument()
    expect(within(peel).getByText('Running low')).toBeInTheDocument()
    expect(within(peel).getByLabelText(`${onShelf('enzyme-peel')} in stock`)).toBeInTheDocument()
  })

  it('keeps the rarer actions in one menu on the row', async () => {
    const user = userEvent.setup()
    show()
    const balm = await screen.findByRole(
      'group',
      { name: 'Stock and details for Calming Cleansing Balm' },
      { timeout: 8000 },
    )
    await user.click(within(balm).getByRole('button', { name: /^More/ }))
    const menu = await screen.findByRole('menu', { name: 'More for Calming Cleansing Balm' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Used in treatments', 'Correct the count', 'Edit details'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Correct the count' }))
    const dialog = screen.getByRole('dialog', { name: 'Correct the count' })
    expect(within(dialog).getByLabelText('How many are on the shelf now')).toHaveFocus()
    // Closing the dialog puts the focus back on the menu's button, where the person was.
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(within(balm).getByRole('button', { name: /^More/ })).toHaveFocus()
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
    expect(
      within(balm.parentElement!).getByLabelText(`${onShelf('cleansing-balm') + 5} in stock`),
    ).toBeInTheDocument()
    // The dialog closed as it saved, so a notice in the corner says what was recorded.
    expect(
      await screen.findByText(
        `Delivery of 5 recorded for Calming Cleansing Balm. ${onShelf('cleansing-balm') + 5} in stock.`,
      ),
    ).toBeInTheDocument()
  })
})

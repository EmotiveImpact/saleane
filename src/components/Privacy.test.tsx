import { describe, expect, it, vi } from 'vitest'
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

describe('privacy screens in the browser demo (LOCAL-03)', () => {
  it('previews a client data copy before downloading it, and says the demo keeps no audit', async () => {
    const created = vi.fn(() => 'blob:privacy')
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() })
    const user = userEvent.setup()
    await show('/clients/client-1')
    await user.click(await screen.findByRole('button', { name: 'Prepare a data copy' }))
    const dialog = await screen.findByRole('dialog', { name: /A copy of Amelia Carter’s data/ })
    expect(within(dialog).getByText('Not included')).toBeInTheDocument()
    expect(within(dialog).getByText(/Other clients’ names and details/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Download readable summary' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Download JSON file' }))
    expect(created).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('status')).toHaveTextContent('keeps no audit log')
    await user.click(within(dialog).getByRole('button', { name: 'Download readable summary' }))
    expect(created).toHaveBeenCalledTimes(2)
  })

  it('reviews an erasure without deleting anything', async () => {
    const user = userEvent.setup()
    await show('/clients/client-1')
    const before = localStorage.getItem('saleane.demo.v1.UK')
    await user.click(await screen.findByRole('button', { name: 'Review erasure' }))
    const dialog = await screen.findByRole('dialog', { name: /Erasure review for Amelia Carter/ })
    expect(within(dialog).getByText('Must be kept, and why')).toBeInTheDocument()
    expect(within(dialog).getByText('Receipts')).toBeInTheDocument()
    expect(within(dialog).getByText(/requests are not recorded/)).toBeInTheDocument()
    expect(localStorage.getItem('saleane.demo.v1.UK')).toBe(before)
  })
})

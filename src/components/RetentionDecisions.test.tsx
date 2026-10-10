import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { sampleWithRegulars } from '../domain/seed'

// The sample as the demo shows it, with the regulars: two of them are long past their period.
beforeAll(() => sampleWithRegulars(true))
afterAll(() => sampleWithRegulars(false))

async function show() {
  render(
    <MemoryRouter initialEntries={['/settings?section=privacy']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(document.querySelector('.route-loading, .candidate-loading')).toBeNull(),
  )
  return screen.findByRole('region', { name: 'Waiting for your decision' })
}

describe('records waiting for a decision, in Settings, Data & privacy', () => {
  it('lists what is due by kind, with why, and keeps a record longer by years by default', async () => {
    const user = userEvent.setup()
    const panel = await show()
    const clients = within(panel).getByRole('region', { name: /Client details/ })
    expect(within(clients).getByText('Winifred Ashby')).toBeInTheDocument()
    expect(
      within(clients).getByText(/Last visit 12 March 2024\. Due since 12 March 2026\./),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: /Private feedback/ })).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: /Unsent messages/ })).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: /Waitlist requests/ })).toBeInTheDocument()

    await user.click(within(clients).getByRole('button', { name: 'Decide about Winifred Ashby' }))
    const dialog = await screen.findByRole('dialog', { name: 'Decide about Winifred Ashby' })
    expect(within(dialog).getByRole('button', { name: 'Keep longer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByRole('radio', { name: 'Years' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Keep until 6 October 2027' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Say why')
    await user.type(within(dialog).getByLabelText(/Why keep it/), 'A complaint is still open.')
    await user.click(within(dialog).getByRole('button', { name: 'Keep until 6 October 2027' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(panel).getByRole('status')).toHaveTextContent(
      'Kept 1 client’s details until 6 October 2027. They come back here then.',
    )
    const left = within(panel).getByRole('region', { name: /Client details/ })
    expect(within(left).queryByText('Winifred Ashby')).toBeNull()
    expect(within(left).getByText('Gideon Marlowe')).toBeInTheDocument()
    expect(within(panel).getByText('Kept longer (1)')).toBeInTheDocument()
  })

  it('confirms in plain words before deleting, and keeps the receipts under Former client', async () => {
    const user = userEvent.setup()
    const panel = await show()
    const messages = within(panel).getByRole('region', { name: /Unsent messages/ })
    await user.click(within(messages).getByRole('button', { name: /^Decide about/ }))
    let dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Approve deletion' }))
    expect(
      within(dialog).getByText('The messages. None of them was ever sent.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tick the box')
    await user.click(within(dialog).getByLabelText(/I understand this is final/))
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(panel).queryByRole('region', { name: /Unsent messages/ })).toBeNull()

    const clients = within(panel).getByRole('region', { name: /Client details/ })
    await user.click(within(clients).getByRole('button', { name: 'Decide for all 2' }))
    dialog = await screen.findByRole('dialog', { name: 'Decide about 2 clients’ details' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve deletion' }))
    expect(within(dialog).getByText(/stay under the name Former client/)).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText(/I understand this is final/))
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(panel).getByRole('status')).toHaveTextContent('Deleted 2 clients’ details.')
    // Their feedback and waitlist request went with them, so nothing is left waiting.
    expect(within(panel).getByText('Nothing is waiting')).toBeInTheDocument()
  })
})

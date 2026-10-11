import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show() {
  render(
    <MemoryRouter initialEntries={['/today']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('Ask Saleane', { timeout: 20000 }, () => {
  it('follows a notice with its own question and answers it', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /^Ask SALEANE/ }))
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    // Stage 3: Theo rents his chair, so the named clients' quieter week is the notice to follow.
    const notice = within(panel).getByText(/Takings are down this week/).parentElement!
    expect(within(notice).queryByRole('button', { name: 'Anything unusual?' })).toBeNull()
    await user.click(within(notice).getByRole('button', { name: 'How was the week?' }))
    expect(await within(panel).findByText(/^The last seven days: /)).toBeInTheDocument()
  })

  it('keeps the question box’s hint short enough for a phone', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /^Ask SALEANE/ }))
    const box = await screen.findByLabelText('Your question')
    expect(box).toHaveAttribute('placeholder', 'Ask about today or a client…')
    expect(box.getAttribute('placeholder')!.length).toBeLessThanOrEqual(30)
  })
})

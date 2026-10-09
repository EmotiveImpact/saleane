import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TestPayment } from './TestPayment'
import { api } from '../state/api'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))

const attempt = {
  studio: 'Atelier House',
  locale: 'en-GB',
  currency: 'GBP',
  amountMinor: 2500,
  purpose: 'deposit',
  saveCard: false,
  status: 'started',
}
beforeEach(() => {
  window.location.hash = '#attempt-1'
})
afterEach(() => {
  window.location.hash = ''
  vi.resetAllMocks()
})
function answer(next: string, purpose = 'deposit') {
  vi.mocked(api).mockImplementation(async (_path, init) =>
    init?.method === 'POST'
      ? ({ status: 'succeeded', next } as never)
      : ({ ...attempt, purpose } as never),
  )
}

test('a test deposit ends by saying plainly that no money was taken', async () => {
  const user = userEvent.setup()
  answer('/manage?payment=done')
  render(<TestPayment />)
  await user.click(await screen.findByRole('button', { name: 'Pay £25.00 (test)' }))
  expect(await screen.findByRole('heading', { name: 'Test payment complete' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    'This was a test of the £25.00 deposit, so no money was taken and no card was charged.',
  )
  // The guest goes back to their visit when they choose, not before they have read this.
  expect(screen.getByRole('link', { name: 'Back to your visit' })).toHaveAttribute(
    'href',
    '/manage?payment=done',
  )
  expect(vi.mocked(api)).toHaveBeenCalledWith('/api/test-payments/attempt-1', {
    method: 'POST',
    body: { outcome: 'pay', card: '4242' },
  })
  // Nothing on the page claims a real payment.
  expect(document.body).not.toHaveTextContent(/payment (was )?(received|taken|successful)/i)
})

test('a declined test card and leaving without paying both say nothing was taken', async () => {
  const user = userEvent.setup()
  answer('/manage?payment=declined')
  const first = render(<TestPayment />)
  await user.click(await screen.findByRole('radio', { name: /ending 0002/ }))
  await user.click(screen.getByRole('button', { name: 'Pay £25.00 (test)' }))
  expect(await screen.findByRole('heading', { name: 'The test card was declined' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('This was a test, so nothing was taken.')
  first.unmount()
  answer('/manage?payment=cancelled')
  render(<TestPayment />)
  await user.click(await screen.findByRole('button', { name: 'Go back without paying' }))
  expect(await screen.findByRole('heading', { name: 'You left without paying' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Nothing was taken.')
})

test('saving a test card says no real card was saved', async () => {
  const user = userEvent.setup()
  answer('/manage?payment=done', 'save_card')
  render(<TestPayment />)
  await user.click(await screen.findByRole('button', { name: 'Save test card' }))
  expect(await screen.findByRole('heading', { name: 'Test card saved' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    'This was a test, so no real card was saved and no money was taken.',
  )
})

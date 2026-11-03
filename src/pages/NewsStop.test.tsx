import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NewsStop } from './NewsStop'
import { api, ApiError } from '../state/api'

// Stage 4: the page behind the stop link at the foot of a message to clients.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const token = 'b'.repeat(43)
beforeEach(() => {
  window.location.hash = `#${token}`
})
afterEach(() => {
  window.location.hash = ''
  vi.resetAllMocks()
})

test('asks first, and stops news only when the client presses the button', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(
    async (path) => ({ studio: 'Atelier House', stopped: path === '/api/news/stop' }) as never,
  )
  render(<NewsStop />)
  expect(
    await screen.findByRole('heading', { name: 'Stop news from Atelier House?' }),
  ).toBeInTheDocument()
  // Opening the link changes nothing by itself.
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('/api/news/open', { method: 'POST', body: { token } })
  await user.click(screen.getByRole('button', { name: 'Stop news and offers' }))
  expect(api).toHaveBeenLastCalledWith('/api/news/stop', { method: 'POST', body: { token } })
  expect(screen.getByRole('heading', { name: 'Done.' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Atelier House will not send you news and offers. You will still hear about your visits.',
  )
})

test('says so when news is already off', async () => {
  vi.mocked(api).mockResolvedValue({ studio: 'Atelier House', stopped: true } as never)
  render(<NewsStop />)
  expect(
    await screen.findByRole('heading', { name: 'Your news is already off.' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

test('gives the same plain answer for a link that is wrong, used up or replaced', async () => {
  vi.mocked(api).mockRejectedValue(new ApiError('This link is not valid.', 404))
  render(<NewsStop />)
  expect(
    await screen.findByRole('heading', { name: 'We couldn’t open this link.' }),
  ).toBeInTheDocument()
  expect(
    screen.getByText('This link has expired or been replaced. Ask the studio to stop your news.'),
  ).toBeInTheDocument()
})

test('never sends a malformed token to the server', async () => {
  window.location.hash = '#short'
  render(<NewsStop />)
  expect(screen.getByRole('heading', { name: 'We couldn’t open this link.' })).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})

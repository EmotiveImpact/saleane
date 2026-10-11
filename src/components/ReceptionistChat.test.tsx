import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ReceptionistChat } from './ReceptionistChat'
import { api } from '../state/api'

// V4: each free time the AI receptionist lists is a button that starts booking it.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
// The chat keeps its newest message in view; jsdom does not scroll.
Element.prototype.scrollTo ??= () => {}
afterEach(() => {
  vi.resetAllMocks()
})

test('a listed time starts booking it on the page', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({
    text: 'Skin Renewal Facial on Thursday 8 October:\nAt Islington: 14:00\nAt Marylebone: 15:00\nWhich would you like?',
    chat: 'chat-1',
    proposals: [],
    times: [
      {
        serviceId: 'service-facial',
        staffId: 'any',
        date: '2026-10-08',
        startMinutes: 840,
        locationId: 'loc-islington',
        label: '14:00',
        location: 'Islington',
      },
      {
        serviceId: 'service-facial',
        staffId: 'any',
        date: '2026-10-08',
        startMinutes: 900,
        locationId: 'loc-london',
        label: '15:00',
        location: 'Marylebone',
      },
    ],
  } as never)
  const onTime = vi.fn()
  render(<ReceptionistChat base="/api/public/review" studio="Atelier House" onTime={onTime} />)
  await user.click(screen.getByRole('button', { name: 'Ask a question' }))
  // The suggested questions name no treatment, since not every studio offers the same ones.
  expect(screen.getByRole('button', { name: 'What treatments do you offer?' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Your question'), 'Any facial times on Thursday afternoon?')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  const times = await screen.findByRole('group', { name: 'Free times' })
  expect(times).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Choose 14:00 at Islington' }))
  expect(onTime).toHaveBeenCalledWith({
    serviceId: 'service-facial',
    staffId: 'any',
    date: '2026-10-08',
    startMinutes: 840,
    locationId: 'loc-islington',
  })
  // The chat closes so the guest carries on with the booking steps.
  expect(screen.queryByRole('group', { name: 'Free times' })).toBeNull()
})

test('sends the chat’s id with a follow-up, never its earlier lines', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({
    text: 'We are open from 9:00 to 18:00.',
    chat: 'chat-1',
    proposals: [],
    times: [],
  } as never)
  render(<ReceptionistChat base="/api/public/review" studio="Atelier House" onTime={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Ask a question' }))
  await user.type(screen.getByLabelText('Your question'), 'When are you open?')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('We are open from 9:00 to 18:00.')
  await user.type(screen.getByLabelText('Your question'), 'And on Sunday?')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  // The studio keeps the chat's earlier lines itself, so nobody can write its side.
  expect(vi.mocked(api)).toHaveBeenLastCalledWith('/api/public/review/receptionist', {
    method: 'POST',
    body: { text: 'And on Sunday?', chat: 'chat-1' },
    timeoutMs: expect.any(Number),
  })
})

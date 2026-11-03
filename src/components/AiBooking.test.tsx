import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AiBooking } from './AiBooking'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import { operations } from '../domain/operations'
import type { BusinessState } from '../domain/model'

// Stage 5: the owner lets guests book through ChatGPT or Claude, and sees the address.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const store = vi.hoisted(() => ({
  role: 'owner',
  state: null as unknown as BusinessState,
  commit: vi.fn(),
}))
vi.mock('../state/context', () => ({
  useStore: () => ({
    mode: 'server',
    session: { user: { id: 'account-ada', name: 'Ada Owner', email: 'ada@example.invalid' } },
    state: store.state,
    role: store.role,
    blocked: false,
    commit: store.commit,
  }),
}))
const address = 'http://127.0.0.1:5173/api/mcp/linden-studio'
const studio = (enabled: boolean, bookingEnabled = true): BusinessState => {
  const s = seed('UK')
  return {
    ...s,
    operations: { ...operations(s), mode: 'local', bookingEnabled, aiBooking: { enabled } },
  }
}
const answer = (status: Record<string, unknown> = {}) =>
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `/api/workspaces/${store.state.organisation.id}/ai-booking`)
      return { mode: 'test', reachable: true, address, sample: false, ...status } as never
    throw new Error(`Unexpected route ${path}`)
  })
beforeEach(() => {
  store.role = 'owner'
  store.commit.mockResolvedValue({ ok: true })
})
afterEach(() => {
  vi.resetAllMocks()
})

test('turns it on with a quiet Save and says plainly that SALEANE is not online yet', async () => {
  const user = userEvent.setup()
  store.state = studio(false)
  answer()
  render(<AiBooking />)
  expect(
    await screen.findByRole('heading', { name: 'Booking through ChatGPT or Claude' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/SALEANE is not online yet, so ChatGPT and Claude/)).toBeInTheDocument()
  // The address shows once it is on.
  expect(screen.queryByLabelText('Your studio’s address for AI assistants')).toBeNull()
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toHaveClass('button-secondary')
  await user.click(screen.getByLabelText('Let guests book through ChatGPT or Claude'))
  await user.click(save)
  expect(store.commit).toHaveBeenCalledWith({ type: 'ai-booking', settings: { enabled: true } })
  expect(await screen.findByText('Saved.')).toBeInTheDocument()
})

test('shows the address to copy and the visits booked through an assistant', async () => {
  const user = userEvent.setup()
  const s = studio(true)
  store.state = {
    ...s,
    appointments: s.appointments.map((a, i) =>
      i === 0 ? { ...a, source: 'online', channel: 'claude' } : a,
    ),
  }
  answer()
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<AiBooking />)
  const field = await screen.findByLabelText('Your studio’s address for AI assistants')
  expect(field).toHaveValue(address)
  expect(screen.getByText('1 visit has been booked through an AI assistant.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Copy/ }))
  expect(writeText).toHaveBeenCalledWith(address)
  expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument()
})

test('says when online booking is off, when test mode cannot answer here, and for a sample', async () => {
  store.state = studio(true, false)
  answer({ reachable: false, sample: true })
  render(<AiBooking />)
  expect(
    await screen.findByText(/Test mode only answers on the computer SALEANE runs on/),
  ).toBeInTheDocument()
  expect(screen.getByText(/Online booking is off, so nothing answers/)).toBeInTheDocument()
  expect(
    screen.getByText(/sample studio, so visits booked here are for practice/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/has been sent|was sent/)).toBeNull()
})

test('shows nothing to anyone but the owner', async () => {
  store.role = 'manager'
  store.state = studio(true)
  answer()
  const { container } = render(<AiBooking />)
  expect(container).toBeEmptyDOMElement()
  expect(api).not.toHaveBeenCalled()
})

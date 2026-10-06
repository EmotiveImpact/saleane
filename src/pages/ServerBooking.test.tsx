import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api, ApiError } from '../state/api'
import { seed } from '../domain/seed'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
const state = seed('UK'),
  base = '/api/public/review',
  journal = `saleane.guest-confirmation:${base}`
const catalog = {
  organisation: state.organisation,
  services: [state.services[0]],
  staff: state.staff,
  today: '2026-10-06',
  sample: false,
}
const payload = {
  hold: 'a'.repeat(48),
  contact: {
    name: 'Guest Review',
    email: 'guest@example.test',
    phone: '+44 7700 900123',
    marketingConsent: false,
  },
  policy: true,
}
function view() {
  return render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

test('unknown confirmation retains its exact snapshot through expiry and reload, then safely replays', async () => {
  const user = userEvent.setup()
  let succeed = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    if (path === `${base}/book`) {
      if (!succeed) throw new ApiError('Connection interrupted; confirmation is uncertain.', 0)
      return { appointmentId: 'visit-recovered' } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  const first = view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone with country code'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  await user.click(
    screen.getByRole('checkbox', { name: /I understand this is a local booking preview/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Connection interrupted; confirmation is uncertain.')
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  const saved = JSON.parse(sessionStorage.getItem(journal)!)
  expect(saved.payload).toEqual(payload)
  first.unmount()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(Date.parse(saved.expiresAt) + 60000))
  view()
  const retry = await screen.findByRole('button', { name: 'Check booking status' })
  expect(retry).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Choose a time again' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  succeed = true
  await user.click(retry)
  await screen.findByText('Saved in the studio calendar')
  expect(sessionStorage.getItem(journal)).toBeNull()
  const confirmations = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/book`)
  expect(confirmations).toHaveLength(2)
  expect(confirmations[0][1]?.body).toEqual(confirmations[1][1]?.body)
  expect(confirmations[1][1]?.body).toEqual(payload)
})

test('a definitive expired unconsumed reservation unlocks a new time; inaccessible studio keeps retry protected', async () => {
  const saved = {
    payload,
    serviceId: state.services[0].id,
    staffId: 'any',
    date: '2026-10-07',
    start: 600,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  }
  sessionStorage.setItem(journal, JSON.stringify(saved))
  let code = 404
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    throw new ApiError(
      code === 404
        ? 'Studio is temporarily unavailable.'
        : 'This reservation expired. Choose a time again.',
      code,
    )
  })
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Check booking status' }))
  await screen.findByText('Studio is temporarily unavailable.')
  expect(sessionStorage.getItem(journal)).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  code = 409
  await user.click(screen.getByRole('button', { name: 'Check booking status' }))
  await screen.findByText('This reservation expired. Choose a time again.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit details' })).toBeEnabled())
  expect(screen.getByRole('button', { name: 'Confirm visit' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Choose a time again' })).toBeEnabled()
  expect(sessionStorage.getItem(journal)).toBeNull()
})

test('corrupt pending confirmation fails closed instead of offering another booking', async () => {
  sessionStorage.setItem(journal, 'not JSON')
  vi.mocked(api).mockResolvedValue(catalog as never)
  await act(async () => {
    view()
  })
  expect(await screen.findByText(/unfinished confirmation could not be recovered/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Choose a time' })).toBeDisabled()
})

test('a studio bot check gates the hold and sends a fresh single-use token each attempt', async () => {
  let issued = 0
  const callbacks: ((token: string) => void)[] = []
  window.turnstile = {
    render: (_element, options) => {
      callbacks.push(options.callback)
      return `widget-${callbacks.length}`
    },
    remove: vi.fn(),
  }
  let refuse = true
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base)
      return { ...catalog, botCheck: { siteKey: '1x00000000000000000000AA' } } as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`) {
      if (refuse) {
        refuse = false
        throw new ApiError('Complete the quick check below, then reserve your time again.', 403)
      }
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  const holdButton = screen.getByRole('button', { name: 'Hold this time' })
  expect(holdButton).toBeDisabled()
  act(() => callbacks.at(-1)!(`token-${++issued}`))
  expect(holdButton).toBeEnabled()
  await user.click(holdButton)
  await screen.findByText('Complete the quick check below, then reserve your time again.')
  // The used token is discarded and a new widget is rendered for the retry.
  await waitFor(() => expect(callbacks).toHaveLength(2))
  expect(screen.getByRole('button', { name: 'Hold this time' })).toBeDisabled()
  act(() => callbacks.at(-1)!(`token-${++issued}`))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await screen.findByLabelText('Full name')
  const holds = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/holds`)
  expect(holds.map(([, init]) => (init?.body as { botCheck: string }).botCheck)).toEqual([
    'token-1',
    'token-2',
  ])
  delete window.turnstile
})

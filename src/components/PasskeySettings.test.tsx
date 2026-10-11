import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { startRegistration } from '@simplewebauthn/browser'
import { PasskeySettings } from './PasskeySettings'
import { api, ApiError } from '../state/api'
import type { Session } from '../state/api'

// NEXT-15: the devices that sign in with Face ID or a fingerprint, in the person's own settings.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  browserSupportsWebAuthn: () => true,
  startRegistration: vi.fn(),
}))
const store: { session: Session | null; refreshSession: () => Promise<Session | null> } = {
  session: null,
  refreshSession: vi.fn(async () => store.session),
}
vi.mock('../state/context', () => ({
  useStore: () => ({ ...store, state: { organisation: { locale: 'en-GB' } } }),
}))

const day = Date.parse('2026-10-09T09:00:00.000Z')
const mac = {
  id: 'credential-mac-0001',
  name: 'Studio Mac',
  createdAt: day,
  lastUsedAt: null,
  shared: true,
}
const phone = {
  id: 'credential-phone-02',
  name: 'iPhone',
  createdAt: day,
  lastUsedAt: Date.parse('2026-10-10T07:30:00.000Z'),
  shared: false,
}
const answer = { id: 'new-credential', rawId: 'new-credential', type: 'public-key', response: {} }
function session(extra: Partial<Session['user']> = {}, here = true): Session {
  return {
    user: {
      id: 'account-1',
      name: 'Ada Owner',
      email: 'ada@example.invalid',
      passkeys: 1,
      ...extra,
    },
    csrf: 'csrf',
    workspaces: [],
    services: { email: false, payments: false },
    localOnly: true,
    passkeysHere: here,
  }
}
beforeEach(() => {
  store.session = session()
  vi.mocked(startRegistration).mockResolvedValue(answer as never)
})
afterEach(() => vi.clearAllMocks())

async function open() {
  render(<PasskeySettings />)
  await userEvent.click(screen.getByText('Face ID and fingerprint'))
}

test('lists each device and adds this one with the password', async () => {
  const calls: [string, unknown][] = []
  vi.mocked(api).mockImplementation(async (path, options) => {
    calls.push([path, options?.body])
    if (path === '/api/auth/passkeys' && !options) return { passkeys: [mac], here: true } as never
    if (path === '/api/auth/passkeys/options')
      return { challenge: 'abc', rp: { id: 'localhost' } } as never
    if (path === '/api/auth/passkeys')
      return { passkeys: [mac, { ...phone, name: 'Front desk' }] } as never
    throw new Error(`Unexpected ${path}`)
  })
  await open()
  const list = await screen.findByRole('list', { name: 'Devices that sign in' })
  expect(within(list).getByText('Studio Mac')).toBeInTheDocument()
  expect(
    within(list).getByText('Added 9 October 2026 · not used yet · also on your other devices'),
  ).toBeInTheDocument()
  expect(screen.getByText('1 device')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Add another device' }))
  const form = screen.getByRole('form', { name: 'Add this device' })
  // jsdom names no device, so the plain fallback is offered for the person to change.
  const name = within(form).getByLabelText('Name this device')
  expect(name).toHaveValue('This device')
  await userEvent.clear(name)
  await userEvent.type(name, 'Front desk')
  // Two-step sign-in is off, so no code is asked for.
  expect(within(form).queryByLabelText(/Code from the app/)).toBeNull()
  await userEvent.type(within(form).getByLabelText('Your password'), 'Fictional 2026!')
  await userEvent.click(within(form).getByRole('button', { name: 'Add this device' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Front desk is set up. Next time, choose Sign in with Face ID or fingerprint on the sign-in page.',
  )
  expect(calls).toEqual([
    ['/api/auth/passkeys', undefined],
    ['/api/auth/passkeys/options', { password: 'Fictional 2026!' }],
    ['/api/auth/passkeys', { response: answer, name: 'Front desk' }],
  ])
  expect(startRegistration).toHaveBeenCalledWith({
    optionsJSON: { challenge: 'abc', rp: { id: 'localhost' } },
  })
  expect(screen.getByText('2 devices')).toBeInTheDocument()
})

test('asks for the code as well when two-step sign-in is on, and says nothing changed when the prompt is closed', async () => {
  store.session = session({ passkeys: 0, twoStep: { since: day, recoveryLeft: 10 } })
  const bodies: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/api/auth/passkeys' && !options) return { passkeys: [], here: true } as never
    if (path === '/api/auth/passkeys/options') {
      bodies.push(options?.body)
      return { challenge: 'abc' } as never
    }
    throw new Error(`Unexpected ${path}`)
  })
  vi.mocked(startRegistration).mockRejectedValue(new DOMException('closed', 'NotAllowedError'))
  await open()
  expect(screen.getByText('Off')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add this device' }))
  const form = screen.getByRole('form', { name: 'Add this device' })
  await userEvent.type(within(form).getByLabelText('Your password'), 'Fictional 2026!')
  await userEvent.type(within(form).getByLabelText(/Code from the app/), '123456')
  await userEvent.click(within(form).getByRole('button', { name: 'Add this device' }))
  expect(await screen.findByText('Nothing was changed.')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(bodies).toEqual([{ password: 'Fictional 2026!', code: '123456' }])
})

test('removes a device with the password', async () => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/api/auth/passkeys' && !options)
      return { passkeys: [mac, phone], here: true } as never
    if (path === '/api/auth/passkeys/remove') {
      const body = options?.body as { password: string }
      if (body.password !== 'Fictional 2026!') throw new ApiError('The password is incorrect.', 403)
      return { passkeys: [mac] } as never
    }
    throw new Error(`Unexpected ${path}`)
  })
  await open()
  expect(await screen.findByText(/last used 10 October 2026/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove iPhone' }))
  const form = screen.getByRole('form', { name: 'Remove iPhone' })
  await userEvent.type(within(form).getByLabelText('Your password'), 'wrong')
  await userEvent.click(within(form).getByRole('button', { name: 'Remove iPhone' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The password is incorrect.')
  await userEvent.clear(within(form).getByLabelText('Your password'))
  await userEvent.type(within(form).getByLabelText('Your password'), 'Fictional 2026!')
  await userEvent.click(within(form).getByRole('button', { name: 'Remove iPhone' }))
  expect(await screen.findByText('iPhone can no longer sign in.')).toBeInTheDocument()
  expect(vi.mocked(api)).toHaveBeenLastCalledWith('/api/auth/passkeys/remove', {
    method: 'POST',
    body: { id: 'credential-phone-02', password: 'Fictional 2026!' },
  })
})

test('says why it is not offered on an address that cannot use it', async () => {
  store.session = session({ passkeys: 0 }, false)
  await open()
  expect(
    screen.getByText(/works once SALEANE is on its own secure web address/),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
  expect(vi.mocked(api)).not.toHaveBeenCalled()
})

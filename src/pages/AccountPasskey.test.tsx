import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  sendSignal,
  startAuthentication,
} from '@simplewebauthn/browser'
import { Account } from './Account'
import { api, ApiError } from '../state/api'
import type { Session } from '../state/api'
import { PASSKEY_GONE } from '../state/passkeys'

// NEXT-15: signing in with Face ID or a fingerprint from the sign-in page.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  browserSupportsWebAuthn: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn(),
  startAuthentication: vi.fn(),
  sendSignal: vi.fn(),
}))
const store: { session: Session | null } = { session: null }
const openWorkspace = vi.fn()
vi.mock('../state/context', () => ({
  useStore: () => ({
    session: store.session,
    refreshSession: async () => store.session,
    openWorkspace,
    state: { organisation: { locale: 'en-GB' } },
    enterDemo: vi.fn(),
    logout: vi.fn(),
  }),
}))

const owner: Session = {
  user: { id: 'account-1', name: 'Amara Okafor', email: 'amara@example.invalid' },
  csrf: 'csrf',
  workspaces: [{ id: 'org-1', name: 'Linden Studio', role: 'owner' }] as Session['workspaces'],
  services: { email: false, payments: false },
  localOnly: true,
}
const prompt = { challenge: 'challenge-1', rpId: 'localhost', userVerification: 'required' }
const answer = { id: 'credential-1', rawId: 'credential-1', type: 'public-key', response: {} }
let here = true
let paths: string[]
function routes(passkey: () => Promise<unknown>) {
  vi.mocked(api).mockImplementation(async (path) => {
    paths.push(path)
    if (path === '/api/health') return { ok: true, passkeysHere: here } as never
    if (path === '/api/auth/passkey/options') return prompt as never
    if (path === '/api/auth/passkey') return (await passkey()) as never
    throw new ApiError('Sign in to continue.', 401)
  })
}
function signInPage() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
        <Route path="/today" element={<h1>Today</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  store.session = null
  here = true
  paths = []
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
  vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false)
  vi.mocked(startAuthentication).mockResolvedValue(answer as never)
  vi.mocked(sendSignal).mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

test('signs in with Face ID and opens the studio, with no email or password typed', async () => {
  routes(async () => {
    store.session = owner
    return { csrf: 'new-csrf' }
  })
  signInPage()
  const button = await screen.findByRole('button', { name: 'Sign in with Face ID or fingerprint' })
  expect(screen.getByText('or')).toBeInTheDocument()
  await userEvent.click(button)
  expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
  expect(startAuthentication).toHaveBeenCalledWith({
    optionsJSON: prompt,
    useBrowserAutofill: false,
  })
  expect(vi.mocked(api)).toHaveBeenCalledWith('/api/auth/passkey', {
    method: 'POST',
    body: { response: answer },
  })
  expect(openWorkspace).toHaveBeenCalledWith('org-1')
})

test('a closed prompt changes nothing, and a removed passkey says so and is forgotten', async () => {
  routes(async () => {
    throw new ApiError(PASSKEY_GONE, 401)
  })
  vi.mocked(startAuthentication).mockRejectedValueOnce(
    new DOMException('closed', 'NotAllowedError'),
  )
  signInPage()
  const button = await screen.findByRole('button', { name: 'Sign in with Face ID or fingerprint' })
  await userEvent.click(button)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(paths).not.toContain('/api/auth/passkey')
  await userEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent(PASSKEY_GONE)
  // The device is told SALEANE no longer knows this passkey, so it stops offering it.
  expect(sendSignal).toHaveBeenCalledWith({
    signalName: 'unknownCredential',
    rpID: 'localhost',
    credentialID: 'credential-1',
  })
})

test('offers a saved passkey under the email field where the browser can', async () => {
  vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(true)
  // The browser waits for the person to pick it.
  vi.mocked(startAuthentication).mockReturnValue(new Promise(() => undefined))
  routes(async () => ({ csrf: 'new-csrf' }))
  signInPage()
  await screen.findByRole('button', { name: 'Sign in with Face ID or fingerprint' })
  await vi.waitFor(() =>
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: prompt,
      useBrowserAutofill: true,
    }),
  )
  expect(screen.getByLabelText(/Email/)).toHaveAttribute('autocomplete', 'email webauthn')
})

test('is not offered where the address or the browser cannot use it', async () => {
  here = false
  routes(async () => ({ csrf: 'new-csrf' }))
  const { unmount } = signInPage()
  await vi.waitFor(() => expect(paths).toContain('/api/health'))
  expect(screen.queryByRole('button', { name: /Face ID/ })).toBeNull()
  expect(screen.getByLabelText(/Email/)).toHaveAttribute('autocomplete', 'email')
  unmount()
  here = true
  paths = []
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(false)
  signInPage()
  await screen.findByRole('button', { name: 'Sign in' })
  expect(paths).not.toContain('/api/health')
  expect(screen.queryByRole('button', { name: /Face ID/ })).toBeNull()
})

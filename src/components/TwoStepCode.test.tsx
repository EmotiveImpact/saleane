import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { TwoStepCode } from './TwoStepCode'
import { api, ApiError } from '../state/api'

// NEXT-04: the second step of signing in, after the password was right.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
  setCsrf: vi.fn(),
}))
afterEach(() => {
  vi.resetAllMocks()
})

test('signs in with the code from the app', async () => {
  const user = userEvent.setup()
  const onSignedIn = vi.fn()
  vi.mocked(api).mockResolvedValue({ csrf: 'fresh' } as never)
  render(<TwoStepCode challenge="ch-1" onSignedIn={onSignedIn} onRestart={vi.fn()} />)
  const field = screen.getByLabelText(/code from your authenticator app/i)
  expect(field).toHaveFocus()
  expect(field).toHaveAttribute('autocomplete', 'one-time-code')
  await user.type(field, '123 456')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  expect(api).toHaveBeenCalledWith('/api/auth/login/code', {
    method: 'POST',
    body: { challenge: 'ch-1', code: '123 456' },
  })
  expect(onSignedIn).toHaveBeenCalledWith({ csrf: 'fresh' })
})

test('a wrong code says so and empties the field; a dead sign-in starts again', async () => {
  const user = userEvent.setup()
  const onRestart = vi.fn()
  vi.mocked(api).mockRejectedValueOnce(new ApiError('That code is not right.', 400))
  render(<TwoStepCode challenge="ch-1" onSignedIn={vi.fn()} onRestart={onRestart} />)
  const field = screen.getByLabelText(/code from your authenticator app/i)
  await user.type(field, '111111')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  expect(await screen.findByText('That code is not right.')).toBeInTheDocument()
  expect(field).toHaveValue('')
  expect(onRestart).not.toHaveBeenCalled()

  vi.mocked(api).mockRejectedValueOnce(new ApiError('This sign-in has timed out.', 410))
  await user.type(field, '222222')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  expect(onRestart).toHaveBeenCalledWith('This sign-in has timed out.')
})

test('a lost phone switches to a recovery code field and back', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({ csrf: 'fresh', recoveryLeft: 9 } as never)
  const onSignedIn = vi.fn()
  render(<TwoStepCode challenge="ch-2" onSignedIn={onSignedIn} onRestart={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /lost your phone/i }))
  const field = screen.getByLabelText(/^recovery code/i)
  expect(field).toHaveFocus()
  expect(field).not.toHaveAttribute('inputmode')
  await user.type(field, 'abcde-fghjk')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  expect(onSignedIn).toHaveBeenCalledWith({ csrf: 'fresh', recoveryLeft: 9 })
  await user.click(screen.getByRole('button', { name: /code from the app instead/i }))
  expect(screen.getByLabelText(/code from your authenticator app/i)).toHaveValue('')
})

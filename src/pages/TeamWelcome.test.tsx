import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TeamWelcome } from './TeamWelcome'
import { api } from '../state/api'

// Three short screens for someone who has just joined, before their studio opens.
vi.mock('../state/context', () => ({
  useStore: () => ({
    session: { user: { id: 'account-3', name: 'Sam Okoro', twoStep: null } },
    state: { organisation: { locale: 'en-GB' } },
  }),
}))

vi.mock('../state/api', () => ({ api: vi.fn() }))

function welcome(role: 'general' | 'manager', onOpen = vi.fn(), required = false) {
  render(
    <TeamWelcome
      required={required}
      studio="Fernleaf Rooms"
      role={role}
      place={role === 'general' ? 'Frome' : undefined}
      name="Sam Okoro"
      pending={false}
      error=""
      onOpen={onOpen}
    />,
  )
  return onOpen
}

test('a general manager is welcomed to the location they run, and can go back', async () => {
  welcome('general')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Fernleaf Rooms')
  expect(screen.getByText(/You have joined as a general manager at Frome\./)).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Your welcome' })).toHaveTextContent('Running Frome')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Running Frome')
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(screen.getByText('Requests')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Fernleaf Rooms')
})

test('a manager is told where to turn on two-step sign-in later, and can skip at any point', async () => {
  const onOpen = welcome('manager')
  expect(screen.getByText(/You have joined as a manager\./)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    screen.getByText(
      'You can also turn it on later in Settings, under Team, or on your account page.',
    ),
  ).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Skip the welcome' }))
  expect(onOpen).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: /Open the studio/ }))
  expect(onOpen).toHaveBeenCalledTimes(2)
})

test('keeps one main button on the sign-in screen, stepping back while two-step is set up', async () => {
  vi.mocked(api).mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/SALEANE:sam?secret=JBSWY3DPEHPK3PXP&issuer=SALEANE',
  } as never)
  welcome('manager')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  const main = () => screen.getByRole('button', { name: /Open the studio/ })
  const primaries = () => document.querySelectorAll('.button-primary')
  expect(primaries()).toHaveLength(1)
  expect(main()).toHaveClass('button-primary')
  expect(screen.getByRole('button', { name: 'Set up two-step sign-in' })).toHaveClass(
    'button-secondary',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))
  const turnOn = await screen.findByRole('button', { name: 'Turn on two-step sign-in' })
  expect(turnOn).toHaveClass('button-primary')
  expect(main()).toHaveClass('button-secondary')
  expect(primaries()).toHaveLength(1)
  // Going back and returning starts the screen afresh, with the footer as the way forward.
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(main()).toHaveClass('button-primary')
})

test('says two-step sign-in is needed when the studio asks everyone, and makes it the main job', async () => {
  vi.mocked(api).mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/SALEANE:sam?secret=JBSWY3DPEHPK3PXP&issuer=SALEANE',
  } as never)
  welcome('manager', vi.fn(), true)
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    screen.getByText(/Fernleaf Rooms asks everyone to use two-step sign-in, so set it up now/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/turn it on later/)).not.toBeInTheDocument()
  expect(document.querySelectorAll('.button-primary')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Set up two-step sign-in' })).toHaveClass(
    'button-primary',
  )
  expect(screen.getByRole('button', { name: /Open the studio/ })).toHaveClass('button-secondary')
})

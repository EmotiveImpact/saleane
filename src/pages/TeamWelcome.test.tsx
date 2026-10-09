import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TeamWelcome } from './TeamWelcome'

// Three short screens for someone who has just joined, before their studio opens.
vi.mock('../state/context', () => ({
  useStore: () => ({
    session: { user: { id: 'account-3', name: 'Sam Okoro', twoStep: null } },
    state: { organisation: { locale: 'en-GB' } },
  }),
}))

function welcome(role: 'general' | 'manager', onOpen = vi.fn()) {
  render(
    <TeamWelcome
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
    screen.getByText('You can also turn it on later in Settings, under Team.'),
  ).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Skip the welcome' }))
  expect(onOpen).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: /Open the studio/ }))
  expect(onOpen).toHaveBeenCalledTimes(2)
})

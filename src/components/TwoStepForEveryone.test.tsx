import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { TwoStepForEveryone } from './TwoStepForEveryone'

// Stage 6: the owner's switch on Settings, Team, and who has two-step sign-in on.
const commit = vi.fn()
let store: Record<string, unknown>
vi.mock('../state/context', () => ({ useStore: () => store }))
const studio = (forEveryone?: boolean) => ({
  organisation: { name: 'Fernleaf Rooms' },
  operations: forEveryone === undefined ? {} : { twoStep: { forEveryone } },
})
const team = [
  { name: 'Ada Owner', twoStep: true },
  { name: 'Maya Lind', twoStep: false },
  { name: 'Theo Hart', twoStep: false },
]
beforeEach(() => {
  commit.mockReset()
  commit.mockResolvedValue({ ok: true })
  store = {
    state: studio(),
    session: { user: { twoStep: { since: 1, recoveryLeft: 10 } } },
    commit,
    saving: false,
  }
})

test('says who has it on and who has not yet, and asks everyone with one button', async () => {
  render(<TwoStepForEveryone members={team} />)
  expect(
    screen.getByText('1 of 3 people have it on. Not yet: Maya Lind and Theo Hart.'),
  ).toBeVisible()
  expect(screen.getByText('Off')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Ask everyone to use it' }))
  expect(commit).toHaveBeenCalledWith({ type: 'two-step-rule', forEveryone: true })
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Everyone without two-step sign-in will be asked to set it up the next time they open the studio.',
  )
})

test('waits for the owner to use it themselves first', () => {
  store = { ...store, session: { user: { twoStep: null } } }
  render(<TwoStepForEveryone members={team} />)
  expect(screen.getByText('Turn on two-step sign-in for yourself first, just above.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Ask everyone to use it' })).toBeDisabled()
})

test('stops asking, and shows the server’s refusal in its own words', async () => {
  store = { ...store, state: studio(true) }
  commit.mockResolvedValueOnce({ ok: false, error: 'Someone else saved a change just now.' })
  render(<TwoStepForEveryone members={team.map((m) => ({ ...m, twoStep: true }))} />)
  expect(screen.getByText('Everyone in Fernleaf Rooms has two-step sign-in on.')).toBeVisible()
  expect(screen.getByText('On')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Stop asking everyone' }))
  expect(commit).toHaveBeenCalledWith({ type: 'two-step-rule', forEveryone: false })
  expect(await screen.findByText('Someone else saved a change just now.')).toBeVisible()
})

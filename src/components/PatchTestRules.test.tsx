import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { PatchTestRules } from './PatchTests'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { seed } from '../domain/seed'

// Stage 3: the setting in Settings, Treatments, Patch tests.
type Shown = {
  state: BusinessState
  role: Role
  blocked: boolean
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
const commit = vi.fn<(command: Command) => Promise<CommandResult>>()
afterEach(() => vi.resetAllMocks())
const LABEL = 'Stop online booking when a patch test is missing or out of date'

function show(role: Role) {
  const state = seed('UK')
  store = { state, role, blocked: false, commit }
  commit.mockResolvedValue({ ok: true, state, recordId: state.organisation.id })
  render(<PatchTestRules />)
}

test('is off by default and says what changes for guests', async () => {
  const user = userEvent.setup()
  show('manager')
  const box = screen.getByRole('checkbox', { name: LABEL })
  expect(box).not.toBeChecked()
  expect(box).toHaveAccessibleDescription(
    /Guests booking online are never matched to your client records, so with this on nobody can book Gloss & Tone online: on your booking page, through the AI receptionist or on Google\. Every guest reads the same words/,
  )
  expect(screen.getByLabelText('The patch test guests can book online')).toHaveValue(
    'service-patch-test',
  )
  await user.click(box)
  await user.click(screen.getByRole('button', { name: 'Save patch test rules' }))
  expect(commit).toHaveBeenCalledWith({
    type: 'patch-test-settings',
    settings: {
      hoursBefore: 48,
      validMonths: 6,
      remind: true,
      stopOnline: true,
      testServiceId: 'service-patch-test',
    },
  })
  expect(await screen.findByText('Saved.')).toBeInTheDocument()
})

test('offers only treatments that need no test as the patch test, or none', async () => {
  const user = userEvent.setup()
  show('owner')
  const choice = screen.getByLabelText('The patch test guests can book online')
  const offered = [...(choice as HTMLSelectElement).options].map((o) => o.textContent)
  expect(offered).toContain('None: guests call or email you to arrange one')
  expect(offered).not.toContain('Gloss & Tone')
  await user.selectOptions(choice, '')
  await user.click(screen.getByRole('button', { name: 'Save patch test rules' }))
  expect(commit.mock.calls[0][0]).toEqual({
    type: 'patch-test-settings',
    settings: { hoursBefore: 48, validMonths: 6, remind: true, stopOnline: false },
  })
})

test('reception sees the rules but cannot change them', () => {
  show('reception')
  expect(screen.getByRole('checkbox', { name: LABEL })).toBeDisabled()
  expect(screen.getByLabelText('The patch test guests can book online')).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save patch test rules' })).not.toBeInTheDocument()
})

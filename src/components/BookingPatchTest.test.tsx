import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BookingDialog } from './BookingDialog'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { seed } from '../domain/seed'

// Stage 3: the desk is never stopped. Its booking dialog says where the client stands for a
// treatment that needs a patch test, when online booking would have stopped the visit, and offers
// the patch test first.
type Shown = {
  state: BusinessState
  today: string
  role: Role
  blocked: boolean
  saving: boolean
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
const commit = vi.fn<(command: Command) => Promise<CommandResult>>()
afterEach(() => vi.resetAllMocks())

function studio(stopOnline: boolean) {
  const s = seed('UK')
  s.operations!.patchTests = { ...s.operations!.patchTests!, stopOnline }
  return s
}
function show(state: BusinessState, clientId: string) {
  store = { state, today: '2026-10-06', role: 'reception', blocked: false, saving: false, commit }
  commit.mockResolvedValue({ ok: true, state, recordId: 'visit-new' })
  return render(
    <MemoryRouter>
      <BookingDialog
        onClose={() => {}}
        defaults={{ clientId, serviceId: 'service-gloss', date: '2026-10-08' }}
      />
    </MemoryRouter>,
  )
}
const STOPPED =
  'Online booking would have stopped this visit, as the studio asks for a clear patch test first. You can still book it here.'

test('says plainly when online booking would have stopped the visit, and still books it', async () => {
  const user = userEvent.setup()
  show(studio(true), 'client-9')
  const dialog = screen.getByRole('dialog')
  const note = within(dialog).getByRole('note')
  expect(note).toHaveTextContent('Needs a patch test at least 48 hours before')
  expect(note).toHaveTextContent(STOPPED)
  // The desk is never stopped.
  await user.click(within(dialog).getByRole('radio', { name: '14:00' }))
  const confirm = within(dialog).getByRole('button', { name: 'Confirm demo booking' })
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  expect(commit).toHaveBeenCalledWith({
    type: 'book',
    input: expect.objectContaining({
      clientId: 'client-9',
      serviceId: 'service-gloss',
      source: 'desk',
    }),
  })
})

test('books the patch test first in one tap', async () => {
  const user = userEvent.setup()
  show(studio(true), 'client-9')
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Book the patch test first' }))
  expect(within(dialog).getByLabelText('Treatment')).toHaveValue('service-patch-test')
  expect(within(dialog).getByLabelText('Professional')).toHaveValue('staff-theo')
  expect(within(dialog).queryByRole('note')).not.toBeInTheDocument()
})

test('shows a clear test plainly, with nothing stopped and nothing to book first', () => {
  show(studio(true), 'client-3')
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/^Patch test clear on/)).toBeInTheDocument()
  expect(within(dialog).queryByText(STOPPED)).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'Book the patch test first' }),
  ).not.toBeInTheDocument()
})

test('without the rule, the desk keeps today’s warning and the quick way to the patch test', () => {
  show(studio(false), 'client-9')
  const note = within(screen.getByRole('dialog')).getByRole('note')
  expect(note).toHaveTextContent('Needs a patch test at least 48 hours before')
  expect(note).not.toHaveTextContent(STOPPED)
  expect(within(note).getByRole('button', { name: 'Book the patch test first' })).toBeEnabled()
})

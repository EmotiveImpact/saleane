import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { HelpPanel } from './HelpPanel'
import { api } from '../state/api'
import type { Role } from '../domain/operations'
import type { SupportAnswer } from '../domain/help'

// NEXT-06: Help, from anywhere in SALEANE.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const mocked = vi.mocked(api)
const at = Date.parse('2026-10-09T10:00:00.000Z')
const answer = (extra: Partial<SupportAnswer> = {}): SupportAnswer => ({
  requests: [],
  email: 'ada@example.com',
  delivery: 'test',
  ...extra,
})
beforeEach(() => mocked.mockReset())

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}
function open(
  at: string,
  role: Role | null = 'owner',
  extra: Partial<Parameters<typeof HelpPanel>[0]> = {},
) {
  const onClose = vi.fn()
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <HelpPanel open onClose={onClose} role={role} signedIn={false} {...extra} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Help' }) }
}

test('offers the guides for the screen first, and only those the person can use', () => {
  const { dialog } = open('/settings?section=billing')
  const here = within(dialog).getByRole('list', { name: 'On this screen' })
  expect(
    within(here)
      .getAllByRole('button')
      .map((b) => b.querySelector('strong')?.textContent),
  ).toEqual(['Your SALEANE plan and bills', 'If a SALEANE payment fails'])
  // The rest are grouped, without repeating what is on this screen.
  const money = within(dialog).getByRole('list', { name: 'Money' })
  expect(within(money).queryByText('Your SALEANE plan and bills')).not.toBeInTheDocument()
  expect(within(money).getByText('Refund a payment')).toBeInTheDocument()
})

test('keeps guides from people who cannot do them', () => {
  const { dialog } = open('/business/money', 'reception')
  expect(within(dialog).getByRole('list', { name: 'On this screen' })).toHaveTextContent(
    'Count the till at the end of the day',
  )
  expect(within(dialog).queryByText('Refund a payment')).not.toBeInTheDocument()
  expect(within(dialog).queryByText('Your SALEANE plan and bills')).not.toBeInTheDocument()
})

test('finds a guide in everyday words, reads it, and goes there', async () => {
  const user = userEvent.setup()
  const { dialog, onClose } = open('/today')
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search help' }), 'reschedule')
  await user.click(within(dialog).getByRole('button', { name: /Move a visit/ }))
  const guide = screen.getByRole('dialog', { name: 'Move a visit' })
  expect(within(guide).getByRole('list')).toHaveTextContent('Choose Save visit.')
  expect(guide).toHaveTextContent('No message is sent to the client')
  await user.click(within(guide).getByRole('button', { name: 'Go there' }))
  expect(onClose).toHaveBeenCalled()
  expect(screen.getByTestId('where')).toHaveTextContent('/calendar')
})

test('a regional manager reads their guides with no way into the studio screens they cannot open', async () => {
  const user = userEvent.setup()
  const { dialog } = open('/area/org-1', 'regional')
  const here = within(dialog).getByRole('list', { name: 'On this screen' })
  await user.click(within(here).getByRole('button', { name: /Do a branch visit/ }))
  const guide = screen.getByRole('dialog', { name: 'Do a branch visit' })
  expect(guide).toHaveTextContent('On your area page, choose Start a branch visit.')
  expect(within(guide).queryByRole('button', { name: 'Go there' })).toBeNull()
})

test('says when nothing matches, and points to Ask SALEANE and the team', async () => {
  const user = userEvent.setup()
  const onAsk = vi.fn()
  const { dialog, onClose } = open('/today', 'owner', { onAsk })
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search help' }), 'rocket')
  expect(within(dialog).getByRole('status')).toHaveTextContent('No guide matches that.')
  await user.click(within(dialog).getByRole('button', { name: 'Ask SALEANE' }))
  expect(onClose).toHaveBeenCalled()
  expect(onAsk).toHaveBeenCalled()
})

test('the browser demo cannot write to the team', () => {
  const { dialog } = open('/today')
  expect(within(dialog).getByText(/The browser demo cannot send anything/)).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Send to the SALEANE team' })).toBeNull()
  expect(mocked).not.toHaveBeenCalled()
})

test('writes to the team with the screen, and says plainly it was only kept in test mode', async () => {
  const user = userEvent.setup()
  mocked.mockResolvedValueOnce(answer())
  const { dialog } = open('/settings?section=billing', 'owner', {
    signedIn: true,
    workspaceId: 'org-1',
  })
  expect(await within(dialog).findByText(/Email is in test mode on this server/)).toHaveTextContent(
    'Replies would go to ada@example.com.',
  )
  const send = within(dialog).getByRole('button', { name: 'Send to the SALEANE team' })
  expect(send).toBeDisabled()
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'About' }), 'billing')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'What do you need?' }),
    'Can I pay for a year at once?',
  )
  mocked.mockResolvedValueOnce(
    answer({
      id: 'r1',
      requests: [
        {
          id: 'r1',
          topic: 'billing',
          message: 'Can I pay for a year at once?',
          page: '/settings?section=billing',
          studio: 'Linden Studio',
          status: 'test',
          createdAt: at,
        },
      ],
    }),
  )
  await user.click(send)
  expect(mocked).toHaveBeenLastCalledWith('/api/support', {
    method: 'POST',
    body: {
      topic: 'billing',
      message: 'Can I pay for a year at once?',
      page: '/settings?section=billing',
      workspaceId: 'org-1',
    },
  })
  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    'Saved. Email is in test mode, so it has not been sent to anyone yet.',
  )
  const written = within(dialog).getByText('What you have written').parentElement!
  expect(written).toHaveTextContent('My SALEANE plan or a bill')
  expect(written).toHaveTextContent(
    '9 October 2026, Linden Studio. Not sent: email is in test mode.',
  )
  expect(within(dialog).getByRole('textbox', { name: 'What do you need?' })).toHaveValue('')
})

test('says a request was emailed, and promises no reply', async () => {
  const user = userEvent.setup()
  mocked.mockResolvedValueOnce(answer({ delivery: 'email' }))
  const { dialog } = open('/today', 'owner', { signedIn: true })
  expect(
    await within(dialog).findByText(/It is emailed to the SALEANE team. Any reply goes to/),
  ).toHaveTextContent('ada@example.com')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'What do you need?' }),
    'Can I pay for a year at once?',
  )
  mocked.mockResolvedValueOnce(
    answer({
      delivery: 'email',
      id: 'r3',
      requests: [
        {
          id: 'r3',
          topic: 'using',
          message: 'Can I pay for a year at once?',
          page: '/today',
          studio: null,
          status: 'accepted',
          createdAt: at,
        },
      ],
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'Send to the SALEANE team' }))
  const said = await within(dialog).findByRole('status')
  expect(said).toHaveTextContent('Sent to the SALEANE team by email.')
  expect(said).not.toHaveTextContent(/will reply/)
})

test('never says a request was sent when the email service failed', async () => {
  const user = userEvent.setup()
  mocked.mockResolvedValueOnce(answer({ delivery: 'email' }))
  const { dialog } = open('/today', 'owner', { signedIn: true })
  await within(dialog).findByText(/It is emailed to the SALEANE team/)
  await user.type(
    within(dialog).getByRole('textbox', { name: 'What do you need?' }),
    'The calendar will not open.',
  )
  mocked.mockResolvedValueOnce(
    answer({
      delivery: 'email',
      id: 'r2',
      requests: [
        {
          id: 'r2',
          topic: 'using',
          message: 'The calendar will not open.',
          page: '/today',
          studio: null,
          status: 'failed',
          createdAt: at,
        },
      ],
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'Send to the SALEANE team' }))
  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    'Saved, but the email could not be sent. It is kept here.',
  )
  expect(dialog).toHaveTextContent('Could not be sent.')
})

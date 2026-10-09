import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import { DEMO_DATE } from '../domain/model'
import { storageKey } from '../state/storage'

// Stage 1: what the team sees after a client texts STOP to the studio's line.
function stoppedStudio() {
  const result = dispatch(
    seed('UK'),
    {
      type: 'reply-received',
      channel: 'sms',
      from: '+447700900003',
      body: 'STOP',
      providerRef: 'SM-stop',
    },
    'Text line',
    `${DEMO_DATE}T08:00:00.000Z`,
  )
  if (!result.ok) throw new Error(result.error)
  localStorage.setItem(storageKey('UK'), JSON.stringify(result.state))
}
function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
// Pages open on demand, which can take a few seconds while the whole suite runs.
const WAIT = { timeout: 10000 }
const stored = () => JSON.parse(localStorage.getItem(storageKey('UK'))!)

describe('after a STOP by text', { timeout: 20000 }, () => {
  it('says so on the client page, and warns before the desk turns texts back on', async () => {
    stoppedStudio()
    const user = userEvent.setup()
    show('/clients/client-3')
    expect(
      await screen.findByText('Texts are off. Ellie replied STOP on 6 October.', {}, WAIT),
    ).toBeInTheDocument()
    const texts = screen.getByRole('checkbox', { name: 'Visit texts' })
    expect(texts).not.toBeChecked()
    await user.click(texts)
    // Nothing changes until the team says Ellie asked.
    const warning = screen.getByRole('group', { name: 'Turn texts back on' })
    expect(warning).toHaveTextContent('Only if Ellie asked you to.')
    expect(warning).toHaveTextContent('keeps blocking the studio’s texts until they text START')
    expect(stored().clients.find((c: { id: string }) => c.id === 'client-3').noTextReminders).toBe(
      true,
    )
    await user.click(within(warning).getByRole('button', { name: 'Keep texts off' }))
    expect(screen.queryByRole('group', { name: 'Turn texts back on' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Visit texts' })).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'Visit texts' }))
    await user.click(screen.getByRole('button', { name: 'Ellie asked, turn texts on' }))
    expect(
      await screen.findByText('Ellie’s number replied STOP on 6 October.', {}, WAIT),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Visit texts' })).toBeChecked()
    const ellie = stored().clients.find((c: { id: string }) => c.id === 'client-3')
    expect(ellie.noTextReminders).toBeUndefined()
    expect(stored().events.at(-1)).toMatchObject({ title: 'Visit messages updated' })
  })

  it('labels the reply in the Inbox and offers no text to answer it', async () => {
    stoppedStudio()
    const user = userEvent.setup()
    show('/inbox')
    await user.click(await screen.findByRole('button', { name: /Ellie Brooks/ }, WAIT))
    const thread = screen.getByRole('list', { name: 'Conversation with Ellie Brooks' })
    expect(within(thread).getByText('Turned texts off')).toBeInTheDocument()
    expect(
      within(thread).getByText(
        'SALEANE will not text this number until they text START. No answer is needed.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Reply by')).toHaveValue('email')
    expect(screen.getByRole('option', { name: 'Text (texts are off)' })).toBeDisabled()
  })
})

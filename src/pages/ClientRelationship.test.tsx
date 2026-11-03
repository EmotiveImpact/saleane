import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

// "At a glance" in the fictional demo, on 6 October 2026. Each test drives the whole app.
describe('At a glance on the client page', { timeout: 20000 }, () => {
  it('sits above the timeline and saves an invitation for a drifting client as an unsent draft', async () => {
    const user = userEvent.setup()
    show('/clients/client-13')
    const glance = await screen.findByRole('region', { name: 'At a glance' }, { timeout: 8000 })
    const timeline = screen.getByRole('heading', { name: 'The relationship timeline' })
    expect(glance.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The heading already says how often they come, so the section does not repeat it.
    expect(within(glance).queryByText(/Usually every/)).not.toBeInTheDocument()

    const step = within(glance).getByRole('group', { name: 'Invite them back' })
    expect(
      within(step).getByText(
        '7 weeks since their last visit, against their usual 4, and nothing booked.',
      ),
    ).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Invite them back' }))
    await user.click(within(step).getByRole('button', { name: 'Save as unsent draft' }))
    expect(await within(step).findByRole('status')).toHaveTextContent(
      'Invitation saved in the Inbox, unsent.',
    )
    const saved = JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)
    expect(saved.operations.messages.at(-1)).toMatchObject({
      clientId: 'client-13',
      purpose: 'marketing',
      status: 'draft',
      subject: 'We would love to see you, Charlotte',
    })
  })

  it('leads to the patch tests when one is not in order for the next visit', async () => {
    const user = userEvent.setup()
    show('/clients/client-6')
    const glance = await screen.findByRole('region', { name: 'At a glance' }, { timeout: 8000 })
    const step = within(glance).getByRole('group', { name: 'Patch test before Fri 9 Oct' })
    expect(within(step).getByText(/result not recorded yet/)).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Go to patch tests' }))
    expect(screen.getByRole('region', { name: 'Patch tests' })).toHaveFocus()
  })
})

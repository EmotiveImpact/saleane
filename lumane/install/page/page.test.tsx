import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CALEANE, TALLY } from '../examples'
import { InstallPage } from './InstallPage'
import { pathwayFor } from './preview'

function show() {
  render(<InstallPage apps={[CALEANE, TALLY]} pause={0} />)
  return userEvent.setup()
}
const preview = (name: string) => screen.getByRole('region', { name })

describe('the install page', () => {
  it('opens on the recommended answers, with a live preview of Ask in the app’s own colours', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Set up LUMANE in Caleane' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ask Caleane/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const panel = preview('Ask Caleane')
    expect(panel.style.getPropertyValue('--lumane-accent')).toBe('#3949AB')
    // Each chosen pathway offers its example; the one not chosen does not.
    expect(within(panel).getByRole('button', { name: 'What’s on tomorrow?' })).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'Remind everyone invited to the design review' }),
    ).toBeNull()
    expect(
      within(panel).getByText('3 of 300 questions used this month. 0 of 30 talking minutes used.'),
    ).toBeInTheDocument()
  })

  it('follows each choice in the preview', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: /^Ask Cal\b(?!eane)/ }))
    expect(preview('Ask Cal')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Look up events/ }))
    expect(
      within(preview('Ask Cal')).queryByRole('button', { name: 'What’s on tomorrow?' }),
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: /^More/ }))
    expect(
      within(preview('Ask Cal')).getByText(
        '3 of 1,000 questions used this month. 0 of 120 talking minutes used.',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /LUMANE’s default look/ }))
    await user.click(
      within(screen.getByRole('group', { name: 'Light or dark' })).getByRole('button', {
        name: 'Dark',
      }),
    )
    expect(preview('Ask Cal')).toHaveAttribute('data-lumane-look', 'dark')
    await user.click(screen.getByRole('button', { name: /Plain parts only/ }))
    expect(preview('Ask Cal')).not.toHaveAttribute('data-lumane-look')
  })

  it('answers an example, and waits for approval before calling a change done', async () => {
    const user = show()
    const panel = preview('Ask Caleane')
    await user.click(
      within(panel).getByRole('button', { name: 'Move the design review to Friday at 2pm' }),
    )
    expect(await within(panel).findByText('Waiting for your approval')).toBeInTheDocument()
    expect(within(panel).getByText('Fri 9 Oct, 14:00 to 15:00')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(await within(panel).findByText('Done. In the app, this is saved now.')).toBeVisible()
    expect(
      within(panel).getByText('4 of 300 questions used this month. 0 of 30 talking minutes used.'),
    ).toBeInTheDocument()
  })

  it('writes the real pack, checks it, and hands the answers to the coding agent', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: 'Write the pack' }))
    const written = screen.getByRole('status')
    expect(within(written).getByText('Wrote the pack: src/lumane.pack.ts')).toBeInTheDocument()
    expect(within(written).getByText('Checked it: no problems found.')).toBeInTheDocument()
    expect(written.querySelector('pre')?.textContent).toContain("name: 'Caleane'")
    expect(written.querySelector('.install-handover')?.textContent).toBe(
      [
        '/lumane:install',
        'LUMANE answers',
        'Name: Caleane',
        'Tone: warm',
        'Pathways: look_up_events, find_free_times, prepare_event, prepare_move',
        'Allowances: 300 typed questions, 30 talking minutes',
        'Look: own',
      ].join('\n'),
    )
    // It never claims the pull request was opened: the coding agent does that.
    expect(written).not.toHaveTextContent(/Opened a pull request/)
    await user.click(screen.getByRole('button', { name: 'Change something' }))
    expect(screen.getByRole('button', { name: 'Write the pack' })).toBeEnabled()
  })

  it('hands over the default look’s four choices as previewed', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: /LUMANE’s default look/ }))
    await user.click(
      within(screen.getByRole('group', { name: 'Light or dark' })).getByRole('button', {
        name: 'Dark',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Write the pack' }))
    expect(screen.getByRole('status').querySelector('.install-handover')?.textContent).toContain(
      "Look: default (colour #3949AB; font 'Figtree Variable', 'Figtree', system-ui, sans-serif; corners soft; scheme dark)",
    )
  })

  it('stops a pack that is not ready before anything is written', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: 'Type your own' }))
    const name = screen.getByLabelText('The name after “Ask”')
    await user.clear(name)
    await user.type(name, 'Ask Caleane')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The name goes without “Ask”: LUMANE adds it, so this would be “Ask Ask Caleane”.',
    )
    expect(screen.getByRole('button', { name: 'Write the pack' })).toBeDisabled()
    for (const pathway of [
      'Look up events',
      'Find free times',
      'Prepare a new event',
      'Prepare a move',
    ])
      await user.click(screen.getByRole('button', { name: new RegExp(`^${pathway}`) }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one pathway.')
  })

  it('offers an app with no design of its own the default look', async () => {
    const user = show()
    await user.click(
      within(screen.getByRole('group', { name: 'Try it with' })).getByRole('button', {
        name: 'Tally',
      }),
    )
    expect(screen.queryByRole('button', { name: /Tally’s own design/ })).toBeNull()
    expect(screen.getByRole('button', { name: /LUMANE’s default look/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(preview('Ask Tally')).toHaveAttribute('data-lumane-look', 'light')
  })

  it('matches a question to the pathway it is most like', () => {
    const chosen = CALEANE.pathways
    expect(pathwayFor('what is on tomorrow', chosen)?.name).toBe('look_up_events')
    expect(pathwayFor('Could you move the design review?', chosen)?.name).toBe('prepare_move')
    expect(pathwayFor('Tell me a joke', chosen)).toBeNull()
  })
})

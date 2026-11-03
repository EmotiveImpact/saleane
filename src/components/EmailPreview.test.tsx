import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailLook, SentEmail } from './EmailPreview'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// NEXT-13: an email as a guest sees it, in Settings before any guest gets one, and in Sent.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const state = { ...sample, operations: { ...sample.operations!, mode: 'local' as const } }
let role = 'owner'
vi.mock('../state/context', () => ({
  useStore: () => ({
    state,
    mode: 'server',
    session: { workspaces: [{ slug: 'atelier', id: state.organisation.id }] },
    role,
    blocked: false,
  }),
}))
const mocked = vi.mocked(api)
const page = (words: string) =>
  `<!DOCTYPE html><html lang="en-GB"><head><title>${words}</title></head><body><p>${words}</p><a href="https://example.com/book">Book a visit</a></body></html>`

beforeEach(() => {
  role = 'owner'
  mocked.mockReset()
  mocked.mockImplementation(async (path: string) => {
    const kind = new URL(path, 'http://x').searchParams.get('kind')
    if (kind) return { subject: `Sample ${kind}`, html: page(`The ${kind} email`) }
    if (path.endsWith('/email')) return { subject: 'Your visit is booked', html: page('Booked') }
    throw new Error(`Unexpected ${path}`)
  })
})

describe('email previews', () => {
  it('shows each sample in a frame that runs nothing and opens links in a new tab', async () => {
    const user = userEvent.setup()
    render(<EmailLook />)
    expect(screen.getByRole('heading', { name: 'How your emails look' })).toBeInTheDocument()
    const frame = await screen.findByTitle('The booking confirmation email, as a guest sees it')
    expect(mocked).toHaveBeenCalledWith(
      `/api/workspaces/${state.organisation.id}/outbox/sample?kind=confirmation`,
    )
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    )
    expect(frame.getAttribute('srcdoc')).toContain('<head><base target="_blank"><title>')
    const choices = screen.getByRole('radiogroup', { name: 'Which email' })
    expect(
      within(choices)
        .getAllByRole('radio')
        .map((item) => item.textContent),
    ).toEqual(['Booking confirmation', 'Reminder', 'After the visit'])
    // The birthday email is a Marketing automatic message, so it is shown there, not here.
    await user.click(within(choices).getByRole('radio', { name: 'After the visit' }))
    expect(
      await screen.findByTitle('The after the visit email, as a guest sees it'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Written for a made-up guest, Alex/)).toBeInTheDocument()
  })

  it('is not offered to a practitioner, who has no Sent list either', () => {
    role = 'practitioner'
    const { container } = render(<EmailLook />)
    expect(container).toBeEmptyDOMElement()
    expect(mocked).not.toHaveBeenCalled()
  })

  it('opens a sent email as the guest saw it', async () => {
    const user = userEvent.setup()
    render(<SentEmail id="row-1" />)
    expect(mocked).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'See the email' }))
    const dialog = await screen.findByRole('dialog', { name: 'Your visit is booked' })
    expect(mocked).toHaveBeenCalledWith(
      `/api/workspaces/${state.organisation.id}/outbox/row-1/email`,
    )
    expect(
      within(dialog).getByTitle('The email, Your visit is booked, as the guest sees it'),
    ).toBeInTheDocument()
  })
})

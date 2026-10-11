import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { DiaryLinks } from './DiaryLinks'
import type { DiaryLinkView, DiaryListing } from './DiaryLinks'
import { api } from '../state/api'
import { choicesIn } from '../test/choices'

// NEXT-10: a private link to a diary of visits for Google or Apple Calendar.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  vi.resetAllMocks()
})
const base = '/api/workspaces/org-1/diary-links'
const listing = (extra: Partial<DiaryListing> = {}): DiaryListing => ({
  links: [],
  sample: false,
  locale: 'en-GB',
  timeZone: 'Europe/London',
  daysAhead: 182,
  choices: {
    own: { staffId: 'staff-maya', name: 'Maya Lewis' },
    people: [{ id: 'staff-sophia', name: 'Sophia Reed' }],
    locations: [],
    studio: true,
  },
  ...extra,
})
const studioLink: DiaryLinkView = {
  id: 'link-1',
  who: 'Everyone at the studio',
  kind: 'studio',
  detail: 'treatment',
  madeBy: 'Ada Owner',
  mine: true,
  createdAt: '2026-10-06T08:00:00.000Z',
  lastReadAt: null,
}
const address = 'http://127.0.0.1:5173/api/diary/sd_0a1b2c3d_abcdefghijklmnopqrstuvwxyz012345.ics'

test('makes a link for the whole studio, shows it once, copies it and stops it', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === base && !options) return listing() as never
    if (path === base)
      return listing({ links: [studioLink], link: address, created: 'link-1' }) as never
    if (path === `${base}/link-1/stop`) return listing() as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<DiaryLinks workspaceId="org-1" />)
  const whose = await screen.findByRole('combobox', { name: 'Whose visits' })
  expect((await choicesIn(user, whose)).map((o) => o.text)).toEqual([
    'Your own visits (Maya Lewis)',
    'Sophia Reed',
    'Everyone at the studio',
  ])
  expect(screen.getByText(/From two weeks back to six months ahead/)).toBeInTheDocument()
  await user.selectOptions(whose, 'Everyone at the studio')
  await user.click(screen.getByRole('radio', { name: 'The treatment only' }))
  await user.click(screen.getByRole('button', { name: 'Make the link' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(base, {
    method: 'POST',
    body: { scope: { kind: 'studio' }, detail: 'treatment' },
  })
  expect(await screen.findByText('Your link to Everyone at the studio is ready.')).toBeVisible()
  expect(screen.getByText(address)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open in Apple Calendar' })).toHaveAttribute(
    'href',
    address.replace('http:', 'webcal:'),
  )
  expect(screen.getByText(/only calendar apps on this computer can read the link/)).toBeVisible()
  // The form steps aside while the link is on show.
  expect(screen.queryByRole('button', { name: 'Make the link' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy link' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(await navigator.clipboard.readText()).toBe(address)
  expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByText(address)).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Whose visits' })).toHaveFocus()

  expect(screen.getByText('The treatment only. Made by you, 6 Oct, 09:00.', { exact: false }))
  expect(screen.getByText(/Not read by a calendar yet/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Stop link for Everyone at the studio' }))
  expect(
    screen.getByRole('button', { name: 'Stop it now for Everyone at the studio' }),
  ).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Keep it' }))
  expect(screen.getByRole('button', { name: 'Stop link for Everyone at the studio' })).toHaveFocus()
  await user.keyboard('{Enter}')
  // Stopping asks once more.
  expect(vi.mocked(api)).not.toHaveBeenCalledWith(`${base}/link-1/stop`, expect.anything())
  await user.click(screen.getByRole('button', { name: 'Stop it now for Everyone at the studio' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base}/link-1/stop`, { method: 'POST', body: {} })
  expect(
    await screen.findByText(
      'Stopped the link to Everyone at the studio. Calendars that had it keep what they last read until it is removed there.',
    ),
  ).toBeVisible()
})

test('a practitioner links their own visits, four weeks ahead, and sees a link that no longer works', async () => {
  vi.mocked(api).mockResolvedValue(
    listing({
      daysAhead: 28,
      choices: {
        own: { staffId: 'staff-maya', name: 'Maya Lewis' },
        people: [],
        locations: [],
        studio: false,
      },
      links: [
        {
          ...studioLink,
          who: 'Maya Lewis',
          kind: 'person',
          detail: 'names',
          lastReadAt: '2026-10-06T09:15:00.000Z',
          stoppedWorking: 'That person is no longer on the team.',
        },
      ],
    }) as never,
  )
  render(<DiaryLinks workspaceId="org-1" inDialog />)
  expect(await screen.findByText('Your own visits')).toBeVisible()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByText(/From two weeks back to four weeks ahead/)).toBeVisible()
  expect(
    screen.getByRole('radio', { name: 'The treatment and the client’s first name' }),
  ).toBeChecked()
  expect(screen.getByText(/Last read by a calendar 6 Oct, 10:15/)).toBeVisible()
  expect(screen.getByText('No longer works: That person is no longer on the team.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Your links' })).toBeVisible()
})

test('shares nothing from the browser demo, a sample studio, or someone with no visits', async () => {
  const { unmount } = render(<DiaryLinks workspaceId="org-1" demo />)
  expect(screen.getByText(/The browser demo keeps everything on this device/)).toBeVisible()
  expect(vi.mocked(api)).not.toHaveBeenCalled()
  unmount()

  vi.mocked(api).mockResolvedValueOnce(listing({ sample: true }) as never)
  const sample = render(<DiaryLinks workspaceId="org-1" />)
  expect(await screen.findByText(/A sample studio never shares anything/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Make the link' })).toBeNull()
  sample.unmount()

  vi.mocked(api).mockResolvedValueOnce(
    listing({ choices: { own: null, people: [], locations: [], studio: false } }) as never,
  )
  render(<DiaryLinks workspaceId="org-1" />)
  expect(await screen.findByText(/You have no visits of your own to show/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Make the link' })).toBeNull()
})

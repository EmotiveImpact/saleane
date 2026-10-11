import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { VisitWriteUp } from './VisitWriteUp'
import { api } from '../state/api'

// NEXT-16: writing up a visit from what the professional says afterwards.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  vi.resetAllMocks()
})
const path = '/api/workspaces/org-1'

test('writes up typed words, lets them change both parts, then saves only on Save', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (url === `${path}/write-up`) return { mode: 'test', listens: false } as never
    if (url === `${path}/visits/visit-1/write-up`) {
      expect(options?.body).toEqual({ words: 'Balayage with toner. Avoid hot water for two days.' })
      return {
        heard: 'Balayage with toner. Avoid hot water for two days.',
        note: 'Balayage with toner.',
        aftercare: 'Avoid hot water for two days.',
      } as never
    }
    throw new Error(`Unexpected route ${url}`)
  })
  const onSave = vi.fn().mockResolvedValue(true)
  render(
    <VisitWriteUp
      path={path}
      appointmentId="visit-1"
      guest="Amara"
      saving={false}
      onSave={onSave}
    />,
  )
  expect(await screen.findByText(/nothing leaves SALEANE/)).toBeInTheDocument()
  // Without a live AI and OpenAI there is nothing to speak to.
  expect(screen.queryByRole('button', { name: 'Speak a note' })).not.toBeInTheDocument()
  await user.type(
    screen.getByLabelText('What you would say'),
    'Balayage with toner. Avoid hot water for two days.',
  )
  await user.click(screen.getByRole('button', { name: 'Write it up' }))
  const note = await screen.findByLabelText('For the studio')
  expect(note).toHaveValue('Balayage with toner.')
  const care = screen.getByLabelText('Aftercare for Amara')
  expect(care).toHaveValue('Avoid hot water for two days.')
  expect(onSave).not.toHaveBeenCalled()
  await user.clear(care)
  await user.type(care, 'Avoid hot water for three days.')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(
    {
      type: 'visit-write-up',
      appointmentId: 'visit-1',
      note: 'Balayage with toner.',
      aftercare: 'Avoid hot water for three days.',
    },
    'Saved. The aftercare is added to Amara’s aftercare email.',
  )
  expect(await screen.findByLabelText('What you would say')).toHaveValue('')
})

test('says what leaves SALEANE when live, and keeps their words when it fails', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === `${path}/write-up`) return { mode: 'live', listens: false } as never
    return {
      status: 'unavailable',
      heard: 'Gel polish in Sienna.',
      text: 'It could not be written up just now. Nothing was saved. Try again, or type it yourself.',
    } as never
  })
  render(
    <VisitWriteUp
      path={path}
      appointmentId="visit-1"
      guest="Amara"
      saving={false}
      onSave={vi.fn()}
    />,
  )
  expect(
    await screen.findByText(/Your words go to Claude to be written up\. Each one counts/),
  ).toBeInTheDocument()
  await user.type(screen.getByLabelText('What you would say'), 'Gel polish in Sienna.')
  await user.click(screen.getByRole('button', { name: 'Write it up' }))
  expect(await screen.findByText(/Nothing was saved/)).toBeInTheDocument()
  expect(screen.getByLabelText('What you would say')).toHaveValue('Gel polish in Sienna.')
  expect(screen.queryByLabelText('For the studio')).not.toBeInTheDocument()
})

test('shows saved aftercare and removes it on request', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({ mode: 'test', listens: false } as never)
  const onSave = vi.fn().mockResolvedValue(true)
  render(
    <VisitWriteUp
      path={path}
      appointmentId="visit-1"
      guest="Amara"
      aftercare="Keep it dry tonight."
      saving={false}
      onSave={onSave}
    />,
  )
  expect(await screen.findByText('Keep it dry tonight.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Remove' }))
  expect(onSave).toHaveBeenCalledWith(
    { type: 'visit-write-up', appointmentId: 'visit-1', aftercare: null },
    'The aftercare is removed from their aftercare email.',
  )
})

test('records a voice note and sends the recording itself', async () => {
  const user = userEvent.setup()
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] }
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
    state = 'inactive'
    mimeType: string
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    constructor(_stream: unknown, options: { mimeType: string; audioBitsPerSecond: number }) {
      this.mimeType = options.mimeType
      expect(options.audioBitsPerSecond).toBe(24_000)
    }
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: this.mimeType }) })
      this.onstop?.()
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  let sent: unknown
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (url === `${path}/write-up`) return { mode: 'live', listens: true } as never
    sent = options?.body
    return { heard: 'Lashes lifted.', note: 'Lashes lifted.', aftercare: '' } as never
  })
  try {
    render(
      <VisitWriteUp
        path={path}
        appointmentId="visit-1"
        guest="Amara"
        saving={false}
        onSave={vi.fn()}
      />,
    )
    expect(await screen.findByText(/The recording is not kept/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Speak a note' }))
    expect(await screen.findByText(/Listening · 0:00 of 2:00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop and write it up' }))
    expect(await screen.findByLabelText('For the studio')).toHaveValue('Lashes lifted.')
    expect(sent).toBeInstanceOf(Blob)
    expect((sent as Blob).type).toBe('audio/webm;codecs=opus')
    expect(stopTrack).toHaveBeenCalled()
    expect(screen.getByText('Heard')).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

test('leaving while recording lets go of the microphone and sends nothing', async () => {
  const user = userEvent.setup()
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] }
  class FakeRecorder {
    static isTypeSupported = () => true
    state = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)]) })
      this.onstop?.()
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  vi.mocked(api).mockResolvedValue({ mode: 'live', listens: true } as never)
  try {
    const { unmount } = render(
      <VisitWriteUp
        path={path}
        appointmentId="visit-1"
        guest="Amara"
        saving={false}
        onSave={vi.fn()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Speak a note' }))
    await screen.findByText(/Listening/)
    unmount()
    expect(stopTrack).toHaveBeenCalled()
    // Only the status was asked for: the recording was never sent.
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

test('a microphone granted after leaving is let go at once and never recorded', async () => {
  const user = userEvent.setup()
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] }
  let grant: (value: unknown) => void = () => {}
  const made = vi.fn()
  class FakeRecorder {
    static isTypeSupported = () => true
    constructor() {
      made()
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    // The browser is still asking for the microphone when they leave.
    value: { getUserMedia: vi.fn(() => new Promise((resolve) => (grant = resolve))) },
  })
  vi.mocked(api).mockResolvedValue({ mode: 'live', listens: true } as never)
  try {
    const { unmount } = render(
      <VisitWriteUp
        path={path}
        appointmentId="visit-1"
        guest="Amara"
        saving={false}
        onSave={vi.fn()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Speak a note' }))
    unmount()
    grant(stream)
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalled())
    expect(made).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

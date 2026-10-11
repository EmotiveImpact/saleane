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
    if (url === `${path}/write-up?visit=visit-1`)
      return { mode: 'test', listens: false, aftercareEmail: true } as never
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
    if (url === `${path}/write-up?visit=visit-1`) return { mode: 'live', listens: false } as never
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
  vi.mocked(api).mockResolvedValue({ mode: 'test', listens: false, aftercareEmail: true } as never)
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

test('says plainly when no email will carry the aftercare, as once its email has gone', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === `${path}/write-up?visit=visit-1`)
      return { mode: 'test', listens: false, aftercareEmail: false } as never
    return { heard: 'Keep it dry.', note: '', aftercare: 'Keep it dry tonight.' } as never
  })
  const onSave = vi.fn().mockResolvedValue(true)
  render(
    <VisitWriteUp
      path={path}
      appointmentId="visit-1"
      guest="Amara"
      aftercare="Use the purple shampoo."
      saving={false}
      onSave={onSave}
    />,
  )
  expect(
    await screen.findByText(/Kept on the visit only: their aftercare email has gone/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Added to their aftercare email/)).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('What you would say'), 'Keep it dry tonight.')
  await user.click(screen.getByRole('button', { name: 'Write it up' }))
  await screen.findByLabelText('Aftercare for Amara')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(
    { type: 'visit-write-up', appointmentId: 'visit-1', aftercare: 'Keep it dry tonight.' },
    'Saved. The aftercare is kept on the visit, and no email will carry it.',
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
    if (url === `${path}/write-up?visit=visit-1`) return { mode: 'live', listens: true } as never
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

test('a second tap while the browser asks for the microphone opens nothing more', async () => {
  const user = userEvent.setup()
  const getUserMedia = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('MediaRecorder', class {})
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  vi.mocked(api).mockResolvedValue({ mode: 'live', listens: true } as never)
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
    const speak = await screen.findByRole('button', { name: 'Speak a note' })
    await user.click(speak)
    await user.click(speak)
    expect(speak).toBeDisabled()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

test('asks again before saying where saved aftercare goes, as its email may have gone since', async () => {
  const user = userEvent.setup()
  let ahead = true
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === `${path}/write-up?visit=visit-1`)
      return { mode: 'test', listens: false, aftercareEmail: ahead } as never
    return { heard: 'Keep it dry.', note: '', aftercare: 'Keep it dry tonight.' } as never
  })
  const onSave = vi.fn().mockResolvedValue(true)
  render(
    <VisitWriteUp
      path={path}
      appointmentId="visit-1"
      guest="Amara"
      aftercare="Use the purple shampoo."
      saving={false}
      onSave={onSave}
    />,
  )
  expect(await screen.findByText(/^Added to their aftercare email/)).toBeInTheDocument()
  // The aftercare email goes while the visit is open.
  ahead = false
  await user.click(screen.getByRole('button', { name: 'Remove' }))
  expect(onSave).toHaveBeenLastCalledWith(
    { type: 'visit-write-up', appointmentId: 'visit-1', aftercare: null },
    'The aftercare is removed from the visit.',
  )
  expect(await screen.findByText(/^Kept on the visit only/)).toBeInTheDocument()
})

test('when it cannot tell how write-ups are handled it promises nothing and writes nothing', async () => {
  const user = userEvent.setup()
  let reachable = false
  vi.mocked(api).mockImplementation(async () => {
    if (!reachable) throw new Error('Offline')
    return { mode: 'live', listens: false } as never
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
  expect(await screen.findByText(/could not check how write-ups are handled/)).toBeInTheDocument()
  expect(screen.queryByText(/nothing leaves SALEANE/)).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('What you would say'), 'Gel polish in Sienna.')
  expect(screen.getByRole('button', { name: 'Write it up' })).toBeDisabled()
  reachable = true
  await user.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText(/Your words go to Claude/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Write it up' })).toBeEnabled()
})

test('a recorder that will not start lets go of the microphone and says so', async () => {
  const user = userEvent.setup()
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] }
  vi.stubGlobal(
    'MediaRecorder',
    class {
      static isTypeSupported = () => true
      constructor() {
        throw new Error('NotSupportedError')
      }
    },
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  vi.mocked(api).mockResolvedValue({ mode: 'live', listens: true } as never)
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
    await user.click(await screen.findByRole('button', { name: 'Speak a note' }))
    expect(await screen.findByText(/could not start recording/)).toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Speak a note' })).toBeEnabled()
  } finally {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

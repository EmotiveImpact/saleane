import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScanDetector, SCAN_GAP_MS, useBarcodeScan } from './barcodeScan'
import type { ScanKey } from './barcodeScan'

/** Presses each key `gap` milliseconds after the last, as a scanner or a person would. */
function press(keys: (string | Omit<ScanKey, 'time'>)[], gap: number, from = 1000) {
  const detector = createScanDetector()
  let time = from
  return keys.map((key) => {
    time += gap
    return detector.key(typeof key === 'string' ? { key, time } : { ...key, time })
  })
}
const scans = (steps: ReturnType<typeof press>) =>
  steps.flatMap((step) => (step.kind === 'scan' ? [step.code] : []))
const typed = (text: string) => [...text]

describe('the scan-burst detector', () => {
  it('reads a fast burst that ends in Enter as a scan', () => {
    expect(scans(press([...typed('5012345678900'), 'Enter'], 8))).toEqual(['5012345678900'])
    // At the edge of the gap it is still a scanner.
    expect(scans(press([...typed('ABC123'), 'Enter'], SCAN_GAP_MS))).toEqual(['ABC123'])
  })

  it('leaves ordinary typing alone, however it ends', () => {
    expect(scans(press([...typed('5012345678900'), 'Enter'], 120))).toEqual([])
    expect(scans(press([...typed('Hydrating'), 'Enter'], SCAN_GAP_MS + 1))).toEqual([])
  })

  it('needs Enter, at scanner speed, to finish a scan', () => {
    // A burst without Enter is not a scan.
    expect(scans(press(typed('5012345678900'), 8))).toEqual([])
    // Enter pressed by a person after a pause is not a scan either.
    const detector = createScanDetector()
    for (const [index, key] of typed('5012345678900').entries())
      detector.key({ key, time: 1000 + index * 8 })
    expect(detector.key({ key: 'Enter', time: 1000 + 12 * 8 + 400 })).toEqual({ kind: 'none' })
  })

  it('needs at least four characters', () => {
    expect(scans(press([...typed('123'), 'Enter'], 8))).toEqual([])
    expect(scans(press([...typed('1234'), 'Enter'], 8))).toEqual(['1234'])
    // Enter on its own, or twice, is never a scan.
    expect(scans(press(['Enter', 'Enter'], 8))).toEqual([])
  })

  it('takes only the burst when someone was typing just before it', () => {
    const detector = createScanDetector()
    for (const [index, key] of typed('note').entries()) detector.key({ key, time: index * 300 })
    let time = 2000
    const steps = [...typed('2000000000022'), 'Enter'].map((key) =>
      detector.key({ key, time: (time += 6) }),
    )
    expect(scans(steps)).toEqual(['2000000000022'])
    expect(steps[0]).toEqual({ kind: 'char', start: true })
    expect(steps[1]).toEqual({ kind: 'char', start: false })
  })

  it('lets a scanner press Shift for capital letters', () => {
    const keys = ['Shift', 'S', 'Shift', 'A', 'L', '0', '0', '1', 'Enter']
    expect(scans(press(keys, 6))).toEqual(['SAL001'])
  })

  it('treats a held key, a shortcut, an input method or a moving key as a person', () => {
    const held = [...typed('5012'), { key: '3', repeat: true }, ...typed('45678900'), 'Enter']
    expect(scans(press(held, 8))).toEqual(['45678900'])
    const shortcut = [...typed('5012345678900'), { key: 'v', modified: true }, 'Enter']
    expect(scans(press(shortcut, 8))).toEqual([])
    const composing = [...typed('50123'), { key: 'a', composing: true }, 'Enter']
    expect(scans(press(composing, 8))).toEqual([])
    expect(scans(press([...typed('50123'), 'ArrowLeft', 'Enter'], 8))).toEqual([])
  })
})

function Till({ onScan }: { onScan: (code: string) => void }) {
  const root = useRef<HTMLDivElement | null>(null)
  const [note, setNote] = useState('')
  const [code, setCode] = useState('')
  useBarcodeScan(onScan, root)
  return (
    <div ref={root}>
      <label>
        Note
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label>
        Barcode
        <input data-scan-field value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onScan('form sent')
        }}
      >
        <input aria-label="Inside a form" />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}

describe('scanning on a screen', () => {
  // Keys are stamped with a held clock, so a busy test machine cannot slow a scan down; it moves
  // on by a second where a person would pause.
  let clock = 1000
  beforeEach(() => {
    vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => clock)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands a scanner burst to the screen and puts the field it landed in back', async () => {
    const onScan = vi.fn()
    // No delay between keys: as fast as a scanner.
    const user = userEvent.setup({ delay: null })
    render(<Till onScan={onScan} />)
    const note = screen.getByLabelText('Note')
    await user.click(note)
    await user.keyboard('Ask about')
    clock += 1000
    await user.keyboard('2000000000022{Enter}')
    expect(onScan).toHaveBeenCalledWith('2000000000022')
    expect(note).toHaveValue('Ask about')
  })

  it('stops a scanner’s Enter from sending a form', async () => {
    const onScan = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<Till onScan={onScan} />)
    await user.click(screen.getByLabelText('Inside a form'))
    await user.keyboard('2000000000022{Enter}')
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('2000000000022')
    expect(screen.getByLabelText('Inside a form')).toHaveValue('')
  })

  it('leaves slow typing and its Enter to the field', async () => {
    // Real time here: each key comes well over the gap after the last.
    vi.restoreAllMocks()
    const onScan = vi.fn()
    const user = userEvent.setup({ delay: SCAN_GAP_MS * 2 })
    render(<Till onScan={onScan} />)
    await user.click(screen.getByLabelText('Inside a form'))
    await user.keyboard('2000{Enter}')
    // The person's Enter sends the form as it always did.
    expect(onScan).toHaveBeenCalledWith('form sent')
    expect(onScan).not.toHaveBeenCalledWith('2000')
    expect(screen.getByLabelText('Inside a form')).toHaveValue('2000')
  })

  it('leaves a field marked for scanning to handle the code itself', async () => {
    const onScan = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<Till onScan={onScan} />)
    await user.click(screen.getByLabelText('Barcode'))
    await user.keyboard('2000000000022{Enter}')
    expect(onScan).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Barcode')).toHaveValue('2000000000022')
  })

  it('sends a scan to the newest screen, and never to one hidden under a dialog', async () => {
    const page = vi.fn()
    const dialog = vi.fn()
    const user = userEvent.setup({ delay: null })
    const { rerender } = render(
      <>
        <div>
          <Till onScan={page} />
        </div>
        <div>
          <Till onScan={dialog} />
        </div>
      </>,
    )
    await user.keyboard('2000000000015{Enter}')
    clock += 1000
    expect(dialog).toHaveBeenCalledWith('2000000000015')
    expect(page).not.toHaveBeenCalled()
    // The newest is now hidden, as the page is while a dialog is open over it.
    rerender(
      <>
        <div>
          <Till onScan={page} />
        </div>
        <div aria-hidden="true">
          <Till onScan={dialog} />
        </div>
      </>,
    )
    await user.keyboard('2000000000039{Enter}')
    expect(page).toHaveBeenCalledWith('2000000000039')
    expect(dialog).toHaveBeenCalledTimes(1)
  })
})

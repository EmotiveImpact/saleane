import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CameraScanButton } from './CameraScan'
import { forgetCameraSupport } from './cameraSupport'
import { fitWithin } from './productPhoto'

const browser = window as unknown as { BarcodeDetector?: unknown }

/** A browser with a camera and a barcode reader that reads `code` from the first frame. */
function cameraBrowser(code = '5012345678900') {
  const track = { stop: vi.fn() }
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  browser.BarcodeDetector = class {
    static getSupportedFormats = () => Promise.resolve(['ean_13', 'qr_code', 'code_128'])
    detect = vi.fn().mockResolvedValue(code ? [{ rawValue: code }] : [])
  }
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  return { track, getUserMedia }
}

afterEach(() => {
  delete browser.BarcodeDetector
  Reflect.deleteProperty(navigator, 'mediaDevices')
  vi.restoreAllMocks()
  forgetCameraSupport()
})

describe('scanning with the camera', () => {
  it('offers nothing where the browser cannot read barcodes', async () => {
    render(<CameraScanButton onCode={() => {}} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Scan with camera' })).toBeNull()
  })

  it('asks for the camera only when pressed, and turns it off once a code is read', async () => {
    const { track, getUserMedia } = cameraBrowser()
    const onCode = vi.fn()
    const user = userEvent.setup()
    render(<CameraScanButton onCode={onCode} />)
    const button = await screen.findByRole('button', { name: 'Scan with camera' })
    expect(getUserMedia).not.toHaveBeenCalled()
    await user.click(button)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
    await waitFor(() => expect(onCode).toHaveBeenCalledWith('5012345678900'))
    expect(track.stop).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Scan with camera' })).toBeNull()
  })

  it('turns the camera off when the overlay is closed without a code', async () => {
    const { track } = cameraBrowser('')
    const onCode = vi.fn()
    const user = userEvent.setup()
    render(<CameraScanButton onCode={onCode} />)
    await user.click(await screen.findByRole('button', { name: 'Scan with camera' }))
    const overlay = screen.getByRole('dialog', { name: 'Scan with camera' })
    await waitFor(() => expect(overlay.querySelector('.is-watching')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Type it instead' }))
    expect(track.stop).toHaveBeenCalled()
    expect(onCode).not.toHaveBeenCalled()
  })

  it('says plainly when the camera is not allowed', async () => {
    const { getUserMedia } = cameraBrowser()
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const user = userEvent.setup()
    render(<CameraScanButton onCode={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Scan with camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'SALEANE may not use the camera. Allow it in your browser’s settings, or type the barcode instead.',
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

describe('preparing a product photo', () => {
  it('shrinks the longer side to 800 pixels and never enlarges', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1200, 2400)).toEqual({ width: 400, height: 800 })
    expect(fitWithin(500, 300)).toEqual({ width: 500, height: 300 })
    expect(fitWithin(5000, 1, 640)).toEqual({ width: 640, height: 1 })
  })
})

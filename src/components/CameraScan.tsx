import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, Modal } from '../design'
import { detectorClass, useCameraFormats } from './cameraSupport'

/**
 * Stage 2: reading a barcode with the camera of a phone or tablet, where the browser offers the
 * BarcodeDetector API. The button appears only where it works; the camera is asked for only when
 * the button is pressed, and it stops the moment a code is read or the overlay closes.
 */
function cameraProblem(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'SALEANE may not use the camera. Allow it in your browser’s settings, or type the barcode instead.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found. Type the barcode instead.'
  return 'The camera could not start. Close this and type the barcode instead.'
}

/** "Scan with camera": shown only where the browser can read barcodes with a camera. */
export function CameraScanButton({
  onCode,
  disabled,
  label = 'Scan with camera',
}: {
  onCode: (code: string) => void
  disabled?: boolean
  label?: string
}) {
  const formats = useCameraFormats()
  const [open, setOpen] = useState(false)
  if (!formats) return null
  return (
    <>
      <Button
        variant="secondary"
        className="scan-camera-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Camera size={16} aria-hidden="true" /> {label}
      </Button>
      {open && (
        <CameraOverlay
          formats={formats}
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false)
            onCode(code)
          }}
        />
      )}
    </>
  )
}

function CameraOverlay({
  formats,
  onCode,
  onClose,
}: {
  formats: string[]
  onCode: (code: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const found = useRef(onCode)
  const [problem, setProblem] = useState('')
  const [watching, setWatching] = useState(false)
  useEffect(() => {
    found.current = onCode
  })
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      if (video.current) video.current.srcObject = null
    }
    const Detector = detectorClass()
    if (!Detector) return stop
    const detector = new Detector({ formats })
    const look = async () => {
      const source = video.current
      if (stopped || !source) return
      try {
        if (source.readyState >= 2) {
          const code = (await detector.detect(source)).find((item) => item.rawValue)?.rawValue
          if (code && !stopped) {
            // The camera goes off the moment a code is read.
            stop()
            found.current(code)
            return
          }
        }
      } catch {
        // A frame that cannot be read; try the next one.
      }
      if (!stopped) timer = setTimeout(() => void look(), 160)
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (opened) => {
        if (stopped) {
          opened.getTracks().forEach((track) => track.stop())
          return
        }
        stream = opened
        const source = video.current!
        source.srcObject = opened
        await source.play()
        if (stopped) return
        setWatching(true)
        void look()
      })
      .catch((error: unknown) => {
        if (stopped) return
        stop()
        setProblem(cameraProblem(error))
      })
    return stop
  }, [formats])
  return (
    <Modal
      open
      onClose={onClose}
      title="Scan with camera"
      description="Hold the barcode inside the frame. The camera turns off as soon as it reads one."
    >
      <div className="scan-camera">
        <div className={`scan-camera-view ${watching ? 'is-watching' : ''}`}>
          <video ref={video} muted playsInline aria-label="What the camera sees" />
          <span className="scan-camera-frame" aria-hidden="true" />
          {!watching && !problem && <span className="scan-camera-wait">Starting the camera…</span>}
        </div>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        <div className="ops-actions">
          <Button variant="secondary" onClick={onClose}>
            {problem ? 'Close' : 'Type it instead'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

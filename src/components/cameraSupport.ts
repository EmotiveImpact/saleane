import { useEffect, useState } from 'react'

/**
 * Stage 2: whether this browser can read barcodes with the camera (the BarcodeDetector API, on
 * most phones and tablets), and which printed code formats it reads.
 */
export type Found = { rawValue: string }
export type Detector = { detect: (source: HTMLVideoElement) => Promise<Found[]> }
export type DetectorClass = {
  new (options?: { formats?: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}
/** Printed product codes: EAN, UPC and the common one-dimensional codes on labels. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39', 'code_93', 'itf', 'codabar']

export const detectorClass = () =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector

let supported: Promise<string[]> | null = null
/** The product code formats this browser's detector reads, worked out once. */
function supportedFormats() {
  const Detector = detectorClass()
  if (!Detector || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)
    return Promise.resolve([])
  supported ??= Promise.resolve(Detector.getSupportedFormats?.() ?? FORMATS)
    .then((formats) => FORMATS.filter((format) => formats.includes(format)))
    .catch(() => [])
  return supported
}

/** The formats the camera can read here, or null where camera scanning is not offered. */
export function useCameraFormats() {
  const [formats, setFormats] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    void supportedFormats().then((found) => {
      if (live) setFormats(found.length ? found : null)
    })
    return () => {
      live = false
    }
  }, [])
  return formats
}

/** Forgets what was worked out, for tests that change what the browser offers. */
export function forgetCameraSupport() {
  supported = null
}

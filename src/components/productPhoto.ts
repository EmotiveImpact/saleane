import { useEffect, useState } from 'react'

/**
 * Stage 2: product photos, prepared in the browser before they are sent. A photo from the
 * device's library or camera is turned the right way up, shrunk to at most 800 pixels on its
 * longer side, laid on white (so a cut-out product never shows a black background) and
 * compressed as WebP, or JPEG where the browser cannot make WebP, to under 300 KB.
 */
export const PHOTO_SIDE = 800
export const PHOTO_BYTES = 300 * 1024
/** Smaller sizes and lower qualities tried, in order, until the photo is small enough. */
const SIDES = [PHOTO_SIDE, 640, 480]
const QUALITIES = [0.82, 0.72, 0.6]
const TYPES = ['image/webp', 'image/jpeg'] as const

export class PhotoProblem extends Error {}

/** The size a picture is drawn at: its own, or shrunk so its longer side is `side`. */
export function fitWithin(width: number, height: number, side = PHOTO_SIDE) {
  const scale = Math.min(1, side / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

type Picture = { source: CanvasImageSource; width: number; height: number; close: () => void }

/** Opens the file as a picture, turned the way the camera held it. */
async function open(file: Blob): Promise<Picture> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // Some browsers open only some kinds this way; try a plain image below.
    }
  }
  // Read as a data address, which the studio's content rules allow for pictures.
  const address = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('undecodable'))
    image.src = address
  })
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => undefined,
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

/** Shrinks and compresses a chosen photo, ready to send. */
export async function preparePhoto(file: File) {
  if (file.type && !file.type.startsWith('image/'))
    throw new PhotoProblem('Choose a photo, such as a JPEG, PNG or WebP picture.')
  let picture: Picture
  try {
    picture = await open(file)
  } catch {
    throw new PhotoProblem('This file could not be opened as a photo. Choose another.')
  }
  try {
    if (!picture.width || !picture.height)
      throw new PhotoProblem('This file could not be opened as a photo. Choose another.')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoProblem('This browser cannot prepare photos. Try another browser.')
    for (const side of SIDES) {
      const size = fitWithin(picture.width, picture.height, side)
      canvas.width = size.width
      canvas.height = size.height
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
      context.imageSmoothingQuality = 'high'
      context.drawImage(picture.source, 0, 0, size.width, size.height)
      for (const type of TYPES)
        for (const quality of QUALITIES) {
          const blob = await toBlob(canvas, type, quality)
          // A browser that cannot make this kind hands back another; try the next kind.
          if (!blob || blob.type !== type) break
          if (blob.size <= PHOTO_BYTES) return { blob, ...size }
        }
    }
    throw new PhotoProblem('This photo is too detailed to make small enough. Choose another.')
  } finally {
    picture.close()
  }
}

type Loader = (address: string) => Promise<string>
/**
 * The browser demo answers SALEANE's addresses inside the page, where a picture cannot be fetched
 * by its address, so the demo offers its own way to load one. Everywhere else the address is used.
 */
const demoLoader = () => (globalThis as { saleaneDemoImage?: Loader }).saleaneDemoImage

/** The address to show a photo from: the photo's own, or the demo's copy once it has loaded. */
export function useImageSource(address: string | undefined) {
  const loader = demoLoader()
  const [loaded, setLoaded] = useState<{ address: string; source: string } | null>(null)
  useEffect(() => {
    if (!address || !loader) return
    let live = true
    loader(address)
      .then((source) => {
        if (live) setLoaded({ address, source })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [address, loader])
  if (!address) return undefined
  if (!loader) return address
  return loaded?.address === address ? loaded.source : undefined
}

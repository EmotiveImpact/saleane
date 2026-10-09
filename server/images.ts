/**
 * Stage 2: what a product photo really is, read from its first bytes rather than from its name or
 * the type the browser claims. Only JPEG, PNG and WebP are photos here; SVG, GIF, HTML or anything
 * else is refused. The width and height come from the picture's own header, so a picture that is
 * small on disk but enormous when opened is refused too.
 *
 * Works on plain byte arrays so the same code runs in the browser demo.
 */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'
export type ImageFacts = { type: ImageType; width: number; height: number }

/** The most bytes a photo may have when it arrives (the browser shrinks it well below this). */
export const IMAGE_MAX_BYTES = 400 * 1024
/** The longest side a stored photo may have, in pixels (the browser makes it 800 at most). */
export const IMAGE_MAX_SIDE = 2000

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
const ascii = (b: Uint8Array, at: number, text: string) =>
  [...text].every((c, i) => b[at + i] === c.charCodeAt(0))

function png(b: Uint8Array): ImageFacts | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 24 || signature.some((v, i) => b[i] !== v) || !ascii(b, 12, 'IHDR')) return null
  return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) }
}

function jpeg(b: Uint8Array): ImageFacts | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]
    if (marker === 0xff) {
      at += 1
      continue
    }
    // Markers without a length: restarts, the start of the image, and padding.
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      at += 2
      continue
    }
    // The end of the image or the start of the picture data came before the size.
    if (marker === 0xd9 || marker === 0xda) return null
    const length = u16be(b, at + 2)
    if (length < 2) return null
    // A start-of-frame marker carries the height and width.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { type: 'image/jpeg', height: u16be(b, at + 5), width: u16be(b, at + 7) }
    at += 2 + length
  }
  return null
}

function webp(b: Uint8Array): ImageFacts | null {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  if (ascii(b, 12, 'VP8 ')) {
    // A lossy frame: its start code, then 14 bits each of width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(b, 12, 'VP8X'))
    return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return null
}

/** What the bytes are and how large the picture is, or null when they are not a usable photo. */
export function imageFacts(bytes: Uint8Array): ImageFacts | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes)
}

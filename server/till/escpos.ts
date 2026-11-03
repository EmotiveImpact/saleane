import { receiptRows } from '../../src/domain/receipt'
import type { Receipt } from '../../src/domain/receipt'
import type { PaperWidth } from '../../src/domain/tillSchema'

/**
 * Stage 2: ESC/POS, the command language almost every receipt printer speaks. Only a small, well
 * supported part is used: reset, the PC858 code page (Western European letters, £ and €), centred
 * and left text, bold, double size for the studio's name, a feed and a partial cut, and the pulse
 * that opens a cash drawer plugged into the printer. Pure: it turns a receipt into bytes and back
 * into a preview, and sends nothing.
 */

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a
/** Characters per line in the printer's standard font. */
export const COLUMNS: Record<PaperWidth, number> = { '80': 48, '58': 32 }

const RESET = [ESC, 0x40]
/** Code page 19: PC858, which has £ and €. */
const CODE_PAGE = [ESC, 0x74, 19]
const align = (where: 'left' | 'centre') => [ESC, 0x61, where === 'centre' ? 1 : 0]
const bold = (on: boolean) => [ESC, 0x45, on ? 1 : 0]
/** Double width and height, or back to normal. */
const large = (on: boolean) => [GS, 0x21, on ? 0x11 : 0x00]
/** Feed four lines so the last line clears the cutter, then cut most of the way through. */
const FEED_AND_CUT = [ESC, 0x64, 4, GS, 0x56, 0x42, 0x00]
/** Pin 2, on for 50 ms and off for 500 ms: the standard drawer kick. */
export const DRAWER_PULSE = [ESC, 0x70, 0x00, 0x19, 0xfa]

/** The letters PC858 has beyond plain ASCII. */
const PC858: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  ø: 0x9b,
  '£': 0x9c,
  Ø: 0x9d,
  '×': 0x9e,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  '½': 0xab,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  ã: 0xc6,
  Ã: 0xc7,
  Ê: 0xd2,
  Ë: 0xd3,
  È: 0xd4,
  '€': 0xd5,
  Í: 0xd6,
  Î: 0xd7,
  Ï: 0xd8,
  Ì: 0xde,
  Ó: 0xe0,
  ß: 0xe1,
  Ô: 0xe2,
  Ò: 0xe3,
  õ: 0xe4,
  Õ: 0xe5,
  Ú: 0xe9,
  Û: 0xea,
  Ù: 0xeb,
  ý: 0xec,
  Ý: 0xed,
}
const BACK = new Map(Object.entries(PC858).map(([char, byte]) => [byte, char]))
/** Typography a till roll cannot show, written the plain way. */
const PLAIN: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '−': '-',
  '\u2013': '-',
  '\u2014': '-',
  '…': '...',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
}

/**
 * Text as printer bytes, one byte for each character. Control characters never reach the
 * printer, so nothing typed into a name can become a printer command.
 */
export function encode(text: string): number[] {
  const out: number[] = []
  for (const raw of text) {
    const char = PLAIN[raw] ?? raw
    for (const c of char) {
      const code = c.codePointAt(0)!
      if (code >= 0x20 && code <= 0x7e) out.push(code)
      else if (PC858[c] !== undefined) out.push(PC858[c])
      else if (/\s/.test(c)) out.push(0x20)
      else {
        // Letters with marks the code page lacks lose the mark ("ł" stays "l" where it can).
        const bare = c.normalize('NFD').replace(/[̀-ͯ]/g, '')
        const first = bare.codePointAt(0) ?? 0
        out.push(bare.length && first >= 0x20 && first <= 0x7e ? first : 0x3f)
      }
    }
  }
  return out
}

/**
 * Splits encoded text into lines of at most `width` characters, at spaces where it can. Only a
 * plain space splits: a code page letter such as "á" is byte 0xA0, which reads as a space to
 * JavaScript.
 */
export function wrap(text: string, width: number): string[] {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let word of words) {
    while (word.length > width) {
      if (line) lines.push(line)
      lines.push(word.slice(0, width))
      word = word.slice(width)
      line = ''
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** A label on the left and an amount on the right; a long label wraps above its amount. */
export function columns(label: string, amount: string, width: number): string[] {
  const plainLabel = String.fromCharCode(...encode(label))
  const plainAmount = String.fromCharCode(...encode(amount))
  const room = width - plainAmount.length - 1
  const lines = wrap(plainLabel, Math.max(8, room))
  const last = lines[lines.length - 1]
  if (last.length <= room) {
    lines[lines.length - 1] = last + ' '.repeat(width - last.length - plainAmount.length)
    return lines.map((line, i) => (i === lines.length - 1 ? line + plainAmount : line))
  }
  return [...lines, plainAmount.padStart(width)]
}

/** Builds a print job from lines, keeping track of the printer's state. */
class Job {
  bytes: number[] = [...RESET, ...CODE_PAGE]
  raw(...parts: number[][]) {
    for (const part of parts) this.bytes.push(...part)
    return this
  }
  /** One line already measured: its characters are written as they are. */
  line(text: string) {
    for (const char of text) this.bytes.push(char.charCodeAt(0) & 0xff)
    this.bytes.push(LF)
    return this
  }
  text(text: string, width: number) {
    for (const line of wrap(String.fromCharCode(...encode(text)), width)) this.line(line)
    return this
  }
}

/** A receipt as ESC/POS bytes for a till roll of the given width. */
export function receiptJob(
  receipt: Receipt,
  paper: PaperWidth,
  options: { drawer?: boolean } = {},
) {
  const width = COLUMNS[paper]
  const job = new Job()
  if (options.drawer) job.raw(DRAWER_PULSE)
  job.raw(align('centre'), bold(true), large(true)).text(receipt.studio.name, width / 2)
  job.raw(large(false), bold(false))
  for (const line of [receipt.studio.location, receipt.studio.address, receipt.studio.phone])
    if (line) job.text(line, width)
  job.raw(align('left')).line('')
  job.text(`${receipt.title} ${receipt.number}`, width)
  job.text(`${receipt.date}, ${receipt.time}`, width)
  if (receipt.servedBy) job.text(`Served by ${receipt.servedBy}`, width)
  const rule = '-'.repeat(width)
  job.line(rule)
  for (const row of receiptRows(receipt)) {
    if (row.kind === 'total') job.line(rule).raw(bold(true))
    for (const line of columns(row.label, row.amount, width)) job.line(line)
    if (row.kind === 'total') job.raw(bold(false))
    if (row.detail)
      for (const line of wrap(String.fromCharCode(...encode(row.detail)), width - 2))
        job.line(`  ${line}`)
  }
  job.line(rule)
  for (const note of receipt.notes) job.text(note, width)
  job.raw(align('centre')).text(receipt.thanks, width)
  if (receipt.studio.taxNumber)
    job.text(`${receipt.studio.taxNumber.label}: ${receipt.studio.taxNumber.value}`, width)
  job.raw(align('left'), FEED_AND_CUT)
  return Uint8Array.from(job.bytes)
}

/** A page to check a printer works, saying plainly what it is. */
export function testPageJob(studio: string, place: string | undefined, paper: PaperWidth) {
  const width = COLUMNS[paper]
  const job = new Job()
  job.raw(align('centre'), bold(true)).text(studio, width).raw(bold(false))
  if (place) job.text(place, width)
  job.line('').text('Test page from SALEANE', width)
  job.text(`Paper ${paper} mm, ${width} characters a line`, width)
  job.line('-'.repeat(width)).raw(align('left'))
  for (const line of columns('Amounts line up on the right', '£12.50', width)) job.line(line)
  job.raw(align('centre')).text('If you can read this, receipts will print here.', width)
  job.raw(align('left'), FEED_AND_CUT)
  return Uint8Array.from(job.bytes)
}

/** Just the drawer kick, for opening the drawer without printing. */
export function drawerJob() {
  return Uint8Array.from([...RESET, ...DRAWER_PULSE])
}

export type PreviewLine = { text: string; bold?: true; centre?: true; large?: true }
export type Preview = { lines: PreviewLine[]; cut: boolean; drawer: boolean }

/**
 * Reads a print job back as the paper would look: what the test printer shows instead of
 * printing. Understands exactly the commands written above.
 */
export function preview(bytes: Uint8Array): Preview {
  const lines: PreviewLine[] = []
  const state = { bold: false, centre: false, large: false }
  let text = ''
  let cut = false
  let drawer = false
  const flush = () => {
    lines.push({
      text,
      ...(state.bold ? { bold: true as const } : {}),
      ...(state.centre ? { centre: true as const } : {}),
      ...(state.large ? { large: true as const } : {}),
    })
    text = ''
  }
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    if (byte === ESC) {
      const command = bytes[++i]
      if (command === 0x40) Object.assign(state, { bold: false, centre: false, large: false })
      else if (command === 0x74) i++
      else if (command === 0x61) state.centre = bytes[++i] === 1
      else if (command === 0x45) state.bold = bytes[++i] === 1
      else if (command === 0x64) {
        const feed = bytes[++i]
        if (text) flush()
        for (let n = 0; n < feed; n++) lines.push({ text: '' })
      } else if (command === 0x70) {
        drawer = true
        i += 3
      }
    } else if (byte === GS) {
      const command = bytes[++i]
      if (command === 0x21) state.large = bytes[++i] !== 0
      else if (command === 0x56) {
        cut = true
        i += bytes[i + 1] >= 0x41 ? 2 : 1
      }
    } else if (byte === LF) flush()
    else text += byte < 0x80 ? String.fromCharCode(byte) : (BACK.get(byte) ?? '?')
  }
  if (text) flush()
  // The feed before the cut is paper, not words.
  while (lines.length && !lines[lines.length - 1].text) lines.pop()
  return { lines, cut, drawer }
}

/** Bytes as hex, for keeping a test print in the database. */
export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
export const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))

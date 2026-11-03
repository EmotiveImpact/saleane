import { BOOK_LINK } from '../domain/reminderSettings'
import { MANAGE_LINK, STOP_LINE } from '../domain/reminders'

/**
 * NEXT-13: the plain words of a message, read as the parts of a designed email. Nothing is added
 * and nothing reworded: every word of the plain text appears in the email, in the same order, so
 * the copy the outbox keeps is still exactly what the guest reads. Only the layout changes: a
 * line that ends in a link becomes a button, a short block of plain facts becomes the visit's
 * card, and the line about keeping in touch moves to the foot.
 */
export type Inline = { text: string; href?: string }
export type Button = {
  label: string
  /** Missing in a preview, or when a link could not be made: the button shows but goes nowhere. */
  href?: string
  tone: 'primary' | 'quiet'
}
export type Block =
  | { type: 'greeting'; text: string }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'details'; lines: string[] }
  | ({ type: 'button' } & Button)
  | { type: 'signoff'; text: string }
  /** Why the guest hears from the studio and how to stop, shown small at the foot. */
  | { type: 'note'; text: string }

export type BlockOptions = {
  /** Where each placeholder goes. A placeholder with no address makes a button that goes nowhere. */
  links?: Partial<Record<typeof BOOK_LINK | typeof MANAGE_LINK, string>>
  /** What the button for a placeholder, or for a link on a line of its own, says. */
  labels?: Partial<Record<typeof BOOK_LINK | typeof MANAGE_LINK, string>> & {
    alone?: string
  }
  /** The name the message ends with: the studio's, or SALEANE's. */
  signOff?: string
  /**
   * Short blocks of plain facts are the visit's details in SALEANE's own messages. Off for words
   * a person typed, where a short block is more likely a poem than a time and place.
   */
  details?: boolean
}

/** A placeholder, with the chosen time after a booking link: "{{book_link}}?service=…". */
const PLACEHOLDER = /\{\{(?:book|manage)_link\}\}(?:\?\S*[^\s.,;:!?])?/
const WEB = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)]/
/** Links in ordinary words: a placeholder or an address, without the full stop after it. */
const IN_WORDS = new RegExp(`${PLACEHOLDER.source}|${WEB.source}`, 'g')
/** A line ending in a link: "View, add to your calendar or cancel: {{manage_link}}". */
const LINK_LINE = new RegExp(
  `^(.*?):\\s+(${PLACEHOLDER.source}|${WEB.source})([.,;!?]?)(?:\\s+(.*))?$`,
)
/** Words that can stand on a button by themselves: "Book when it suits you". */
const ACTIONS = new Set(['book', 'view', 'manage', 'rate', 'leave', 'fill', 'confirm', 'choose'])

const isLabel = (lead: string) =>
  lead.length <= 40 &&
  !/[.!?:]/.test(lead) &&
  ACTIONS.has(lead.split(/[\s,]+/)[0]?.toLowerCase() ?? '')

/**
 * Facts on their own lines with no sentence among them, one of them a time: "Facial with Maya /
 * Tuesday 6 October at 09:30 / Atelier House, 12 High Street".
 */
const isDetails = (lines: string[]) =>
  lines.length >= 2 &&
  lines.length <= 4 &&
  lines.some((line) => /\b\d{1,2}[:.]\d{2}\b/.test(line)) &&
  lines.every(
    (line) =>
      line.length <= 90 && !/[.!?:,;]$/.test(line) && !WEB.test(line) && !line.includes('{{'),
  )

export function emailBlocks(text: string, options: BlockOptions = {}): Block[] {
  const { links = {}, labels = {}, signOff, details = true } = options
  const target = (link: string) => {
    const placeholder = link.match(/^\{\{(?:book|manage)_link\}\}/)?.[0] as
      typeof BOOK_LINK | typeof MANAGE_LINK | undefined
    if (!placeholder) return { href: link, placeholder }
    const base = links[placeholder]
    return { href: base ? base + link.slice(placeholder.length) : undefined, placeholder }
  }
  /** The button for a link: its own words if they fit on one, otherwise what the link does. */
  const button = (
    link: string,
    lead: string,
    offer: boolean,
  ): Extract<Block, { type: 'button' }> => {
    const { href, placeholder } = target(link)
    const tone = placeholder ? 'primary' : 'quiet'
    if (offer) return { type: 'button', label: lead, href, tone }
    // "Rate your visit and Maya, and add a note if you like": the first words say what it does.
    const opening = lead.split(/[,.]/)[0].trim()
    const label =
      (placeholder && labels[placeholder]) ||
      (isLabel(opening) ? opening : '') ||
      (placeholder === BOOK_LINK
        ? link.length > BOOK_LINK.length
          ? 'Book this time'
          : 'Book a visit'
        : placeholder === MANAGE_LINK
          ? 'Manage your visit'
          : /review/i.test(lead)
            ? 'Leave a review'
            : 'Open the link')
    return { type: 'button', label, href, tone }
  }

  /** A link written into ordinary words stays in place, made clickable. */
  const inlines = (line: string): Inline[] => {
    const parts: Inline[] = []
    let last = 0
    for (const match of line.matchAll(IN_WORDS)) {
      if (match.index > last) parts.push({ text: line.slice(last, match.index) })
      const { href, placeholder } = target(match[0])
      const unmade =
        placeholder === MANAGE_LINK
          ? '[private link to manage the visit]'
          : '[link to the booking page]'
      parts.push({ text: href ?? unmade, href })
      last = match.index + match[0].length
    }
    if (last < line.length || !parts.length) parts.push({ text: line.slice(last) })
    return parts
  }

  const blocks: Block[] = []
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()))
    .map((lines) => lines.filter(Boolean))
    .filter((lines) => lines.length)
  paragraphs.forEach((lines, index) => {
    const whole = lines.join('\n')
    const last = index === paragraphs.length - 1
    if (index === 0 && lines.length === 1 && /^(hello|hi|dear)\b.*,$/i.test(whole))
      return blocks.push({ type: 'greeting', text: whole })
    if (last && signOff && whole === signOff) return blocks.push({ type: 'signoff', text: whole })
    if (whole === STOP_LINE) return blocks.push({ type: 'note', text: whole })
    if (details && index > 0 && isDetails(lines)) return blocks.push({ type: 'details', lines })
    let open: Inline[][] = []
    const flush = () => {
      if (open.length) blocks.push({ type: 'paragraph', lines: open })
      open = []
    }
    for (const line of lines) {
      const alone = line.match(new RegExp(`^(${PLACEHOLDER.source}|${WEB.source})$`))
      if (alone) {
        flush()
        const made = button(alone[1], '', false)
        blocks.push(
          labels.alone && !target(alone[1]).placeholder
            ? { ...made, label: labels.alone, tone: 'primary' }
            : made,
        )
        continue
      }
      const linked = line.match(LINK_LINE)
      // A link in the middle of a sentence stays where it is, as a link in the words.
      if (!linked || (!target(linked[2]).placeholder && !/review/i.test(linked[1]))) {
        open.push(inlines(line))
        continue
      }
      // The full stop after a link has nothing left to end once the link is a button.
      const [, lead, link, , rest] = linked
      const offer = isLabel(lead)
      if (!offer) open.push([{ text: `${lead}:` }])
      flush()
      blocks.push(button(link, lead, offer))
      if (rest) open.push(inlines(rest))
    }
    flush()
  })
  return blocks
}

/** A short line for the inbox list beside the subject: the first sentence after the greeting. */
export function emailPreheader(blocks: Block[]) {
  const first = blocks.find((block) => block.type === 'paragraph')
  if (!first || first.type !== 'paragraph') return ''
  const words = first.lines.map((line) => line.map((part) => part.text).join('')).join(' ')
  const sentence = words.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? words
  return sentence.length > 140 ? `${sentence.slice(0, 139).trimEnd()}…` : sentence
}

import { bookingChannels } from './model'
import type { BookingChannel, VisitChannel } from './model'

/**
 * Where an online guest came from, read from the `from` value on a shared booking link such as
 * `/book/your-studio?from=google`. Only the studio's own shared links count; anything else,
 * including a missing or unknown value, records nothing.
 */
export function bookingChannel(value: unknown): BookingChannel | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim().toLowerCase()
  return (bookingChannels as readonly string[]).includes(clean)
    ? (clean as BookingChannel)
    : undefined
}

const labels: Record<VisitChannel, string> = {
  google: 'Google',
  instagram: 'Instagram',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  assistant: 'an AI assistant',
}

export function channelLabel(channel: VisitChannel) {
  return labels[channel]
}

/**
 * What a visit's booking says about where it came from: a shared link of the studio's, or, since
 * Stage 5, an AI assistant the guest asked to book.
 */
export function channelNote(channel: VisitChannel) {
  return (bookingChannels as readonly string[]).includes(channel)
    ? `Booked through your ${labels[channel]} link.`
    : `Booked by the guest through ${labels[channel]}.`
}

/** The booking page address with the `from` value for one channel added. */
export function channelLink(bookingUrl: string, channel?: BookingChannel) {
  if (!channel) return bookingUrl
  const url = new URL(bookingUrl)
  url.searchParams.set('from', channel)
  return url.toString()
}

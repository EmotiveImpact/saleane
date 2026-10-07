import { bookingChannels } from './model'
import type { BookingChannel } from './model'

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

export function channelLabel(channel: BookingChannel) {
  return channel === 'google' ? 'Google' : 'Instagram'
}

/** The booking page address with the `from` value for one channel added. */
export function channelLink(bookingUrl: string, channel?: BookingChannel) {
  if (!channel) return bookingUrl
  const url = new URL(bookingUrl)
  url.searchParams.set('from', channel)
  return url.toString()
}

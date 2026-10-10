import type { BusinessState, Client } from './model'
import { guestKey } from './cancelledTimes'
import { senderClient } from './inbox'
import { textNumber } from './reminders'

/**
 * Stage 5: who is writing to the studio's text line or WhatsApp, when the server can be sure.
 *
 * Until now a guest was known only when exactly one client record had the number they wrote from.
 * Every online booking opens a new record, so a guest who books online more than once has several
 * records with the same number, and was never known. They are still one person: records with the
 * same email are one guest everywhere in SALEANE (news.ts, cancelledTimes.ts). So a number is
 * also known when every record that has it shares one email, and the inbox files their texts
 * under the same record (`senderClient`, inbox.ts), so the guest's words and the answers stay in
 * one conversation.
 *
 * A number on records with different emails (a family sharing a phone, say) stays unknown, and a
 * sender the team matched by hand still proves nothing. Nobody is ever known in the booking page
 * chat, where anyone can type anything.
 */
export function textingGuest(
  s: BusinessState,
  channel: 'sms' | 'whatsapp',
  from: string,
): Client | undefined {
  return senderClient(s, channel, from)
}

/**
 * The records of the same guest that carry the same number as this one: the visits a text from
 * that number may ask about, and whose private links may go back to it.
 */
export function textingRecords(s: BusinessState, clientId: string): string[] {
  const client = s.clients.find((c) => c.id === clientId)
  if (!client) return [clientId]
  const number = textNumber(client.phone)
  const key = guestKey(client)
  return s.clients
    .filter(
      (c) =>
        c.id === client.id ||
        (number !== null && textNumber(c.phone) === number && guestKey(c) === key),
    )
    .map((c) => c.id)
}

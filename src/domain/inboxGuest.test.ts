import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch } from './commands'
import type { Command } from './commands'
import { DEMO_DATE } from './model'
import type { BusinessState, Client } from './model'
import { conversationKey, conversations, repliesList } from './inbox'
import { addDays } from './format'

// Stage 6: the Inbox shows one conversation per guest, however many records online booking
// opened for them. Records with the same email are one guest; nothing else ever joins.
const NOW = `${DEMO_DATE}T08:00:00.000Z`
function run(s: BusinessState, command: Command, now = NOW) {
  const result = dispatch(s, command, 'Maya', now)
  if (!result.ok) throw new Error(result.error)
  return result
}
const at = (days: number, hour = 9) =>
  `${addDays(DEMO_DATE, days)}T${String(hour).padStart(2, '0')}:00:00.000Z`

/** Olivia (client-2) with a second record from booking online, her email typed in capitals. */
function twoRecords(extra: Partial<Client> = {}) {
  const base = seed('UK')
  const olivia = base.clients.find((c) => c.id === 'client-2')!
  const online: Client = {
    ...olivia,
    id: 'client-online',
    email: olivia.email.toUpperCase(),
    phone: '+44 7700 900777',
    createdAt: at(-3),
    ...extra,
  }
  return { s: { ...base, clients: [...base.clients, online] }, olivia, online }
}
const email = (s: BusinessState, from: string, body: string, ref: string, now = NOW) =>
  run(s, { type: 'reply-received', channel: 'email', from, body, providerRef: ref }, now)
const text = (s: BusinessState, from: string, body: string, ref: string, now = NOW) =>
  run(s, { type: 'reply-received', channel: 'sms', from, body, providerRef: ref }, now)

describe('one conversation per guest (Stage 6)', () => {
  it('shows every record of one guest as one conversation, in time order', () => {
    const { s: start, olivia, online } = twoRecords()
    // She texts from the number on her first record, then from the one she typed online.
    let s = text(start, olivia.phone, 'Is Thursday still fine?', 'SM-1', at(-2)).state
    s = text(s, online.phone, 'Booked online for next week too.', 'SM-2', at(-1)).state
    s = run(s, {
      type: 'message',
      input: {
        clientId: olivia.id,
        purpose: 'appointment',
        channel: 'email',
        subject: 'Thursday',
        body: 'Thursday is fine, see you then.',
      },
    }).state
    const replies = repliesList(s).filter((r) => r.providerRef?.startsWith('SM-'))
    expect(replies.map((r) => r.clientId)).toEqual([olivia.id, online.id])
    const mine = conversations(s).filter((c) => c.clientIds.includes(olivia.id))
    expect(mine).toHaveLength(1)
    const [thread] = mine
    expect(thread.key).toBe(`guest:${olivia.email.toLowerCase()}`)
    expect(thread.clientIds.sort()).toEqual([olivia.id, online.id].sort())
    expect(conversations(s).some((c) => c.key === `client:${online.id}`)).toBe(false)
    // Every message from both records, oldest first, with both new replies counted.
    expect(thread.items.map((i) => i.at)).toEqual([...thread.items.map((i) => i.at)].sort())
    expect(
      thread.items.filter((i) => i.kind === 'reply').map((i) => i.kind === 'reply' && i.reply.id),
    ).toEqual(replies.map((r) => r.id))
    expect(thread.unread).toBe(2)
    expect(thread.drafts).toBe(1)
    // An answer goes to the record she last wrote under, so a text goes to the number she used.
    expect(thread.clientId).toBe(online.id)
    // Both records lead to the same conversation.
    expect(conversationKey(s, olivia.id)).toBe(thread.key)
    expect(conversationKey(s, online.id)).toBe(thread.key)
  })

  it('answers the record she last wrote under, even when the studio wrote later', () => {
    const { s: start, olivia, online } = twoRecords()
    let s = text(start, online.phone, 'Running late, sorry.', 'SM-late', at(-1)).state
    s = run(s, {
      type: 'message',
      input: {
        clientId: olivia.id,
        purpose: 'appointment',
        channel: 'email',
        subject: 'No rush',
        body: 'No rush at all.',
      },
    }).state
    const thread = conversations(s).find((c) => c.clientIds.includes(olivia.id))!
    expect(thread.clientId).toBe(online.id)
  })

  it('answers the record of her latest visit when she has not written', () => {
    const { s: start, olivia } = twoRecords()
    const s = run(start, {
      type: 'message',
      input: {
        clientId: 'client-online',
        purpose: 'appointment',
        channel: 'email',
        subject: 'Hello',
        body: 'A note about your next visit.',
      },
    }).state
    const thread = conversations(s).find((c) => c.clientIds.includes(olivia.id))!
    // Olivia's visits are all under her first record.
    expect(start.appointments.some((a) => a.clientId === olivia.id)).toBe(true)
    expect(thread.clientId).toBe(olivia.id)
  })

  it('keeps an email from an address on two records with the guest, not waiting unmatched', () => {
    const { s, olivia } = twoRecords()
    const result = email(s, olivia.email, 'Thank you!', 'EM-1')
    const reply = repliesList(result.state).find((r) => r.id === result.recordId)!
    // Her visits are under her first record, so it goes there.
    expect(reply.clientId).toBe(olivia.id)
    expect(conversations(result.state).some((c) => c.key.startsWith('from:'))).toBe(true)
    expect(conversations(result.state).some((c) => c.key === `from:${olivia.email}`)).toBe(false)
  })

  it('never joins records that do not share an email', () => {
    // A family sharing a phone, each with an email of their own.
    const {
      s: start,
      olivia,
      online,
    } = twoRecords({
      email: 'someone.else@example.com',
      phone: seed('UK').clients.find((c) => c.id === 'client-2')!.phone,
    })
    let s = run(start, {
      type: 'message',
      input: {
        clientId: online.id,
        purpose: 'appointment',
        channel: 'email',
        subject: 'Hello',
        body: 'A note.',
      },
    }).state
    s = email(s, olivia.email, 'Thanks', 'EM-2').state
    const threads = conversations(s)
    const hers = threads.find((c) => c.clientIds.includes(olivia.id))!
    const theirs = threads.find((c) => c.clientIds.includes(online.id))!
    expect(hers.key).not.toBe(theirs.key)
    expect(hers.clientIds).toEqual([olivia.id])
    expect(theirs.clientIds).toEqual([online.id])
  })

  it('never joins records without an email, even with the same name', () => {
    // A client always has an email today; should one ever be blank, it joins nobody.
    const base = seed('UK')
    const blank = (id: string): Client => ({ ...base.clients[0], id, name: 'Sam Lee', email: '' })
    const note = (id: string, clientId: string) => ({
      id,
      organisationId: base.organisation.id,
      clientId,
      channel: 'desk' as const,
      from: 'phone',
      body: 'Called to say thank you.',
      receivedAt: NOW,
      actor: 'Maya',
      readAt: NOW,
      readBy: 'Maya',
    })
    const s: BusinessState = {
      ...base,
      clients: [...base.clients, blank('blank-1'), blank('blank-2')],
      replies: [...repliesList(base), note('n-1', 'blank-1'), note('n-2', 'blank-2')],
    }
    const threads = conversations(s).filter((c) => c.clientIds.some((x) => x.startsWith('blank')))
    expect(threads.map((c) => c.clientIds).sort()).toEqual([['blank-1'], ['blank-2']])
    expect(new Set(threads.map((c) => c.key)).size).toBe(2)
  })

  it('keeps a reply whose record has gone as a conversation of its own', () => {
    const { s: start } = twoRecords()
    const s = text(start, start.clients[2].phone, 'Hello', 'SM-gone').state
    const reply = repliesList(s).find((r) => r.providerRef === 'SM-gone')!
    const gone = { ...s, replies: [...repliesList(s), { ...reply, id: 'r-x', clientId: 'nobody' }] }
    const thread = conversations(gone).find((c) => c.key === 'client:nobody')!
    expect(thread).toMatchObject({ clientId: 'nobody', clientIds: ['nobody'] })
    expect(conversationKey(gone, 'nobody')).toBe('client:nobody')
  })

  it('shows the sample regular who booked online again as one conversation', () => {
    for (const region of ['UK', 'US'] as const) {
      const s = seed(region, { regulars: true })
      const joined = conversations(s).filter((c) => c.clientIds.length > 1)
      expect(joined).toHaveLength(1)
      const [thread] = joined
      const [first, online] = [...thread.clientIds].sort()
      // Her answer goes to the record she booked online under, the one she last wrote from.
      expect(online).toBe(`${first}-online`)
      expect(thread).toMatchObject({ clientId: online, unread: 1 })
      expect(thread.items.filter((i) => i.kind === 'reply')).toHaveLength(2)
      // The visit she booked online moved with its record, so each record has visits.
      expect(s.appointments.some((a) => a.clientId === online)).toBe(true)
      expect(s.appointments.some((a) => a.clientId === first)).toBe(true)
    }
    // The quieter sample the tests use has no regulars, and no second records.
    expect(conversations(seed('UK')).every((c) => c.clientIds.length <= 1)).toBe(true)
  })
})

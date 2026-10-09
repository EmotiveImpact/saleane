import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { can, operations, permissionFor } from './operations'
import { conversations, repliesList, savedReplies, unreadReplies } from './inbox'
import { planMessages } from './reminders'
import { clientExport, clientExportText, erasureReview } from './privacy'

// V1.5: the inbox. Replies kept beside the studio's messages, one conversation per guest.
let sequence = 0
const makeId = () => `inbox-test-${++sequence}`
const NOW = `${DEMO_DATE}T08:00:00.000Z`
function run(s: BusinessState, command: Command, actor = 'Maya') {
  const result = dispatch(s, command, actor, NOW)
  if (!result.ok) throw new Error(result.error)
  return result
}
// Only a studio that sends plans messages; sample studios never do.
const sending = (s: BusinessState): BusinessState => ({
  ...s,
  operations: { ...s.operations!, mode: 'local' },
})
const draft = (
  s: BusinessState,
  extra: Partial<Extract<Command, { type: 'message' }>['input']> = {},
) =>
  run(s, {
    type: 'message',
    input: {
      clientId: 'client-3',
      purpose: 'appointment',
      subject: 'Thursday',
      body: 'Of course, we have moved you to 10:30.',
      ...extra,
    },
  })

describe('the inbox (V1.5)', () => {
  it('keeps a reply from the text line with the guest whose number it is, unread', () => {
    const s = seed('UK')
    const ellie = s.clients.find((c) => c.id === 'client-3')!
    const result = run(
      s,
      {
        type: 'reply-received',
        channel: 'sms',
        from: ellie.phone,
        body: '  Thank you!  ',
        providerRef: 'SM-new',
      },
      'Text line',
    )
    const reply = repliesList(result.state).find((r) => r.id === result.recordId)!
    expect(reply).toMatchObject({
      clientId: 'client-3',
      channel: 'sms',
      from: '+447700900003',
      body: 'Thank you!',
      actor: 'Text line',
    })
    expect(reply.readAt).toBeUndefined()
    expect(result.state.events.at(-1)).toMatchObject({ type: 'message', title: 'Text received' })
    // The provider sending it again keeps it once.
    const again = dispatch(
      result.state,
      {
        type: 'reply-received',
        channel: 'sms',
        from: ellie.phone,
        body: 'Thank you!',
        providerRef: 'SM-new',
      },
      'Text line',
      NOW,
    )
    expect(again.ok && again.state).toBe(result.state)
  })

  it('keeps a reply from an address nobody has, and matches it to a client later with its siblings', () => {
    let s = run(seed('UK'), {
      type: 'reply-received',
      channel: 'email',
      from: 'someone@example.net',
      body: 'Is there parking nearby?',
      providerRef: 'pm-1',
    }).state
    s = run(s, {
      type: 'reply-received',
      channel: 'email',
      from: 'someone@example.net',
      body: 'Also, do you take cards?',
      providerRef: 'pm-2',
    }).state
    const first = repliesList(s).find((r) => r.providerRef === 'pm-1')!
    expect(first.clientId).toBeUndefined()
    expect(conversations(s).some((c) => c.key === 'from:someone@example.net')).toBe(true)
    s = run(s, { type: 'reply-link', replyId: first.id, clientId: 'client-6' }).state
    expect(
      repliesList(s)
        .filter((r) => r.from === 'someone@example.net')
        .map((r) => r.clientId),
    ).toEqual(['client-6', 'client-6'])
    const linked = execute(
      s,
      { type: 'reply-link', replyId: first.id, clientId: 'client-5' },
      NOW,
      makeId,
    )
    expect(linked.ok || linked.error).toBe('This reply is already with a client.')
  })

  it('lets the desk note a reply given by phone, read already, and refuses health details', () => {
    const s = seed('UK')
    const noted = run(s, {
      type: 'reply-note',
      clientId: 'client-2',
      how: 'phone',
      body: 'Rang to say she will be ten minutes late.',
    })
    expect(repliesList(noted.state).at(-1)).toMatchObject({
      channel: 'desk',
      from: 'phone',
      actor: 'Maya',
      readBy: 'Maya',
    })
    const health = execute(
      s,
      { type: 'reply-note', clientId: 'client-2', how: 'phone', body: 'Mentioned a new allergy.' },
      NOW,
      makeId,
    )
    expect(health.ok || health.error).toMatch(/cannot hold health details \(“allergy”\)/)
  })

  it('marks replies read with who read them, and a second read changes nothing', () => {
    const s = seed('UK')
    expect(unreadReplies(s).map((r) => r.id)).toEqual(['reply-ellie', 'reply-unknown'])
    const read = run(s, { type: 'replies-read', replyIds: ['reply-ellie'] }, 'Priya')
    expect(repliesList(read.state).find((r) => r.id === 'reply-ellie')).toMatchObject({
      readAt: NOW,
      readBy: 'Priya',
    })
    const again = dispatch(
      read.state,
      { type: 'replies-read', replyIds: ['reply-ellie'] },
      'Maya',
      NOW,
    )
    expect(again.ok && again.state).toBe(read.state)
  })

  it('reads as one conversation per guest, newest first, with unread replies counted', () => {
    const s = draft(seed('UK')).state
    const [ellie] = conversations(s).filter((c) => c.clientId === 'client-3')
    expect(ellie.unread).toBe(1)
    expect(ellie.drafts).toBe(1)
    expect(ellie.items.map((i) => i.kind)).toEqual(['reply', 'message'])
    // An approved message is shown once, with what the outbox did with it.
    const messageId = operations(s).messages.at(-1)!.id
    const withSent = conversations(s, [
      {
        id: 'row-1',
        clientId: 'client-3',
        kind: 'message',
        channel: 'sms',
        recipient: '+447700900003',
        subject: 'Thursday',
        body: 'Of course',
        status: 'test',
        provider: 'test',
        detail: null,
        createdAt: NOW,
        updatedAt: NOW,
        messageId,
      },
    ]).find((c) => c.clientId === 'client-3')!
    expect(withSent.items).toHaveLength(2)
    const item = withSent.items.find((i) => i.kind === 'message')!
    expect(item.kind === 'message' && item.delivery?.status).toBe('test')
  })

  it('sends an approved message once through the outbox, by the channel chosen', () => {
    let s = seed('UK')
    const written = draft(s, { channel: 'sms' })
    s = written.state
    expect(planMessages(sending(s), NOW, []).some((m) => m.kind === 'message')).toBe(false)
    s = run(s, { type: 'message-queue', messageId: written.recordId! }).state
    const message = operations(s).messages.find((m) => m.id === written.recordId)!
    expect(message.approvedAt).toBe(NOW)
    const planned = planMessages(sending(s), NOW, []).filter((m) => m.kind === 'message')
    expect(planned).toEqual([
      expect.objectContaining({
        channel: 'sms',
        recipient: '+447700900003',
        slot: `message:${message.id}`,
        body: 'Of course, we have moved you to 10:30.',
      }),
    ])
    // Once recorded, it is not planned again.
    expect(
      planMessages(sending(s), NOW, [
        {
          appointmentId: '',
          clientId: 'client-3',
          kind: 'message',
          channel: 'sms',
          slot: `message:${message.id}`,
          status: 'test',
        },
      ]).some((m) => m.kind === 'message'),
    ).toBe(false)
  })

  it('never sends a message queued before the outbox took them, or one approved long ago', () => {
    const s = seed('UK')
    s.operations!.messages.push({
      id: 'old-queued',
      clientId: 'client-1',
      purpose: 'appointment',
      subject: 'Old',
      body: 'Queued before sending was connected.',
      status: 'queued',
      createdAt: '2026-09-01T09:00:00.000Z',
      actor: 'Maya',
    })
    s.operations!.messages.push({
      id: 'old-approved',
      clientId: 'client-1',
      purpose: 'appointment',
      subject: 'Old',
      body: 'Approved weeks ago.',
      status: 'queued',
      createdAt: '2026-09-01T09:00:00.000Z',
      approvedAt: '2026-09-01T09:00:00.000Z',
      actor: 'Maya',
    })
    expect(planMessages(sending(s), NOW, []).some((m) => m.kind === 'message')).toBe(false)
  })

  it('refuses email news by text, and approval with nowhere to send it', () => {
    const s = seed('UK')
    const news = execute(
      s,
      {
        type: 'message',
        input: {
          clientId: 'client-1',
          purpose: 'marketing',
          channel: 'sms',
          subject: 'News',
          body: 'Autumn offers.',
        },
      },
      NOW,
      makeId,
    )
    expect(news.ok || news.error).toMatch(/by email only/)
    s.clients.find((c) => c.id === 'client-3')!.phone = '07700 900003'
    const written = draft(s, { channel: 'sms' })
    const approve = execute(
      written.state,
      { type: 'message-queue', messageId: written.recordId! },
      NOW,
      makeId,
    )
    expect(approve.ok || approve.error).toMatch(/no mobile number with its country code/)
  })

  it('keeps saved replies for owners and managers to look after, with names kept apart', () => {
    let s = seed('UK')
    expect(savedReplies(s)).toHaveLength(3)
    const saved = run(s, {
      type: 'saved-reply-save',
      input: { name: 'Parking', body: 'There is parking on the street after 6pm.' },
    })
    s = saved.state
    const clash = execute(
      s,
      { type: 'saved-reply-save', input: { name: 'parking', body: 'Another.' } },
      NOW,
      makeId,
    )
    expect(clash.ok || clash.error).toBe('A saved reply already has this name.')
    s = run(s, { type: 'saved-reply-remove', id: saved.recordId! }).state
    expect(savedReplies(s).map((r) => r.name)).not.toContain('Parking')
    expect(can('manager', 'saved-replies')).toBe(true)
    expect(can('reception', 'saved-replies')).toBe(false)
    expect(can('reception', 'message')).toBe(true)
    expect(can('practitioner', 'message')).toBe(false)
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const)
      expect(can(role, 'reply-received')).toBe(false)
  })

  it('puts their replies in their export, and keeps approved messages when erasure is reviewed', () => {
    let s = seed('UK')
    const written = draft(s)
    s = run(written.state, { type: 'message-queue', messageId: written.recordId! }).state
    const file = clientExport(s, 'client-3', { generatedAt: NOW, generatedBy: 'Maya' })
    expect(file.replies).toEqual([
      expect.objectContaining({
        how: 'Text from +447700900003',
        words: expect.stringContaining('half an hour later'),
      }),
    ])
    expect(file.messages.at(-1)?.delivery).toMatch(/Approved for sending/)
    expect(clientExportText(file)).toContain('REPLIES (1)')
    const review = erasureReview(s, 'client-3', DEMO_DATE)
    expect(review.kept.find((k) => k.label === 'Messages approved for sending')?.count).toBe(1)
  })

  it('respects a client who asked for no appointment texts, and needs the right to approve', () => {
    let s = seed('UK')
    const written = draft(s, { channel: 'sms' })
    s = structuredClone(written.state)
    s.clients.find((c) => c.id === 'client-3')!.noTextReminders = true
    const approve = execute(s, { type: 'message-queue', messageId: written.recordId! }, NOW, makeId)
    expect(approve.ok || approve.error).toMatch(/asked for no appointment texts/)
    // Approved before they asked: it is not planned after all.
    const before = run(written.state, { type: 'message-queue', messageId: written.recordId! }).state
    before.clients.find((c) => c.id === 'client-3')!.noTextReminders = true
    expect(planMessages(sending(before), NOW, []).some((m) => m.kind === 'message')).toBe(false)
    expect(permissionFor({ type: 'message', approve: true })).toBe('message.queue')
    expect(can('reception', permissionFor({ type: 'message', approve: true }))).toBe(false)
    expect(can('reception', permissionFor({ type: 'message' }))).toBe(true)
  })

  it('keeps a later reply from a sender matched before with the same client', () => {
    let s = run(seed('UK'), {
      type: 'reply-received',
      channel: 'sms',
      from: '+447700900888',
      body: 'Hi, it is Grace on my work phone.',
      providerRef: 'SM-a',
    }).state
    const first = repliesList(s).find((r) => r.providerRef === 'SM-a')!
    s = run(s, { type: 'reply-link', replyId: first.id, clientId: 'client-6' }).state
    const later = run(s, {
      type: 'reply-received',
      channel: 'sms',
      from: '+44 7700 900888',
      body: 'Running ten minutes late.',
      providerRef: 'SM-b',
    })
    expect(repliesList(later.state).find((r) => r.id === later.recordId)?.clientId).toBe('client-6')
  })

  it('never matches a message left in the booking page chat by the details the visitor typed', () => {
    const s = seed('UK')
    const amelia = s.clients.find((c) => c.id === 'client-1')!
    const timeline = (state: BusinessState) =>
      state.events.filter((e) => e.clientId === amelia.id).length
    const left = (state: BusinessState, from: string, providerRef: string) =>
      run(
        state,
        {
          type: 'reply-received',
          channel: 'chat',
          from,
          body: 'Amelia Carter: please call me',
          providerRef,
        },
        'AI receptionist',
      )
    // Anyone can type a client's email or number into the chat, so neither finds the client.
    let result = left(s, amelia.email, 'chat-1')
    expect(repliesList(result.state).find((r) => r.id === result.recordId)?.clientId).toBe(
      undefined,
    )
    result = left(result.state, '+447700900001', 'chat-2')
    expect(repliesList(result.state).find((r) => r.id === result.recordId)?.clientId).toBe(
      undefined,
    )
    expect(timeline(result.state)).toBe(timeline(s))
    // The team matches it by hand; a later chat giving the same address still waits for them.
    const first = repliesList(result.state).find((r) => r.providerRef === 'chat-1')!
    let next = run(result.state, {
      type: 'reply-link',
      replyId: first.id,
      clientId: amelia.id,
    }).state
    expect(repliesList(next).find((r) => r.id === first.id)?.clientId).toBe(amelia.id)
    const matched = timeline(next)
    result = left(next, amelia.email, 'chat-3')
    expect(repliesList(result.state).find((r) => r.id === result.recordId)?.clientId).toBe(
      undefined,
    )
    expect(timeline(result.state)).toBe(matched)
    // A text from the number on her record still goes with her.
    next = run(result.state, {
      type: 'reply-received',
      channel: 'sms',
      from: amelia.phone,
      body: 'Running late',
      providerRef: 'SM-amelia',
    }).state
    expect(repliesList(next).find((r) => r.providerRef === 'SM-amelia')?.clientId).toBe(amelia.id)
  })

  it('refuses a reply that names a client who is not there', () => {
    const s = seed('UK')
    s.replies![0].clientId = 'client-missing'
    expect(() => parseState(s, 'UK')).toThrow('does not match its client')
  })
})

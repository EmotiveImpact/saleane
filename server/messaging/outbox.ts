import { randomUUID } from 'node:crypto'
import { staleInvitation } from '../../src/domain/cancelledTimes'
import { agreedEverywhere } from '../../src/domain/dueBack'
import {
  BOOK_LINK,
  MANAGE_LINK,
  aftercareDue,
  birthdayDue,
  channelsFor,
  clientSlot,
  composeClientMessage,
  composeMissedCallText,
  missedCallSlot,
  missedCallTextDue,
  isClientKind,
  messageSlot,
  socialSlot,
  appointmentMessagesOff,
  missYouDue,
  dueBackDue,
  composeMessage,
  planMessages,
  textNumber,
  feedbackDue,
  patchTestReminderDue,
  visitSlot,
} from '../../src/domain/reminders'
import type { MessageKind, OutboxChannel, OutboxStatus } from '../../src/domain/reminders'
import { operations } from '../../src/domain/operations'
import { socialWindowEnds } from '../../src/domain/inbox'
import { isSocialChannel } from '../../src/domain/inboxSchema'
import {
  answersCalls,
  answersSocial,
  answersTexts,
  visitSummary,
} from '../../src/assistant/receptionist'
import { visitStart } from '../../src/domain/guest'
import type { Context } from '../context'
import { issueGuestLink } from '../routes/guest'
import { renderEmail, studioSender } from '../../src/email/render'
import { providerFor } from './providers'
import type { Providers, Receipt } from './providers'

export type OutboxRow = {
  id: string
  organisation_id: string
  dedupe_key: string
  appointment_id: string
  client_id: string
  kind: MessageKind
  channel: OutboxChannel
  slot: string
  recipient: string
  subject: string
  body: string
  status: OutboxStatus
  provider: string | null
  provider_ref: string | null
  detail: string | null
  attempts: number
  next_attempt_at: number
  created_at: number
  updated_at: number
}
/** Transient refusals are tried this many times in all, further apart each time. */
export const MAX_ATTEMPTS = 3
const RETRY_MS = [60000, 5 * 60000]
const BATCH = 50
/** An AI receptionist's answer that could not go out within this long is not sent at all. */
const RECEPTION_STALE_MS = 15 * 60000

type Org = NonNullable<ReturnType<Context['systemOrg']>>
/** Where each placeholder in a message's stored words goes as it is sent. */
type Links = Partial<Record<typeof BOOK_LINK | typeof MANAGE_LINK, string>>
/** Sent because the guest agreed to keep in touch, not because of a visit they booked. */
const keepInTouch = new Set<MessageKind>(['birthday', 'miss_you', 'due_back'])

/**
 * NEXT-13: the email as the guest sees it, in the studio's colours, made from the same words as
 * the plain-text part. Should the design ever fail, the email still goes, in plain words.
 */
function designed(org: Org, subject: string, stored: string, links: Links, typed: boolean) {
  try {
    return renderEmail({
      subject,
      text: stored,
      links,
      details: !typed,
      from: studioSender(org.state),
    })
  } catch (error) {
    console.error('[SALEANE] An email design could not be made; sending the plain words.', error)
    return undefined
  }
}

/**
 * The outbox: plans confirmations and reminders from studio records, then hands each one to the
 * configured provider exactly once. Messages live in their own table rather than the studio
 * record, so sending never collides with someone editing the calendar.
 */
export function createOutbox(ctx: Context, providers: Providers) {
  const { db, now } = ctx
  let running: Promise<void> | null = null
  const bookAt = (org: Org) => `${ctx.allowedOrigin}/book/${org.slug}`

  /** Records anything newly due. Safe to repeat: each message has one key per visit time. */
  const plan = () => {
    const orgs = db.all<{ id: string }>(
      "SELECT id FROM organisations WHERE json_extract(state,'$.operations.mode')='local'",
    )
    for (const { id } of orgs) {
      const org = ctx.systemOrg(id)
      if (!org) continue
      const recorded = db
        .all<
          Pick<
            OutboxRow,
            'appointment_id' | 'client_id' | 'kind' | 'channel' | 'slot' | 'status' | 'created_at'
          >
        >(
          'SELECT appointment_id,client_id,kind,channel,slot,status,created_at FROM outbox WHERE organisation_id=?',
          id,
        )
        .map((row) => ({
          appointmentId: row.appointment_id,
          clientId: row.client_id,
          kind: row.kind,
          channel: row.channel,
          slot: row.slot,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
        }))
      const time = now()
      for (const message of planMessages(org.state, new Date(time).toISOString(), recorded))
        db.run(
          `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
          randomUUID(),
          id,
          message.dedupeKey,
          message.appointmentId,
          message.clientId,
          message.kind,
          message.channel,
          message.slot,
          message.recipient,
          message.subject,
          message.body,
          time,
          time,
          time,
        )
    }
  }

  const finish = (row: OutboxRow, status: OutboxStatus, fields: Partial<OutboxRow> = {}) =>
    db.run(
      'UPDATE outbox SET status=?,provider=?,provider_ref=?,detail=?,next_attempt_at=?,updated_at=? WHERE id=?',
      status,
      fields.provider ?? row.provider,
      fields.provider_ref ?? row.provider_ref,
      fields.detail ?? null,
      fields.next_attempt_at ?? row.next_attempt_at,
      now(),
      row.id,
    )

  /**
   * Re-checks one message against the current records and prepares its text. Runs in a
   * transaction and marks the row "unknown" before anything leaves, so a crash mid-send leaves an
   * honest "check before resending" rather than a silent second copy.
   */
  const claim = (row: OutboxRow) =>
    db.transaction(() => {
      const fresh = db.get<OutboxRow>(
        "SELECT * FROM outbox WHERE id=? AND status='pending'",
        row.id,
      )
      if (!fresh) return null
      const org = ctx.systemOrg(fresh.organisation_id)
      const client = org?.state.clients.find((c) => c.id === fresh.client_id)
      const skip = (detail: string) => {
        finish(fresh, 'skipped', { detail })
        return null
      }
      if (org && fresh.kind === 'missed_call') {
        // V1.5: a caller may not be a client at all. Checked again now: called back meanwhile,
        // switched off, too late, or the number belongs to a client who asked for no texts.
        const call = (operations(org.state).missedCalls ?? []).find(
          (c) => c.number === fresh.recipient && missedCallSlot(org.state, c) === fresh.slot,
        )
        if (!call || !missedCallTextDue(org.state, call, new Date(now()).toISOString()))
          return skip('Called back, turned off or too late before it went out.')
        const text = composeMissedCallText(org.state)
        return send(fresh, org, fresh.recipient, '', text.body, { [BOOK_LINK]: bookAt(org) })
      }
      if (org && fresh.kind === 'receptionist') {
        // V4: an answer to a guest's text. Checked again now: still a studio of its own, still
        // switched on, and not so late that the answer no longer fits the question.
        if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
        if (now() - fresh.created_at > RECEPTION_STALE_MS)
          return skip('Too late to answer by the time it could go out.')
        // A visit's private link goes only to the number still on that guest's record, and only
        // while the visit is still to come.
        const links: Links = {}
        if (fresh.body.includes(MANAGE_LINK)) {
          const visit = org.state.appointments.find(
            (a) => a.id === fresh.appointment_id && a.clientId === fresh.client_id,
          )
          if (
            !client ||
            !visit ||
            visit.status !== 'confirmed' ||
            visitStart(org.state, visit.id) <= now() ||
            !textNumber(client.phone) ||
            textNumber(client.phone) !== textNumber(fresh.recipient) ||
            // Moved meanwhile: the answer would name the old day, time or person.
            !fresh.body.includes(visitSummary(org.state, visit))
          )
            return skip('The visit or the number on the booking changed before it went out.')
          links[MANAGE_LINK] = issueGuestLink(ctx, org, visit.id, 'message').url
        }
        if (isSocialChannel(fresh.channel)) {
          // On a social app, only from the account the guest wrote to, and within its day.
          if (!answersSocial(org.state))
            return skip('Answering these messages was turned off before it went out.')
          const kept = (org.state.replies ?? []).find(
            (r) => r.channel === fresh.channel && `reception:${r.providerRef}` === fresh.slot,
          )
          const account =
            kept?.account &&
            db.get<{ account_id: string }>(
              'SELECT account_id FROM social_accounts WHERE organisation_id=? AND channel=? AND account_id=?',
              org.id,
              fresh.channel,
              kept.account,
            )
          if (!account) return skip('The account was disconnected or changed before it went out.')
          const ends = socialWindowEnds(org.state, fresh.channel, fresh.recipient, kept.account)
          if (!ends || now() >= ends)
            return skip('The app’s day to answer ended before it went out.')
          return send(fresh, org, fresh.recipient, '', fresh.body, links, {
            account: account.account_id,
          })
        }
        // NEXT-17: a booking link the receptionist texted to someone it was speaking to on the phone.
        if (fresh.slot.startsWith('call:')) {
          if (!answersCalls(org.state))
            return skip('Answering calls was turned off before it went out.')
        } else if (!answersTexts(org.state))
          return skip('Answering texts was turned off before it went out.')
        return send(fresh, org, fresh.recipient, '', fresh.body, links)
      }
      if (org && fresh.kind === 'social') {
        // V4: the team's answer on Instagram, Facebook or WhatsApp. Checked again now: still a
        // studio of its own, the account still connected, and still within the app's day.
        if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
        const answer = (org.state.socialAnswers ?? []).find((a) => socialSlot(a.id) === fresh.slot)
        if (!answer) return skip('The answer is no longer in the studio record.')
        if (!isSocialChannel(fresh.channel)) return skip('Not a social app.')
        // Only the account the guest wrote to can answer them: their id belongs to it.
        const account = db.get<{ account_id: string }>(
          'SELECT account_id FROM social_accounts WHERE organisation_id=? AND channel=? AND account_id=?',
          org.id,
          fresh.channel,
          answer.account,
        )
        if (!account) return skip('The account was disconnected or changed before it went out.')
        const ends = socialWindowEnds(org.state, fresh.channel, fresh.recipient, answer.account)
        if (!ends || now() >= ends) return skip('The app’s day to answer ended before it went out.')
        return send(
          fresh,
          org,
          fresh.recipient,
          '',
          answer.body,
          {},
          {
            account: account.account_id,
          },
        )
      }
      if (fresh.channel !== 'email' && fresh.channel !== 'sms')
        return skip('This message cannot go on a social app.')
      if (!org || !client) return skip('The visit is no longer in the studio record.')
      if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
      if (fresh.kind === 'message') {
        // V1.5: written in the inbox. Checked again now: still queued, still agreed, still reachable.
        const message = operations(org.state).messages.find((m) => messageSlot(m.id) === fresh.slot)
        if (!message || message.status !== 'queued')
          return skip('Stopped or changed before it went out.')
        if (
          message.purpose === 'marketing' &&
          (!client.marketingConsent || (message.opening && !agreedEverywhere(org.state, client.id)))
        )
          return skip('Email news was no longer agreed before it went out.')
        if (message.purpose === 'appointment' && appointmentMessagesOff(client, fresh.channel))
          return skip('Turned off for this client before it went out.')
        // NEXT-11: an invitation to a freed time goes only while that time is still free.
        if (staleInvitation(org.state, message.id, new Date(now()).toISOString()))
          return skip('The time was booked, or had passed, before it went out.')
        const to = fresh.channel === 'email' ? client.email.trim() : textNumber(client.phone)
        if (!to) return skip('The client has no address for this channel now.')
        return send(
          fresh,
          org,
          to,
          message.subject,
          message.body,
          { [BOOK_LINK]: bookAt(org) },
          // Words a person wrote: no visit card, and news goes the way news must.
          { typed: true, stream: message.purpose === 'marketing' ? 'broadcast' : 'transactional' },
        )
      }
      // V1.5: a birthday or "we miss you" is about the guest, not a visit. Checked again now.
      const kind = fresh.kind
      let current: { subject: string; body: string } | null = null
      let visitId = ''
      if (isClientKind(kind)) {
        const nowIso = new Date(now()).toISOString()
        const due = kind === 'birthday' ? birthdayDue : missYouDue
        if (
          !due(org.state, client, nowIso) ||
          clientSlot(org.state, client, kind, nowIso) !== fresh.slot ||
          !channelsFor(org.state, client).includes(fresh.channel)
        )
          return skip('Turned off, booked again or no longer agreed before it went out.')
        current = composeClientMessage(org.state, client, kind)
      } else {
        const visit = org.state.appointments.find((a) => a.id === fresh.appointment_id)
        if (!visit) return skip('The visit is no longer in the studio record.')
        const after = ['feedback', 'aftercare', 'due_back'].includes(kind)
        const wanted = kind === 'cancelled' ? 'cancelled' : after ? 'completed' : 'confirmed'
        if (visit.status !== wanted || visitSlot(visit) !== fresh.slot)
          return skip('The visit changed before this went out.')
        if (
          kind === 'feedback' &&
          !feedbackDue(org.state, visit, visitStart(org.state, visit.id), now())
        )
          return skip('Answered, turned off or too late before it went out.')
        if (
          kind === 'patch_test' &&
          !patchTestReminderDue(org.state, visit, visitStart(org.state, visit.id), now())
        )
          return skip('A patch test was recorded, or it was too late, before it went out.')
        if (kind === 'aftercare' && !aftercareDue(org.state, visit, now()))
          return skip('Turned off, advice removed or too late before it went out.')
        if (kind === 'due_back' && !dueBackDue(org.state, visit, new Date(now()).toISOString()))
          return skip('Booked again, turned off or no longer agreed before it went out.')
        if (kind !== 'cancelled' && !channelsFor(org.state, client).includes(fresh.channel))
          return skip('Turned off for this client or studio before it went out.')
        // The studio's rules may have changed since this was queued: say what they are now.
        if (kind === 'patch_test' || kind === 'aftercare' || kind === 'due_back')
          current = composeMessage(org.state, visit, kind, fresh.channel)
        visitId = visit.id
      }
      const words = current?.body ?? fresh.body
      const links: Links = { [BOOK_LINK]: bookAt(org) }
      if (words.includes(MANAGE_LINK)) {
        try {
          links[MANAGE_LINK] = issueGuestLink(ctx, org, visitId, 'message').url
        } catch {
          return skip('The visit is too close or too far past for a manage link.')
        }
      }
      // Messages that can go days or weeks after planning use the contact on file now.
      const to = !current
        ? fresh.recipient
        : fresh.channel === 'email'
          ? client.email.trim()
          : textNumber(client.phone)
      if (!to) return skip('The client has no address for this channel now.')
      return send(fresh, org, to, current?.subject ?? fresh.subject, words, links, {
        stream: keepInTouch.has(kind) ? 'broadcast' : 'transactional',
      })
    })

  /**
   * Marks a claimed message "unknown" with the words and address it is about to go with, and
   * hands back what the provider needs. Only `stored` is kept, with its placeholders: the private
   * link each one becomes is made for this message and never written down.
   */
  const send = (
    fresh: OutboxRow,
    org: Org,
    to: string,
    subject: string,
    stored: string,
    links: Links,
    options: {
      /** V4: the studio's own account a social answer goes from. */
      account?: string
      /** NEXT-13: news and keeping in touch go apart from visit messages, as providers ask. */
      stream?: 'transactional' | 'broadcast'
      /** Words a person typed, rather than SALEANE's own messages. */
      typed?: boolean
    } = {},
  ) => {
    const { account, stream = 'transactional', typed = false } = options
    const provider = providerFor(providers, fresh.channel)
    const sending = Object.entries(links).reduce(
      (text, [placeholder, url]) => (url ? text.replaceAll(placeholder, url) : text),
      stored,
    )
    const email = fresh.channel === 'email'
    const html = email ? designed(org, subject, stored, links, typed) : undefined
    db.run(
      "UPDATE outbox SET status='unknown',provider=?,attempts=attempts+1,detail=?,recipient=?,subject=?,body=?,updated_at=? WHERE id=?",
      provider.name,
      'Sending was interrupted. Check before sending again.',
      to,
      subject,
      stored,
      now(),
      fresh.id,
    )
    return {
      row: { ...fresh, recipient: to, provider: provider.name, attempts: fresh.attempts + 1 },
      message: {
        id: fresh.id,
        channel: fresh.channel,
        to,
        subject,
        body: sending,
        fromName: org.state.organisation.name,
        ...(account ? { account } : {}),
        ...(email ? { stream } : {}),
        ...(html ? { html } : {}),
      },
    }
  }

  const deliver = async () => {
    const due = db.all<OutboxRow>(
      "SELECT * FROM outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at LIMIT ?",
      now(),
      BATCH,
    )
    for (const candidate of due) {
      const claimed = claim(candidate)
      if (!claimed) continue
      const { row, message } = claimed
      const result = await providerFor(providers, row.channel).send(message)
      if (result.outcome === 'test') finish(row, 'test', { detail: null })
      else if (result.outcome === 'accepted')
        finish(row, 'accepted', { provider_ref: result.providerRef, detail: null })
      else if (result.outcome === 'unknown') finish(row, 'unknown', { detail: result.detail })
      else if (result.retry && row.attempts < MAX_ATTEMPTS)
        finish(row, 'pending', {
          detail: result.detail,
          next_attempt_at: now() + RETRY_MS[Math.min(row.attempts - 1, RETRY_MS.length - 1)],
        })
      else finish(row, 'failed', { detail: result.detail })
    }
  }

  /** One pass: plan, then send. Overlapping calls share the pass already running. */
  const tick = () => {
    running ??= (async () => {
      try {
        plan()
        await deliver()
      } finally {
        running = null
      }
    })()
    return running
  }

  /** A verified provider receipt. Only a receipt can turn a message into "delivered". */
  const record = (receipt: Receipt) => {
    const row = receipt.providerRef
      ? db.get<OutboxRow>(
          'SELECT * FROM outbox WHERE provider=? AND provider_ref=?',
          receipt.provider,
          receipt.providerRef,
        )
      : receipt.outboxId
        ? // Only a row handed to this sender (accepted, or unclear when the line dropped) can be
          // named by the id SALEANE gave it.
          db.get<OutboxRow>(
            "SELECT * FROM outbox WHERE provider=? AND id=? AND (provider_ref IS NOT NULL OR status='unknown')",
            receipt.provider,
            receipt.outboxId,
          )
        : undefined
    if (!row) return false
    // Delivered applies to a message on its way. A failure also applies to one already delivered,
    // as a bounce can come back after the guest's provider first took it, and nothing undoes it.
    const open = row.status === 'accepted' || row.status === 'unknown'
    if (receipt.delivered ? !open : !open && row.status !== 'delivered') return false
    finish(row, receipt.delivered ? 'delivered' : 'failed', {
      detail: receipt.delivered ? null : (receipt.detail ?? 'The provider could not deliver it.'),
    })
    return true
  }

  /** Staff ask for a failed or unclear message to go again; it is re-checked before it goes. */
  const retry = (organisationId: string, id: string) =>
    Number(
      db.run(
        "UPDATE outbox SET status='pending',detail=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND organisation_id=? AND status IN ('failed','unknown')",
        now(),
        now(),
        id,
        organisationId,
      ).changes,
    ) === 1

  let timer: ReturnType<typeof setInterval> | undefined
  let nudge: ReturnType<typeof setTimeout> | undefined
  return {
    providers,
    plan,
    deliver,
    tick,
    record,
    retry,
    start(intervalMs = 30000) {
      timer ??= setInterval(() => void tick().catch(() => {}), intervalMs)
      timer.unref?.()
    },
    /** Runs a pass shortly, gathering a burst of changes into one. */
    soon(delayMs = 1500) {
      if (nudge) return
      nudge = setTimeout(() => {
        nudge = undefined
        void tick().catch(() => {})
      }, delayMs)
      nudge.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      if (nudge) clearTimeout(nudge)
      timer = nudge = undefined
    },
  }
}
export type Outbox = ReturnType<typeof createOutbox>

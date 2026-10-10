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
  clientsWithNumber,
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
import { answersSocial, answersTexts, visitSummary } from '../../src/assistant/receptionist'
import { visitStart } from '../../src/domain/guest'
import { textsStopped } from '../../src/domain/textStop'
import { isPlanCardKind, planCardMessage, readPlanCardSlot } from '../../src/domain/planCards'
import type { Context } from '../context'
import { issueGuestLink } from '../routes/guest'
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

/**
 * The outbox: plans confirmations and reminders from studio records, then hands each one to the
 * configured provider exactly once. Messages live in their own table rather than the studio
 * record, so sending never collides with someone editing the calendar.
 */
export function createOutbox(ctx: Context, providers: Providers) {
  const { db, now } = ctx
  let running: Promise<void> | null = null

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
        return send(
          fresh,
          org,
          fresh.recipient,
          '',
          text.body,
          text.body.replaceAll(BOOK_LINK, `${ctx.allowedOrigin}/book/${org.slug}`),
        )
      }
      if (org && fresh.kind === 'receptionist') {
        // V4: an answer to a guest's text. Checked again now: still a studio of its own, still
        // switched on, and not so late that the answer no longer fits the question.
        if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
        if (now() - fresh.created_at > RECEPTION_STALE_MS)
          return skip('Too late to answer by the time it could go out.')
        // A visit's private link goes only to the number still on that guest's record, and only
        // while the visit is still to come.
        let sending = fresh.body
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
          sending = fresh.body.replaceAll(
            MANAGE_LINK,
            issueGuestLink(ctx, org, visit.id, 'message').url,
          )
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
          return send(fresh, org, fresh.recipient, '', fresh.body, sending, account.account_id)
        }
        if (!answersTexts(org.state))
          return skip('Answering texts was turned off before it went out.')
        // Stage 1: a client with this number asked for no texts meanwhile.
        if (clientsWithNumber(org.state, fresh.recipient).some((c) => c.noTextReminders))
          return skip('Texts were turned off for this number before it went out.')
        return send(fresh, org, fresh.recipient, '', fresh.body, sending)
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
        return send(fresh, org, fresh.recipient, '', answer.body, answer.body, account.account_id)
      }
      if (fresh.channel !== 'email' && fresh.channel !== 'sms')
        return skip('This message cannot go on a social app.')
      if (!org || !client) return skip('The visit is no longer in the studio record.')
      if (operations(org.state).mode !== 'local') return skip('Sample studios never send.')
      if (isPlanCardKind(fresh.kind)) {
        // Stage 1: about a membership's card payment. Checked again now: still running, still
        // unpaid, still due to be taken (for a reminder), and the client still reachable this way.
        if (fresh.kind === 'plan_reminder' && ctx.plans.readOnly(org.id))
          return skip('The studio is read only, so no membership payment will be taken.')
        const { holdingId, periodStart } = readPlanCardSlot(fresh.slot)
        const text = planCardMessage(
          org.state,
          fresh.kind,
          holdingId,
          periodStart,
          fresh.channel,
          new Date(now()).toISOString(),
        )
        if (!text) return skip('Paid, ended or changed before it went out.')
        const to = fresh.channel === 'email' ? client.email.trim() : textNumber(client.phone)
        if (!to) return skip('The client has no address for this channel now.')
        return send(fresh, org, to, text.subject, text.body, text.body)
      }
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
        const body = message.body.replaceAll(BOOK_LINK, `${ctx.allowedOrigin}/book/${org.slug}`)
        return send(fresh, org, to, message.subject, message.body, body)
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
      let body = current?.body ?? fresh.body
      body = body.replaceAll(BOOK_LINK, `${ctx.allowedOrigin}/book/${org.slug}`)
      if (body.includes(MANAGE_LINK)) {
        try {
          body = body.replaceAll(MANAGE_LINK, issueGuestLink(ctx, org, visitId, 'message').url)
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
      return send(
        fresh,
        org,
        to,
        current?.subject ?? fresh.subject,
        current?.body ?? fresh.body,
        body,
      )
    })

  /**
   * Marks a claimed message "unknown" with the words and address it is about to go with, and
   * hands back what the provider needs. Only `stored` is kept: the private link in `sending` is
   * never written down.
   */
  const send = (
    fresh: OutboxRow,
    org: NonNullable<ReturnType<Context['systemOrg']>>,
    to: string,
    subject: string,
    stored: string,
    sending: string,
    /** V4: the studio's own account a social answer goes from. */
    account?: string,
  ) => {
    // Stage 1: whatever planned it, nothing is texted to a number that replied STOP and has not
    // texted START since, client or not (src/domain/textStop.ts).
    if (fresh.channel === 'sms' && textsStopped(org.state, to)) {
      finish(fresh, 'skipped', {
        detail: 'This number replied STOP, so SALEANE does not text it until they text START.',
      })
      return null
    }
    const provider = providerFor(providers, fresh.channel)
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
    const row = db.get<OutboxRow>(
      'SELECT * FROM outbox WHERE provider=? AND provider_ref=?',
      receipt.provider,
      receipt.providerRef,
    )
    if (!row || row.status === 'delivered') return false
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

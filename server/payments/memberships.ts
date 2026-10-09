import { randomUUID } from 'node:crypto'
import { dispatch } from '../../src/domain/commands'
import type { Command } from '../../src/domain/commands'
import { operations } from '../../src/domain/operations'
import { holdings, openCardAgreement, periodStartFor } from '../../src/domain/plans'
import {
  cardChargeProblem,
  cardMonthDue,
  nextTryAt,
  planCardChannels,
  planCardMessage,
  planCardSlot,
  reminderWindow,
  upcomingCardPayment,
} from '../../src/domain/planCards'
import type { PlanCardKind } from '../../src/domain/planCards'
import { textNumber } from '../../src/domain/reminders'
import { businessDate } from '../../src/domain/operations'
import { addDays, dateLabel } from '../../src/domain/format'
import type { Context, Org } from '../context'
import type { PayOutcome, PaymentEvent } from './providers'
import type { CardRow, Payments } from './service'

export type ChargeRow = {
  id: string
  organisation_id: string
  holding_id: string
  client_id: string
  kind: 'charge' | 'refund'
  /** The membership month paid for (a refund: the month whose card payment is returned). */
  period_start: string
  amount_minor: number
  currency: 'GBP' | 'USD'
  card_id: string
  card_brand: string
  card_last4: string
  try_number: number
  status: 'started' | 'processing' | 'succeeded' | 'failed' | 'unknown' | 'review'
  provider: string
  provider_ref: string | null
  detail: string | null
  /** A declined charge's next try, on the server's clock; null once no more tries are due. */
  next_try_at: number | null
  /** A refund: the provider's reference of the card payment it returns. */
  refund_of: string | null
  /** A charge: what the provider was told it was for. A refund: why it was given. */
  reason: string | null
  ledger_id: string | null
  request_key: string | null
  actor_id: string | null
  created_at: number
  updated_at: number
}

/** A row with no answer from the provider after this long was cut short by a stop or crash. */
const STALE_MS = 2 * 60000
const UNDER_WAY = "('started','processing','unknown')"

/**
 * Why nothing else may charge, refund or record by hand a membership's money now: a try at its
 * card or a refund to it is still waiting on the provider or unclear. Null when nothing is.
 */
export function membershipCardHold(ctx: Context, organisationId: string, holdingId: string) {
  return ctx.db.get(
    `SELECT id FROM membership_charges WHERE organisation_id=? AND holding_id=? AND status IN ${UNDER_WAY}`,
    organisationId,
    holdingId,
  )
    ? 'A card payment or refund for this membership is still under way or unclear. Check it first.'
    : null
}

/** Whether card payments for a studio's memberships are paused after a restore. */
export const membershipCardsHeld = (ctx: Context, organisationId: string) =>
  !!ctx.db.get('SELECT 1 FROM membership_card_holds WHERE organisation_id=?', organisationId)

/**
 * Stage 1: memberships paid from a saved card. A loop in the style of the outbox: each pass
 * queues the reminder three days before a payment, takes each payment that is due (from 09:00 on
 * its due date), and tries a declined card again on its next day. Every try is a row first, and
 * the month enters the studio record only when the provider confirms it, inside one transaction
 * with the row. The row's ID is the provider's idempotency key, and one live or successful try per
 * membership and month is enforced by the database, so a month is never charged twice. An unclear
 * answer stays "unknown" until staff choose "Check again"; it is never tried again by itself.
 */
export function createMembershipCharges(
  ctx: Context,
  payments: Payments,
  /** Called when a message was queued, so the outbox can send it soon. */
  queued: () => void = () => {},
) {
  const { db, now } = ctx
  const { provider, processor } = payments
  const iso = (at = now()) => new Date(at).toISOString()
  let running: Promise<void> | null = null

  const get = (id: string) => db.get<ChargeRow>('SELECT * FROM membership_charges WHERE id=?', id)
  const update = (id: string, fields: Partial<ChargeRow>) => {
    const keys = Object.keys(fields)
    db.run(
      `UPDATE membership_charges SET ${keys.map((key) => `${key}=?`).join(',')},updated_at=? WHERE id=?`,
      ...keys.map((key) => fields[key as keyof ChargeRow] as string | number | null),
      now(),
      id,
    )
  }
  const insert = (
    row: Pick<
      ChargeRow,
      | 'organisation_id'
      | 'holding_id'
      | 'client_id'
      | 'kind'
      | 'period_start'
      | 'amount_minor'
      | 'currency'
      | 'card_id'
      | 'card_brand'
      | 'card_last4'
      | 'try_number'
      | 'refund_of'
      | 'reason'
      | 'request_key'
      | 'actor_id'
    >,
  ) => {
    const id = randomUUID()
    const time = now()
    db.run(
      `INSERT INTO membership_charges(id,organisation_id,holding_id,client_id,kind,period_start,amount_minor,currency,card_id,card_brand,card_last4,try_number,status,provider,refund_of,reason,request_key,actor_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'started',?,?,?,?,?,?,?)`,
      id,
      row.organisation_id,
      row.holding_id,
      row.client_id,
      row.kind,
      row.period_start,
      row.amount_minor,
      row.currency,
      row.card_id,
      row.card_brand,
      row.card_last4,
      row.try_number,
      provider.name,
      row.refund_of,
      row.reason,
      row.request_key,
      row.actor_id,
      time,
      time,
    )
    return get(id)!
  }
  const savedCard = (organisationId: string, clientId: string, cardId: string) =>
    db.get<CardRow>(
      'SELECT * FROM saved_cards WHERE id=? AND organisation_id=? AND client_id=? AND provider=? AND removed_at IS NULL',
      cardId,
      organisationId,
      clientId,
      provider.name,
    )

  /** Runs a command the server makes on the studio record, inside the caller's transaction. */
  const record = (
    org: Org,
    command: Command,
    actorName: string,
    actorId: string | null,
    action: string,
  ) => {
    const result = dispatch(org.state, command, actorName, iso())
    if (!result.ok) throw new Error(result.error)
    if (result.state.revision !== org.state.revision)
      ctx.persist(org, result.state, actorId, action, result.recordId)
    return result
  }

  /**
   * Queues a membership payment message once per membership, month, kind and channel: by email
   * whenever the client has an address, and by text only when they allow texts. The outbox checks
   * it again just before it goes; in test mode it is written down and never sent.
   */
  const queue = (org: Org, kind: PlanCardKind, holdingId: string, periodStart: string) => {
    const holding = holdings(org.state).find((h) => h.id === holdingId)
    const client = org.state.clients.find((c) => c.id === holding?.clientId)
    if (!holding || !client) return 0
    let added = 0
    const time = now()
    for (const channel of planCardChannels(org.state, client)) {
      const text = planCardMessage(org.state, kind, holdingId, periodStart, channel, iso(time))
      const recipient = channel === 'email' ? client.email.trim() : textNumber(client.phone)
      if (!text || !recipient) continue
      added += Number(
        db.run(
          `INSERT OR IGNORE INTO outbox(id,organisation_id,dedupe_key,appointment_id,client_id,kind,channel,slot,recipient,subject,body,status,next_attempt_at,created_at,updated_at)
           VALUES(?,?,?,'',?,?,?,?,?,?,?,'pending',?,?,?)`,
          randomUUID(),
          org.id,
          `${holdingId}:${kind}:${channel}:${periodStart}`,
          client.id,
          kind,
          channel,
          planCardSlot(holdingId, periodStart),
          recipient,
          text.subject,
          text.body,
          time,
          time,
          time,
        ).changes,
      )
    }
    return added
  }

  /**
   * Prepares one try at the card for a month, or returns null when it must not happen now. The
   * membership, its agreement, the saved card and the month are all checked again, and the ledger
   * command is rehearsed, so the card is charged only when the month will land. A retry that is no
   * longer wanted (paid by hand, ended, card removed or card payments turned off) is closed.
   */
  const prepare = (
    organisationId: string,
    holdingId: string,
    periodStart: string,
    tryNumber: number,
    previous?: ChargeRow,
  ) =>
    db.transaction(() => {
      const org = ctx.systemOrg(organisationId)
      if (!org || operations(org.state).mode !== 'local' || membershipCardsHeld(ctx, org.id))
        return null
      const at = iso()
      const stop = (why: string) => {
        if (previous)
          update(previous.id, {
            next_try_at: null,
            detail: `${previous.detail ?? 'Declined.'} No more tries: ${why}`,
          })
        return null
      }
      const holding = holdings(org.state).find((h) => h.id === holdingId)
      const agreement = holding && openCardAgreement(holding)
      const problem = cardChargeProblem(
        org.state,
        holdingId,
        periodStart,
        previous?.card_id ?? agreement?.cardId ?? '',
        at,
      )
      if (problem || !holding || !agreement)
        return stop(problem ?? 'Card payments were turned off.')
      if (membershipCardHold(ctx, org.id, holdingId)) return null
      const card = savedCard(org.id, holding.clientId, agreement.cardId)
      if (!card) return stop('The saved card was removed.')
      const rehearsal = dispatch(
        org.state,
        {
          type: 'plan-renew',
          holdingId,
          method: 'card',
          reference: `rehearsal-${randomUUID()}`,
          processor,
          periodStart,
        },
        'Card payment',
        at,
      )
      const lands =
        rehearsal.ok &&
        holdings(rehearsal.state)
          .find((h) => h.id === holdingId)
          ?.payments.some((p) => p.periodStart === periodStart && p.method === 'card')
      if (!lands)
        return stop(rehearsal.ok ? 'This month has been paid another way.' : rehearsal.error)
      if (previous) update(previous.id, { next_try_at: null })
      const description = `${holding.name} at ${org.state.organisation.name}, the month from ${dateLabel(periodStart, org.state.organisation.locale)}`
      try {
        const row = insert({
          organisation_id: org.id,
          holding_id: holdingId,
          client_id: holding.clientId,
          kind: 'charge',
          period_start: periodStart,
          amount_minor: holding.priceMinor,
          currency: org.state.organisation.currency,
          card_id: card.id,
          card_brand: card.brand,
          card_last4: card.last4,
          try_number: tryNumber,
          refund_of: null,
          // Kept so a check after an unclear answer repeats the request exactly.
          reason: description,
          request_key: null,
          actor_id: null,
        })
        return { row, card }
      } catch {
        // Another try for this month already exists: the database refuses a second one.
        return null
      }
    })

  /**
   * The client was promised a reminder three days before each payment. When none went out for this
   * month (the server was off for those days, or there was no way to reach them), the card is not
   * tried: the month is noted for staff, and stays unpaid until it is paid by hand.
   */
  const missed = (organisationId: string, holdingId: string, periodStart: string) =>
    db.transaction(() => {
      const org = ctx.systemOrg(organisationId)
      if (!org || operations(org.state).mode !== 'local') return
      const holding = holdings(org.state).find((h) => h.id === holdingId)
      const agreement = holding && openCardAgreement(holding)
      if (!holding || !agreement) return
      if (cardChargeProblem(org.state, holdingId, periodStart, agreement.cardId, iso())) return
      let row: ChargeRow
      try {
        row = insert({
          organisation_id: org.id,
          holding_id: holdingId,
          client_id: holding.clientId,
          kind: 'charge',
          period_start: periodStart,
          amount_minor: holding.priceMinor,
          currency: org.state.organisation.currency,
          card_id: agreement.cardId,
          card_brand: agreement.brand,
          card_last4: agreement.last4,
          try_number: 1,
          refund_of: null,
          reason: 'No reminder went out three days before.',
          request_key: null,
          actor_id: null,
        })
      } catch {
        return
      }
      update(row.id, {
        status: 'failed',
        detail:
          'Not taken: no reminder went out three days before, so the card was not tried. Take this month by hand.',
      })
      try {
        record(
          org,
          {
            type: 'plan-card-try',
            holdingId,
            periodStart,
            amountMinor: holding.priceMinor,
            try: 1,
            missedReminder: true,
          },
          'SALEANE',
          null,
          'plan-card-try',
        )
      } catch {
        // The row is kept for staff even if the record could not take the note.
      }
    })
  const reminded = (organisationId: string, holdingId: string, periodStart: string) =>
    !!db.get(
      "SELECT id FROM outbox WHERE organisation_id=? AND kind='plan_reminder' AND slot=?",
      organisationId,
      planCardSlot(holdingId, periodStart),
    )

  /** One try at the card. Returns the row as the provider left it, or null when none was made. */
  const attempt = async (
    organisationId: string,
    holdingId: string,
    periodStart: string,
    tryNumber: number,
    previous?: ChargeRow,
  ) => {
    const prepared = prepare(organisationId, holdingId, periodStart, tryNumber, previous)
    if (!prepared) return null
    const { row, card } = prepared
    const outcome = await provider.chargeSaved({
      attemptId: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      description: row.reason ?? '',
      card: { customerRef: card.customer_ref, methodRef: card.method_ref, last4: card.last4 },
    })
    return settle(row.id, outcome)
  }

  /** Records a confirmed payment or refund, once. Safe to call again for the same row. */
  const succeed = (id: string, providerRef: string) =>
    db.transaction(() => {
      const row = get(id)
      if (!row || ['succeeded', 'review'].includes(row.status)) return row
      const org = ctx.systemOrg(row.organisation_id)
      const fail = (what: string, error: unknown, then: string) => {
        update(row.id, {
          status: 'review',
          provider_ref: providerRef,
          next_try_at: null,
          detail: `${what} ${error instanceof Error ? error.message : 'The studio record is missing.'} ${then}`,
        })
        return get(row.id)
      }
      if (row.kind === 'refund') {
        // The membership ends with the refund, as the person who started it asked.
        try {
          if (!org) throw new Error('The studio record is missing.')
          const name =
            (row.actor_id &&
              db.get<{ name: string }>('SELECT name FROM accounts WHERE id=?', row.actor_id)
                ?.name) ||
            'Card refund'
          const result = record(
            org,
            {
              type: 'plan-cancel',
              holdingId: row.holding_id,
              reason: row.reason ?? 'Ended with a refund to the card',
              refundMinor: row.amount_minor,
              method: 'card',
              reference: providerRef,
              processor,
            },
            name,
            row.actor_id,
            'membership.card-refund',
          )
          const refund = holdings(result.state)
            .find((h) => h.id === row.holding_id)
            ?.refunds.find((r) => r.reference === providerRef)
          if (!refund) throw new Error('The membership had already ended.')
          update(row.id, {
            status: 'succeeded',
            provider_ref: providerRef,
            ledger_id: refund.id,
            detail: null,
          })
        } catch (error) {
          return fail(
            `${provider.live ? 'The money went back to the card' : 'The test refund went through'} but the membership could not be ended with it:`,
            error,
            'End it by hand with nothing more returned.',
          )
        }
        return get(row.id)
      }
      try {
        if (!org) throw new Error('The studio record is missing.')
        const result = record(
          org,
          {
            type: 'plan-renew',
            holdingId: row.holding_id,
            method: 'card',
            reference: providerRef,
            processor,
            periodStart: row.period_start,
          },
          'Card payment',
          null,
          'membership.card-payment',
        )
        const paid = holdings(result.state)
          .find((h) => h.id === row.holding_id)
          ?.payments.find((p) => p.reference === providerRef)
        if (!paid) throw new Error('This month had already been paid another way.')
        update(row.id, {
          status: 'succeeded',
          provider_ref: providerRef,
          ledger_id: paid.id,
          next_try_at: null,
          detail: null,
        })
      } catch (error) {
        return fail(
          `${provider.live ? 'Money was taken' : 'The test payment went through'} but could not be added to the membership:`,
          error,
          'Refund it or record it by hand.',
        )
      }
      return get(row.id)
    })

  /**
   * A declined card. Before the last try, the next one is set for 1, 3 or 7 days after the first
   * (09:00 on the studio's clock) unless the month would have ended; after the last, SALEANE
   * stops, the month stays unpaid, and the client is asked to contact the studio.
   */
  const declined = (id: string, detail: string) =>
    db.transaction(() => {
      const row = get(id)
      if (!row || !['started', 'processing', 'unknown'].includes(row.status)) return row
      if (row.kind === 'refund') {
        update(row.id, { status: 'failed', detail })
        return get(row.id)
      }
      const org = ctx.systemOrg(row.organisation_id)
      const first =
        row.try_number === 1
          ? row
          : (db.get<ChargeRow>(
              "SELECT * FROM membership_charges WHERE organisation_id=? AND holding_id=? AND kind='charge' AND period_start=? AND try_number=1",
              row.organisation_id,
              row.holding_id,
              row.period_start,
            ) ?? row)
      const holding = org && holdings(org.state).find((h) => h.id === row.holding_id)
      let next = org ? nextTryAt(org.state, iso(first.created_at), row.try_number) : null
      if (next && holding && periodStartFor(holding, next.day) !== row.period_start) next = null
      update(row.id, { status: 'failed', detail, next_try_at: next?.at ?? null })
      if (org && holding) {
        try {
          record(
            org,
            {
              type: 'plan-card-try',
              holdingId: row.holding_id,
              periodStart: row.period_start,
              amountMinor: row.amount_minor,
              try: Math.min(row.try_number, 4),
              ...(next ? { nextTryOn: next.day } : {}),
            },
            'SALEANE',
            null,
            'plan-card-try',
          )
        } catch {
          // The try is kept here even if the record could not take the note.
        }
        if (!next && queue(org, 'plan_declined', row.holding_id, row.period_start)) queued()
      }
      return get(row.id)
    })

  /** Applies whatever the provider answered. */
  const settle = (id: string, outcome: PayOutcome) => {
    if (outcome.status === 'succeeded') return succeed(id, outcome.providerRef)
    if (outcome.status === 'failed') return declined(id, outcome.detail)
    const row = get(id)
    if (row && ['started', 'processing', 'unknown'].includes(row.status))
      update(
        id,
        outcome.status === 'processing'
          ? { status: 'processing', provider_ref: outcome.providerRef, detail: null }
          : { status: 'unknown', detail: outcome.detail },
      )
    return get(id)
  }

  /** A verified provider event about a membership payment or refund. False when not one of ours. */
  const apply = (event: PaymentEvent) => {
    const row = get(event.attemptId)
    if (!row || row.provider !== provider.name) return false
    if (event.status === 'succeeded') succeed(row.id, event.providerRef)
    else declined(row.id, event.detail ?? 'The card was declined.')
    return true
  }

  /**
   * Asks the provider again about an unclear answer, as the same request under the same key: it
   * reports what happened the first time and never charges or refunds twice.
   */
  const check = async (row: ChargeRow) => {
    if (row.status !== 'unknown') return row
    let outcome: PayOutcome
    if (row.kind === 'refund')
      outcome = await provider.refund({
        attemptId: row.id,
        paymentRef: row.refund_of!,
        amountMinor: row.amount_minor,
      })
    else {
      const card = db.get<CardRow>(
        'SELECT * FROM saved_cards WHERE id=? AND organisation_id=? AND removed_at IS NULL',
        row.card_id,
        row.organisation_id,
      )
      if (!card) return null
      outcome = await provider.chargeSaved({
        attemptId: row.id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        description: row.reason ?? '',
        card: { customerRef: card.customer_ref, methodRef: card.method_ref, last4: card.last4 },
      })
    }
    return settle(row.id, outcome)
  }

  /** Starts a refund to the card that the route prepared, and records it once confirmed. */
  const refund = async (row: ChargeRow) =>
    settle(
      row.id,
      await provider.refund({
        attemptId: row.id,
        paymentRef: row.refund_of!,
        amountMinor: row.amount_minor,
      }),
    )

  /** One pass: tidy rows cut short, queue reminders, take what is due, try declined cards again. */
  const pass = async () => {
    // A try left "started" by a stop or crash may have reached the provider; staff check it.
    db.run(
      "UPDATE membership_charges SET status='unknown',detail=?,updated_at=? WHERE status='started' AND updated_at<?",
      'The server stopped before the payment provider answered. Check again before doing anything else.',
      now(),
      now() - STALE_MS,
    )
    const orgs = db.all<{ id: string }>(
      "SELECT id FROM organisations WHERE json_extract(state,'$.operations.mode')='local' AND json_array_length(json_extract(state,'$.holdings'))>0",
    )
    let added = 0
    for (const { id } of orgs) {
      if (membershipCardsHeld(ctx, id)) continue
      const org = ctx.systemOrg(id)
      if (!org) continue
      const at = iso()
      const today = businessDate(org.state, at)
      const due: { holdingId: string; periodStart: string }[] = []
      for (const holding of holdings(org.state)) {
        if (holding.status !== 'active' || !openCardAgreement(holding)) continue
        const next = upcomingCardPayment(holding, addDays(today, 1))
        if (next && reminderWindow(org.state, next, at))
          added += queue(org, 'plan_reminder', holding.id, next)
        const month = cardMonthDue(org.state, holding, at)
        if (
          month &&
          !db.get(
            "SELECT id FROM membership_charges WHERE organisation_id=? AND holding_id=? AND kind='charge' AND period_start=?",
            org.id,
            holding.id,
            month,
          )
        )
          due.push({ holdingId: holding.id, periodStart: month })
      }
      for (const item of due)
        if (reminded(id, item.holdingId, item.periodStart))
          await attempt(id, item.holdingId, item.periodStart, 1)
        else missed(id, item.holdingId, item.periodStart)
    }
    if (added) queued()
    const retries = db.all<ChargeRow>(
      "SELECT * FROM membership_charges WHERE kind='charge' AND status='failed' AND next_try_at IS NOT NULL AND next_try_at<=? ORDER BY next_try_at LIMIT 50",
      now(),
    )
    for (const row of retries)
      await attempt(row.organisation_id, row.holding_id, row.period_start, row.try_number + 1, row)
  }

  /** One pass at a time; overlapping calls share the pass already running. */
  const tick = () => {
    running ??= (async () => {
      try {
        await pass()
      } finally {
        running = null
      }
    })()
    return running
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let nudge: ReturnType<typeof setTimeout> | undefined
  return {
    get,
    insert,
    update,
    succeed,
    settle,
    apply,
    check,
    refund,
    tick,
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
export type MembershipCharges = ReturnType<typeof createMembershipCharges>

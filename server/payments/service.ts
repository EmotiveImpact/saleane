import { randomUUID } from 'node:crypto'
import { fail } from '../http'
import { depositPaid, dispatch } from '../../src/domain/commands'
import type { Command } from '../../src/domain/commands'
import { checkoutTotals } from '../../src/domain/money'
import { cardPolicy, guestPayment } from '../../src/domain/guest'
import { feeAllowed } from '../../src/domain/fees'
export { feeAllowed }
import { operations, visitTax } from '../../src/domain/operations'
import type { BusinessState } from '../../src/domain/model'
import type { Context, Org } from '../context'
import { HOSTED_MINUTES } from './providers'
import type { PayOutcome, PaymentEvent, PaymentProvider, SavedCardDetails } from './providers'

export type Purpose = 'deposit' | 'balance' | 'fee' | 'save_card' | 'refund'
export type AttemptRow = {
  id: string
  organisation_id: string
  appointment_id: string
  client_id: string
  purpose: Purpose
  route: 'hosted' | 'saved_card' | 'reader' | 'refund'
  amount_minor: number
  currency: 'GBP' | 'USD'
  tip_minor: number
  discount_minor: number
  save_card: number
  refund_of: string | null
  reason: string | null
  provider: string
  provider_ref: string | null
  status: 'started' | 'processing' | 'succeeded' | 'failed' | 'unknown' | 'review'
  detail: string | null
  ledger_id: string | null
  request_key: string | null
  actor_id: string | null
  created_at: number
  updated_at: number
}
export type CardRow = {
  id: string
  organisation_id: string
  client_id: string
  provider: string
  customer_ref: string
  method_ref: string
  brand: string
  last4: string
  exp_month: number
  exp_year: number
  agreed: string
  created_at: number
  removed_at: number | null
}

/** The amount still owed at checkout, with the tip and discount the desk entered. */
export function balanceDue(
  s: BusinessState,
  appointmentId: string,
  tipMinor: number,
  discountMinor: number,
) {
  const a = s.appointments.find((item) => item.id === appointmentId)
  if (!a) return null
  const deposit = depositPaid(s, a.id)
  const { totalMinor } = checkoutTotals({
    priceMinor: a.bookedPriceMinor,
    discountMinor,
    tipMinor,
    depositMinor: deposit,
    tax: visitTax(s, a),
  })
  return totalMinor - deposit
}

/**
 * Card payments. Each one is an attempt row first; money enters the studio record only when the
 * provider confirms it, inside one transaction with the attempt's new state. If the record has
 * moved on (a visit cancelled while its deposit was being paid), the attempt is left for review
 * rather than forced in, so staff see money that was taken but not yet matched to a visit.
 */
export function createPayments(ctx: Context, provider: PaymentProvider) {
  const { db, now } = ctx
  const processor = { provider: provider.name, live: provider.live }
  const get = (id: string) => db.get<AttemptRow>('SELECT * FROM payment_attempts WHERE id=?', id)
  const update = (id: string, fields: Partial<AttemptRow>) => {
    const keys = Object.keys(fields)
    db.run(
      `UPDATE payment_attempts SET ${keys.map((key) => `${key}=?`).join(',')},updated_at=? WHERE id=?`,
      ...keys.map((key) => fields[key as keyof AttemptRow] as string | number | null),
      now(),
      id,
    )
  }
  const cards = (organisationId: string, clientId: string) =>
    db.all<CardRow>(
      'SELECT * FROM saved_cards WHERE organisation_id=? AND client_id=? AND provider=? AND removed_at IS NULL ORDER BY created_at DESC',
      organisationId,
      clientId,
      provider.name,
    )

  const create = (
    row: Omit<
      AttemptRow,
      | 'id'
      | 'provider'
      | 'provider_ref'
      | 'status'
      | 'detail'
      | 'ledger_id'
      | 'created_at'
      | 'updated_at'
    >,
  ) => {
    const id = randomUUID()
    const time = now()
    db.run(
      `INSERT INTO payment_attempts(id,organisation_id,appointment_id,client_id,purpose,route,amount_minor,currency,tip_minor,discount_minor,save_card,refund_of,reason,provider,status,request_key,actor_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'started',?,?,?,?)`,
      id,
      row.organisation_id,
      row.appointment_id,
      row.client_id,
      row.purpose,
      row.route,
      row.amount_minor,
      row.currency,
      row.tip_minor,
      row.discount_minor,
      row.save_card,
      row.refund_of,
      row.reason,
      provider.name,
      row.request_key,
      row.actor_id,
      time,
      time,
    )
    return get(id)!
  }

  const commandFor = (row: AttemptRow, providerRef: string, s: BusinessState): Command | null => {
    const base = { method: 'card' as const, reference: providerRef, processor }
    if (row.purpose === 'deposit') {
      const a = s.appointments.find((item) => item.id === row.appointment_id)
      if (!a || a.status !== 'confirmed') throw new Error('The visit is no longer booked.')
      if (depositPaid(s, a.id) + row.amount_minor > a.bookedDepositMinor)
        throw new Error('The deposit had already been paid.')
      return {
        type: 'deposit',
        appointmentId: row.appointment_id,
        amountMinor: row.amount_minor,
        ...base,
      }
    }
    if (row.purpose === 'fee')
      return {
        type: 'fee',
        appointmentId: row.appointment_id,
        amountMinor: row.amount_minor,
        ...base,
      }
    if (row.purpose === 'balance') {
      if (s.sales.some((sale) => sale.appointmentId === row.appointment_id))
        throw new Error('The visit had already been checked out.')
      if (balanceDue(s, row.appointment_id, row.tip_minor, row.discount_minor) !== row.amount_minor)
        throw new Error('The visit’s total changed while the card was being charged.')
      return {
        type: 'checkout',
        appointmentId: row.appointment_id,
        tipMinor: row.tip_minor,
        discountMinor: row.discount_minor,
        ...base,
      }
    }
    if (row.purpose === 'refund') {
      const [kind, target] = (row.refund_of ?? '').split(':')
      return {
        type: 'refund',
        ...(kind === 'sale' ? { saleId: target } : { paymentId: target }),
        amountMinor: row.amount_minor,
        reason: row.reason ?? 'Refunded to the card',
        ...base,
      }
    }
    return null
  }

  /** Records a confirmed payment, once. Safe to call again for the same attempt. */
  const succeed = (attemptId: string, providerRef: string, card?: SavedCardDetails) =>
    db.transaction(() => {
      const row = get(attemptId)
      if (!row || ['succeeded', 'review'].includes(row.status)) return row
      const org = ctx.systemOrg(row.organisation_id)
      if (!org) {
        update(row.id, {
          status: 'review',
          provider_ref: providerRef,
          detail: 'The studio record is missing.',
        })
        return get(row.id)
      }
      if (card && (row.save_card || row.purpose === 'save_card'))
        db.run(
          `INSERT OR IGNORE INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          randomUUID(),
          org.id,
          row.client_id,
          provider.name,
          card.customerRef,
          card.methodRef,
          card.brand,
          card.last4,
          card.expMonth,
          card.expYear,
          cardPolicy(org.state),
          now(),
        )
      let ledgerId: string | null = null
      try {
        const command = commandFor(row, providerRef, org.state)
        if (command) {
          const actor =
            row.purpose === 'deposit' && !row.actor_id ? 'Guest (card payment)' : 'Card payment'
          const result = dispatch(org.state, command, actor, new Date(now()).toISOString())
          if (!result.ok) throw new Error(result.error)
          ledgerId = result.recordId
          if (result.state.revision !== org.state.revision)
            ctx.persist(org, result.state, row.actor_id, `payment.${row.purpose}`, ledgerId)
        }
      } catch (error) {
        update(row.id, {
          status: 'review',
          provider_ref: providerRef,
          detail: `${provider.live ? 'Money was taken' : 'The test payment went through'} but could not be added to the visit: ${error instanceof Error ? error.message : 'unknown reason'} Refund it or record it by hand.`,
        })
        return get(row.id)
      }
      update(row.id, {
        status: 'succeeded',
        provider_ref: providerRef,
        ledger_id: ledgerId,
        detail: null,
      })
      return get(row.id)
    })

  /** Applies whatever the provider answered when the attempt was made. */
  const settle = (row: AttemptRow, outcome: PayOutcome) => {
    if (outcome.status === 'succeeded') return succeed(row.id, outcome.providerRef, outcome.card)
    if (outcome.status === 'processing')
      update(row.id, { status: 'processing', provider_ref: outcome.providerRef, detail: null })
    else update(row.id, { status: outcome.status, detail: outcome.detail })
    return get(row.id)
  }

  const apply = (event: PaymentEvent) => {
    const row = get(event.attemptId)
    if (!row || row.provider !== provider.name) return false
    if (event.status === 'succeeded') succeed(row.id, event.providerRef, event.card)
    else if (!['succeeded', 'review'].includes(row.status))
      update(row.id, {
        status: 'failed',
        provider_ref: event.providerRef,
        detail: event.detail ?? 'The card was declined.',
      })
    return true
  }

  /** Re-checks a visit before money is asked for. */
  const visit = (org: Org, appointmentId: string) => {
    const a = org.state.appointments.find((item) => item.id === appointmentId)
    if (!a) fail(404, 'This visit was not found.')
    if (operations(org.state).mode !== 'local')
      fail(409, 'Sample studios never take card payments.')
    return a!
  }

  return { provider, processor, get, update, cards, create, settle, succeed, apply, visit }
}
export type Payments = ReturnType<typeof createPayments>

/** The payment part of a guest's view, read with the server's provider and saved cards. */
export function guestPaymentFor(ctx: Context, org: Org, appointmentId: string) {
  const a = org.state.appointments.find((item) => item.id === appointmentId)
  if (!a) return null
  const card = ctx.db.get<Pick<CardRow, 'brand' | 'last4'>>(
    'SELECT brand,last4 FROM saved_cards WHERE organisation_id=? AND client_id=? AND provider=? AND removed_at IS NULL ORDER BY created_at DESC',
    org.id,
    a.clientId,
    ctx.paymentProvider.name,
  )
  // An open payment page, a payment being confirmed, or an unclear answer all block a second
  // page, so a guest cannot pay the same deposit twice from two tabs.
  const pending = !!ctx.db.get(
    `SELECT id FROM payment_attempts WHERE organisation_id=? AND appointment_id=? AND purpose IN ('deposit','save_card')
     AND (status IN ('processing','unknown') OR (status='started' AND created_at>?))`,
    org.id,
    appointmentId,
    ctx.now() - (HOSTED_MINUTES + 1) * 60000,
  )
  return guestPayment(org.state, appointmentId, ctx.now(), {
    testMode: !ctx.paymentProvider.live,
    savedCard: card ? { brand: card.brand, last4: card.last4 } : null,
    pending,
  })
}

import { z } from 'zod'
import { fail, header } from '../http'
import { depositPaid, dispatch } from '../../src/domain/commands'
import type { Command } from '../../src/domain/commands'
import { can, operations } from '../../src/domain/operations'
import type { BusinessState } from '../../src/domain/model'
import type { Context, Org, Route } from '../context'
import { TEST_CARDS } from '../payments/providers'
import { balanceDue, feeAllowed, giftCardHoldProblem, guestPaymentFor } from '../payments/service'
import type { AttemptRow, CardRow, Payments } from '../payments/service'
import { openGuestLink, tokenSchema } from './guest'

const keySchema = /^[A-Za-z0-9._:-]{8,100}$/
const money = z.number().int().nonnegative().max(100_000_000)

/** What staff see of an attempt. Provider references stay on the server. */
function attemptView(row: AttemptRow, live: boolean) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    purpose: row.purpose,
    route: row.route,
    amountMinor: row.amount_minor,
    status: row.status,
    detail: row.detail,
    testMode: !live,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}
function cardView(row: CardRow) {
  return {
    id: row.id,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    agreed: row.agreed,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

/** Runs the ledger command with a stand-in reference, so a card is charged only if it will land. */
function rehearse(org: Org, command: Command) {
  const result = dispatch(org.state, command, 'Card payment', new Date().toISOString())
  if (!result.ok) fail(422, result.error)
  return result.ok ? result.state : org.state
}

function cardRefundable(s: BusinessState, target: { saleId?: string; paymentId?: string }) {
  const sale = target.saleId ? s.sales.find((x) => x.id === target.saleId) : undefined
  const paid = target.paymentId
    ? s.payments.find((x) => x.id === target.paymentId && x.kind !== 'settlement')
    : undefined
  const item = sale ?? paid
  if (!item) fail(404, 'This receipt was not found.')
  if (item!.method !== 'card' || !item!.processor || !item!.reference)
    fail(409, 'Only a card payment taken through SALEANE can be refunded to the card.')
  const refunded = (operations(s).refunds ?? [])
    .filter((r) => (sale ? r.saleId === sale.id : r.paymentId === paid!.id))
    .reduce((sum, r) => sum + r.amountMinor, 0)
  // A receipt's card charge is its balance; any deposit was its own charge.
  const charged = sale ? sale.balanceMinor : paid!.amountMinor
  return { item: item!, remaining: Math.max(0, charged - refunded) }
}

const guestPay = z
  .object({
    token: tokenSchema,
    purpose: z.enum(['deposit', 'save_card']),
    saveCard: z.boolean().default(false),
  })
  .strict()
const staffPay = z
  .object({
    appointmentId: z.string().min(1).max(150),
    purpose: z.enum(['balance', 'deposit', 'fee']),
    route: z.enum(['saved_card', 'reader']),
    amountMinor: money.refine((v) => v > 0),
    tipMinor: money.default(0),
    discountMinor: money.default(0),
    /** V1.5: a gift card paying part of the balance; the card is charged the rest. */
    giftCardId: z.string().min(1).max(150).optional(),
    giftCardMinor: money.default(0),
    readerId: z.string().min(1).max(100).optional(),
  })
  .strict()
const refundInput = z
  .object({
    saleId: z.string().min(1).max(150).optional(),
    paymentId: z.string().min(1).max(150).optional(),
    amountMinor: money.refine((v) => v > 0),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
const lookup = z
  .object({
    appointmentId: z.string().min(1).max(150).optional(),
    clientId: z.string().min(1).max(150).optional(),
  })
  .strict()

/**
 * PILOT-02 card payment routes: the guest's deposit and saved card, the test payment page, and
 * the desk's card payments, fees and refunds. Returns false for other paths.
 */
export function paymentRoutes(payments: Payments) {
  const { provider } = payments
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { db, now, rateLimit, allowedOrigin } = ctx
    const { request, method, path, url, body, reply } = route

    // The guest opens the provider's own page; the card number never reaches SALEANE.
    if (path[1] === 'guest' && path[2] === 'pay' && path.length === 3 && method === 'POST') {
      rateLimit(request, 'guest-pay', 10, 5 * 60000)
      const data = guestPay.parse(body)
      const { row, input } = db.transaction(() => {
        const { org, appointmentId } = openGuestLink(ctx, data.token)
        payments.visit(org, appointmentId)
        const payment = guestPaymentFor(ctx, org, appointmentId)
        if (!payment) fail(409, 'There is nothing to pay for this visit now.')
        if (payment!.pending) fail(409, 'A payment for this visit is still being confirmed.')
        if (data.purpose === 'deposit' && !payment!.depositDueMinor)
          fail(409, 'The deposit for this visit has already been paid.')
        if (data.purpose === 'save_card' && !payment!.saveCardOffered)
          fail(409, 'A card is already saved for your visits.')
        const a = org.state.appointments.find((item) => item.id === appointmentId)!
        const client = org.state.clients.find((item) => item.id === a.clientId)
        const service =
          a.bookedServiceName ?? org.state.services.find((x) => x.id === a.serviceId)?.name
        const saveCard = data.purpose === 'save_card' || (data.saveCard && payment!.saveCardOffered)
        const row = payments.create({
          organisation_id: org.id,
          appointment_id: appointmentId,
          client_id: a.clientId,
          purpose: data.purpose,
          route: 'hosted',
          amount_minor: data.purpose === 'deposit' ? payment!.depositDueMinor : 0,
          currency: org.state.organisation.currency,
          tip_minor: 0,
          discount_minor: 0,
          save_card: saveCard ? 1 : 0,
          refund_of: null,
          reason: null,
          request_key: null,
          actor_id: null,
        })
        return {
          row,
          input: {
            description:
              data.purpose === 'deposit'
                ? `Deposit for ${service ?? 'your visit'} at ${org.state.organisation.name}`
                : `Card saved for visits at ${org.state.organisation.name}`,
            email: client?.email ?? '',
            name: client?.name ?? 'Guest',
          },
        }
      })
      const opened = await provider.hosted({
        attemptId: row.id,
        mode: row.purpose === 'deposit' ? 'payment' : 'setup',
        amountMinor: row.amount_minor,
        currency: row.currency,
        description: input.description,
        email: input.email,
        name: input.name,
        saveCard: !!row.save_card,
        // The manage token stays in the guest's browser; it is never handed to the provider.
        returnUrl: `${allowedOrigin}/manage?payment=done`,
        cancelUrl: `${allowedOrigin}/manage?payment=cancelled`,
      })
      if (!opened.ok) {
        payments.update(row.id, { status: 'failed', detail: opened.detail })
        fail(502, opened.detail)
      } else payments.update(row.id, { provider_ref: opened.providerRef })
      reply(200, { url: opened.ok ? opened.url : '' })
      return true
    }

    // Coming back from the provider's page without paying closes it, so the guest can start again.
    if (path[1] === 'guest' && path[2] === 'pay' && path[3] === 'cancel' && path.length === 4) {
      if (method !== 'POST') fail(405, 'Use POST.')
      rateLimit(request, 'guest-pay', 10, 5 * 60000)
      const data = z.object({ token: tokenSchema }).strict().parse(body)
      const { org, appointmentId } = openGuestLink(ctx, data.token)
      const open = db.all<AttemptRow>(
        "SELECT * FROM payment_attempts WHERE organisation_id=? AND appointment_id=? AND route='hosted' AND status='started'",
        org.id,
        appointmentId,
      )
      for (const row of open)
        if (!row.provider_ref || (await provider.closeHosted(row.provider_ref)))
          payments.update(row.id, { status: 'failed', detail: 'The guest left the payment page.' })
      reply(200, { ok: true })
      return true
    }

    // The test payment page stands in for the provider's page while payments are in test mode.
    if (path[1] === 'test-payments' && path.length === 3) {
      if (provider.name !== 'test') fail(404, 'This endpoint was not found.')
      rateLimit(request, 'test-pay', 30, 5 * 60000)
      const row = payments.get(path[2])
      if (!row || row.route !== 'hosted') fail(404, 'This test payment was not found.')
      const org = ctx.systemOrg(row!.organisation_id)
      if (!org) fail(404, 'This test payment was not found.')
      if (method === 'GET') {
        reply(200, {
          studio: org!.state.organisation.name,
          locale: org!.state.organisation.locale,
          currency: row!.currency,
          amountMinor: row!.amount_minor,
          purpose: row!.purpose,
          saveCard: !!row!.save_card,
          status: row!.status,
        })
        return true
      }
      if (method === 'POST') {
        const data = z
          .object({ outcome: z.enum(['pay', 'cancel']), card: z.enum(['4242', '0002']) })
          .strict()
          .parse(body)
        if (row!.status !== 'started') fail(409, 'This test payment has already finished.')
        if (data.outcome === 'cancel') {
          payments.update(row!.id, { status: 'failed', detail: 'The guest left the payment page.' })
          reply(200, { status: 'failed', next: '/manage?payment=cancelled' })
          return true
        }
        const card = TEST_CARDS[data.card]
        // Saving a card that always declines lets the studio rehearse a refused fee.
        if (card.declines && row!.purpose !== 'save_card') {
          payments.update(row!.id, {
            status: 'failed',
            detail: 'The card was declined (test card).',
          })
          reply(200, { status: 'failed', next: '/manage?payment=declined' })
          return true
        }
        const done = payments.succeed(row!.id, `test_pay_${row!.id.slice(0, 8)}`, {
          customerRef: `test_customer_${row!.client_id.slice(0, 24)}`,
          methodRef: `test_card_${row!.id}`,
          brand: card.brand,
          last4: data.card,
          expMonth: 12,
          expYear: new Date(now()).getUTCFullYear() + 3,
        })
        reply(200, { status: done?.status, next: '/manage?payment=done' })
        return true
      }
      fail(405, 'Use GET or POST.')
    }

    if (path[1] !== 'workspaces' || !['payments', 'card-refunds', 'cards'].includes(path[3]))
      return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    if (!can(org.role, 'checkout')) fail(403, 'Your role cannot see card payments.')

    if (path[3] === 'payments' && path.length === 4 && method === 'GET') {
      const input = lookup.parse(Object.fromEntries(url.searchParams))
      const a = input.appointmentId
        ? org.state.appointments.find((item) => item.id === input.appointmentId)
        : undefined
      const clientId = a?.clientId ?? input.clientId
      const attempts = input.appointmentId
        ? db.all<AttemptRow>(
            'SELECT * FROM payment_attempts WHERE organisation_id=? AND appointment_id=? ORDER BY created_at DESC LIMIT 50',
            org.id,
            input.appointmentId,
          )
        : clientId
          ? db.all<AttemptRow>(
              'SELECT * FROM payment_attempts WHERE organisation_id=? AND client_id=? ORDER BY created_at DESC LIMIT 50',
              org.id,
              clientId,
            )
          : db.all<AttemptRow>(
              "SELECT * FROM payment_attempts WHERE organisation_id=? AND status IN ('review','unknown','processing') ORDER BY created_at DESC LIMIT 50",
              org.id,
            )
      reply(200, {
        provider: { name: provider.name, live: provider.live, readers: provider.readers },
        available: operations(org.state).mode === 'local',
        attempts: attempts.map((row) => attemptView(row, provider.live)),
        cards: clientId ? payments.cards(org.id, clientId).map(cardView) : [],
        ...(a
          ? {
              depositDueMinor:
                a.status === 'confirmed'
                  ? Math.max(0, a.bookedDepositMinor - depositPaid(org.state, a.id))
                  : 0,
              feeAllowedMinor: feeAllowed(org.state, a.id),
            }
          : {}),
      })
      return true
    }

    if (path[3] === 'payments' && path.length === 5 && method === 'GET') {
      const row = payments.get(path[4])
      if (!row || row.organisation_id !== org.id) fail(404, 'This payment was not found.')
      reply(200, attemptView(row!, provider.live))
      return true
    }

    if (path[3] === 'payments' && path.length === 4 && method === 'POST') {
      const data = staffPay.parse(body)
      const key = header(request, 'idempotency-key')
      if (!key || !keySchema.test(key))
        fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
      if (!can(org.role, data.purpose === 'balance' ? 'checkout' : data.purpose))
        fail(403, 'Your role cannot take this payment.')
      const prepared = db.transaction(() => {
        const fresh = ctx.orgFor(org.id, actor)
        const replay = db.get<AttemptRow>(
          'SELECT * FROM payment_attempts WHERE organisation_id=? AND actor_id=? AND request_key=?',
          fresh.id,
          actor.id,
          key!,
        )
        if (replay) return { row: replay, replayed: true as const }
        const a = payments.visit(fresh, data.appointmentId)
        if (
          db.get(
            "SELECT id FROM payment_attempts WHERE organisation_id=? AND appointment_id=? AND route IN ('saved_card','reader') AND status IN ('started','processing','unknown')",
            fresh.id,
            a.id,
          )
        )
          fail(
            409,
            'A card payment for this visit is already under way or unclear. Finish or check that one first.',
          )
        const placeholder = {
          method: 'card' as const,
          reference: 'rehearsal',
          processor: payments.processor,
        }
        let expected: number
        if (data.purpose === 'balance') {
          if (fresh.state.sales.some((sale) => sale.appointmentId === a.id))
            fail(409, 'This visit has already been checked out.')
          if (!!data.giftCardId !== data.giftCardMinor > 0)
            fail(422, 'Name the gift card and the amount it pays together.')
          expected =
            balanceDue(fresh.state, a.id, data.tipMinor, data.discountMinor, data.giftCardMinor) ??
            0
          // The rehearsal checks the gift card can pay its share now.
          if (expected > 0) {
            const after = rehearse(fresh, {
              type: 'checkout',
              appointmentId: a.id,
              tipMinor: data.tipMinor,
              discountMinor: data.discountMinor,
              ...(data.giftCardId
                ? { giftCardId: data.giftCardId, giftCardMinor: data.giftCardMinor }
                : {}),
              ...placeholder,
            })
            const held = giftCardHoldProblem(ctx, fresh.id, after)
            if (held) fail(409, held)
          }
        } else if (data.purpose === 'deposit') {
          expected =
            a.status === 'confirmed'
              ? Math.max(0, a.bookedDepositMinor - depositPaid(fresh.state, a.id))
              : 0
          if (expected > 0)
            rehearse(fresh, {
              type: 'deposit',
              appointmentId: a.id,
              amountMinor: expected,
              ...placeholder,
            })
        } else {
          const allowed = feeAllowed(fresh.state, a.id)
          if (data.amountMinor > allowed)
            fail(409, 'This is more than the studio’s policy allows for this visit.')
          expected = data.amountMinor
          rehearse(fresh, {
            type: 'fee',
            appointmentId: a.id,
            amountMinor: expected,
            ...placeholder,
          })
        }
        if (expected <= 0) fail(409, 'Nothing is left to pay on this visit.')
        if (expected !== data.amountMinor)
          fail(409, 'The amount changed. Check the total and try again.')
        const service =
          a.bookedServiceName ??
          fresh.state.services.find((x) => x.id === a.serviceId)?.name ??
          'Visit'
        const description = `${service} at ${fresh.state.organisation.name}${data.purpose === 'fee' ? ' (missed visit fee)' : ''}`
        let card: CardRow | undefined
        if (data.route === 'saved_card') {
          card = payments.cards(fresh.id, a.clientId)[0]
          if (!card) fail(409, 'This client has no saved card.')
        } else if (!provider.readers.some((r) => r.id === data.readerId))
          fail(422, 'Choose one of the studio’s card readers.')
        const row = payments.create({
          organisation_id: fresh.id,
          appointment_id: a.id,
          client_id: a.clientId,
          purpose: data.purpose,
          route: data.route,
          amount_minor: expected,
          currency: fresh.state.organisation.currency,
          tip_minor: data.purpose === 'balance' ? data.tipMinor : 0,
          discount_minor: data.purpose === 'balance' ? data.discountMinor : 0,
          ...(data.purpose === 'balance' && data.giftCardId
            ? { gift_card_id: data.giftCardId, gift_card_minor: data.giftCardMinor }
            : {}),
          save_card: 0,
          refund_of: null,
          // Kept so a check after an unclear answer repeats the request exactly.
          reason: description,
          request_key: key!,
          actor_id: actor.id,
        })
        ctx.audit(fresh, actor.id, `payment.${data.purpose}.started`, row.id)
        return {
          row,
          card,
          description,
          replayed: false as const,
        }
      })
      if (prepared.replayed) {
        reply(200, attemptView(prepared.row, provider.live))
        return true
      }
      const { row, card, description } = prepared
      const outcome =
        data.route === 'saved_card'
          ? await provider.chargeSaved({
              attemptId: row.id,
              amountMinor: row.amount_minor,
              currency: row.currency,
              description,
              card: {
                customerRef: card!.customer_ref,
                methodRef: card!.method_ref,
                last4: card!.last4,
              },
            })
          : await provider.reader({
              attemptId: row.id,
              amountMinor: row.amount_minor,
              currency: row.currency,
              description,
              readerId: data.readerId!,
            })
      reply(200, attemptView(payments.settle(row, outcome)!, provider.live))
      return true
    }

    // An unclear answer is asked again with the same attempt, which the provider treats as the
    // same request: it reports what happened the first time and never charges twice.
    if (path[3] === 'payments' && path.length === 6 && path[5] === 'check' && method === 'POST') {
      const row = payments.get(path[4])
      if (!row || row.organisation_id !== org.id) fail(404, 'This payment was not found.')
      if (row!.status !== 'unknown') {
        reply(200, attemptView(row!, provider.live))
        return true
      }
      if (!can(org.role, row!.purpose === 'balance' ? 'checkout' : row!.purpose))
        fail(403, 'Your role cannot check this payment.')
      let outcome
      if (row!.route === 'refund') {
        const [kind, target] = (row!.refund_of ?? '').split(':')
        const { item } = cardRefundable(
          org.state,
          kind === 'sale' ? { saleId: target } : { paymentId: target },
        )
        outcome = await provider.refund({
          attemptId: row!.id,
          paymentRef: item.reference!,
          amountMinor: row!.amount_minor,
        })
      } else if (row!.route === 'saved_card') {
        const card = payments.cards(org.id, row!.client_id)[0]
        if (!card) fail(409, 'The saved card was removed. Check the provider’s dashboard instead.')
        outcome = await provider.chargeSaved({
          attemptId: row!.id,
          amountMinor: row!.amount_minor,
          currency: row!.currency,
          description: row!.reason ?? '',
          card: {
            customerRef: card!.customer_ref,
            methodRef: card!.method_ref,
            last4: card!.last4,
          },
        })
      } else fail(409, 'Check this payment in the provider’s dashboard.')
      reply(200, attemptView(payments.settle(row!, outcome!)!, provider.live))
      return true
    }

    // A test reader has no card to tap, so the desk approves or declines it on screen.
    if (
      path[3] === 'payments' &&
      path.length === 6 &&
      path[5] === 'test-tap' &&
      method === 'POST'
    ) {
      if (provider.name !== 'test') fail(404, 'This endpoint was not found.')
      const data = z.object({ approve: z.boolean() }).strict().parse(body)
      const row = payments.get(path[4])
      if (!row || row.organisation_id !== org.id || row.route !== 'reader')
        fail(404, 'This payment was not found.')
      if (row!.status !== 'processing') fail(409, 'This payment has already finished.')
      const done = data.approve
        ? payments.succeed(row!.id, row!.provider_ref ?? `test_reader_${row!.id.slice(0, 8)}`)
        : (payments.update(row!.id, {
            status: 'failed',
            detail: 'Declined on the test card reader.',
          }),
          payments.get(row!.id))
      reply(200, attemptView(done!, provider.live))
      return true
    }

    if (path[3] === 'card-refunds' && path.length === 4 && method === 'POST') {
      if (!can(org.role, 'refund')) fail(403, 'Your role cannot refund payments.')
      const data = refundInput.parse(body)
      if (!!data.saleId === !!data.paymentId)
        fail(400, 'Choose the receipt or the payment being refunded.')
      const key = header(request, 'idempotency-key')
      if (!key || !keySchema.test(key))
        fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
      const prepared = db.transaction(() => {
        const fresh = ctx.orgFor(org.id, actor)
        const replay = db.get<AttemptRow>(
          'SELECT * FROM payment_attempts WHERE organisation_id=? AND actor_id=? AND request_key=?',
          fresh.id,
          actor.id,
          key!,
        )
        if (replay) return { row: replay, replayed: true as const }
        const target = data.saleId ? { saleId: data.saleId } : { paymentId: data.paymentId }
        const { item, remaining } = cardRefundable(fresh.state, target)
        if (item.processor!.provider !== provider.name)
          fail(409, 'This card was charged through a different payment provider.')
        const refundOf = data.saleId ? `sale:${data.saleId}` : `payment:${data.paymentId}`
        if (
          db.get(
            "SELECT id FROM payment_attempts WHERE organisation_id=? AND refund_of=? AND status IN ('started','processing','unknown')",
            fresh.id,
            refundOf,
          )
        )
          fail(
            409,
            'A refund for this payment is already under way or unclear. Check that one first.',
          )
        if (data.amountMinor > remaining)
          fail(409, 'This is more than is left to refund on this card payment.')
        rehearse(fresh, {
          type: 'refund',
          ...target,
          amountMinor: data.amountMinor,
          reason: data.reason,
          reference: 'rehearsal',
          method: 'card',
          processor: payments.processor,
        })
        const a = fresh.state.appointments.find((x) => x.id === item.appointmentId)!
        const row = payments.create({
          organisation_id: fresh.id,
          appointment_id: a.id,
          client_id: a.clientId,
          purpose: 'refund',
          route: 'refund',
          amount_minor: data.amountMinor,
          currency: fresh.state.organisation.currency,
          tip_minor: 0,
          discount_minor: 0,
          save_card: 0,
          refund_of: refundOf,
          reason: data.reason,
          request_key: key!,
          actor_id: actor.id,
        })
        ctx.audit(fresh, actor.id, 'payment.refund.started', row.id)
        return { row, paymentRef: item.reference!, replayed: false as const }
      })
      if (prepared.replayed) {
        reply(200, attemptView(prepared.row, provider.live))
        return true
      }
      const outcome = await provider.refund({
        attemptId: prepared.row.id,
        paymentRef: prepared.paymentRef,
        amountMinor: prepared.row.amount_minor,
      })
      reply(200, attemptView(payments.settle(prepared.row, outcome)!, provider.live))
      return true
    }

    if (path[3] === 'cards' && path.length === 6 && path[5] === 'remove' && method === 'POST') {
      const card = db.get<CardRow>(
        'SELECT * FROM saved_cards WHERE id=? AND organisation_id=? AND removed_at IS NULL',
        path[4],
        org.id,
      )
      if (!card) fail(404, 'This card was not found.')
      if (!(await provider.removeCard(card!.method_ref)))
        fail(502, 'The payment provider did not confirm the card was removed. Try again.')
      db.run('UPDATE saved_cards SET removed_at=? WHERE id=?', now(), card!.id)
      ctx.audit(org, actor.id, 'card.removed', card!.id)
      reply(200, { ok: true })
      return true
    }
    fail(404, 'This endpoint was not found.')
  }
}

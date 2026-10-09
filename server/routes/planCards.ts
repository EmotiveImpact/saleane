import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fail, header } from '../http'
import { dispatch } from '../../src/domain/commands'
import type { Command } from '../../src/domain/commands'
import { businessDate, can, operations } from '../../src/domain/operations'
import { branchRefusal } from '../../src/domain/branch'
import { cardRefundTarget, holdings, lastCardAgreement, planStanding } from '../../src/domain/plans'
import type { Holding } from '../../src/domain/plansSchema'
import { money } from '../../src/domain/format'
import type { Actor, Context, Org, Route } from '../context'
import type { CardRow, Payments } from '../payments/service'
import { membershipCardHold, membershipCardsHeld } from '../payments/memberships'
import type { ChargeRow, MembershipCharges } from '../payments/memberships'

const keySchema = /^[A-Za-z0-9._:-]{8,100}$/
const id = z.string().min(1).max(150)
const setUp = z
  .object({ cardId: id, wording: z.string().trim().min(20).max(1000), agreed: z.literal(true) })
  .strict()
const end = z
  .object({
    reason: z.string().trim().min(2).max(300),
    refundMinor: z.number().int().positive().max(100_000_000),
  })
  .strict()
const lookup = z.object({ clientId: id.optional() }).strict()
const empty = z.object({}).strict()

/** What staff see of a try at the card or a refund to it. Provider references stay here. */
function chargeView(row: ChargeRow, live: boolean) {
  return {
    id: row.id,
    holdingId: row.holding_id,
    clientId: row.client_id,
    kind: row.kind,
    periodStart: row.period_start,
    amountMinor: row.amount_minor,
    card: { brand: row.card_brand, last4: row.card_last4 },
    try: row.try_number,
    status: row.status,
    detail: row.detail,
    nextTryAt: row.next_try_at === null ? null : new Date(row.next_try_at).toISOString(),
    testMode: !live,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}
export type ChargeView = ReturnType<typeof chargeView>
const cardView = (row: CardRow) => ({
  id: row.id,
  brand: row.brand,
  last4: row.last4,
  expMonth: row.exp_month,
  expYear: row.exp_year,
  createdAt: new Date(row.created_at).toISOString(),
})

/**
 * Stage 1 routes for memberships paid from a saved card: what staff see, setting it up or turning
 * it off, "Check again" on an unclear answer, ending a membership with its card-paid month
 * returned to the card, and turning card payments back on after a restore. Card details and the
 * card method never come from a page's command; the server reads them from the saved card here.
 */
export function planCardRoutes(payments: Payments, charges: MembershipCharges) {
  const { provider, processor } = payments
  return async (ctx: Context, route: Route): Promise<boolean> => {
    const { db, now } = ctx
    const { request, method, path, url, body, reply } = route
    if (path[1] !== 'workspaces' || path[3] !== 'plan-cards') return false
    const actor = ctx.actorFor(request, method !== 'GET')
    const org = ctx.orgFor(path[2], actor)
    const at = () => new Date(now()).toISOString()
    // V5: a general manager follows only memberships sold at their own location.
    const here = (o: Org, holding: Pick<Holding, 'locationId'> | undefined) =>
      o.role !== 'general' ||
      (!!holding && (holding.locationId ?? o.state.organisation.locationId) === o.locationId)
    const holdingOf = (o: Org, holdingId: string) =>
      holdings(o.state).find((h) => h.id === holdingId && h.kind === 'membership')

    if (path.length === 4 && method === 'GET') {
      // Whoever may take card payments at the desk may see how memberships are paid.
      if (!can(org.role, 'checkout')) fail(403, 'Your role cannot see card payments.')
      const input = lookup.parse(Object.fromEntries(url.searchParams))
      const today = businessDate(org.state, at())
      const rows = input.clientId
        ? db.all<ChargeRow>(
            'SELECT * FROM membership_charges WHERE organisation_id=? AND client_id=? ORDER BY created_at DESC LIMIT 100',
            org.id,
            input.clientId,
          )
        : db.all<ChargeRow>(
            `SELECT * FROM membership_charges WHERE organisation_id=? AND (period_start>=? OR status IN ('started','processing','unknown','review') OR next_try_at IS NOT NULL)
             ORDER BY created_at DESC LIMIT 200`,
            org.id,
            `${today.slice(0, 7)}-01`,
          )
      const byId = new Map(holdings(org.state).map((h) => [h.id, h]))
      reply(200, {
        provider: { name: provider.name, live: provider.live },
        available: operations(org.state).mode === 'local',
        held: membershipCardsHeld(ctx, org.id),
        cards: input.clientId ? payments.cards(org.id, input.clientId).map(cardView) : [],
        charges: rows
          .filter((row) => here(org, byId.get(row.holding_id)))
          .map((row) => chargeView(row, provider.live)),
      })
      return true
    }

    // After a restore, card payments wait until the owner or a manager has checked the provider
    // for payments taken since the backup, then turns them back on.
    if (path.length === 5 && path[4] === 'resume') {
      if (method !== 'POST') fail(405, 'Use POST.')
      if (!['owner', 'manager'].includes(org.role))
        fail(403, 'The owner or a manager turns card payments back on.')
      empty.parse(body ?? {})
      db.run('DELETE FROM membership_card_holds WHERE organisation_id=?', org.id)
      ctx.audit(org, actor.id, 'membership.cards-resumed', org.id)
      reply(200, { ok: true })
      return true
    }

    // Setting up or turning off: the owner, managers, and general managers at their location.
    if (path.length === 5 || (path.length === 6 && path[5] === 'off')) {
      if (method !== 'POST') fail(405, 'Use POST.')
      if (!can(org.role, 'plan-card'))
        fail(403, 'Your role cannot change how a membership is paid.')
      const on = path.length === 5
      const data = on ? setUp.parse(body) : (empty.parse(body ?? {}), null)
      const result = db.transaction(() => {
        const fresh = ctx.orgFor(org.id, actor)
        if (operations(fresh.state).mode !== 'local')
          fail(409, 'Sample studios never take card payments.')
        const holding = holdingOf(fresh, path[4])
        if (!holding) fail(404, 'This membership was not found.')
        let command: Command = { type: 'plan-card', holdingId: holding!.id, reason: 'turned_off' }
        if (data) {
          // The card must be this client's, still saved, and saved with this server's provider.
          const card = db.get<CardRow>(
            'SELECT * FROM saved_cards WHERE id=? AND organisation_id=? AND client_id=? AND provider=? AND removed_at IS NULL',
            data.cardId,
            fresh.id,
            holding!.clientId,
            provider.name,
          )
          if (!card) fail(409, 'Choose one of this client’s saved cards.')
          command = {
            type: 'plan-card',
            holdingId: holding!.id,
            card: { id: card!.id, brand: card!.brand, last4: card!.last4 },
            wording: data.wording,
          }
        }
        if (fresh.role === 'general') {
          const refusal = branchRefusal(fresh.state, fresh.locationId!, command)
          if (refusal) fail(403, refusal)
        }
        const hold = membershipCardHold(ctx, fresh.id, holding!.id)
        if (hold) fail(409, hold)
        const done = dispatch(fresh.state, command, actor.name, at())
        if (!done.ok) fail(422, done.error)
        if (done.ok && done.state.revision !== fresh.state.revision)
          ctx.persist(fresh, done.state, actor.id, 'plan-card', done.recordId)
        return done.ok ? { recordId: done.recordId, revision: done.state.revision } : null
      })
      reply(200, { ok: true, ...result })
      return true
    }

    // An unclear answer is asked again as the same request, which never charges twice.
    if (path.length === 7 && path[4] === 'charges' && path[6] === 'check') {
      if (method !== 'POST') fail(405, 'Use POST.')
      const row = charges.get(path[5])
      if (!row || row.organisation_id !== org.id) fail(404, 'This payment was not found.')
      if (!can(org.role, row!.kind === 'refund' ? 'plan-cancel' : 'plan-card'))
        fail(403, 'Your role cannot check this payment.')
      if (
        !here(
          org,
          holdings(org.state).find((h) => h.id === row!.holding_id),
        )
      )
        fail(404, 'This payment was not found.')
      const checked = await charges.check(row!)
      if (!checked)
        fail(409, 'The saved card was removed. Check the payment provider’s dashboard instead.')
      ctx.audit(org, actor.id, 'membership.card-payment.unclear', row!.id)
      reply(200, chargeView(checked!, provider.live))
      return true
    }

    // Ending a membership whose current month the card paid: the money goes back to that card
    // through the provider, and the membership ends once the provider confirms it.
    if (path.length === 6 && path[5] === 'end') {
      if (method !== 'POST') fail(405, 'Use POST.')
      if (!can(org.role, 'plan-cancel') || !can(org.role, 'refund'))
        fail(403, 'Your role cannot end a membership with a refund.')
      const data = end.parse(body)
      const key = header(request, 'idempotency-key')
      if (!key || !keySchema.test(key))
        fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
      const prepared = db.transaction(() => {
        const fresh = ctx.orgFor(org.id, actor)
        const replay = db.get<ChargeRow>(
          'SELECT * FROM membership_charges WHERE organisation_id=? AND actor_id=? AND request_key=?',
          fresh.id,
          actor.id,
          key!,
        )
        if (replay) return { row: replay, replayed: true as const }
        if (operations(fresh.state).mode !== 'local')
          fail(409, 'Sample studios never take card payments.')
        const holding = holdingOf(fresh, path[4])
        if (!holding) fail(404, 'This membership was not found.')
        if (holding!.status !== 'active') fail(409, 'This plan has already ended.')
        const today = businessDate(fresh.state, at())
        const target = cardRefundTarget(holding!, today)
        if (!target)
          fail(
            409,
            'No month of this membership was paid by card through SALEANE. End it as usual.',
          )
        if (target!.processor!.provider !== provider.name)
          fail(409, 'This card was charged through a different payment provider.')
        const hold = membershipCardHold(ctx, fresh.id, holding!.id)
        if (hold) fail(409, hold)
        const cap = Math.min(planStanding(holding!, today).unusedMinor, target!.amountMinor)
        if (data.refundMinor > cap)
          fail(
            409,
            `Refund up to ${money(cap, fresh.state.organisation, true)}, the unused part paid by card.`,
          )
        rehearse(fresh, actor, at(), {
          type: 'plan-cancel',
          holdingId: holding!.id,
          reason: data.reason,
          refundMinor: data.refundMinor,
          method: 'card',
          reference: `rehearsal-${randomUUID()}`,
          processor,
        })
        const card = lastCardAgreement(holding!)
        const tries = db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM membership_charges WHERE organisation_id=? AND holding_id=? AND kind='refund' AND period_start=?",
          fresh.id,
          holding!.id,
          target!.periodStart!,
        )!.n
        const row = charges.insert({
          organisation_id: fresh.id,
          holding_id: holding!.id,
          client_id: holding!.clientId,
          kind: 'refund',
          period_start: target!.periodStart!,
          amount_minor: data.refundMinor,
          currency: fresh.state.organisation.currency,
          card_id: card?.cardId ?? '',
          card_brand: card?.brand ?? 'Card',
          card_last4: card?.last4 ?? '',
          try_number: tries + 1,
          refund_of: target!.reference!,
          reason: data.reason,
          request_key: key!,
          actor_id: actor.id,
        })
        ctx.audit(fresh, actor.id, 'membership.card-refund.started', row.id)
        return { row, replayed: false as const }
      })
      const done = prepared.replayed ? prepared.row : await charges.refund(prepared.row)
      reply(200, chargeView(done!, provider.live))
      return true
    }

    fail(404, 'This endpoint was not found.')
  }
}

/** Runs the ledger command with a stand-in reference, so money moves only if it will land. */
function rehearse(org: Org, actor: Actor, at: string, command: Command) {
  const result = dispatch(org.state, command, actor.name, at)
  if (!result.ok) fail(422, result.error)
}

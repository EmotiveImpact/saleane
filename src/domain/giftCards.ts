import type { Command } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent, Sale } from './model'
import type { GiftCard } from './giftCardsSchema'
import { GIFT_CODE_ALPHABET, GIFT_MOVE_LIMIT } from './giftCardsSchema'
import { assertMethod } from './operatingCommands'
import { businessDate, operations } from './operations'
import { addMonths } from './plans'
import { referenceTaken, refundReferenceTaken } from './references'
import { fullDateLabel, money } from './format'
import { giftHome, placeOf, salePlace } from './locations'

/**
 * V1.5: gift cards and vouchers. The money paid for one is held until it pays for a visit, so the
 * day's takings count only what a card spends at checkout. A card can pay part or all of what is
 * due after any deposit or plan; the guest pays the rest in the usual way.
 */
type GiftCommand = Extract<
  Command,
  { type: 'gift-card-sell' | 'gift-card-extend' | 'gift-card-cancel' | 'gift-card-move' }
>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/**
 * How long a card lasts when sold. Two years in the UK; five in the US, the shortest the federal
 * gift card rules allow.
 */
export const giftCardMonths = (s: BusinessState) => (s.organisation.region === 'US' ? 60 : 24)

export const giftCards = (s: BusinessState) => s.giftCards ?? []

const sum = (rows: { amountMinor: number }[]) => rows.reduce((total, r) => total + r.amountMinor, 0)

/** Typed codes are forgiving: any case, with or without spaces and dashes. */
export function normaliseCode(typed: string) {
  const raw = typed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` : raw
}

export function findGiftCard(s: BusinessState, typed: string) {
  const code = normaliseCode(typed)
  return giftCards(s).find((card) => card.code === code)
}

/** Twelve characters from a fresh random identifier, so codes cannot be worked out in sequence. */
export function giftCode(seed: string) {
  let out = ''
  for (let round = 0; out.length < 12; round += 1) {
    // cyrb53, a small well-spread string hash, run with a different seed for each round.
    let h1 = 0xdeadbeef ^ round
    let h2 = 0x41c6ce57 ^ round
    for (let i = 0; i < seed.length; i += 1) {
      const ch = seed.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    let value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
    for (let i = 0; i < 6 && out.length < 12; i += 1) {
      out += GIFT_CODE_ALPHABET[value % 32]
      value = Math.floor(value / 32)
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

/** Where a card stands today. */
export function giftStanding(card: GiftCard, today: string) {
  const spentMinor = sum(card.redemptions)
  const refundedMinor = sum(card.refunds)
  const balanceMinor = Math.max(0, card.valueMinor - spentMinor - refundedMinor)
  const expired = today > card.expiresOn
  const state: 'active' | 'used' | 'expired' | 'cancelled' =
    card.status === 'cancelled'
      ? 'cancelled'
      : balanceMinor === 0
        ? 'used'
        : expired
          ? 'expired'
          : 'active'
  return { state, spentMinor, refundedMinor, balanceMinor, canSpend: state === 'active' }
}

/**
 * Checks a card can pay `amountMinor` towards this visit and records it. `dueMinor` is what is
 * left to pay after any deposit and plan. `next` is the working copy. `asOf` is the business day a
 * card payment started on, when that payment held the card's share.
 */
export function spendGiftCard(
  next: BusinessState,
  appointment: Appointment,
  giftCardId: string,
  amountMinor: number,
  dueMinor: number,
  saleId: string,
  now: string,
  makeId: () => string,
  asOf?: string,
) {
  const org = next.organisation
  const card = giftCards(next).find((c) => c.id === giftCardId)
  if (!card) throw new Error('This gift card was not sold here.')
  const standing = giftStanding(card, asOf ?? businessDate(next, now))
  if (!standing.canSpend)
    throw new Error(
      standing.state === 'cancelled'
        ? `Gift card ${card.code} was cancelled.`
        : standing.state === 'used'
          ? `Gift card ${card.code} has been used up.`
          : `Gift card ${card.code} expired on ${fullDateLabel(card.expiresOn, org.locale)}.`,
    )
  if (!Number.isInteger(amountMinor) || amountMinor <= 0)
    throw new Error('Enter an amount above zero to take from the gift card.')
  if (amountMinor > standing.balanceMinor)
    throw new Error(`Gift card ${card.code} has ${money(standing.balanceMinor, org, true)} left.`)
  if (amountMinor > dueMinor)
    throw new Error(`Take no more than ${money(dueMinor, org, true)}, the amount due.`)
  card.redemptions.push({
    id: makeId(),
    saleId,
    appointmentId: appointment.id,
    amountMinor,
    at: now,
  })
  return { card, leftMinor: standing.balanceMinor - amountMinor }
}

function paidWith(method: string, mode: string) {
  if (mode === 'sandbox') return 'Demo payment recorded. No real money was collected.'
  return method === 'cash'
    ? 'Recorded as cash received.'
    : 'Recorded as paid at an external terminal. SALEANE did not process a payment.'
}

export function runGiftCardCommand(
  next: BusinessState,
  command: GiftCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const org = next.organisation
  const today = businessDate(next, now)
  if (command.type === 'gift-card-sell') {
    const input = command.input
    const service = input.serviceId
      ? next.services.find((s) => s.id === input.serviceId && !s.archived)
      : undefined
    if (input.kind === 'service' && !service) throw new Error('Choose a treatment offered here.')
    const client = input.clientId ? next.clients.find((c) => c.id === input.clientId) : undefined
    if (input.clientId && !client) throw new Error('Client does not belong to this studio.')
    const valueMinor = service ? service.priceMinor : input.valueMinor!
    if (valueMinor <= 0) throw new Error('This treatment has no price to put on a voucher.')
    assertMethod(next, command.method, command.reference)
    if (referenceTaken(next, command.reference))
      throw new Error('This payment reference is already recorded. Review the existing payment.')
    const place = salePlace(next, command.locationId)
    next.giftCards ??= []
    let code = giftCode(makeId())
    for (let tries = 0; next.giftCards.some((c) => c.code === code); tries += 1) {
      if (tries > 5) throw new Error('A new code could not be made. Try again.')
      code = giftCode(makeId())
    }
    const card: GiftCard = {
      id: makeId(),
      organisationId: org.id,
      code,
      kind: input.kind,
      ...(service ? { serviceId: service.id, serviceName: service.name } : {}),
      valueMinor,
      ...(client ? { clientId: client.id } : {}),
      purchaserName: input.purchaserName,
      recipientName: input.recipientName,
      message: input.message,
      issuedOn: today,
      // The last day is the anniversary itself: US rules keep the money for at least five years.
      expiresOn: addMonths(today, giftCardMonths(next)),
      soldAt: now,
      actor: '',
      ...place,
      payment: {
        id: makeId(),
        amountMinor: valueMinor,
        method: command.method,
        ...(command.reference?.trim() ? { reference: command.reference.trim() } : {}),
        recordedAt: now,
      },
      redemptions: [],
      extensions: [],
      status: 'active',
      refunds: [],
    }
    next.giftCards.push(card)
    if (client)
      addEvent({
        clientId: client.id,
        type: 'gift_card',
        title: service ? 'Voucher bought' : 'Gift card bought',
        detail: `${service ? `${service.name} voucher` : 'Gift card'} worth ${money(valueMinor, org, true)}${input.recipientName ? ` for ${input.recipientName}` : ''}, until ${fullDateLabel(card.expiresOn, org.locale)}. ${paidWith(command.method, operations(next).mode)}`,
      })
    return card.id
  }
  const card = giftCards(next).find((c) => c.id === command.giftCardId)
  if (!card) throw new Error('This gift card was not sold here.')
  if (command.type === 'gift-card-move')
    return moveGiftCard(next, card, command, now, makeId, addEvent)
  if (card.status === 'cancelled') throw new Error('This gift card has already been cancelled.')
  if (command.type === 'gift-card-extend') {
    if (command.expiresOn <= card.expiresOn || command.expiresOn < today)
      throw new Error('Choose a later date than the current one.')
    if (command.expiresOn > addMonths(today, 120))
      throw new Error('Choose a date within ten years.')
    card.extensions.push({ from: card.expiresOn, to: command.expiresOn, at: now, actor: '' })
    card.expiresOn = command.expiresOn
    return card.id
  }
  // gift-card-cancel: any money returned is capped at what is left on the card.
  const standing = giftStanding(card, today)
  const refundMinor = command.refundMinor ?? 0
  if (refundMinor > standing.balanceMinor)
    throw new Error(`Return up to ${money(standing.balanceMinor, org, true)}, what is left.`)
  if (refundMinor > 0) {
    // The sample workspace asks for no reference, so a demo refund is given one.
    const refundId = makeId()
    const reference =
      command.reference?.trim() ||
      (operations(next).mode === 'sandbox' ? `DEMO-${refundId.slice(0, 8)}` : '')
    if (!command.method || !reference)
      throw new Error('Say how the money was returned and give its reference.')
    assertMethod(next, command.method, reference)
    if (refundReferenceTaken(next, reference))
      throw new Error('This refund reference is already recorded. Review the existing record.')
    card.refunds.push({
      id: refundId,
      amountMinor: refundMinor,
      method: command.method,
      reference,
      reason: command.reason,
      createdAt: now,
      actor: '',
    })
  }
  card.status = 'cancelled'
  card.cancelled = { at: now, actor: '', reason: command.reason }
  if (card.clientId)
    addEvent({
      clientId: card.clientId,
      type: 'gift_card',
      title: card.kind === 'service' ? 'Voucher cancelled' : 'Gift card cancelled',
      detail: `${card.code}: ${command.reason}. ${refundMinor ? `${money(refundMinor, org, true)} recorded as returned. SALEANE did not process a refund.` : 'No money returned.'}`,
    })
  return card.id
}

/**
 * Stage 4: a card moves to another location, with a reason. Its code, balance, last day and
 * history stay as they are, and so does where it was sold, so money already taken and spent stays
 * where it happened. From now on it belongs to the new location: its money waiting to be spent
 * counts there, any money returned when it is cancelled leaves that location's drawer, and only
 * that location's general manager can move it again. It can still be spent at any location.
 */
function moveGiftCard(
  next: BusinessState,
  card: GiftCard,
  command: Extract<GiftCommand, { type: 'gift-card-move' }>,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const org = next.organisation
  const standing = giftStanding(card, businessDate(next, now))
  if (standing.state === 'cancelled')
    throw new Error(
      card.refunds.length
        ? `Gift card ${card.code} was cancelled and its money returned, so it cannot move.`
        : `Gift card ${card.code} was cancelled, so it cannot move.`,
    )
  if (standing.state === 'used')
    throw new Error(`Gift card ${card.code} has been used up, so there is nothing to move.`)
  if (standing.state === 'expired')
    throw new Error(
      `Gift card ${card.code} expired on ${fullDateLabel(card.expiresOn, org.locale)}. Give it more time first if it is still to be spent.`,
    )
  const site = placeOf(next, command.locationId)
  if (!site || site.archived) throw new Error('Choose an open location.')
  const from = giftHome(next, card)
  if (site.id === from) throw new Error(`Gift card ${card.code} already belongs to ${site.name}.`)
  const fromName = placeOf(next, from)?.name ?? 'its location'
  if ((card.moves?.length ?? 0) >= GIFT_MOVE_LIMIT)
    throw new Error(
      `Gift card ${card.code} has moved as often as one card can. Ask SALEANE support to look at it.`,
    )
  card.moves = [
    ...(card.moves ?? []),
    { id: makeId(), from, to: site.id, reason: command.reason, at: now, actor: '' },
  ]
  if (card.clientId)
    addEvent({
      clientId: card.clientId,
      type: 'gift_card',
      title: card.kind === 'service' ? 'Voucher moved' : 'Gift card moved',
      detail: `${card.code} moved from ${fromName} to ${site.name}. Its balance, last day and history are unchanged, and it can still be spent at any location.`,
    })
  return card.id
}

/**
 * Stage 4: money waiting to be spent on cards that can still be spent, by the location each card
 * belongs to now. Only cards with a balance are named.
 */
export function heldByHome(s: BusinessState, today: string) {
  const held = new Map<string, number>()
  for (const card of giftCards(s)) {
    const standing = giftStanding(card, today)
    if (standing.state !== 'active') continue
    const home = giftHome(s, card)
    held.set(home, (held.get(home) ?? 0) + standing.balanceMinor)
  }
  return held
}

/** Puts the person's name on cards, extensions, refunds and cancellations this command made. */
export function stampGiftCardActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(giftCards(before).map((c) => [c.id, c]))
  for (const card of giftCards(after)) {
    const previous = old.get(card.id)
    if (!previous) card.actor = actor
    if (card.cancelled && !previous?.cancelled) card.cancelled.actor = actor
    card.extensions.slice(previous?.extensions.length ?? 0).forEach((e) => (e.actor = actor))
    const refunds = new Set(previous?.refunds.map((r) => r.id))
    for (const refund of card.refunds) if (!refunds.has(refund.id)) refund.actor = actor
    // Stage 4: moves, likewise.
    card.moves?.slice(previous?.moves?.length ?? 0).forEach((m) => (m.actor = actor))
  }
}

/**
 * Stage 4, for who changed what: which card moved, from where to where. The reason is typed
 * wording, so it stays on the card and is never copied into the record.
 */
export function giftMoveDetail(after: BusinessState, action: string, recordId: string) {
  if (action !== 'gift-card-move') return null
  const move = giftCards(after)
    .find((c) => c.id === recordId)
    ?.moves?.at(-1)
  return move ? { fields: [{ f: 'locationId', from: move.from, to: move.to }] } : null
}

/** Ledger checks for parseState: every card, what it paid for and the receipts must agree. */
export function giftCardsProblem(s: BusinessState) {
  const org = s.organisation
  const cards = giftCards(s)
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return 'Duplicate gift card IDs.'
  if (new Set(cards.map((c) => c.code)).size !== cards.length) return 'Duplicate gift card codes.'
  if (cards.some((c) => c.organisationId !== org.id)) return 'Foreign workspace record.'
  const sandbox = operations(s).mode === 'sandbox'
  const salesById = new Map(s.sales.map((sale) => [sale.id, sale]))
  const spent = new Set<string>()
  for (const card of cards) {
    if (
      (card.status === 'cancelled') !== !!card.cancelled ||
      (card.kind === 'service') !== !!card.serviceId ||
      (card.clientId && !s.clients.some((c) => c.id === card.clientId)) ||
      card.payment.amountMinor !== card.valueMinor ||
      card.expiresOn < card.issuedOn
    )
      return 'Invalid gift card.'
    for (const record of [card.payment, ...card.refunds])
      if (
        ['card', 'previous_system'].includes(record.method) ||
        sandbox !== record.method.startsWith('demo_') ||
        (record.method === 'external_card' && !record.reference?.trim())
      )
        return 'A gift card payment record is not valid for this studio.'
    if (sum(card.redemptions) + sum(card.refunds) > card.valueMinor)
      return 'A gift card cannot pay or return more than it holds.'
    // Stage 4: each move starts where the card belonged and goes somewhere else.
    let home = card.locationId ?? org.locationId
    for (const move of card.moves ?? []) {
      if (move.from !== home || move.to === move.from || move.at < card.soldAt)
        return 'A gift card move does not follow on from where the card belonged.'
      home = move.to
    }
    if (new Set((card.moves ?? []).map((m) => m.id)).size !== (card.moves ?? []).length)
      return 'Duplicate gift card move IDs.'
    for (const use of card.redemptions) {
      const sale = salesById.get(use.saleId)
      if (
        !sale ||
        sale.giftCardId !== card.id ||
        sale.appointmentId !== use.appointmentId ||
        sale.giftCardMinor !== use.amountMinor ||
        spent.has(sale.id)
      )
        return 'Gift card use does not match its receipt.'
      spent.add(sale.id)
    }
  }
  for (const sale of s.sales)
    if ((sale.giftCardId || sale.giftCardMinor !== undefined) && !spent.has(sale.id))
      return 'A receipt names a gift card that did not pay for it.'
  return null
}

/** The part of a receipt paid in money at the desk: what a refund on the receipt can return. */
export const refundableOnReceipt = (sale: Sale) =>
  sale.totalMinor - (sale.coveredMinor ?? 0) - (sale.giftCardMinor ?? 0)

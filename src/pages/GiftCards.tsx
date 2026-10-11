import { useState } from 'react'
import type { FormEvent } from 'react'
import { Gift, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import {
  giftCardMonths,
  giftCards,
  giftStanding,
  heldByHome,
  normaliseCode,
} from '../domain/giftCards'
import type { GiftCard } from '../domain/giftCardsSchema'
import { fullDateLabel, money, wholeMoney } from '../domain/format'
import { parseMinor } from '../domain/money'
import {
  Button,
  Empty,
  ErrorMessage,
  Modal,
  PageHeader,
  SegmentedControl,
  Stat,
  Stats,
  Select,
} from '../design'
import { PaymentFields } from '../components/Plans'
import { SoldAt } from '../components/SoldAt'
import { asksSoldAt, giftHome, hasLocations, placeOf, places } from '../domain/locations'
import { recordDay } from '../domain/tillCount'
import { usePayment, useRun } from '../components/usePayment'
import { ReceiptActions } from '../components/ReceiptActions'
import '../components/management.css'
import '../components/plans.css'
import '../giftCards.css'
import { StudioDateField } from '../components/StudioDateField'

const STATE_LABEL = {
  active: 'Ready to spend',
  used: 'Used up',
  expired: 'Expired',
  cancelled: 'Cancelled',
} as const

type Dialog =
  | { kind: 'sell' }
  | { kind: 'sold' }
  | { kind: 'view'; cardId: string }
  | { kind: 'extend'; cardId: string }
  | { kind: 'cancel'; cardId: string }
  | { kind: 'move'; cardId: string }

/**
 * V1.5: gift cards and vouchers. The desk sells them and spends them at checkout; owners and
 * managers can give an expired card more time or cancel one. Money on a card is held for the
 * guest until it pays for a visit. Stage 4: with more than one location, owners and managers can
 * move a card to another location, and a general manager can pass on one that belongs to theirs.
 */
export function GiftCards() {
  const { state, role, blocked, branch } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const sandbox = operations(state).mode === 'sandbox'
  const may = (action: string) => !blocked && can(role, action)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'money' | 'service'>('money')
  const [amount, setAmount] = useState('50')
  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState('')
  const [purchaser, setPurchaser] = useState('')
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState('0')
  const [soldAt, setSoldAt] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const pay = usePayment()
  const { run, pending, error, setError } = useRun()
  if (role === 'practitioner')
    return (
      <div className="gift-page">
        <PageHeader variant="compact" eyebrow="Money" title="Gift cards and vouchers." />
        <Empty title="For the front desk">Gift cards are sold and spent at the front desk.</Empty>
      </div>
    )
  const services = state.services.filter((s) => !s.archived && s.priceMinor > 0)
  const rows = giftCards(state)
    .map((card) => ({ card, standing: giftStanding(card, today) }))
    .sort((a, b) => b.card.soldAt.localeCompare(a.card.soldAt))
  const needle = query.trim().toLowerCase()
  const code = normaliseCode(query)
  const shown = needle
    ? rows.filter(
        ({ card }) =>
          card.code === code ||
          card.code.replace(/-/g, '').includes(code.replace(/-/g, '')) ||
          card.purchaserName.toLowerCase().includes(needle) ||
          card.recipientName.toLowerCase().includes(needle),
      )
    : rows
  const held = rows
    .filter((r) => r.standing.state === 'active')
    .reduce((sum, r) => sum + r.standing.balanceMinor, 0)
  const spent = rows.reduce((sum, r) => sum + r.standing.spentMinor, 0)
  const sold = rows.reduce((sum, r) => sum + r.card.valueMinor, 0)
  // Stage 4: with several locations, each card belongs to one, and its money waits there.
  const several = hasLocations(state)
  const placeName = (id: string) => placeOf(state, id)?.name ?? 'a closed location'
  const heldAt = [...heldByHome(state, today)].sort(
    ([a], [b]) =>
      places(state, true).findIndex((p) => p.id === a) -
      places(state, true).findIndex((p) => p.id === b),
  )
  /** Open locations a card could move to: anywhere but where it belongs. */
  const destinations = (card: GiftCard) =>
    places(state).filter((place) => place.id !== giftHome(state, card))
  /** Moving is for cards that can still be spent, and a general manager's own location's cards. */
  const mayMove = (card: GiftCard) =>
    may('gift-card-move') &&
    giftStanding(card, today).state === 'active' &&
    destinations(card).length > 0 &&
    (role !== 'general' || giftHome(state, card) === branch)
  const open = (next: Dialog) => {
    setDialog(next)
    setError('')
    pay.reset()
    if (next.kind === 'sell') {
      setKind('money')
      setAmount('50')
      setServiceId(services[0]?.id ?? '')
      setSoldAt(org.locationId)
      setClientId('')
      setPurchaser('')
      setRecipient('')
      setMessage('')
    }
    if (next.kind === 'extend') {
      const card = giftCards(state).find((c) => c.id === next.cardId)!
      const from = card.expiresOn > today ? card.expiresOn : today
      const d = new Date(`${from}T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + 6)
      setExpiresOn(d.toISOString().slice(0, 10))
    }
    if (next.kind === 'cancel') {
      setReason('')
      setRefund('0')
    }
    if (next.kind === 'move') {
      const card = giftCards(state).find((c) => c.id === next.cardId)!
      setReason('')
      setMoveTo(destinations(card)[0]?.id ?? '')
    }
  }
  const current =
    dialog && 'cardId' in dialog ? giftCards(state).find((c) => c.id === dialog.cardId) : null
  const currentStanding = current ? giftStanding(current, today) : null
  const chosenService = services.find((s) => s.id === serviceId)
  const valueMinor = kind === 'service' ? (chosenService?.priceMinor ?? 0) : parseMinor(amount, 0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return
    if (dialog.kind === 'sell') {
      if (!Number.isFinite(valueMinor) || valueMinor <= 0) {
        setError('Enter an amount above zero, with up to two decimal places.')
        return
      }
      if (!pay.ready) {
        setError('Confirm the payment has already been received.')
        return
      }
      const client = state.clients.find((c) => c.id === clientId)
      const result = await run({
        type: 'gift-card-sell',
        input: {
          kind,
          ...(kind === 'service' ? { serviceId } : { valueMinor }),
          ...(client ? { clientId: client.id } : {}),
          purchaserName: (client?.name ?? purchaser).trim(),
          recipientName: recipient.trim(),
          message: message.trim(),
        },
        ...pay.payment,
        ...(asksSoldAt(state, role) ? { locationId: soldAt } : {}),
      })
      // The new card is the newest one once the saved state arrives.
      if (result) setDialog({ kind: 'sold' })
      return
    }
    if (!current) return
    if (dialog.kind === 'extend') {
      if (await run({ type: 'gift-card-extend', giftCardId: current.id, expiresOn }))
        setDialog({ kind: 'view', cardId: current.id })
      return
    }
    if (dialog.kind === 'move') {
      if (
        await run({
          type: 'gift-card-move',
          giftCardId: current.id,
          locationId: moveTo,
          reason: reason.trim(),
        })
      )
        setDialog({ kind: 'view', cardId: current.id })
      return
    }
    if (dialog.kind === 'cancel') {
      const refundMinor = parseMinor(refund, 0)
      if (!Number.isFinite(refundMinor) || refundMinor < 0) {
        setError('Enter the amount returned, zero or more, with up to two decimal places.')
        return
      }
      if (refundMinor > 0 && !pay.ready) {
        setError('Confirm the money has already been returned.')
        return
      }
      if (
        await run({
          type: 'gift-card-cancel',
          giftCardId: current.id,
          reason: reason.trim(),
          ...(refundMinor > 0 ? { refundMinor, ...pay.payment } : {}),
        })
      )
        setDialog({ kind: 'view', cardId: current.id })
    }
  }

  // After a sale, show the newest card so the desk can read out or print its code.
  const newest = rows[0]?.card
  const soldCard = dialog?.kind === 'sold' ? newest : undefined

  return (
    <div className="gift-page">
      <PageHeader
        variant="compact"
        eyebrow="Money"
        title="Gift cards and vouchers."
        description={`Sold at the desk and spent at checkout. Each lasts ${giftCardMonths(state) / 12} years and can pay for any visit until it runs out.`}
        actions={
          may('gift-card-sell') ? (
            <Button onClick={() => open({ kind: 'sell' })}>
              <Plus size={16} aria-hidden="true" /> Sell a gift card
            </Button>
          ) : undefined
        }
      />
      <Stats className="gift-totals">
        <Stat label="Waiting to be spent" value={wholeMoney(held, org)} />
        <Stat label="Spent at visits" value={wholeMoney(spent, org)} />
        <Stat label="Sold in total" value={wholeMoney(sold, org)} />
      </Stats>
      {several && heldAt.length > 0 && (
        <p className="ops-help gift-held-at">
          Waiting to be spent, by where each card belongs:{' '}
          {heldAt.map(([id, minor]) => `${placeName(id)} ${wholeMoney(minor, org)}`).join(', ')}.
        </p>
      )}
      <p className="ops-help">
        Money paid for a gift card counts as takings only when the card pays for a visit. Until then
        it belongs to whoever holds the card.
      </p>
      {rows.length > 0 && (
        <label className="ops-field gift-search">
          Find a card by code or name
          <input
            type="search"
            value={query}
            placeholder="ABCD-EFGH-JKLM or a name"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {rows.length === 0 ? (
        <section className="surface gift-empty" aria-labelledby="gift-empty-title">
          <GiftCardSample />
          <div>
            <h2 id="gift-empty-title">No gift cards yet</h2>
            <p>
              A gift card or a treatment voucher is paid for now and spent at checkout. Each one has
              its own code, like this, and its balance and every visit it pays for show here.
            </p>
            {may('gift-card-sell') && <p>Sell the first one with Sell a gift card, above.</p>}
          </div>
        </section>
      ) : shown.length === 0 ? (
        <p className="ops-help">No card matches that search.</p>
      ) : (
        <ul className="gift-grid">
          {shown.map(({ card, standing }) => (
            <li key={card.id}>
              <button
                type="button"
                className="gift-tile"
                onClick={() => open({ kind: 'view', cardId: card.id })}
              >
                <GiftCardMini card={card} standing={standing} />
                <span className="gift-tile-copy">
                  <strong>
                    {card.kind === 'service' ? `${card.serviceName} voucher` : 'Gift card'}
                  </strong>
                  <small>
                    From {card.purchaserName}
                    {card.recipientName ? ` for ${card.recipientName}` : ''}
                  </small>
                  {several && <small>{placeName(giftHome(state, card))}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'sold' && soldCard && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title="Gift card ready"
          description="Give the code to the buyer. It is all anyone needs to spend the card here."
        >
          <GiftCardFace card={soldCard} />
          <ReceiptActions receiptKey={`gift-card:${soldCard.id}`} />
          <div className="ops-actions">
            <Button onClick={printCard}>Print</Button>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'view' && current && currentStanding && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title={current.kind === 'service' ? 'Voucher' : 'Gift card'}
          description={`${STATE_LABEL[currentStanding.state]} · ${money(currentStanding.balanceMinor, org, true)} left of ${money(current.valueMinor, org, true)}`}
        >
          <GiftCardFace card={current} />
          {(several || !!current.moves?.length) && (
            <p className="gift-where">
              {current.moves?.length
                ? `Belongs to ${placeName(giftHome(state, current))}. Sold at ${placeName(current.locationId ?? org.locationId)}.`
                : `Sold at ${placeName(current.locationId ?? org.locationId)}, and belongs there.`}{' '}
              It can be spent at any location.
            </p>
          )}
          <GiftHistory card={current} />
          {current.status === 'active' && currentStanding.balanceMinor > 0 && (
            <div className="ops-actions">
              {may('gift-card-extend') && (
                <Button
                  variant="secondary"
                  onClick={() => open({ kind: 'extend', cardId: current.id })}
                >
                  Give more time
                </Button>
              )}
              {mayMove(current) && (
                <Button variant="quiet" onClick={() => open({ kind: 'move', cardId: current.id })}>
                  Move to another location
                </Button>
              )}
              {may('gift-card-cancel') && (
                <Button
                  variant="quiet"
                  onClick={() => open({ kind: 'cancel', cardId: current.id })}
                >
                  Cancel card
                </Button>
              )}
            </div>
          )}
        </Modal>
      )}
      {dialog &&
        (dialog.kind === 'sell' ||
          dialog.kind === 'extend' ||
          dialog.kind === 'cancel' ||
          dialog.kind === 'move') && (
          <Modal
            open
            onClose={() => {
              if (!pending) setDialog(null)
            }}
            title={
              dialog.kind === 'sell'
                ? 'Sell a gift card'
                : dialog.kind === 'extend'
                  ? `Give ${current?.code} more time`
                  : dialog.kind === 'move'
                    ? `Move ${current?.code}`
                    : `Cancel ${current?.code}`
            }
            description={
              dialog.kind === 'sell'
                ? 'The payment is recorded now. The card can be spent on any visit.'
                : dialog.kind === 'extend'
                  ? `It can be spent until ${current ? fullDateLabel(current.expiresOn, org.locale) : ''} at the moment. The earlier date stays in its history.`
                  : dialog.kind === 'move'
                    ? `It belongs to ${current ? placeName(giftHome(state, current)) : ''} now. Its code, balance, last day and history stay as they are.`
                    : `Nothing is deleted. Up to ${money(currentStanding?.balanceMinor ?? 0, org, true)} is left on it.`
            }
          >
            <form onSubmit={submit} className="plan-form">
              {dialog.kind === 'sell' && (
                <>
                  <SegmentedControl
                    label="What are they buying?"
                    appearance="pill"
                    value={kind}
                    onChange={(value) => {
                      setKind(value)
                      setError('')
                    }}
                    options={[
                      { value: 'money', label: 'An amount' },
                      { value: 'service', label: 'A treatment' },
                    ]}
                  />
                  {kind === 'money' ? (
                    <label className="ops-field">
                      Amount ({org.currency})
                      <input
                        inputMode="decimal"
                        value={amount}
                        required
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                  ) : (
                    <label className="ops-field">
                      Treatment
                      <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name} · {money(service.priceMinor, org, true)}
                          </option>
                        ))}
                      </Select>
                      <small>
                        Worth today’s price. If the price goes up, the guest pays the difference.
                      </small>
                    </label>
                  )}
                  <label className="ops-field">
                    Bought by a client?
                    <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">Someone new</option>
                      {state.clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {!clientId && (
                    <label className="ops-field">
                      Buyer’s name
                      <input
                        value={purchaser}
                        required
                        minLength={2}
                        maxLength={100}
                        onChange={(e) => setPurchaser(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="ops-field">
                    For (optional)
                    <input
                      value={recipient}
                      maxLength={100}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  <label className="ops-field">
                    Message on the card (optional)
                    <textarea
                      value={message}
                      maxLength={300}
                      rows={2}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <SoldAt value={soldAt} onChange={setSoldAt} />
                  <PaymentFields {...pay.fields} />
                </>
              )}
              {dialog.kind === 'extend' && (
                <label className="ops-field">
                  New last day
                  <StudioDateField value={expiresOn} min={today} required onChange={setExpiresOn} />
                </label>
              )}
              {dialog.kind === 'cancel' && (
                <>
                  <label className="ops-field">
                    Why it is cancelled
                    <input
                      value={reason}
                      required
                      minLength={2}
                      maxLength={300}
                      placeholder="For example: bought by mistake"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <label className="ops-field">
                    Money returned ({org.currency})
                    <input
                      inputMode="decimal"
                      value={refund}
                      onChange={(e) => setRefund(e.target.value)}
                    />
                    <small>Leave at 0 if nothing is returned.</small>
                  </label>
                  {parseMinor(refund, 0) > 0 && <PaymentFields {...pay.fields} verb="returned" />}
                </>
              )}
              {dialog.kind === 'move' && current && (
                <>
                  <label className="ops-field">
                    Move to
                    <Select value={moveTo} required onChange={(e) => setMoveTo(e.target.value)}>
                      {destinations(current).map((place) => (
                        <option key={place.id} value={place.id}>
                          {place.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="ops-field">
                    Why it is moving
                    <input
                      value={reason}
                      required
                      minLength={2}
                      maxLength={300}
                      placeholder="For example: the guest now lives nearer"
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <small>Kept on the card’s history.</small>
                  </label>
                  <p className="subtle">
                    Money already taken for it and spent with it stays where it happened. What is
                    left on it, {money(currentStanding?.balanceMinor ?? 0, org, true)}, counts at{' '}
                    {placeName(moveTo)} from now on. It can still be spent at any location.
                  </p>
                </>
              )}
              {(dialog.kind === 'sell' || dialog.kind === 'cancel') && (
                <p className="subtle demo-note">
                  {sandbox
                    ? 'Sample studio: no real money moves.'
                    : 'SALEANE records this; it does not take or return the money itself.'}
                </p>
              )}
              <ErrorMessage error={error} />
              <div className="ops-actions">
                <Button
                  type="submit"
                  disabled={
                    pending || (dialog.kind === 'sell' && kind === 'service' && !chosenService)
                  }
                >
                  {pending
                    ? 'Saving…'
                    : dialog.kind === 'sell'
                      ? `Record ${Number.isFinite(valueMinor) && valueMinor > 0 ? money(valueMinor, org, true) : 'sale'}`
                      : dialog.kind === 'extend'
                        ? 'Save new date'
                        : dialog.kind === 'move'
                          ? 'Move card'
                          : 'Cancel card'}
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setDialog(null)}>
                  {dialog.kind === 'cancel' ? 'Keep card' : 'Back'}
                </Button>
              </div>
            </form>
          </Modal>
        )}
    </div>
  )
}

/** Prints only the card, then leaves printing as it was for every other page. */
function printCard() {
  document.body.classList.add('printing-gift')
  const done = () => {
    document.body.classList.remove('printing-gift')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

/** The card as the guest would see it, in the studio's colours, for reading out or printing. */
function GiftCardFace({ card }: { card: GiftCard }) {
  const { state } = useStore()
  const org = state.organisation
  return (
    <figure className="gift-face">
      <div className="gift-face-top">
        <span className="gift-face-studio">{org.name}</span>
        <span>{card.kind === 'service' ? 'Treatment voucher' : 'Gift card'}</span>
      </div>
      <div className="gift-face-middle">
        {card.kind === 'service' ? (
          <span className="gift-face-value gift-face-treatment">{card.serviceName}</span>
        ) : (
          <span className="gift-face-value">{money(card.valueMinor, org)}</span>
        )}
        {card.recipientName && <span className="gift-face-for">For {card.recipientName}</span>}
        {card.message && <blockquote>{card.message}</blockquote>}
      </div>
      <div className="gift-face-bottom">
        <span className="gift-face-code">{card.code}</span>
        <span>Use by {fullDateLabel(card.expiresOn, org.locale)}</span>
      </div>
    </figure>
  )
}

/** A card on the list: what is left on it, its code and its last day, in the studio's colours. */
function GiftCardMini({
  card,
  standing,
}: {
  card: GiftCard
  standing: ReturnType<typeof giftStanding>
}) {
  const { state } = useStore()
  const org = state.organisation
  return (
    <span className="gift-face gift-face-mini" data-state={standing.state}>
      <span className="gift-face-top" aria-hidden="true">
        <span className="gift-face-studio">{org.name}</span>
        <span>{card.kind === 'service' ? 'Voucher' : 'Gift card'}</span>
      </span>
      <span className="gift-face-middle">
        <span className="gift-face-value">{money(standing.balanceMinor, org)}</span>
        <span className="gift-face-of">left of {money(card.valueMinor, org)}</span>
      </span>
      <span className="gift-face-bottom">
        <span className="gift-face-code">{card.code}</span>
        <span>
          {standing.state === 'active'
            ? `Use by ${fullDateLabel(card.expiresOn, org.locale)}`
            : STATE_LABEL[standing.state]}
        </span>
      </span>
    </span>
  )
}

/** What a card will look like, shown before the studio has sold one. */
function GiftCardSample() {
  const { state } = useStore()
  return (
    <span className="gift-face gift-face-mini gift-face-sample" aria-hidden="true">
      <span className="gift-face-top">
        <span className="gift-face-studio">{state.organisation.name}</span>
        <span>Gift card</span>
      </span>
      <span className="gift-face-middle">
        <span className="gift-face-value">{money(5000, state.organisation)}</span>
      </span>
      <span className="gift-face-bottom">
        <span className="gift-face-code">ABCD-EFGH-JKLM</span>
      </span>
    </span>
  )
}

/** Everything that has happened to a card, oldest first. */
function GiftHistory({ card }: { card: GiftCard }) {
  const { state } = useStore()
  const org = state.organisation
  // The studio's own day, as receipts and the till show it.
  const day = (instant: string) => fullDateLabel(recordDay(state, instant), org.locale)
  const receipt = (saleId: string) => state.sales.find((s) => s.id === saleId)?.receiptNumber
  // Stage 4: with several locations, where it was sold and each move to another.
  const placeName = (id: string) => placeOf(state, id)?.name ?? 'a closed location'
  const soldAt =
    hasLocations(state) || card.moves?.length
      ? ` at ${placeName(card.locationId ?? org.locationId)}`
      : ''
  const rows = [
    {
      at: card.soldAt,
      text: `Sold for ${money(card.valueMinor, org, true)}${soldAt} by ${card.actor || 'the desk'}`,
    },
    ...(card.moves ?? []).map((m) => ({
      at: m.at,
      text: `Moved from ${placeName(m.from)} to ${placeName(m.to)} by ${m.actor || 'a manager'}: ${m.reason}`,
    })),
    ...card.redemptions.map((r) => ({
      at: r.at,
      text: `Paid ${money(r.amountMinor, org, true)} towards a visit${receipt(r.saleId) ? ` (receipt ${receipt(r.saleId)})` : ''}`,
    })),
    ...card.extensions.map((e) => ({
      at: e.at,
      text: `Last day moved from ${fullDateLabel(e.from, org.locale)} to ${fullDateLabel(e.to, org.locale)} by ${e.actor || 'a manager'}`,
    })),
    ...card.refunds.map((r) => ({
      at: r.createdAt,
      text: `${money(r.amountMinor, org, true)} recorded as returned`,
    })),
    ...(card.cancelled
      ? [
          {
            at: card.cancelled.at,
            text: `Cancelled by ${card.cancelled.actor}: ${card.cancelled.reason}`,
          },
        ]
      : []),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <section className="gift-history" aria-label="History">
      <h3>
        <Gift size={16} aria-hidden="true" /> History
      </h3>
      <ol>
        {rows.map((row, index) => (
          <li key={index}>
            <time dateTime={row.at}>{day(row.at)}</time>
            <span>{row.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

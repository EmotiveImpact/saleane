import { useState } from 'react'
import { CreditCard, FlaskConical, PauseCircle } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { businessDate, can } from '../domain/operations'
import { holdings, openCardAgreement } from '../domain/plans'
import type { Holding } from '../domain/plansSchema'
import {
  cardAgreementWording,
  dayMonth,
  firstCardMonth,
  planCardChannels,
  upcomingCardPayment,
} from '../domain/planCards'
import { addDays, dateLabel, money } from '../domain/format'
import { Button, ErrorMessage, Modal, Checkbox } from '../design'
import {
  chargeWords,
  planCardsBase as base,
  useCheckAgain,
  useMayChange,
  usePlanCards,
} from './usePlanCards'
import type { PlanCardsReply, PlanCharge } from './usePlanCards'

/**
 * Stage 1 screens for a membership paid each month from a saved card: the line on the client's
 * membership, setting it up with the client's agreement, turning it off, "Check again" on an
 * unclear answer, and this month's card payments on Money. The server takes the money; these
 * screens show what it did, and never say money moved before the provider confirmed it.
 */
/**
 * On the client's membership: how it is paid, the next payment, and the last try at the card.
 * Setting it up and turning it off are here for the owner, managers and the general manager of
 * the location that sold it.
 */
export function MembershipCardLine({
  holding,
  reply,
  onChanged,
  onSetUp,
}: {
  holding: Holding
  reply: PlanCardsReply
  onChanged: () => void
  onSetUp: () => void
}) {
  const { state, role, blocked, reload } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const mayChange = useMayChange()(holding)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const again = useCheckAgain(onChanged)
  if (holding.kind !== 'membership' || !reply.available) return null
  const agreement = openCardAgreement(holding)
  const rows = reply.charges.filter((c) => c.holdingId === holding.id)
  const last = rows.find((c) => c.kind === 'charge')
  const refund = rows.find((c) => c.kind === 'refund' && c.status !== 'succeeded')
  // The next payment still to come: today's, until the card has been tried for it.
  const dueToday = upcomingCardPayment(holding, today)
  const next =
    dueToday && rows.some((c) => c.kind === 'charge' && c.periodStart === dueToday)
      ? upcomingCardPayment(holding, addDays(today, 1))
      : dueToday
  const day = (iso: string) => businessDate(state, iso)
  async function turnOff() {
    setBusy(true)
    setError('')
    try {
      await api(`${base(org.id)}/${encodeURIComponent(holding.id)}/off`, {
        method: 'POST',
        body: {},
      })
      setConfirm(false)
      await reload().catch(() => null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Card payments could not be turned off.')
    } finally {
      setBusy(false)
    }
  }
  const shown = [last, refund].filter((c): c is PlanCharge => !!c)
  if (!agreement && !shown.length && !(holding.status === 'active' && mayChange)) return null
  return (
    <div className="plan-card-line">
      {agreement && (
        <p>
          <CreditCard size={15} aria-hidden="true" /> Paid by {agreement.brand} ending{' '}
          {agreement.last4} each month.
          {reply.paused
            ? ' Paused while the studio is read only.'
            : next
              ? ` Next payment ${money(holding.priceMinor, org, true)} on ${dayMonth(next, org.locale)}.`
              : ''}
        </p>
      )}
      {shown.map((charge) => {
        const words = chargeWords(charge, org.locale, day)
        const mayCheck =
          charge.status === 'unknown' &&
          !blocked &&
          (charge.kind === 'refund' ? can(role, 'plan-cancel') : mayChange)
        return (
          <div key={charge.id} className={`plan-card-try is-${charge.status}`} role="status">
            <strong>
              {charge.kind === 'refund' ? 'Refund to the card' : 'Last payment'}: {words.label}
            </strong>
            <span>{words.detail}</span>
            {mayCheck && (
              <Button
                variant="quiet"
                disabled={!!again.busy}
                onClick={() => void again.check(charge.id)}
              >
                {again.busy === charge.id ? 'Checking…' : 'Check again'}
              </Button>
            )}
          </div>
        )
      })}
      <ErrorMessage error={error || again.error} />
      {holding.status === 'active' && mayChange && (
        <div className="plan-controls">
          {agreement ? (
            confirm ? (
              <>
                <span className="subtle">
                  The card will not be charged again. Each month is then paid at the desk.
                </span>
                <Button variant="secondary" disabled={busy} onClick={() => void turnOff()}>
                  {busy ? 'Turning off…' : 'Yes, turn off card payments'}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setConfirm(false)}>
                  Keep them
                </Button>
              </>
            ) : (
              <Button variant="quiet" disabled={blocked} onClick={() => setConfirm(true)}>
                Turn off card payments
              </Button>
            )
          ) : (
            <Button variant="quiet" disabled={blocked} onClick={onSetUp}>
              Pay each month from a saved card
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Setting a membership to be paid from a saved card: choose the card, read the exact words to the
 * client, and confirm they agreed. The server works the words out again and keeps them.
 */
export function CardSetUp({
  holding,
  reply,
  onClose,
  onDone,
}: {
  holding: Holding
  reply: PlanCardsReply
  onClose: () => void
  onDone: () => void
}) {
  const { state, blocked, reload } = useStore()
  const org = state.organisation
  const client = state.clients.find((c) => c.id === holding.clientId)
  const [cardId, setCardId] = useState(reply.cards[0]?.id ?? '')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const card = reply.cards.find((c) => c.id === cardId)
  const reachable = !!client && planCardChannels(state, client).length > 0
  const today = businessDate(state)
  const first = firstCardMonth(holding, today)
  const wording = card ? cardAgreementWording(state, holding, card) : ''
  const expiry = (c: (typeof reply.cards)[number]) =>
    `${c.brand} card ending ${c.last4}, which expires ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}`
  async function save() {
    if (!card || !agreed) return
    setBusy(true)
    setError('')
    try {
      await api(`${base(org.id)}/${encodeURIComponent(holding.id)}`, {
        method: 'POST',
        body: { cardId: card.id, wording, agreed: true },
      })
      await reload().catch(() => null)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Card payments could not be set up.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`Pay ${holding.name} from a saved card`}
      description={`${money(holding.priceMinor, org, true)} each month for ${client?.name ?? 'the client'}.`}
    >
      <div className="plan-form plan-card-setup">
        {!reply.provider.live && (
          <p className="card-test-note">
            <FlaskConical size={16} aria-hidden="true" />
            Test mode: no card is charged and no money moves.
          </p>
        )}
        {!reachable ? (
          <p className="subtle">
            The words promise a reminder before each payment. Add {client?.name ?? 'the client'}’s
            email address, or a mobile number they allow texts on, then set this up.
          </p>
        ) : reply.cards.length === 0 ? (
          <p className="subtle">
            {client?.name ?? 'This client'} has no saved card yet. They can save one from the link
            to their visit, once the studio offers it in Settings, Payments & tax. Then set this up
            here.
          </p>
        ) : (
          <>
            {reply.cards.length === 1 ? (
              <p className="plan-card-one">
                <CreditCard size={16} aria-hidden="true" /> From their {expiry(reply.cards[0])}.
              </p>
            ) : (
              <fieldset className="plan-card-choice" disabled={busy}>
                <legend>Which saved card</legend>
                {reply.cards.map((c) => (
                  <label key={c.id} className="card-route">
                    <input
                      type="radio"
                      name="plan-card"
                      checked={cardId === c.id}
                      onChange={() => {
                        setCardId(c.id)
                        setAgreed(false)
                      }}
                    />
                    <CreditCard size={16} aria-hidden="true" />
                    {expiry(c)}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="plan-card-wording">
              <strong>Read this to the client, or let them read it</strong>
              <p>{wording}</p>
            </div>
            <p className="subtle">
              The first payment from the card is {money(holding.priceMinor, org, true)} on{' '}
              {dateLabel(first, org.locale)}, from 09:00. Any month before then is paid at the desk
              as usual.
            </p>
            <label className="ops-check plan-card-agree">
              <Checkbox
                checked={agreed}
                disabled={busy}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              {client?.name ?? 'The client'} has agreed to these words.
            </label>
          </>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          {reachable && reply.cards.length > 0 && (
            <Button disabled={blocked || busy || !card || !agreed} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Set up card payments'}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {reachable && reply.cards.length ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Money, Plans: this month's membership payments from saved cards, and any that need a look. */
export function MembershipCardPayments() {
  const { state, role, blocked, branch } = useStore()
  const org = state.organisation
  const { reply, error, load } = usePlanCards()
  const again = useCheckAgain(load)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState('')
  if (!reply?.available) return error ? <ErrorMessage error={error} /> : null
  const today = businessDate(state)
  const month = today.slice(0, 7)
  const day = (iso: string) => businessDate(state, iso)
  const mine = (h: Holding) => role !== 'general' || (h.locationId ?? org.locationId) === branch
  const byId = new Map(holdings(state).map((h) => [h.id, h]))
  const clientName = (id: string) => state.clients.find((c) => c.id === id)?.name ?? 'Client'
  // The latest try for each membership month; the server lists them newest first.
  const latest = new Map<string, PlanCharge>()
  for (const charge of reply.charges) {
    const key = `${charge.kind}:${charge.holdingId}:${charge.periodStart}`
    if (!latest.has(key)) latest.set(key, charge)
  }
  const rows = [...latest.values()].filter(
    (c) =>
      day(c.createdAt).slice(0, 7) === month ||
      c.periodStart.slice(0, 7) === month ||
      ['started', 'processing', 'unknown', 'review'].includes(c.status) ||
      !!c.nextTryAt,
  )
  const tried = new Set(
    rows.filter((c) => c.kind === 'charge').map((c) => `${c.holdingId}:${c.periodStart}`),
  )
  const upcoming = holdings(state)
    .filter((h) => h.status === 'active' && h.kind === 'membership' && mine(h))
    .map((h) => ({ holding: h, date: upcomingCardPayment(h, today) }))
    .filter(
      (x): x is { holding: Holding; date: string } =>
        !!x.date && x.date.slice(0, 7) === month && !tried.has(`${x.holding.id}:${x.date}`),
    )
  const total = (list: { amountMinor: number }[]) =>
    money(
      list.reduce((sum, c) => sum + c.amountMinor, 0),
      org,
      true,
    )
  const charges = rows.filter((c) => c.kind === 'charge')
  const taken = charges.filter((c) => c.status === 'succeeded')
  const declined = charges.filter((c) => c.status === 'failed')
  const unclear = charges.filter((c) => !['succeeded', 'failed'].includes(c.status))
  async function resume() {
    setResuming(true)
    setResumeError('')
    try {
      await api(`${base(org.id)}/resume`, { method: 'POST', body: {} })
      load()
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : 'Card payments could not be turned back on.')
    } finally {
      setResuming(false)
    }
  }
  // While the studio is read only, say so wherever a membership is set to be paid from a card.
  const paused =
    !!reply.paused &&
    holdings(state).some(
      (h) => h.status === 'active' && h.kind === 'membership' && mine(h) && !!openCardAgreement(h),
    )
  if (!rows.length && !upcoming.length && !reply.held && !paused) return null
  // What needs a person comes first; long months are tucked behind "See all".
  const rank = (c: PlanCharge) => (c.status === 'succeeded' ? 3 : c.status === 'failed' ? 1 : 0)
  const entries = [
    ...rows.map((charge) => ({ rank: rank(charge), key: charge.id, charge })),
    ...upcoming.map((item) => ({ rank: 2, key: `up-${item.holding.id}`, item })),
  ].sort((a, b) => a.rank - b.rank)
  const SHOWN = 6
  const entry = (e: (typeof entries)[number]) => {
    if ('item' in e && e.item) {
      const { holding, date } = e.item
      const card = openCardAgreement(holding)
      return (
        <div className="ops-record" key={e.key}>
          <div className="ops-record-copy">
            <strong>
              {clientName(holding.clientId)} · {holding.name}
            </strong>
            <small>
              Due on {dateLabel(date, org.locale)} from the {card?.brand ?? 'saved'} card ending{' '}
              {card?.last4 ?? ''}.
            </small>
          </div>
          <span className="ops-tag">{reply.paused ? 'Paused' : 'Upcoming'}</span>
          <span className="ops-record-money">{money(holding.priceMinor, org, true)}</span>
        </div>
      )
    }
    const charge = (e as { charge: PlanCharge }).charge
    const holding = byId.get(charge.holdingId)
    const words = chargeWords(charge, org.locale, day)
    const mayCheck =
      charge.status === 'unknown' &&
      !blocked &&
      can(role, charge.kind === 'refund' ? 'plan-cancel' : 'plan-card')
    return (
      <div className="ops-record" key={e.key}>
        <div className="ops-record-copy">
          <strong>
            {clientName(charge.clientId)} · {holding?.name ?? 'Membership'}
          </strong>
          <small>
            {charge.kind === 'refund' ? 'Refund' : 'Month'} from{' '}
            {dateLabel(charge.periodStart, org.locale)} · {charge.card.brand} ending{' '}
            {charge.card.last4}
            {charge.kind === 'charge' && charge.try > 1 ? ` · try ${charge.try} of 4` : ''}
          </small>
          {words.detail && <small>{words.detail}</small>}
          {mayCheck && (
            <Button
              variant="quiet"
              disabled={!!again.busy}
              onClick={() => void again.check(charge.id)}
            >
              {again.busy === charge.id ? 'Checking…' : 'Check again'}
            </Button>
          )}
        </div>
        <span className={`ops-tag ${charge.status === 'succeeded' ? 'is-active' : ''}`}>
          {words.label}
        </span>
        <span className="ops-record-money">
          {money(charge.kind === 'refund' ? -charge.amountMinor : charge.amountMinor, org, true)}
        </span>
      </div>
    )
  }
  return (
    <section className="plan-card-month" aria-labelledby="plan-card-month-heading">
      <h3 id="plan-card-month-heading">
        <CreditCard size={18} aria-hidden="true" /> Membership payments from saved cards this month
      </h3>
      {!reply.provider.live && (
        <p className="card-test-note">
          <FlaskConical size={16} aria-hidden="true" />
          Test mode: no card is charged and no money moves.
        </p>
      )}
      {paused && (
        <div className="plan-card-held" role="status">
          <PauseCircle size={20} aria-hidden="true" />
          <div>
            <strong>Card payments for memberships are paused while the studio is read only.</strong>
            <p>
              No client's card is tried until the SALEANE bill is paid. A month that falls due
              meanwhile is not taken from the card, so take it at the desk once the bill is paid.
            </p>
          </div>
        </div>
      )}
      {reply.held && (
        <div className="plan-card-held" role="status">
          <PauseCircle size={20} aria-hidden="true" />
          <div>
            <strong>Card payments for memberships are paused after a restore.</strong>
            <p>
              Check the payment provider for payments taken since the backup and record any by hand.
              Then turn card payments back on.
            </p>
            {['owner', 'manager'].includes(role) && (
              <Button
                variant="secondary"
                disabled={blocked || resuming}
                onClick={() => void resume()}
              >
                {resuming ? 'Turning on…' : 'Turn card payments back on'}
              </Button>
            )}
            <ErrorMessage error={resumeError} />
          </div>
        </div>
      )}
      <dl className="plan-card-totals">
        <div>
          <dt>Upcoming ({upcoming.length})</dt>
          <dd>{total(upcoming.map((x) => ({ amountMinor: x.holding.priceMinor })))}</dd>
        </div>
        <div>
          <dt>Taken ({taken.length})</dt>
          <dd>{total(taken)}</dd>
        </div>
        <div>
          <dt>Declined or not taken ({declined.length})</dt>
          <dd>{total(declined)}</dd>
        </div>
        <div>
          <dt>Unclear or waiting ({unclear.length})</dt>
          <dd>{total(unclear)}</dd>
        </div>
      </dl>
      <div className="ops-ledger">{entries.slice(0, SHOWN).map(entry)}</div>
      {entries.length > SHOWN && (
        <details className="plan-card-more">
          <summary>See all {entries.length}</summary>
          <div className="ops-ledger">{entries.slice(SHOWN).map(entry)}</div>
        </details>
      )}
      <ErrorMessage error={again.error} />
      <p className="ops-help">
        Card payments are not cash, so they are never expected in the till count. Accounts exports
        list them as card payments through SALEANE.
      </p>
    </section>
  )
}

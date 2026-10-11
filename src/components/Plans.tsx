import { useState } from 'react'
import type { FormEvent } from 'react'
import { Layers, Plus, Repeat } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can, operations } from '../domain/operations'
import {
  cardRefundTarget,
  clientHoldings,
  holdings,
  offers,
  openCardAgreement,
  planStanding,
} from '../domain/plans'
import type { Holding, Offer, OfferInput } from '../domain/plansSchema'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { Button, ErrorMessage, Modal, SegmentedControl, Select, Checkbox } from '../design'
import './management.css'
import './plans.css'
import { usePayment, useRun } from './usePayment'
import { SoldAt } from './SoldAt'
import { asksSoldAt } from '../domain/locations'
import type { Method } from './usePayment'
import { CardSetUp, MembershipCardLine, MembershipCardPayments } from './PlanCards'
import { useCardEnd, usePlanCards } from './usePlanCards'

/**
 * V1.5 screens for packages and memberships: what the studio offers (Settings), what a client
 * holds (their page), and the money held for visits not yet used (Money).
 */

/** One line describing what a plan gives, in the studio's money. */
function planTerms(plan: Pick<Offer, 'kind' | 'visits' | 'discountPercent' | 'validMonths'>) {
  if (plan.kind === 'package')
    return `${plan.visits} ${plan.visits === 1 ? 'visit' : 'visits'} within ${plan.validMonths} ${plan.validMonths === 1 ? 'month' : 'months'}`
  return [
    plan.visits ? `${plan.visits} ${plan.visits === 1 ? 'visit' : 'visits'} a month` : '',
    plan.discountPercent ? `${plan.discountPercent}% off other visits` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

const blankOffer: OfferInput = {
  kind: 'package',
  name: '',
  serviceIds: [],
  visits: 5,
  priceMinor: 0,
  discountPercent: 0,
  validMonths: 6,
  archived: false,
}

export function PlanSettings() {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const [editing, setEditing] = useState<{ id?: string; input: OfferInput } | null>(null)
  const [price, setPrice] = useState('')
  const { run, pending, error, setError } = useRun()
  const allowed = !blocked && can(role, 'catalogue')
  const list = offers(state)
  const sold = (offerId: string) =>
    holdings(state).filter((h) => h.offerId === offerId && h.status === 'active').length
  function open(offer?: Offer) {
    const input = offer
      ? {
          kind: offer.kind,
          name: offer.name,
          serviceIds: offer.serviceIds,
          visits: offer.visits,
          priceMinor: offer.priceMinor,
          discountPercent: offer.discountPercent,
          validMonths: offer.validMonths,
          archived: offer.archived,
        }
      : {
          ...blankOffer,
          serviceIds: state.services
            .filter((s) => !s.archived)
            .slice(0, 1)
            .map((s) => s.id),
        }
    setEditing({ id: offer?.id, input })
    setPrice(offer ? minorInput(offer.priceMinor) : '')
    setError('')
  }
  function change(patch: Partial<OfferInput>) {
    setEditing((current) => current && { ...current, input: { ...current.input, ...patch } })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const priceMinor = parseMinor(price)
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      setError('Enter a price above zero, with up to two decimal places.')
      return
    }
    const input = {
      ...editing.input,
      name: editing.input.name.trim(),
      priceMinor,
      ...(editing.input.kind === 'package' ? { discountPercent: 0 } : { validMonths: 1 }),
    }
    if (await run({ type: 'offer', ...(editing.id ? { id: editing.id } : {}), input }))
      setEditing(null)
  }
  const input = editing?.input
  return (
    <section className="surface ops-panel" aria-labelledby="plans-heading">
      <header>
        <div>
          <h2 id="plans-heading">Packages &amp; memberships</h2>
          <p>
            A package is a set of visits bought at one price. A membership is paid each month and
            can include visits, a discount, or both. Changes apply to future sales only: clients
            keep the terms they bought.
          </p>
        </div>
        <Layers size={21} aria-hidden="true" />
      </header>
      {list.length ? (
        <div className="ops-ledger">
          {list.map((offer) => (
            <div className="ops-record" key={offer.id}>
              {offer.kind === 'package' ? (
                <Layers size={21} aria-hidden="true" />
              ) : (
                <Repeat size={21} aria-hidden="true" />
              )}
              <div className="ops-record-copy">
                <strong>{offer.name}</strong>
                <small>
                  {offer.kind === 'package' ? 'Package' : 'Membership'} · {planTerms(offer)}
                </small>
                <small>
                  {offer.serviceIds
                    .map((id) => state.services.find((s) => s.id === id)?.name)
                    .filter(Boolean)
                    .join(', ')}
                  {` · ${sold(offer.id)} active`}
                </small>
              </div>
              {offer.archived && <span className="ops-tag">Not on sale</span>}
              <span className="ops-record-money">
                {money(offer.priceMinor, org, true)}
                {offer.kind === 'membership' ? ' a month' : ''}
              </span>
              {allowed && (
                <Button
                  variant="quiet"
                  aria-label={`Edit ${offer.name}`}
                  onClick={() => open(offer)}
                >
                  Edit
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="ops-help">
          Nothing on offer yet. A course of facials or a monthly membership keeps good clients
          coming back.
        </p>
      )}
      {allowed && (
        <div className="ops-actions">
          <Button onClick={() => open()}>
            <Plus size={16} aria-hidden="true" /> Add a package or membership
          </Button>
        </div>
      )}
      {editing && input && (
        <Modal
          open
          onClose={() => {
            if (!pending) setEditing(null)
          }}
          title={editing.id ? `Edit ${input.name || 'plan'}` : 'Add a package or membership'}
          description="Prices include any tax. Clients who already hold it keep what they bought."
        >
          <form onSubmit={save} className="plan-form">
            {!editing.id && (
              <SegmentedControl
                label="Kind of plan"
                appearance="pill"
                value={input.kind}
                onChange={(kind) =>
                  change(
                    kind === 'package'
                      ? { kind, visits: Math.max(1, input.visits), discountPercent: 0 }
                      : { kind, visits: 1, discountPercent: 10 },
                  )
                }
                options={[
                  { value: 'package', label: 'Package' },
                  { value: 'membership', label: 'Membership' },
                ]}
              />
            )}
            <div className="ops-fields">
              <label className="ops-wide">
                Name
                <input
                  value={input.name}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder={input.kind === 'package' ? 'Five facials' : 'Facial club'}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label>
                {input.kind === 'package' ? 'Price' : 'Price a month'} ({org.currency})
                <input
                  inputMode="decimal"
                  value={price}
                  required
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label>
                {input.kind === 'package' ? 'Visits' : 'Visits included each month'}
                <input
                  type="number"
                  min={input.kind === 'package' ? 1 : 0}
                  max={100}
                  value={input.visits}
                  onChange={(e) => change({ visits: Number(e.target.value) })}
                />
              </label>
              {input.kind === 'package' ? (
                <label>
                  Use within (months)
                  <input
                    type="number"
                    min={1}
                    max={36}
                    value={input.validMonths}
                    onChange={(e) => change({ validMonths: Number(e.target.value) })}
                  />
                </label>
              ) : (
                <label>
                  Discount on other visits (%)
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={input.discountPercent}
                    onChange={(e) => change({ discountPercent: Number(e.target.value) })}
                  />
                  <small>Offered at checkout; the desk applies it.</small>
                </label>
              )}
              <fieldset className="ops-checks ops-wide">
                <legend>Treatments it covers</legend>
                {state.services
                  .filter((s) => !s.archived || input.serviceIds.includes(s.id))
                  .map((service) => (
                    <label key={service.id}>
                      <Checkbox
                        checked={input.serviceIds.includes(service.id)}
                        onChange={(e) =>
                          change({
                            serviceIds: e.target.checked
                              ? [...input.serviceIds, service.id]
                              : input.serviceIds.filter((id) => id !== service.id),
                          })
                        }
                      />
                      {service.name} · {money(service.priceMinor, org, true)}
                    </label>
                  ))}
              </fieldset>
              {editing.id && (
                <label className="ops-check ops-wide">
                  <Checkbox
                    checked={input.archived}
                    onChange={(e) => change({ archived: e.target.checked })}
                  />
                  Take off sale (clients who hold it keep it)
                </label>
              )}
            </div>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending || !input.serviceIds.length}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

/** How money changed hands, with the honest confirmation a local studio needs. */
export function PaymentFields({
  method,
  setMethod,
  reference,
  setReference,
  collected,
  setCollected,
  verb = 'received',
}: {
  method: Method
  setMethod: (m: Method) => void
  reference: string
  setReference: (r: string) => void
  collected: boolean
  setCollected: (c: boolean) => void
  verb?: 'received' | 'returned'
}) {
  const { state } = useStore()
  const sandbox = operations(state).mode === 'sandbox'
  return (
    <>
      <label className="ops-field">
        {verb === 'received' ? 'Paid by' : 'Returned by'}
        <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
          {sandbox ? (
            <>
              <option value="demo_card">Demo card</option>
              <option value="demo_cash">Demo cash</option>
            </>
          ) : (
            <>
              <option value="cash">Cash</option>
              <option value="external_card">Card at your own terminal</option>
            </>
          )}
        </Select>
      </label>
      {!sandbox && (
        <>
          <label className="ops-field">
            Reference{' '}
            {method === 'external_card' || verb === 'returned' ? '(required)' : '(optional)'}
            <input
              value={reference}
              maxLength={150}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="ops-check">
            <Checkbox checked={collected} onChange={(e) => setCollected(e.target.checked)} />I
            confirm this money has already been {verb} outside SALEANE.
          </label>
        </>
      )}
    </>
  )
}

/** One line on where a plan stands today. */
function holdingSummary(holding: Holding, today: string, locale: string) {
  const standing = planStanding(holding, today)
  if (standing.state === 'cancelled')
    return `Ended ${dateLabel(holding.cancelled!.at.slice(0, 10), locale)}: ${holding.cancelled!.reason}`
  if (holding.kind === 'package')
    return standing.state === 'expired'
      ? `Expired ${dateLabel(holding.endsOn!, locale)} with ${standing.visitsLeft} ${standing.visitsLeft === 1 ? 'visit' : 'visits'} unused`
      : `${standing.visitsLeft} of ${holding.visits} visits left · use by ${dateLabel(holding.endsOn!, locale)}`
  const parts = [
    standing.state === 'unpaid'
      ? `This month is not paid yet (paid until ${dateLabel(holding.paidUntil!, locale)})`
      : `Paid until ${dateLabel(holding.paidUntil!, locale)}`,
    holding.visits && standing.state !== 'unpaid'
      ? `${standing.visitsLeft} of ${holding.visits} ${holding.visits === 1 ? 'visit' : 'visits'} left this month`
      : '',
    holding.discountPercent ? `${holding.discountPercent}% off other visits` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

const STATE_LABEL = {
  active: 'Active',
  used: 'All used',
  expired: 'Expired',
  unpaid: 'Payment due',
  cancelled: 'Ended',
} as const

export function ClientPlans({ clientId }: { clientId: string }) {
  const { state, role, blocked, branch } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const client = state.clients.find((c) => c.id === clientId)
  const list = clientHoldings(state, clientId).sort(
    (a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'),
  )
  const onSale = offers(state).filter((o) => !o.archived)
  const [dialog, setDialog] = useState<
    | { kind: 'sell' }
    | { kind: 'renew'; holding: Holding }
    | { kind: 'end'; holding: Holding }
    | { kind: 'card'; holding: Holding }
    | null
  >(null)
  const [offerId, setOfferId] = useState('')
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState('0')
  const [soldAt, setSoldAt] = useState('')
  // Stage 1: a membership sold here may then be set to be paid from a saved card.
  const [byCard, setByCard] = useState(false)
  const pay = usePayment()
  const { run, record, pending, error, setError } = useRun()
  const cards = usePlanCards(clientId)
  const ending = useCardEnd(dialog?.kind === 'end' ? dialog.holding.id : '', () => setDialog(null))
  const may = (action: string) => !blocked && can(role, action)
  if (!client || role === 'practitioner' || (!list.length && !(onSale.length && may('plan-sell'))))
    return null
  function start(next: NonNullable<typeof dialog>) {
    setDialog(next)
    setOfferId(onSale[0]?.id ?? '')
    setSoldAt(org.locationId)
    setReason('')
    setRefund('0')
    setByCard(false)
    pay.reset()
    setError('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return
    if (dialog.kind === 'end') {
      const refundMinor = parseMinor(refund, 0)
      if (!Number.isFinite(refundMinor) || refundMinor < 0) {
        setError('Enter the amount returned, zero or more, with up to two decimal places.')
        return
      }
      // Stage 1: a month the card paid through SALEANE goes back to that card.
      if (refundMinor > 0 && toCard) {
        await ending.end(reason.trim(), refundMinor)
        return
      }
      if (refundMinor > 0 && !pay.ready) {
        setError('Confirm the money has already been returned.')
        return
      }
      const done = await run({
        type: 'plan-cancel',
        holdingId: dialog.holding.id,
        reason: reason.trim(),
        ...(refundMinor > 0 ? { refundMinor, ...pay.payment } : {}),
      })
      if (done) setDialog(null)
      return
    }
    if (!pay.ready) {
      setError('Confirm the payment has already been received.')
      return
    }
    if (dialog.kind === 'card') return
    const done = await record(
      dialog.kind === 'sell'
        ? {
            type: 'plan-sell',
            offerId,
            clientId,
            ...pay.payment,
            ...(asksSoldAt(state, role) ? { locationId: soldAt } : {}),
          }
        : { type: 'plan-renew', holdingId: dialog.holding.id, ...pay.payment },
    )
    if (!done) return
    // The client then hears the exact words and agrees before any card is set.
    const sold =
      dialog.kind === 'sell' && byCard && holdings(done.state).find((h) => h.id === done.recordId)
    setDialog(sold && sold.kind === 'membership' ? { kind: 'card', holding: sold } : null)
  }
  const chosen = onSale.find((o) => o.id === offerId)
  const unused = dialog?.kind === 'end' ? planStanding(dialog.holding, today).unusedMinor : 0
  const sandbox = operations(state).mode === 'sandbox'
  const target =
    dialog?.kind === 'end' && cards.reply?.available
      ? cardRefundTarget(dialog.holding, today)
      : undefined
  const toCard = !!target && parseMinor(refund, 0) > 0
  const cardCap = target ? Math.min(unused, target.amountMinor) : 0
  const paidFrom = dialog?.kind === 'end' ? dialog.holding.cardAgreements?.at(-1) : undefined
  // Offered when selling a membership, to whoever may set card payments up where it is sold.
  const offerCard =
    chosen?.kind === 'membership' &&
    !!cards.reply?.available &&
    may('plan-card') &&
    (role !== 'general' || (asksSoldAt(state, role) ? soldAt : org.locationId) === branch)
  return (
    <section className="surface client-cards client-plans" aria-labelledby="client-plans-heading">
      <h3 id="client-plans-heading">
        <Layers size={18} aria-hidden="true" /> Packages &amp; memberships
      </h3>
      {list.map((holding) => {
        const standing = planStanding(holding, today)
        return (
          <div className="ops-record" key={holding.id}>
            <div className="ops-record-copy">
              <strong>{holding.name}</strong>
              <small>{holdingSummary(holding, today, org.locale)}</small>
              <span className={`ops-tag ${standing.state === 'active' ? 'is-active' : ''}`}>
                {STATE_LABEL[standing.state]}
              </span>
              {cards.reply && (
                <MembershipCardLine
                  holding={holding}
                  reply={cards.reply}
                  onChanged={cards.load}
                  onSetUp={() => start({ kind: 'card', holding })}
                />
              )}
            </div>
            {holding.status === 'active' && (
              <div className="ops-record-controls plan-controls">
                {holding.kind === 'membership' && may('plan-renew') && (
                  <Button
                    variant="secondary"
                    aria-label={`Take this month’s payment for ${holding.name}`}
                    onClick={() => start({ kind: 'renew', holding })}
                  >
                    Take payment
                  </Button>
                )}
                {may('plan-cancel') && (
                  <Button
                    variant="quiet"
                    aria-label={`End ${holding.name}`}
                    onClick={() => start({ kind: 'end', holding })}
                  >
                    End
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {onSale.length > 0 && may('plan-sell') && (
        <Button variant="secondary" onClick={() => start({ kind: 'sell' })}>
          <Plus size={16} aria-hidden="true" /> Sell a package or membership
        </Button>
      )}
      {dialog?.kind === 'card' && cards.reply && (
        <CardSetUp
          holding={dialog.holding}
          reply={cards.reply}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            cards.load()
          }}
        />
      )}
      {dialog && dialog.kind !== 'card' && (
        <Modal
          open
          onClose={() => {
            if (!pending) setDialog(null)
          }}
          title={
            dialog.kind === 'sell'
              ? `Sell to ${client.name}`
              : dialog.kind === 'renew'
                ? `Take this month’s payment`
                : `End ${dialog.holding.name}`
          }
          description={
            dialog.kind === 'sell'
              ? 'The first payment is recorded now. A membership is then paid each month.'
              : dialog.kind === 'renew'
                ? `${dialog.holding.name} · ${money(dialog.holding.priceMinor, org, true)} for the next month`
                : target
                  ? `Nothing is deleted. Up to ${money(cardCap, org, true)} of the month paid by card is not yet used.`
                  : `Nothing is deleted. Up to ${money(unused, org, true)} is paid and not yet used.`
          }
        >
          <form onSubmit={submit} className="plan-form">
            {dialog.kind === 'sell' && (
              <label className="ops-field">
                Plan
                <Select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                  {onSale.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name} · {money(offer.priceMinor, org, true)}
                      {offer.kind === 'membership' ? ' a month' : ''}
                    </option>
                  ))}
                </Select>
                {chosen && <small>{planTerms(chosen)}</small>}
              </label>
            )}
            {dialog.kind === 'sell' && <SoldAt value={soldAt} onChange={setSoldAt} />}
            {dialog.kind === 'sell' && offerCard && (
              <label className="ops-check plan-card-agree">
                <Checkbox checked={byCard} onChange={(e) => setByCard(e.target.checked)} />
                Take it from their saved card each month
              </label>
            )}
            {dialog.kind === 'sell' && offerCard && byCard && (
              <p className="subtle">
                {cards.reply?.cards.length
                  ? 'Next, read the client the exact words of the agreement and confirm they agree. The first payment, taken now, is recorded here as usual.'
                  : `${client.name} has no saved card yet. They can save one from the link to their visit, once the studio offers it in Settings, Payments. You can set this up afterwards.`}
              </p>
            )}
            {dialog.kind === 'renew' && openCardAgreement(dialog.holding) && (
              <p className="subtle">
                This membership is paid from a saved card. A month paid here is not taken from the
                card.
              </p>
            )}
            {dialog.kind === 'end' && (
              <>
                <label className="ops-field">
                  Why it is ending
                  <input
                    value={reason}
                    required
                    minLength={2}
                    maxLength={300}
                    placeholder="For example: moving away"
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
              </>
            )}
            {toCard ? (
              <p className="subtle">
                This month was paid from the{' '}
                {paidFrom ? `${paidFrom.brand} card ending ${paidFrom.last4}` : 'saved card'}{' '}
                through SALEANE, so the money goes back to that card through the payment provider,
                up to {money(cardCap, org, true)}. The membership ends once the provider confirms
                it.
                {cards.reply?.provider.live ? '' : ' Test mode: no money moves.'}
              </p>
            ) : (
              (dialog.kind !== 'end' || parseMinor(refund, 0) > 0) && (
                <PaymentFields
                  {...pay.fields}
                  verb={dialog.kind === 'end' ? 'returned' : 'received'}
                />
              )
            )}
            {!toCard && (
              <p className="subtle demo-note">
                {sandbox
                  ? 'Sample studio: no real money moves.'
                  : 'SALEANE records this; it does not take or return the money itself.'}
              </p>
            )}
            {dialog.kind === 'end' && ending.charge && (
              <div className="card-attempt" role="status">
                <strong>
                  {ending.charge.status === 'succeeded'
                    ? 'Returned to the card'
                    : ending.charge.status === 'unknown'
                      ? 'Unclear, check the provider before trying again'
                      : ending.charge.status === 'failed'
                        ? 'Not returned'
                        : ending.charge.status === 'review'
                          ? 'Returned, needs review'
                          : 'Waiting for the payment provider'}{' '}
                  · {money(ending.charge.amountMinor, org, true)}
                </strong>
                {ending.charge.detail && <p>{ending.charge.detail}</p>}
                {ending.charge.status === 'unknown' && (
                  <Button
                    variant="secondary"
                    disabled={ending.busy}
                    onClick={() => void ending.check()}
                  >
                    Check again
                  </Button>
                )}
              </div>
            )}
            <ErrorMessage error={error || (dialog.kind === 'end' ? ending.error : '')} />
            <div className="ops-actions">
              <Button
                type="submit"
                disabled={pending || ending.busy || (dialog.kind === 'sell' && !chosen)}
              >
                {pending || ending.busy
                  ? 'Saving…'
                  : dialog.kind === 'sell'
                    ? `Record ${chosen ? money(chosen.priceMinor, org, true) : 'sale'}`
                    : dialog.kind === 'renew'
                      ? `Record ${money(dialog.holding.priceMinor, org, true)}`
                      : toCard
                        ? 'Refund to the card and end'
                        : 'End plan'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setDialog(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

/** Money: what clients have paid for plans and not yet used. */
export function PlansLedger() {
  const { state } = useStore()
  const org = state.organisation
  const today = businessDate(state)
  const rows = holdings(state).map((holding) => ({
    holding,
    standing: planStanding(holding, today),
    client: state.clients.find((c) => c.id === holding.clientId)?.name ?? 'Client',
  }))
  const owed = rows
    .filter((r) => r.holding.kind === 'package' && r.standing.state === 'active')
    .reduce((sum, r) => sum + r.standing.unusedMinor, 0)
  const taken = rows.reduce((sum, r) => sum + r.standing.paidMinor - r.standing.refundedMinor, 0)
  return (
    <div className="plans-ledger">
      <MembershipCardPayments />
      <dl className="plans-totals">
        <div>
          <dt>Taken for plans</dt>
          <dd>{money(taken, org, true)}</dd>
        </div>
        <div>
          <dt>Package visits paid for, not yet used</dt>
          <dd>{money(owed, org, true)}</dd>
        </div>
      </dl>
      <p className="ops-help">
        A covered visit counts its share of the plan as that day’s takings. The rest stays here
        until it is used, returned or the package expires.
      </p>
      <div className="ops-ledger">
        {rows.map(({ holding, standing, client }) => (
          <div className="ops-record" key={holding.id}>
            <div className="ops-record-copy">
              <strong>
                {client} · {holding.name}
              </strong>
              <small>{holdingSummary(holding, today, org.locale)}</small>
              <small>
                Paid {money(standing.paidMinor, org, true)} · used{' '}
                {money(standing.usedMinor, org, true)}
                {standing.refundedMinor
                  ? ` · returned ${money(standing.refundedMinor, org, true)}`
                  : ''}
              </small>
            </div>
            <span className="ops-record-money">
              {holding.kind === 'package' && standing.state === 'active'
                ? money(standing.unusedMinor, org, true)
                : STATE_LABEL[standing.state]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

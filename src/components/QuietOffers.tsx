import { useState } from 'react'
import type { FormEvent } from 'react'
import { BadgePercent } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import { money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { feedbackSince } from '../domain/feedback'
import {
  OFFER_NAME,
  offerEnds,
  offerPriceFor,
  offersTaken,
  quietOfferSettings,
} from '../domain/quietOffers'
import {
  OFFER_HOURS,
  OFFER_PERCENT_MAX,
  OFFER_PERCENT_MIN,
  offerDiscounts,
} from '../domain/quietOffersSchema'
import type { MessageOffer, OfferDiscount, QuietOfferSettings } from '../domain/quietOffersSchema'
import { Button, ErrorMessage, Select } from '../design'
import { useRun } from './usePayment'
import './quietOffers.css'

/**
 * Stage 5: the owner's lower price for quiet times, in Settings › Messages beside the messages to
 * guests. Anyone may read it; only the owner changes it, since it is money. Changing it never
 * changes an invitation already written: each keeps the price it was written with.
 */

const discountWords: Record<OfferDiscount, { label: string; detail: string }> = {
  none: { label: 'No lower price', detail: 'Invitations offer the usual price.' },
  percent: { label: 'A percentage off', detail: 'Such as 20% off the usual price.' },
  amount: { label: 'An amount off', detail: 'The same amount off any treatment.' },
}
const hourWords: Record<(typeof OFFER_HOURS)[number], string> = {
  12: '12 hours',
  24: 'A day',
  48: 'Two days',
  72: 'Three days',
}

/** The settings the form describes, or the reason it cannot be saved yet. */
function readForm(
  current: QuietOfferSettings,
  form: {
    discount: OfferDiscount
    percent: string
    amount: string
    floor: string
    openHours: QuietOfferSettings['openHours']
    leftOutIds: string[]
  },
): QuietOfferSettings | string {
  const percent = Number(form.percent)
  const amount = parseMinor(form.amount)
  const floor = parseMinor(form.floor, 0)
  if (
    form.discount === 'percent' &&
    (!Number.isInteger(percent) || percent < OFFER_PERCENT_MIN || percent > OFFER_PERCENT_MAX)
  )
    return `Enter a whole percentage from ${OFFER_PERCENT_MIN} to ${OFFER_PERCENT_MAX}.`
  if (form.discount === 'amount' && !(amount > 0)) return 'Enter an amount off above zero.'
  if (form.discount !== 'none' && Number.isNaN(floor))
    return 'Enter the lowest price as an amount, such as 40 or 40.00, or leave it empty.'
  return {
    discount: form.discount,
    // While there is no lower price, the other choices keep what they were.
    offPercent: form.discount === 'percent' ? percent : current.offPercent,
    offMinor: form.discount === 'amount' ? amount : current.offMinor,
    floorMinor: form.discount === 'none' ? current.floorMinor : floor,
    openHours: form.openHours,
    leftOutIds: form.leftOutIds,
  }
}

export function QuietOffers() {
  const { state, role, blocked } = useStore()
  const current = quietOfferSettings(state)
  const org = state.organisation
  const [discount, setDiscount] = useState<OfferDiscount>(current.discount)
  const [percent, setPercent] = useState(String(current.offPercent))
  const [amount, setAmount] = useState(minorInput(current.offMinor))
  const [floor, setFloor] = useState(current.floorMinor ? minorInput(current.floorMinor) : '')
  const [openHours, setOpenHours] = useState(current.openHours)
  const [leftOutIds, setLeftOutIds] = useState(current.leftOutIds)
  const [saved, setSaved] = useState('')
  const { run, pending, error, setError } = useRun()
  const allowed = !blocked && can(role, 'quiet-offers')
  const services = state.services.filter((service) => !service.archived)
  const form = { discount, percent, amount, floor, openHours, leftOutIds }
  const read = readForm(current, form)
  const changed = typeof read === 'string' || JSON.stringify(read) !== JSON.stringify(current)
  const tax = operations(state).tax
  const beforeTax = !!tax && tax.rateBps > 0 && !tax.inclusive
  const taken = offersTaken(state, feedbackSince(state, 30))
  // An example from the first treatment not left out, so the owner sees what a guest would pay.
  const example =
    typeof read === 'string' || read.discount === 'none'
      ? null
      : services
          .filter((service) => !read.leftOutIds.includes(service.id))
          .map((service) => ({ service, price: offerPriceFor(read, service.priceMinor) }))[0]
  const touch = () => {
    setSaved('')
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved('')
    if (typeof read === 'string') return setError(read)
    if (await run({ type: 'quiet-offers', settings: read }))
      setSaved(
        read.discount === 'none'
          ? 'Saved. New invitations offer the usual price. Any already written keep theirs.'
          : 'Saved. Invitations written from now on carry this lower price. Any already written keep theirs.',
      )
  }

  return (
    <section className="surface ops-panel settings-panel" aria-labelledby="quiet-offers-heading">
      <header>
        <div>
          <h2 id="quiet-offers-heading">A lower price for quiet times</h2>
          <p>
            Invitations to an open time on Today, or to a time a cancellation freed, can carry a
            lower price for that time only. The guest books it through the private link in their
            email, once.
          </p>
        </div>
        <BadgePercent size={21} aria-hidden="true" />
      </header>
      <form className="settings-body quiet-offers" onSubmit={(e) => void save(e)}>
        {!allowed && (
          <p className="subtle">Only the owner sets a lower price. You can read it here.</p>
        )}
        <fieldset className="message-settings" disabled={!allowed || pending}>
          <legend>Invitations to a quiet time carry</legend>
          <div role="radiogroup" aria-label="Lower price" className="quiet-offer-kinds">
            {offerDiscounts.map((kind) => (
              <label key={kind} className="checkbox-label">
                <input
                  type="radio"
                  name="quiet-offer-kind"
                  value={kind}
                  checked={discount === kind}
                  onChange={() => {
                    setDiscount(kind)
                    touch()
                  }}
                />
                <span>
                  {discountWords[kind].label}
                  <small className="subtle">{discountWords[kind].detail}</small>
                </span>
              </label>
            ))}
          </div>
          {discount === 'percent' && (
            <label>
              Percentage off
              <input
                type="number"
                inputMode="numeric"
                min={OFFER_PERCENT_MIN}
                max={OFFER_PERCENT_MAX}
                step={1}
                value={percent}
                onChange={(e) => {
                  setPercent(e.target.value)
                  touch()
                }}
              />
            </label>
          )}
          {discount === 'amount' && (
            <label>
              Amount off ({org.currency})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  touch()
                }}
              />
            </label>
          )}
          {discount !== 'none' && (
            <>
              <label>
                Never below ({org.currency})
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={floor}
                  onChange={(e) => {
                    setFloor(e.target.value)
                    touch()
                  }}
                />
                <small className="subtle">
                  No lower price goes under this. Leave it empty for no limit other than free.
                </small>
              </label>
              <label>
                Each lower price stays open for
                <Select
                  value={openHours}
                  onChange={(e) => {
                    setOpenHours(Number(e.target.value) as QuietOfferSettings['openHours'])
                    touch()
                  }}
                >
                  {OFFER_HOURS.map((hours) => (
                    <option key={hours} value={hours}>
                      {hourWords[hours]}, or until the time starts
                    </option>
                  ))}
                </Select>
              </label>
              {services.length > 0 && (
                <details className="quiet-offer-left-out">
                  <summary>
                    <span>
                      <span>
                        Treatments left out
                        {leftOutIds.length ? ` (${leftOutIds.length})` : ''}
                      </span>
                      <small>Ticked treatments always keep their usual price.</small>
                    </span>
                  </summary>
                  <div className="quiet-offer-services">
                    {services.map((service) => (
                      <label key={service.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={leftOutIds.includes(service.id)}
                          onChange={(e) => {
                            setLeftOutIds((ids) =>
                              e.target.checked
                                ? [...ids, service.id]
                                : ids.filter((id) => id !== service.id),
                            )
                            touch()
                          }}
                        />
                        {service.name}
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </fieldset>
        {example && (
          <p className="quiet-offer-example">
            {example.price === null
              ? `With these choices, ${example.service.name} would keep its usual price of ${money(example.service.priceMinor, org)}.`
              : `For example, ${example.service.name} at ${money(example.service.priceMinor, org)} would be offered at ${money(example.price, org)}.`}
          </p>
        )}
        <p className="subtle">
          Each invitation keeps the price it was written with, so a change here never changes one
          already written. Nothing is sent until someone approves it in the Inbox. A deposit is
          worked out from the lower price, and never more than it.
          {beforeTax ? ' Prices here are before the tax you add on top.' : ''}
        </p>
        {taken.taken > 0 && (
          <p className="quiet-offer-taken">
            In the last 30 days,{' '}
            {taken.taken === 1 ? 'one visit was' : `${taken.taken} visits were`} booked at a
            quiet-time price, {money(taken.givenMinor, org)} below the usual prices.
          </p>
        )}
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {allowed && (
          <div className="ops-actions">
            <Button type="submit" disabled={pending || !changed}>
              {pending ? 'Saving…' : 'Save lower price'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

/**
 * The lower price an invitation carries, beside its words in the Inbox and wherever it is written:
 * "Quiet-time price: £76 instead of the usual £95, open until Saturday 10 October at 18:00."
 */
export function OfferNote({
  offer,
  writtenAt,
  booked = false,
}: {
  offer: MessageOffer
  writtenAt: string
  booked?: boolean
}) {
  const { state } = useStore()
  const org = state.organisation
  const tax = operations(state).tax
  const beforeTax = !!tax && tax.rateBps > 0 && !tax.inclusive
  return (
    <p className="offer-note">
      <BadgePercent size={16} aria-hidden="true" />
      <span>
        <strong>{OFFER_NAME}:</strong> {money(offer.priceMinor, org)} instead of the usual{' '}
        {money(offer.usualPriceMinor, org)}
        {beforeTax ? ' before tax' : ''}, open until {offerEnds(state, offer, writtenAt)}.
        {booked ? ' A guest has booked it.' : ''}
      </span>
    </p>
  )
}

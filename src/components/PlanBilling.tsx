import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, FlaskConical } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { api } from '../state/api'
import { money } from '../domain/format'
import { operations } from '../domain/operations'
import {
  LOCATION_ADD_ONS,
  PEOPLE_PER_LOCATION,
  PRICE,
  extraPeople,
  priceLabel,
} from '../domain/pricing'
import { ADD_ON_NAMES, addOnBill, planDate, trialDaysLeft } from '../domain/billing'
import type { AddOn, Bill, BillingView, InvoiceView } from '../domain/billing'
import { Button, ErrorMessage, Modal } from '../design'
import './planBilling.css'

/** Each add-on's name inside a sentence, and at the start of one. */
const IN_WORDS: Record<AddOn, string> = { plus: 'Plus', phone: 'the phone receptionist' }
const FIRST_WORDS: Record<AddOn, string> = { plus: 'Plus', phone: 'The phone receptionist' }
const STATUS_WORDS: Record<BillingView['status'], string> = {
  trial: 'Free trial',
  active: 'Paid',
  overdue: 'Payment due',
  stopped: 'Read only',
}
const BILL_WORDS: Record<InvoiceView['status'], string> = {
  paid: 'Paid',
  open: 'Owed',
  charging: 'Being checked',
  unknown: 'Being checked',
  void: 'Not charged',
}
/** What a payment that did not go through says, in place of the words for success. */
const NOT_PAID: Record<string, string> = {
  open: 'The payment did not go through. Nothing was taken. Try again or use another card.',
  void: 'The card was declined, so nothing was taken. Try again or use another card.',
  charging:
    'The card service has not said yet whether the payment went through. Nothing more is taken until it does; look here again in a few minutes.',
  unknown:
    'The card service has not said yet whether the payment went through. Nothing more is taken until it does; look here again in a few minutes.',
}
/** What the card page sent the owner back to say. */
const RETURNS: Record<string, string> = {
  saved: 'Your card is saved.',
  'saved-yes': 'Your card is saved and the bill is paid. Everything works again.',
  'saved-no':
    'Your card is saved, but the payment did not go through. Nothing was taken. Try another card.',
  left: 'You left the card page. Nothing has changed.',
}

/** NEXT-02: the studio's SALEANE plan, for the owner: trial, card, Plus, bills and stopping. */
export function PlanBilling() {
  const { state, mode, reload } = useStore()
  const org = state.organisation
  const base = `/api/workspaces/${encodeURIComponent(org.id)}/billing`
  const real = mode === 'server' && operations(state).mode === 'local'
  const [plan, setPlan] = useState<BillingView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  // Back from the card page: say what happened once.
  const [said, setSaid] = useState(() => {
    const card = params.get('card')
    const paid = params.get('paid')
    return card ? (RETURNS[paid ? `${card}-${paid}` : card] ?? '') : ''
  })
  const [asking, setAsking] = useState<AddOn | 'stop' | null>(null)
  // Bills older than the newest page, once the owner asks for them.
  const [older, setOlder] = useState<{ invoices: InvoiceView[]; next: string | null } | null>(null)
  const now = Date.parse(useClock())
  const cash = (minor: number) => money(minor, org, true)
  const day = (at: number) => planDate(org, at)

  useEffect(() => {
    if (!real) return
    let active = true
    api<BillingView>(base)
      .then((view) => {
        if (active) setPlan(view)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The plan could not be read.')
      })
    return () => {
      active = false
    }
  }, [real, base])
  // Then tidy the address, and read the studio again in case it is no longer read only.
  useEffect(() => {
    if (!params.get('card')) return
    setParams({ section: 'billing' }, { replace: true })
    void reload()
  }, [params, setParams, reload])
  async function load() {
    try {
      setPlan(await api<BillingView>(base))
      setOlder(null)
    } catch {
      // The error from the action that failed is the one to show.
    }
  }

  async function act(path: string, body: object, done: string) {
    setBusy(true)
    setError('')
    setSaid('')
    try {
      const result = await api<{ outcome: string; billing: BillingView }>(`${base}/${path}`, {
        method: 'POST',
        body,
      })
      setPlan(result.billing)
      setOlder(null)
      // Only a payment that went through, or a change that needed none, is spoken of as done.
      setSaid(
        result.outcome === 'paid' || result.outcome === 'saved'
          ? done
          : (NOT_PAID[result.outcome] ?? NOT_PAID.unknown),
      )
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be done. Try again.')
      await load()
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }
  async function showOlder(before: string) {
    setBusy(true)
    setError('')
    try {
      const page = await api<{ invoices: InvoiceView[]; next: string | null }>(
        `${base}/bills?before=${encodeURIComponent(before)}`,
      )
      setOlder((was) => ({
        invoices: [...(was?.invoices ?? []), ...page.invoices],
        next: page.next,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The older bills could not be read.')
    } finally {
      setBusy(false)
    }
  }
  async function addCard() {
    setBusy(true)
    setError('')
    try {
      const { url } = await api<{ url: string }>(`${base}/card`, { method: 'POST', body: {} })
      window.location.assign(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The card page could not be opened.')
      setBusy(false)
    }
  }

  const header = (
    <header>
      <div>
        <h2 id="plan-billing-title">Plan and billing</h2>
        <p>
          {priceLabel(org.region)} a month for each location, {PRICE[org.region].tax}, with{' '}
          {PEOPLE_PER_LOCATION} people taking bookings, Ask Saleane and the AI receptionist
          included. Each person beyond that is {priceLabel(org.region, 'personMinor')} a month.
          Month to month: stop whenever you like.
        </p>
      </div>
      {plan && (
        <span className={`ops-tag ${plan.status === 'stopped' ? 'is-blocked' : 'is-active'}`}>
          {plan.locked ? 'Locked' : STATUS_WORDS[plan.status]}
        </span>
      )}
    </header>
  )
  if (!real)
    return (
      <section className="surface ops-panel plan-billing" aria-labelledby="plan-billing-title">
        {header}
        <p className="ops-help">
          {mode === 'server'
            ? 'Sample studios are never charged. A studio of your own starts with 14 days free, with no card needed.'
            : 'The browser demo is never charged. Sign in to a studio of your own to see its plan.'}
        </p>
      </section>
    )
  if (!plan)
    return (
      <section className="surface ops-panel plan-billing" aria-labelledby="plan-billing-title">
        {header}
        {error ? <ErrorMessage error={error} /> : <p className="ops-help">Reading your plan…</p>}
      </section>
    )

  const card = plan.card
  const owed = plan.status === 'overdue' || plan.status === 'stopped'
  const payable = owed && plan.nextBill && !plan.checking && !plan.held
  // What adding each add-on now would take, for the rest of a paid month.
  const partNow = (addOn: AddOn) =>
    plan.status === 'active' && !plan[addOn] && plan.periodStart && plan.periodEnd
      ? addOnBill(addOn, plan.region, plan.locations, now, plan.periodStart, plan.periodEnd)
      : null
  const askingAddOn = asking === 'plus' || asking === 'phone' ? asking : null
  const askingPart = askingAddOn && partNow(askingAddOn)
  const extras = [plan.plus && 'Plus', plan.phone && 'the phone receptionist'].filter(Boolean)
  const where = `${plan.locations} ${plan.locations === 1 ? 'location' : 'locations'}`

  return (
    <section className="surface ops-panel plan-billing" aria-labelledby="plan-billing-title">
      {header}
      {plan.test && (
        <p className="plan-test">
          <FlaskConical size={15} aria-hidden="true" />
          Test mode: no card is charged and no money moves.
        </p>
      )}

      <div className="plan-now">
        <p className="plan-summary">{summary(plan, now, cash, day)}</p>
        {plan.held ? (
          <p className="ops-help">
            Payments are paused because SALEANE was restored from a backup. They start again by
            themselves once the card service has confirmed what it took, so nothing is taken twice.
          </p>
        ) : (
          plan.checking && (
            <p className="ops-help">
              A payment is being checked with the card service. Nothing more is taken until it is.
            </p>
          )
        )}
        {said && (
          <p className="ops-save-note" role="status">
            {said}
          </p>
        )}
        <ErrorMessage error={error} />
        {(payable || !card) && (
          <div className="plan-buttons">
            {payable && card && (
              <Button
                disabled={busy}
                onClick={() =>
                  void act('pay', {}, 'Paid. Everything works again, and the bill is below.')
                }
              >
                {busy ? 'Paying…' : `Pay ${cash(plan.nextBill!.bill.totalMinor)} now`}
              </Button>
            )}
            {!card && (
              <Button disabled={busy} onClick={() => void addCard()}>
                {owed ? 'Add a card and pay' : 'Add a card'}
              </Button>
            )}
          </div>
        )}
      </div>

      {plan.nextBill && (
        <div className="plan-block">
          <h3>
            {plan.status === 'stopped'
              ? 'A month from today'
              : plan.status === 'overdue'
                ? 'The bill that is owed'
                : `Your next bill, on ${day(plan.nextBill.at)}`}
          </h3>
          <BillLines bill={plan.nextBill.bill} cash={cash} />
        </div>
      )}

      <div className="plan-block">
        <h3>People taking bookings</h3>
        <p className="ops-help">{peopleWords(plan, (minor) => money(minor, org))}</p>
        <p className="ops-help">
          Anyone who gives no treatments, such as reception or a manager, is free; a manager who
          also gives treatments counts. Someone added or archived counts from the next bill.
        </p>
      </div>

      <div className="plan-block">
        <h3>Card</h3>
        <div className="ops-record">
          <CreditCard size={20} aria-hidden="true" />
          <div className="ops-record-copy">
            <strong>{card ? `${card.brand} ending ${card.last4}` : 'No card saved yet'}</strong>
            <small>
              {card
                ? `Expires ${String(card.expMonth).padStart(2, '0')}/${card.expYear}. Kept by the card service; SALEANE never sees the number.`
                : 'You type it on the card service’s own page; SALEANE never sees the number.'}
            </small>
          </div>
          {card && (
            <Button variant="secondary" disabled={busy} onClick={() => void addCard()}>
              Use another card
            </Button>
          )}
        </div>
      </div>

      <div className="plan-block">
        <h3>Add-ons</h3>
        {LOCATION_ADD_ONS.map((addOn) => {
          const name = IN_WORDS[addOn.id],
            first = FIRST_WORDS[addOn.id]
          const on = plan[`${addOn.id}Next`]
          const waits = addOn.id === 'phone' && !plan.phoneConnected
          return (
            <div className="ops-record" key={addOn.id}>
              <div className="ops-record-copy">
                <strong>
                  {addOn.title}, {priceLabel(plan.region, addOn.amount)} a month for each location
                </strong>
                <small>{addOn.body}</small>
                <small>
                  {waits && !plan.phone && !on ? `${addOn.note}.` : addOnWords(plan, addOn.id, day)}
                </small>
              </div>
              {on ? (
                <Button
                  variant="secondary"
                  disabled={busy || plan.status === 'stopped'}
                  onClick={() =>
                    void act(
                      addOn.id,
                      { on: false },
                      plan[addOn.id] && plan.periodEnd
                        ? `${first} stays on until ${day(plan.periodEnd)}, then stops.`
                        : `${first} is off.`,
                    )
                  }
                >
                  Turn {name} off
                </Button>
              ) : waits ? (
                <Button variant="secondary" disabled>
                  Not yet
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy || !['trial', 'active'].includes(plan.status)}
                  onClick={() =>
                    partNow(addOn.id)
                      ? setAsking(addOn.id)
                      : void act(
                          addOn.id,
                          { on: true },
                          plan.status === 'trial'
                            ? `${first} starts with your first bill.`
                            : `${first} is on.`,
                        )
                  }
                >
                  Add {name}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      <div className="plan-block">
        <h3>AI this month</h3>
        <p className="ops-help">
          {plan.status === 'stopped'
            ? 'Ask Saleane and the AI receptionist rest while the studio is read only.'
            : `For ${where}${extras.length ? `, with ${extras.join(' and ')}` : ''}. It starts again on the 1st of each month.`}
        </p>
        <ul className="plan-meters">
          <Meter label="Questions typed to Ask Saleane" {...plan.ai.typed} />
          <Meter label="Guest chats with the AI receptionist" {...plan.ai.guestChats} />
          <li>
            <span>Talking to Ask Saleane</span>
            <small>
              {plan.ai.talkSeconds.of / 60} minutes a month, when talking is switched on
            </small>
          </li>
          {plan.ai.phoneSeconds.of > 0 && (
            <Meter
              label="Minutes of calls answered by the AI receptionist"
              used={Math.ceil(plan.ai.phoneSeconds.used / 60)}
              of={Math.floor(plan.ai.phoneSeconds.of / 60)}
            />
          )}
        </ul>
      </div>

      {plan.invoices.length > 0 && (
        <div className="plan-block">
          <h3>Bills</h3>
          <ul className="ops-ledger plan-bills">
            {[...plan.invoices, ...(older?.invoices ?? [])].map((bill) => (
              <li className="ops-record" key={bill.id}>
                <div className="ops-record-copy">
                  <strong>
                    {bill.number}
                    {bill.kind === 'month' ? '' : `, ${ADD_ON_NAMES[bill.kind]}`}
                  </strong>
                  <small>
                    {day(bill.periodStart)} to {day(bill.periodEnd)}
                    {bill.paidAt
                      ? `. ${bill.test ? 'Settled in test mode' : 'Paid'} on ${day(bill.paidAt)}`
                      : ''}
                  </small>
                  {bill.detail && bill.status !== 'paid' && <small>{bill.detail}</small>}
                  <details>
                    <summary>What it covers</summary>
                    <BillLines bill={bill} cash={cash} />
                  </details>
                </div>
                <span className="ops-record-money">{cash(bill.totalMinor)}</span>
                <span
                  className={`ops-tag ${bill.status === 'paid' ? 'is-active' : bill.status === 'open' ? 'is-blocked' : ''}`}
                >
                  {bill.status === 'paid' && bill.test ? 'Test' : BILL_WORDS[bill.status]}
                </span>
              </li>
            ))}
          </ul>
          {(older ? older.next : plan.moreBills) && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void showOlder((older ? older.next : plan.moreBills)!)}
            >
              Show older bills
            </Button>
          )}
        </div>
      )}

      {['trial', 'active'].includes(plan.status) && (
        <div className="ops-actions">
          {plan.cancelAtPeriodEnd ? (
            <Button
              disabled={busy}
              onClick={() => void act('stop', { stop: false }, 'Your plan carries on.')}
            >
              Keep my plan
            </Button>
          ) : (
            <Button variant="quiet" disabled={busy} onClick={() => setAsking('stop')}>
              {plan.status === 'trial'
                ? 'Stop when the trial ends'
                : 'Stop at the end of the month'}
            </Button>
          )}
        </div>
      )}

      <Modal
        open={!!askingAddOn}
        onClose={() => setAsking(null)}
        title={`Add ${askingAddOn ? IN_WORDS[askingAddOn] : ''} now?`}
        description="It is charged for the rest of this month straight away."
      >
        {askingAddOn && askingPart && plan.periodEnd && (
          <>
            <p>
              {cash(askingPart.totalMinor)} is taken now from the {card?.brand} ending {card?.last4}
              , for the rest of this month. From {day(plan.periodEnd)} {IN_WORDS[askingAddOn]} is
              part of your monthly bill.
            </p>
            <div className="ops-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    askingAddOn,
                    { on: true },
                    askingAddOn === 'plus'
                      ? 'Plus is on, with its larger AI allowance.'
                      : 'The phone receptionist is on. Choose it in AI receptionist settings to start answering calls.',
                  )
                }
              >
                {busy
                  ? 'Adding…'
                  : `Add ${IN_WORDS[askingAddOn]} for ${cash(askingPart.totalMinor)}`}
              </Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Not now
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={asking === 'stop'}
        onClose={() => setAsking(null)}
        title={
          plan.status === 'trial' ? 'Stop when the trial ends?' : 'Stop at the end of the month?'
        }
        description="The studio becomes read only then. Nothing is deleted."
      >
        <p>
          On {day(plan.status === 'trial' ? plan.trialEndsAt : (plan.periodEnd ?? now))} the studio
          becomes read only. Nothing is deleted: your team can still see and download everything,
          guests can still book, and you can start again whenever you like.
        </p>
        <div className="ops-actions">
          <Button
            disabled={busy}
            onClick={() =>
              void act(
                'stop',
                { stop: true },
                'Your plan will stop. You can change your mind until then.',
              )
            }
          >
            Stop then
          </Button>
          <Button variant="quiet" onClick={() => setAsking(null)}>
            Keep my plan
          </Button>
        </div>
      </Modal>
    </section>
  )
}

/** The plan in one or two sentences, in the order the owner needs it. */
function summary(
  plan: BillingView,
  now: number,
  cash: (minor: number) => string,
  day: (at: number) => string,
) {
  const next = plan.nextBill?.bill.totalMinor
  const card = plan.card ? `the ${plan.card.brand} ending ${plan.card.last4}` : null
  if (plan.status === 'trial') {
    const left = trialDaysLeft(plan.trialEndsAt, now)
    const until = `Free trial until ${day(plan.trialEndsAt)}, ${left} ${left === 1 ? 'day' : 'days'} left.`
    if (plan.cancelAtPeriodEnd)
      return `${until} The plan stops then, and the studio becomes read only.`
    return card
      ? `${until} Then ${cash(next!)} a month is taken from ${card}.`
      : `${until} Add a card to carry on after that; nothing is taken until the trial ends.`
  }
  if (plan.status === 'active')
    return plan.cancelAtPeriodEnd
      ? `Paid until ${day(plan.periodEnd!)}. The plan stops then, and the studio becomes read only.`
      : `Paid until ${day(plan.periodEnd!)}. The next bill, ${cash(next!)}, is taken that day from ${card ?? 'your card'}.`
  if (plan.status === 'overdue' && plan.overdue)
    return `We could not take ${next === undefined ? 'this month’s payment' : cash(next)}. ${
      plan.overdue.nextAttemptAt
        ? `We will try the card again on ${day(plan.overdue.nextAttemptAt)}.`
        : 'We will not try the card again by ourselves.'
    } Pay, or use another card, by ${day(plan.overdue.graceEndsAt)} to keep everything working.`
  const why =
    plan.stopReason === 'trial_ended'
      ? 'Your free trial has ended'
      : plan.stopReason === 'cancelled'
        ? 'Your plan has stopped'
        : 'The bill was not paid'
  if (plan.locked)
    return `${why}, so the studio is locked. Your team cannot open it and online booking is closed. Nothing has been lost. To open it again, pay ${cash(next ?? 0)} for a month from today.`
  const lock = plan.lockAt
    ? ` On ${day(plan.lockAt)} it locks: only you will be able to open it, and online booking closes.`
    : ''
  return `${why}, so the studio is read only. Nothing has been lost, and guests can still book.${lock} To carry on, pay ${cash(next ?? 0)} for a month from today.`
}

/**
 * Who the studio pays for: the people taking bookings, against what its locations include. `whole`
 * writes an amount as the price page does: "£9", "£18".
 */
function peopleWords(plan: BillingView, whole: (minor: number) => string) {
  const included = PEOPLE_PER_LOCATION * Math.max(1, plan.locations)
  const extra = extraPeople(plan.people, plan.locations)
  const who = `${plan.people} ${plan.people === 1 ? 'person takes' : 'people take'} bookings.`
  const where =
    plan.locations === 1 ? 'Your location includes' : `Your ${plan.locations} locations include`
  if (!extra) return `${who} ${where} ${included}, so there is nothing more to pay.`
  const unit = PRICE[plan.region].personMinor
  const each = `${whole(unit)} a month${extra === 1 ? '' : ' each'}`
  return `${who} ${where} ${included}, so ${extra} more ${extra === 1 ? 'is' : 'are'} ${each}${extra === 1 ? '' : `, ${whole(unit * extra)} in all`}, ${PRICE[plan.region].tax}.`
}

function addOnWords(plan: BillingView, addOn: AddOn, day: (at: number) => string) {
  const has = plan[addOn],
    next = plan[`${addOn}Next`]
  if (plan.status === 'trial')
    return next ? 'Starts with your first bill.' : 'You can add it at any time.'
  if (has && !next && plan.periodEnd) return `On until ${day(plan.periodEnd)}, then off.`
  if (has)
    return addOn === 'plus'
      ? 'On, with its larger AI allowance.'
      : 'On. Choose it in AI receptionist settings to answer calls.'
  return plan.status === 'active'
    ? 'Added now, it is charged for the rest of this month.'
    : 'You can add it once the bill is paid.'
}

function BillLines({ bill, cash }: { bill: Bill; cash: (minor: number) => string }) {
  return (
    <dl className="plan-lines">
      {bill.lines.map((line) => (
        <div key={line.text}>
          <dt>{line.text}</dt>
          <dd>{cash(line.amountMinor)}</dd>
        </div>
      ))}
      <div>
        <dt>{bill.taxLabel ?? 'Sales tax, where it applies, is not worked out yet'}</dt>
        <dd>{bill.taxLabel ? cash(bill.taxMinor) : '–'}</dd>
      </div>
      <div className="plan-total">
        <dt>Total</dt>
        <dd>{cash(bill.totalMinor)}</dd>
      </div>
    </dl>
  )
}

function Meter({ label, used, of }: { label: string; used: number; of: number }) {
  const share = of ? Math.min(1, used / of) : 1
  return (
    <li>
      <span>{label}</span>
      <small>
        {used} of {of} used
      </small>
      <i aria-hidden="true">
        <b style={{ width: `${Math.round(share * 100)}%` }} />
      </i>
    </li>
  )
}

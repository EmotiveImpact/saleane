import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CreditCard, FlaskConical, Nfc, ShieldCheck } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can, operations } from '../domain/operations'
import { minorInput, parseMinor } from '../domain/money'
import { money as formatMoney } from '../domain/format'
import { Button, ErrorMessage } from '../design'

type Attempt = {
  id: string
  appointmentId: string
  clientId: string
  purpose: 'deposit' | 'balance' | 'fee' | 'save_card' | 'refund'
  route: 'hosted' | 'saved_card' | 'reader' | 'refund'
  amountMinor: number
  status: 'started' | 'processing' | 'succeeded' | 'failed' | 'unknown' | 'review'
  detail: string | null
  testMode: boolean
  createdAt: string
}
type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  agreed: string
  createdAt: string
}
type PaymentsReply = {
  provider: { name: string; live: boolean; readers: { id: string; label: string }[] }
  available: boolean
  attempts: Attempt[]
  cards: SavedCard[]
  depositDueMinor?: number
  feeAllowedMinor?: number
}

const purposeLabel: Record<Attempt['purpose'], string> = {
  deposit: 'Deposit',
  balance: 'Checkout',
  fee: 'Missed visit fee',
  save_card: 'Card saved',
  refund: 'Refund to the card',
}
const statusLabel: Record<Attempt['status'], string> = {
  started: 'Waiting for the client',
  processing: 'Waiting for the card',
  succeeded: 'Paid',
  failed: 'Not taken',
  unknown: 'Unclear, check the provider before trying again',
  review: 'Taken, needs review',
}

/** Card payment details for one visit or one client, read from the server. */
function usePayments(query: { appointmentId?: string; clientId?: string }) {
  const { mode, state, session, role } = useStore()
  const [reply, setReply] = useState<PaymentsReply | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const orgId = state.organisation.id
  const available =
    mode === 'server' && !!session && operations(state).mode === 'local' && can(role, 'checkout')
  const search = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => !!entry[1]),
  ).toString()
  useEffect(() => {
    if (!available) return
    let active = true
    api<PaymentsReply>(
      `/api/workspaces/${encodeURIComponent(orgId)}/payments${search ? `?${search}` : ''}`,
    )
      .then((next) => {
        if (!active) return
        setReply(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Card payments could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [orgId, search, available, state.revision, refresh])
  return { reply, error, load: () => setRefresh((n) => n + 1), available }
}

/** Starts a card payment and follows it until the provider answers. */
function useCharge(onDone: () => void) {
  const { state, reload } = useStore()
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Kept until the server answers, so retrying after a dropped connection cannot charge twice.
  const [key, setKey] = useState(() => crypto.randomUUID())
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}`
  const settle = async (next: Attempt) => {
    setAttempt(next)
    if (next.status !== 'processing') setKey(crypto.randomUUID())
    if (next.status === 'succeeded') {
      await reload().catch(() => null)
      onDone()
    }
  }
  useEffect(() => {
    if (attempt?.status !== 'processing') return
    const timer = setInterval(() => {
      api<Attempt>(`${base}/payments/${attempt.id}`)
        .then((next) => {
          if (next.status !== 'processing') void settle(next)
        })
        .catch(() => null)
    }, 2500)
    return () => clearInterval(timer)
    // Polls while one attempt waits on a card reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.id, attempt?.status])
  async function charge(path: string, body: unknown) {
    setBusy(true)
    setError('')
    try {
      await settle(await api<Attempt>(`${base}${path}`, { method: 'POST', body, key }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment could not be started.')
    } finally {
      setBusy(false)
    }
  }
  /** Asks the provider again about an unclear answer, as the same request; it never charges twice. */
  async function check(id = attempt?.id) {
    if (!id) return
    setBusy(true)
    setError('')
    try {
      await settle(await api<Attempt>(`${base}/payments/${id}/check`, { method: 'POST', body: {} }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment provider could not be asked again.')
    } finally {
      setBusy(false)
    }
  }
  async function tap(approve: boolean) {
    if (!attempt) return
    setBusy(true)
    try {
      await settle(
        await api<Attempt>(`${base}/payments/${attempt.id}/test-tap`, {
          method: 'POST',
          body: { approve },
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test reader could not answer.')
    } finally {
      setBusy(false)
    }
  }
  return { attempt, error, busy, charge, check, tap, clear: () => setAttempt(null) }
}

function AttemptState({
  attempt,
  busy,
  onTap,
  onCheck,
}: {
  attempt: Attempt
  busy: boolean
  onTap: (approve: boolean) => void
  onCheck: () => void
}) {
  const { state } = useStore()
  return (
    <div className="card-attempt" role="status">
      <strong>
        {statusLabel[attempt.status]} · {formatMoney(attempt.amountMinor, state.organisation, true)}
      </strong>
      {attempt.detail && <p>{attempt.detail}</p>}
      {attempt.status === 'processing' && attempt.route === 'reader' && (
        <>
          <p>
            {attempt.testMode
              ? 'This is the test card reader. Choose how the client’s tap ends.'
              : 'Ask the client to tap, insert or swipe their card on the reader.'}
          </p>
          {attempt.testMode && (
            <div className="guest-actions">
              <Button disabled={busy} onClick={() => onTap(true)}>
                Approve on test reader
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onTap(false)}>
                Decline
              </Button>
            </div>
          )}
        </>
      )}
      {attempt.status === 'unknown' && attempt.route !== 'reader' && (
        <Button variant="secondary" disabled={busy} onClick={onCheck}>
          Check again
        </Button>
      )}
      {attempt.status === 'succeeded' && attempt.testMode && <p>Test mode: no money moved.</p>}
    </div>
  )
}

/** PILOT-02: the card choice at checkout, with a saved card or a card reader. */
export function CardCheckout({
  appointmentId,
  amountMinor,
  tipMinor,
  discountMinor,
  products = [],
  giftCard,
}: {
  appointmentId: string
  amountMinor: number
  tipMinor: number
  discountMinor: number
  /** V2: products bought with the visit; the server prices them again before charging. */
  products?: { productId: string; quantity: number }[]
  /** V1.5: a gift card paying part of the visit; the card is charged the rest. */
  giftCard?: { id: string; amountMinor: number }
}) {
  const { state, blocked } = useStore()
  const { reply, error: loadError } = usePayments({ appointmentId })
  const { attempt, error, busy, charge, check, tap } = useCharge(() => undefined)
  const [route, setRoute] = useState('')
  if (!reply) return <ErrorMessage error={loadError} />
  const options = [
    ...reply.cards.slice(0, 1).map((card) => ({
      id: `card:${card.id}`,
      label: `Saved card: ${card.brand} ending ${card.last4}`,
    })),
    ...reply.provider.readers.map((reader) => ({
      id: `reader:${reader.id}`,
      label: `${reader.label}${reply.provider.live ? '' : ' (test)'}`,
    })),
  ]
  const chosen = route || options[0]?.id || ''
  const waiting = attempt?.status === 'processing'
  return (
    <div className="card-checkout">
      {!reply.provider.live && (
        <p className="card-test-note">
          <FlaskConical size={16} aria-hidden="true" />
          Test mode: no card is charged and no money moves.
        </p>
      )}
      <fieldset disabled={busy || waiting}>
        <legend>Take the card</legend>
        {options.map((option) => (
          <label key={option.id} className="card-route">
            <input
              type="radio"
              name="card-route"
              checked={chosen === option.id}
              onChange={() => setRoute(option.id)}
            />
            {option.id.startsWith('card:') ? (
              <CreditCard size={16} aria-hidden="true" />
            ) : (
              <Nfc size={16} aria-hidden="true" />
            )}
            {option.label}
          </label>
        ))}
      </fieldset>
      {attempt && (
        <AttemptState
          attempt={attempt}
          busy={busy}
          onTap={(ok) => void tap(ok)}
          onCheck={() => void check()}
        />
      )}
      <ErrorMessage error={error} />
      <Button
        disabled={blocked || busy || waiting || !chosen || amountMinor <= 0}
        onClick={() => {
          const [kind, id] = chosen.split(/:(.*)/s)
          void charge('/payments', {
            appointmentId,
            purpose: 'balance',
            route: kind === 'card' ? 'saved_card' : 'reader',
            ...(kind === 'reader' ? { readerId: id } : {}),
            amountMinor,
            tipMinor,
            discountMinor,
            ...(products.length ? { products } : {}),
            ...(giftCard ? { giftCardId: giftCard.id, giftCardMinor: giftCard.amountMinor } : {}),
          })
        }}
      >
        <CreditCard size={16} />
        {busy
          ? 'Starting…'
          : waiting
            ? 'Waiting for the card…'
            : `Charge ${formatMoney(amountMinor, state.organisation, true)}`}
      </Button>
    </div>
  )
}

/**
 * PILOT-02: on a visit's details, the client's saved card, a deposit still owed, and the missed
 * visit fee the studio's policy allows. Money that needs a look is listed with what happened.
 */
export function VisitCardPanel({ appointmentId }: { appointmentId: string }) {
  const { state, role, blocked } = useStore()
  const { reply, error: loadError, load } = usePayments({ appointmentId })
  const { attempt, error, busy, charge, check } = useCharge(load)
  const [fee, setFee] = useState('')
  if (!reply?.available) return loadError ? <ErrorMessage error={loadError} /> : null
  const card = reply.cards[0]
  const due = reply.depositDueMinor ?? 0
  const allowedFee = reply.feeAllowedMinor ?? 0
  const feeMinor = fee === '' ? allowedFee : parseMinor(fee, 0)
  const attention = reply.attempts.filter((a) => ['review', 'unknown', 'failed'].includes(a.status))
  if (!card && !attention.length && !(allowedFee && can(role, 'fee'))) return null
  return (
    <section className="visit-card-panel" aria-label="Card on file">
      <h4>
        <ShieldCheck size={16} aria-hidden="true" /> Card on file
      </h4>
      {card ? (
        <p>
          {card.brand} ending {card.last4}, saved{' '}
          {new Date(card.createdAt).toLocaleDateString(state.organisation.locale)}
          {reply.provider.live ? '' : ' in test mode'}.
        </p>
      ) : (
        <p className="subtle">No card saved. The client can save one from their visit link.</p>
      )}
      {card && due > 0 && can(role, 'deposit') && (
        <Button
          variant="secondary"
          disabled={blocked || busy}
          onClick={() =>
            void charge('/payments', {
              appointmentId,
              purpose: 'deposit',
              route: 'saved_card',
              amountMinor: due,
            })
          }
        >
          Take the {formatMoney(due, state.organisation, true)} deposit from this card
        </Button>
      )}
      {allowedFee > 0 && can(role, 'fee') && (
        <div className="visit-fee">
          <label>
            Missed visit fee, up to {formatMoney(allowedFee, state.organisation, true)} under your
            policy ({state.organisation.currency})
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={allowedFee / 100}
              value={fee === '' ? minorInput(allowedFee) : fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={
              blocked ||
              busy ||
              !card ||
              !Number.isFinite(feeMinor) ||
              feeMinor <= 0 ||
              feeMinor > allowedFee
            }
            onClick={() =>
              void charge('/payments', {
                appointmentId,
                purpose: 'fee',
                route: 'saved_card',
                amountMinor: feeMinor,
              })
            }
          >
            Charge the fee to the saved card
          </Button>
          {!card && <p className="subtle">A fee needs a saved card.</p>}
        </div>
      )}
      {attempt && (
        <AttemptState
          attempt={attempt}
          busy={busy}
          onTap={() => undefined}
          onCheck={() => void check()}
        />
      )}
      <ErrorMessage error={error} />
      {attention.length > 0 && (
        <ul className="card-attention">
          {attention.slice(0, 3).map((a) => (
            <li key={a.id}>
              <strong>
                {purposeLabel[a.purpose]}: {statusLabel[a.status]}
              </strong>
              {a.detail && <span>{a.detail}</span>}
              {a.status === 'unknown' && a.route !== 'reader' && (
                <Button variant="quiet" disabled={busy || blocked} onClick={() => void check(a.id)}>
                  Check again
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** PILOT-02: the cards a client saved, what they agreed to, and a way to remove one. */
export function ClientCards({ clientId }: { clientId: string }) {
  const { state, blocked } = useStore()
  const { reply, load, available } = usePayments({ clientId })
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!available || !reply?.available) return null
  async function remove(cardId: string) {
    setBusy(true)
    setError('')
    try {
      await api(
        `/api/workspaces/${encodeURIComponent(state.organisation.id)}/cards/${encodeURIComponent(cardId)}/remove`,
        { method: 'POST', body: {} },
      )
      setConfirm('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The card could not be removed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="surface client-cards">
      <h3>
        <CreditCard size={18} aria-hidden="true" /> Saved card
      </h3>
      {reply.cards.length === 0 ? (
        <p className="subtle">
          None. A client can save a card from the link to their visit, once the studio offers it in
          Settings, Payments.
        </p>
      ) : (
        reply.cards.map((card) => (
          <div key={card.id} className="client-card">
            <p>
              <strong>
                {card.brand} ending {card.last4}
              </strong>{' '}
              · expires {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
              {reply.provider.live ? '' : ' · test card'}
            </p>
            <details>
              <summary>What the client agreed to</summary>
              <p>{card.agreed}</p>
            </details>
            {confirm === card.id ? (
              <div className="guest-actions">
                <Button disabled={blocked || busy} onClick={() => void remove(card.id)}>
                  {busy ? 'Removing…' : 'Yes, remove this card'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm('')}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="quiet" disabled={blocked} onClick={() => setConfirm(card.id)}>
                Remove card
              </Button>
            )}
          </div>
        ))
      )}
      <ErrorMessage error={error} />
    </section>
  )
}

/** PILOT-02: whether guests may save a card, and the missed visit fee. Owners and managers only. */
export function PaymentSettings() {
  const { state, commit, blocked, role, session, mode } = useStore()
  const current = operations(state).protection ?? { saveCard: false, feePercent: 0 }
  const [draft, setDraft] = useState(current)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const editable = can(role, 'protection') && !blocked
  const changed = JSON.stringify(draft) !== JSON.stringify(current)
  const live = session?.services.payments
  const sample = operations(state).mode !== 'local'
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !editable) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'protection', settings: draft })
      if (!result.ok) setError(result.error)
      else setSaved('Saved. Guests see the new terms the next time they open their visit.')
    } catch {
      setError('The settings could not be saved. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Payments</h2>
          <p>Deposits, saved cards and card payments at the desk.</p>
        </div>
        <CreditCard size={21} />
      </header>
      <form className="settings-body" onSubmit={save} aria-busy={pending}>
        <div className="ops-banner">
          {live ? <CreditCard size={20} /> : <FlaskConical size={20} />}
          <div>
            <strong>
              {mode === 'demo' || sample
                ? 'This is a sample studio, so no card is ever charged.'
                : live
                  ? 'Card payments are connected.'
                  : 'Test mode: guests and the desk can rehearse every step, and no money moves.'}
            </strong>
            <p>
              {live
                ? 'A payment is added to a visit only when the payment provider confirms it.'
                : 'Card numbers are never typed into SALEANE. Real payments start once a payment provider is chosen and connected.'}
            </p>
          </div>
        </div>
        <fieldset className="message-settings" disabled={!editable || pending}>
          <legend className="sr-only">Saved cards</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.saveCard}
              onChange={(e) => {
                setDraft({ ...draft, saveCard: e.target.checked })
                setSaved('')
              }}
            />
            Let guests save a card from the link to their visit
          </label>
          <label>
            Missed visit and late cancellation fee
            <select
              value={draft.feePercent}
              onChange={(e) => {
                setDraft({ ...draft, feePercent: Number(e.target.value) })
                setSaved('')
              }}
            >
              <option value={0}>No fee</option>
              <option value={25}>Up to 25% of the booked price</option>
              <option value={50}>Up to 50% of the booked price</option>
              <option value={100}>Up to the full booked price</option>
            </select>
          </label>
        </fieldset>
        <p className="subtle">
          A fee applies only to a missed visit or one cancelled less than 24 hours ahead, comes off
          any deposit already paid, and is charged by a person, never automatically. Guests see
          these terms before they save a card.
        </p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {editable && (
          <div className="ops-actions">
            <Button type="submit" disabled={!changed || pending}>
              {pending ? 'Saving…' : 'Save payment settings'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

/** PILOT-02: returns money to the card it came from, through the payment provider. */
export function CardRefund({
  target,
  maxMinor,
  testMode,
  onDone,
}: {
  target: { saleId: string } | { paymentId: string }
  maxMinor: number
  testMode: boolean
  onDone: () => void
}) {
  const { state, blocked, role } = useStore()
  const { attempt, error, busy, charge, check } = useCharge(onDone)
  const [amount, setAmount] = useState(minorInput(maxMinor))
  const [reason, setReason] = useState('')
  const amountMinor = parseMinor(amount, 0)
  const valid =
    Number.isFinite(amountMinor) &&
    amountMinor > 0 &&
    amountMinor <= maxMinor &&
    reason.trim().length >= 3
  return (
    <form
      className="card-refund"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) void charge('/card-refunds', { ...target, amountMinor, reason: reason.trim() })
      }}
    >
      <h3 className="ops-section-title">Refund to the card</h3>
      <p className="ops-editor-note">
        {testMode
          ? 'Test mode: the refund is recorded and no money moves.'
          : 'The payment provider returns the money to the card it came from. It is recorded here once the provider confirms it.'}
      </p>
      <div className="ops-fields">
        <label>
          Amount ({state.organisation.currency}), up to{' '}
          {formatMoney(maxMinor, state.organisation, true)}
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={maxMinor / 100}
            value={amount}
            required
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="ops-wide">
          Reason
          <textarea
            required
            minLength={3}
            maxLength={300}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {attempt && (
        <AttemptState
          attempt={attempt}
          busy={busy}
          onTap={() => undefined}
          onCheck={() => void check()}
        />
      )}
      <ErrorMessage error={error} />
      <div className="ops-actions">
        <Button type="submit" disabled={!valid || busy || blocked || !can(role, 'refund')}>
          {busy ? 'Refunding…' : 'Refund to the card'}
        </Button>
      </div>
    </form>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { businessDate, can } from '../domain/operations'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { waitingOn } from '../domain/approvals'
import type { RefundTarget } from '../domain/approvalsSchema'
import {
  refundApproval,
  refundApprovalUntil,
  refundLimitFor,
  refundReceipt,
  refundRequestsFor,
} from '../domain/signoffs'
import { Button, ErrorMessage } from '../design'
import './signoffs.css'

/**
 * Stage 4: a receipt's sign-off, for whoever opens it. Someone with a refund limit sees what they
 * may give back on their own and can ask for a sign-off for more; everyone sees where a request
 * for this receipt stands. An approved refund is given back here, once, for exactly its amount.
 * Approving moves no money, so nothing here says money went back until a refund is recorded.
 */
export function RefundSignOff({
  target,
  onGiveBack,
}: {
  target: RefundTarget
  /** Opens the refund with the approved amount filled in. */
  onGiveBack?: (amountMinor: number) => void
}) {
  const { state, role, blocked, commit, branch } = useStore()
  const org = state.organisation
  const [asking, setAsking] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const receipt = refundReceipt(state, target)
  const limit = refundLimitFor(state, role)
  const latest = refundRequestsFor(state, target)[0]
  if (!receipt || (limit === null && !latest)) return null
  const now = new Date().toISOString()
  const left = receipt.paidMinor - receipt.refundedMinor
  const standing = latest ? refundApproval(state, latest, now) : null
  const cash = (n: number) => money(n, org, true)
  const asked = latest?.amountMinor ?? 0
  const by = latest?.decision?.by ? ` by ${latest.decision.by}` : ''
  const mayAsk =
    limit !== null &&
    !blocked &&
    can(role, 'request-raise') &&
    receipt.canReturn &&
    // A general manager asks only for receipts at their own location (the server agrees).
    (!branch || receipt.locationId === branch) &&
    left > 0 &&
    standing !== 'waiting' &&
    standing !== 'ready'

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = parseMinor(amount.trim())
    if (!Number.isFinite(amountMinor) || amountMinor <= 0)
      return setError('Enter the amount to give back, such as 60 or 60.50.')
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'request-raise',
        input: {
          locationId: receipt!.locationId,
          kind: 'refund',
          refund: target,
          amountMinor,
          note: reason.trim(),
        },
      })
      if (!result.ok) return setError(result.error)
      setAsking(false)
      setReason('')
      setNotice('Sent for a sign-off. Nothing has been given back yet.')
    } catch {
      setError('This could not be sent. What you typed is still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="signoff-receipt" aria-label="Refund sign-off">
      {limit !== null && (
        <p>
          You can give back up to {cash(limit)} on a receipt without a sign-off
          {receipt.refundedMinor > 0
            ? `, counting the ${cash(receipt.refundedMinor)} given back on this one already`
            : ''}
          .
        </p>
      )}
      {latest && standing === 'waiting' && (
        <p>
          A refund of {cash(asked)} is waiting for a sign-off from {waitingOn(state, latest)}.
          Nothing has been given back.{' '}
          {can(role, 'request-decide') && !blocked && (
            <Link className="text-link" to="/business/requests">
              Decide in Requests
            </Link>
          )}
        </p>
      )}
      {latest && standing === 'ready' && (
        <p>
          Approved{by}: give back exactly {cash(asked)}, once, from this receipt, by{' '}
          {dateLabel(refundApprovalUntil(state, latest)!, org.locale)}.
        </p>
      )}
      {latest && standing === 'declined' && (
        <p>
          The refund of {cash(asked)} was declined{by}.
          {latest.decision?.note ? ` ${latest.decision.note}` : ''}
        </p>
      )}
      {latest && standing === 'used' && (
        <p>
          The approved refund of {cash(asked)} was given back on{' '}
          {dateLabel(businessDate(state, latest.carriedOut!.at), org.locale)}.
        </p>
      )}
      {latest && standing === 'expired' && (
        <p>
          The sign-off for {cash(asked)} has lapsed: it was not given back by{' '}
          {dateLabel(refundApprovalUntil(state, latest)!, org.locale)}.
        </p>
      )}
      {latest && standing === 'changed' && (
        <p>
          The sign-off for {cash(asked)} has lapsed, as more was given back on this receipt after it
          was asked for.
        </p>
      )}
      <p className="ops-save-note" role="status">
        {notice}
      </p>
      {standing === 'ready' && onGiveBack && can(role, 'refund') && !blocked && (
        <div className="ops-actions">
          <Button variant="secondary" onClick={() => onGiveBack(asked)}>
            Give back {cash(asked)}
          </Button>
        </div>
      )}
      {mayAsk && !asking && (
        <div className="ops-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setAmount(minorInput(left))
              setNotice('')
              setError('')
              setAsking(true)
            }}
          >
            Ask for a sign-off
          </Button>
        </div>
      )}
      {mayAsk && asking && (
        <form className="plan-form signoff-form" onSubmit={send} aria-busy={pending}>
          <div className="ops-fields">
            <label>
              Amount to give back ({org.currency})
              <input
                inputMode="decimal"
                value={amount}
                required
                disabled={pending}
                onChange={(e) => setAmount(e.target.value)}
              />
              <small>Up to {cash(left)} on this receipt.</small>
            </label>
            <label className="ops-wide">
              Why the money goes back
              <textarea
                rows={2}
                required
                minLength={3}
                maxLength={500}
                value={reason}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
              />
              <small>
                Leave out the client’s name and details. Whoever decides sees the receipt number,
                the amount and the treatment only.
              </small>
            </label>
          </div>
          <ErrorMessage error={error} />
          <div className="ops-actions">
            <Button type="submit" disabled={pending || reason.trim().length < 3}>
              {pending ? 'Sending…' : 'Send for sign-off'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setAsking(false)}>
              Not now
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

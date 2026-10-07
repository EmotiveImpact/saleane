import { useState } from 'react'
import { CreditCard, ShieldCheck } from 'lucide-react'
import { api } from '../state/api'
import type { GuestPayment as Payment, GuestView } from '../domain/guest'
import { money } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import { rememberToken } from '../state/guestReturn'

/**
 * PILOT-02: paying a deposit or saving a card from the guest's private page. The card is typed
 * on the payment provider's own page; SALEANE never sees the number.
 */
export function GuestPayment({
  token,
  payment,
  organisation,
}: {
  token: string
  payment: Payment
  organisation: GuestView['organisation']
}) {
  const [saveCard, setSaveCard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const due = money(payment.depositDueMinor, organisation, true)

  async function open(purpose: 'deposit' | 'save_card') {
    setBusy(true)
    setError('')
    try {
      const { url } = await api<{ url: string }>('/api/guest/pay', {
        method: 'POST',
        body: { token, purpose, saveCard: purpose === 'deposit' && saveCard },
      })
      rememberToken(token)
      window.location.assign(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment page could not be opened.')
      setBusy(false)
    }
  }

  return (
    <section className="guest-pay" aria-labelledby="guest-pay-heading">
      <h2 id="guest-pay-heading">
        <ShieldCheck size={18} aria-hidden="true" />
        {payment.depositDueMinor ? 'Secure your visit' : 'Your card'}
      </h2>
      {payment.testMode && (
        <p className="guest-pay-test">
          Test mode: the studio is still setting up card payments, so no card is asked for and no
          money moves.
        </p>
      )}
      {payment.pending ? (
        <p role="status">We’re confirming your payment. This page will show it once it lands.</p>
      ) : (
        <>
          {payment.savedCard && (
            <p className="guest-pay-card">
              <CreditCard size={16} aria-hidden="true" />
              {payment.savedCard.brand} ending {payment.savedCard.last4} is saved for your visits.
            </p>
          )}
          {payment.depositDueMinor > 0 ? (
            <>
              <p>
                {organisation.name} asks for a deposit of {due} to hold this time. It comes off your
                bill on the day.
              </p>
              {payment.saveCardOffered && (
                <label className="guest-pay-save">
                  <input
                    type="checkbox"
                    checked={saveCard}
                    onChange={(event) => setSaveCard(event.target.checked)}
                  />
                  <span>
                    Also save my card for this studio
                    <small>{payment.policy}</small>
                  </span>
                </label>
              )}
              <Button disabled={busy} onClick={() => void open('deposit')}>
                {busy ? 'Opening the payment page…' : `Pay ${due} deposit`}
              </Button>
            </>
          ) : (
            payment.saveCardOffered && (
              <>
                <p>
                  Save a card so you don’t need one on the day. <small>{payment.policy}</small>
                </p>
                <Button variant="secondary" disabled={busy} onClick={() => void open('save_card')}>
                  {busy ? 'Opening the card page…' : 'Save a card'}
                </Button>
              </>
            )
          )}
        </>
      )}
      <ErrorMessage error={error} />
    </section>
  )
}

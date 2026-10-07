import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { api } from '../state/api'
import { money } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import '../guest.css'

type TestAttempt = {
  studio: string
  locale: 'en-GB' | 'en-US'
  currency: 'GBP' | 'USD'
  amountMinor: number
  purpose: 'deposit' | 'save_card'
  saveCard: boolean
  status: string
}

/**
 * PILOT-02: stands in for the payment provider's card page while SALEANE is in test mode. It
 * asks for no card details and moves no money; it only lets the guest choose how the test ends.
 */
export function TestPayment() {
  const [attemptId] = useState(() => window.location.hash.slice(1))
  const [attempt, setAttempt] = useState<TestAttempt | null>(null)
  const [card, setCard] = useState<'4242' | '0002'>('4242')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() =>
    attemptId ? '' : 'This test payment link is incomplete.',
  )

  useEffect(() => {
    document.title = 'SALEANE · Test payment'
    if (!attemptId) return
    api<TestAttempt>(`/api/test-payments/${encodeURIComponent(attemptId)}`)
      .then(setAttempt)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'This test payment could not be opened.'),
      )
  }, [attemptId])

  async function finish(outcome: 'pay' | 'cancel') {
    setBusy(true)
    setError('')
    try {
      const { next } = await api<{ next: string }>(
        `/api/test-payments/${encodeURIComponent(attemptId)}`,
        { method: 'POST', body: { outcome, card } },
      )
      window.location.assign(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test payment could not finish.')
      setBusy(false)
    }
  }

  const amount = attempt
    ? money(attempt.amountMinor, { locale: attempt.locale, currency: attempt.currency }, true)
    : ''
  const paying = attempt?.purpose === 'deposit'
  return (
    <main className="guest-page">
      <span className="wordmark">SALEANE</span>
      <section className="guest-card" aria-labelledby="test-pay-heading">
        <p className="date-caption">
          <FlaskConical size={16} aria-hidden="true" />
          Test payment page
        </p>
        <h1 id="test-pay-heading">
          {attempt ? (paying ? `${amount} deposit` : 'Save a card') : 'Test payment'}
        </h1>
        <p className="guest-pay-test">
          This page stands in for the card payment page while SALEANE is in test mode. No card
          details are asked for and no money moves.
        </p>
        {attempt && attempt.status !== 'started' && (
          <p role="status">This test payment has already finished.</p>
        )}
        {attempt && attempt.status === 'started' && (
          <>
            <p>
              {paying
                ? `A deposit to ${attempt.studio}${attempt.saveCard ? ', saving the card for later visits' : ''}.`
                : `A card saved with ${attempt.studio} for later visits.`}
            </p>
            <fieldset className="test-cards">
              <legend>Choose a test card</legend>
              <label>
                <input
                  type="radio"
                  name="card"
                  checked={card === '4242'}
                  onChange={() => setCard('4242')}
                />
                Test card ending 4242, which goes through
              </label>
              <label>
                <input
                  type="radio"
                  name="card"
                  checked={card === '0002'}
                  onChange={() => setCard('0002')}
                />
                Test card ending 0002, which{' '}
                {paying ? 'is declined' : 'saves, then is declined if the studio charges it'}
              </label>
            </fieldset>
            <div className="guest-actions">
              <Button disabled={busy} onClick={() => void finish('pay')}>
                {busy ? 'Finishing…' : paying ? `Pay ${amount} (test)` : 'Save test card'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void finish('cancel')}>
                Go back without paying
              </Button>
            </div>
          </>
        )}
        <ErrorMessage error={error} />
      </section>
    </main>
  )
}

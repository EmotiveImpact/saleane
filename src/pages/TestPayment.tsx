import { useEffect, useState } from 'react'
import { Check, FlaskConical } from 'lucide-react'
import { api } from '../state/api'
import { money } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import '../guest.css'
import './testPayment.css'

type TestAttempt = {
  studio: string
  locale: 'en-GB' | 'en-US'
  currency: 'GBP' | 'USD'
  amountMinor: number
  purpose: 'deposit' | 'save_card'
  saveCard: boolean
  status: string
}

type Ending = { kind: 'paid' | 'saved' | 'declined' | 'left'; next: string }

/** How a test ended, in words that never suggest money moved. */
function endingWords(ending: Ending, amount: string, paying: boolean) {
  if (ending.kind === 'paid')
    return {
      title: 'Test payment complete',
      words: `This was a test of the ${amount} deposit, so no money was taken and no card was charged.`,
    }
  if (ending.kind === 'saved')
    return {
      title: 'Test card saved',
      words: 'This was a test, so no real card was saved and no money was taken.',
    }
  if (ending.kind === 'declined')
    return {
      title: 'The test card was declined',
      words: 'This was a test, so nothing was taken. You can try again from your visit.',
    }
  return {
    title: paying ? 'You left without paying' : 'You left without saving a card',
    words: paying
      ? 'Nothing was taken. You can pay later from your visit.'
      : 'Nothing was saved or taken. You can save a card later from your visit.',
  }
}

/**
 * PILOT-02: stands in for the payment provider's card page while SALEANE is in test mode. It
 * asks for no card details and moves no money; it only lets the guest choose how the test ends,
 * then says plainly that it was a test before the guest goes back to their visit.
 */
export function TestPayment() {
  const [attemptId] = useState(() => window.location.hash.slice(1))
  const [attempt, setAttempt] = useState<TestAttempt | null>(null)
  const [card, setCard] = useState<'4242' | '0002'>('4242')
  const [busy, setBusy] = useState(false)
  const [ending, setEnding] = useState<Ending | null>(null)
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
      const result = new URLSearchParams(next.split('?')[1] ?? '').get('payment')
      setEnding({
        kind:
          outcome === 'cancel' || result === 'cancelled'
            ? 'left'
            : result === 'declined'
              ? 'declined'
              : attempt?.purpose === 'save_card'
                ? 'saved'
                : 'paid',
        next,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test payment could not finish.')
    } finally {
      setBusy(false)
    }
  }
  /** Back to the guest's own visit, which this tab remembers. */
  function backToVisit(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!ending || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.location.assign(ending.next)
  }

  const amount = attempt
    ? money(attempt.amountMinor, { locale: attempt.locale, currency: attempt.currency }, true)
    : ''
  const paying = attempt?.purpose === 'deposit'
  const ended = ending ? endingWords(ending, amount, paying) : null
  return (
    <main className="guest-page">
      <span className="wordmark">SALEANE</span>
      <section className="guest-card" aria-labelledby="test-pay-heading">
        <p className="date-caption">
          <FlaskConical size={16} aria-hidden="true" />
          Test payment page
        </p>
        <h1 id="test-pay-heading">
          {ended
            ? ended.title
            : attempt
              ? paying
                ? `${amount} deposit`
                : 'Save a card'
              : 'Test payment'}
        </h1>
        {ending && ended && (
          <div className="test-pay-ending">
            {ending.kind !== 'declined' && ending.kind !== 'left' && (
              <span className="test-pay-mark" aria-hidden="true">
                <Check size={22} />
              </span>
            )}
            <p role="status">{ended.words}</p>
            <a className="button button-primary" href={ending.next} onClick={backToVisit}>
              Back to your visit
            </a>
          </div>
        )}
        {!ending && (
          <p className="guest-pay-test">
            This page stands in for the card payment page while SALEANE is in test mode. No card
            details are asked for and no money moves.
          </p>
        )}
        {!ending && attempt && attempt.status !== 'started' && (
          <p role="status">This test payment has already finished.</p>
        )}
        {!ending && attempt && attempt.status === 'started' && (
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

import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { api } from '../state/api'
import { money } from '../domain/format'
import { Button, ErrorMessage } from '../design'
import '../guest.css'
import './testPayment.css'

type TestSetup = {
  studio: string
  status: string
  thenPay: boolean
  locale: 'en-GB' | 'en-US'
  currency: 'GBP' | 'USD'
  amountMinor: number
}

/**
 * NEXT-02: stands in for the card service's page when an owner saves a card for the SALEANE plan
 * in test mode. It asks for no card details and moves no money: the owner chooses how the test
 * ends and goes straight back to Plan and billing, which says what happened.
 */
export function TestBillingCard() {
  const [setupId] = useState(() => window.location.hash.slice(1))
  const [setup, setSetup] = useState<TestSetup | null>(null)
  const [card, setCard] = useState<'4242' | '0002'>('4242')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() => (setupId ? '' : 'This test card link is incomplete.'))

  useEffect(() => {
    document.title = 'SALEANE · Test card'
    if (!setupId) return
    api<TestSetup>(`/api/test-billing/${encodeURIComponent(setupId)}`)
      .then(setSetup)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'This test card page could not be opened.'),
      )
  }, [setupId])

  async function finish(outcome: 'save' | 'cancel') {
    setBusy(true)
    setError('')
    try {
      const { next } = await api<{ next: string }>(
        `/api/test-billing/${encodeURIComponent(setupId)}`,
        { method: 'POST', body: { outcome, card } },
      )
      window.location.assign(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test card page could not finish.')
      setBusy(false)
    }
  }

  const amount =
    setup && setup.thenPay
      ? money(setup.amountMinor, { locale: setup.locale, currency: setup.currency }, true)
      : ''
  return (
    <main className="guest-page">
      <span className="wordmark">SALEANE</span>
      <section className="guest-card" aria-labelledby="test-billing-heading">
        <p className="date-caption">
          <FlaskConical size={16} aria-hidden="true" />
          Test card page
        </p>
        <h1 id="test-billing-heading">
          {amount ? `Save a card and pay ${amount}` : 'Save a card for SALEANE'}
        </h1>
        <p className="guest-pay-test">
          This page stands in for the card service’s page while SALEANE billing is in test mode. No
          card details are asked for and no money moves.
        </p>
        {setup && setup.status !== 'started' && (
          <p role="status">This test card page has already finished.</p>
        )}
        {setup && setup.status === 'started' && (
          <>
            <p>
              {amount
                ? `The card pays the SALEANE bill for ${setup.studio} now, then each month.`
                : `The card pays the SALEANE bill for ${setup.studio} each month. Nothing is taken today.`}
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
                Test card ending 0002, which saves, then is declined when a bill is taken
              </label>
            </fieldset>
            <div className="guest-actions">
              <Button disabled={busy} onClick={() => void finish('save')}>
                {busy ? 'Saving…' : amount ? `Save and pay ${amount} (test)` : 'Save test card'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void finish('cancel')}>
                Go back without saving
              </Button>
            </div>
          </>
        )}
        <ErrorMessage error={error} />
      </section>
    </main>
  )
}

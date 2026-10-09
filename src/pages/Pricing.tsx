import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plug } from 'lucide-react'
import { CONNECT_NOTES, INCLUDED, PRICE, PROMISES, priceLabel } from '../domain/pricing'
import type { PriceRegion } from '../domain/pricing'
import { SegmentedControl } from '../design'
import '../pricing.css'

/** A first guess at the visitor's country, from their browser's language. They can switch. */
function guessRegion(): PriceRegion {
  return typeof navigator !== 'undefined' && /-US$/i.test(navigator.language) ? 'US' : 'UK'
}

/** PILOT-04: SALEANE's one clear published price. */
export function Pricing() {
  const [region, setRegion] = useState<PriceRegion>(guessRegion)
  useEffect(() => {
    document.title = 'SALEANE · Pricing'
  }, [])
  const price = PRICE[region]
  return (
    <div className="pricing-page">
      <header className="pricing-top">
        <Link className="wordmark" to="/pricing">
          SALEANE
        </Link>
        <Link className="pricing-sign-in" to="/account">
          Sign in
        </Link>
      </header>
      <main className="pricing-main">
        <section className="pricing-hero" aria-labelledby="pricing-heading">
          <span className="eyebrow">Pricing</span>
          <h1 id="pricing-heading">One price. Everything included.</h1>
          <p>
            One monthly price for your studio, however many people work there and however many
            clients you look after.
          </p>
        </section>
        <section className="pricing-offer" aria-label="The price">
          <div className="pricing-card">
            <SegmentedControl
              label="Show the price for"
              appearance="pill"
              value={region}
              onChange={setRegion}
              options={[
                { value: 'UK', label: 'United Kingdom' },
                { value: 'US', label: 'United States' },
              ]}
            />
            <p className="pricing-amount" aria-live="polite">
              <strong>{priceLabel(region)}</strong>
              <span>
                a month, {price.tax}
                <small>per studio, month to month</small>
              </span>
            </p>
            <ul className="pricing-included">
              {INCLUDED.map((item) => (
                <li key={item.text} className={item.connect ? 'pricing-connect' : undefined}>
                  {item.connect ? (
                    <Plug size={17} aria-hidden="true" />
                  ) : (
                    <Check size={17} aria-hidden="true" />
                  )}
                  <span>
                    {item.text}
                    {item.connect && <small>{CONNECT_NOTES[item.connect]}</small>}
                  </span>
                </li>
              ))}
            </ul>
            <Link className="button button-primary pricing-cta" to="/account">
              Set up your studio
            </Link>
            <p className="pricing-note">
              SALEANE is in a private pilot. Nothing is charged until your studio goes live.
            </p>
          </div>
          <img
            className="pricing-photo"
            src="/images/saleane-studio-warm.jpg"
            alt="A calm studio treatment room in natural light"
          />
        </section>
        <section className="pricing-promises" aria-labelledby="promises-heading">
          <h2 id="promises-heading">What the price never hides</h2>
          <ul>
            {PROMISES.map((promise) => (
              <li key={promise.title}>
                <h3>{promise.title}</h3>
                <p>{promise.body}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="pricing-costs" aria-labelledby="costs-heading">
          <h2 id="costs-heading">Costs outside SALEANE</h2>
          <dl>
            <div>
              <dt>Card payments</dt>
              <dd>
                The payment provider charges its standard fee on each card payment. SALEANE adds
                nothing on top.
              </dd>
            </div>
            <div>
              <dt>Text messages</dt>
              <dd>
                Passed on at what the text provider charges, with nothing added. Emails are
                included.
              </dd>
            </div>
          </dl>
        </section>
      </main>
      <footer className="pricing-footer">
        <span className="wordmark">SALEANE</span>
        <span>A considered way to run a remarkable business.</span>
      </footer>
    </div>
  )
}

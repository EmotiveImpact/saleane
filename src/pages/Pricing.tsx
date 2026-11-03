import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plug } from 'lucide-react'
import {
  ADD_ONS,
  CONNECT_NOTES,
  INCLUDED,
  PRICE,
  PROMISES,
  STARTING_AMOUNTS,
  TRIAL_DAYS,
  priceLabel,
} from '../domain/pricing'
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
          <h1 id="pricing-heading">Everything included, with room to grow.</h1>
          <p>
            One price for each location. Every feature is yours from the first day, with a generous
            amount each month of the parts that run on AI and email. When you are busier, add more
            of what you use. We limit amounts, never features.
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
                <small>per location, month to month</small>
              </span>
            </p>
            <h2 className="pricing-subhead" id="every-feature">
              Every feature, from day one
            </h2>
            <ul className="pricing-included" aria-labelledby="every-feature">
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
            <h2 className="pricing-subhead" id="each-month">
              Each month, to start with
            </h2>
            <dl className="pricing-amounts" aria-labelledby="each-month">
              {STARTING_AMOUNTS.map((item) => (
                <div key={item.text}>
                  <dt>{item.amount}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
            <Link className="button button-primary pricing-cta" to="/account">
              Set up your studio
            </Link>
            <p className="pricing-note">
              Start with {TRIAL_DAYS} days free, no card needed. SALEANE is in a private pilot, so
              nothing is charged yet.
            </p>
          </div>
          <img
            className="pricing-photo"
            src="/images/saleane-studio-warm.jpg"
            alt="A calm studio treatment room in natural light"
          />
        </section>
        <section className="pricing-addons" aria-labelledby="addons-heading">
          <h2 id="addons-heading">Room to grow</h2>
          <p className="pricing-section-intro">
            Add more only when you need it, and take it away when you don’t. Nothing you already use
            is ever held back.
          </p>
          <ul>
            {ADD_ONS.map((addOn) => (
              <li key={addOn.id}>
                <h3>{addOn.title}</h3>
                <p className="pricing-addon-price">
                  <strong>{priceLabel(region, addOn.amount)}</strong> {addOn.unit}, {price.tax}
                </p>
                <p>{addOn.body}</p>
                {'note' in addOn && (
                  <p className="pricing-addon-note">
                    <Plug size={15} aria-hidden="true" />
                    {addOn.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
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
                You pay Stripe’s standard rate on each card payment, the same as going to Stripe
                yourself, and never anything on top of it. Once SALEANE joins Stripe’s partner
                programme, Stripe will share part of its own fee with SALEANE. Card payments are
                connected through your own Stripe account.
              </dd>
            </div>
            <div>
              <dt>Text messages</dt>
              <dd>
                Passed on at what the text provider charges, with nothing added. Emails about visits
                are never counted.
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

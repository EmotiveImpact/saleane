import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plug } from 'lucide-react'
import {
  ADD_ONS,
  CONNECT_NOTES,
  INCLUDED,
  PEOPLE_PER_LOCATION,
  PRICE,
  PROMISES,
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
          <h1 id="pricing-heading">One price for each location.</h1>
          <p>
            Every feature is included, however many clients you look after. Each location comes with{' '}
            {PEOPLE_PER_LOCATION} people taking bookings, and anyone who gives no treatments, such
            as reception or a manager, is free. Busy studios can add more AI time or a receptionist
            on the phone.
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
            <p className="pricing-people">
              Includes {PEOPLE_PER_LOCATION} people taking bookings. Each person beyond that is{' '}
              <strong>{priceLabel(region, 'personMinor')}</strong> a month, {price.tax}.
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
          <h2 id="addons-heading">Add-ons</h2>
          <ul>
            {ADD_ONS.map((addOn) => (
              <li key={addOn.id}>
                <h3>{addOn.title}</h3>
                <p className="pricing-addon-price">
                  <strong>{priceLabel(region, addOn.amount)}</strong> a month for each location,{' '}
                  {price.tax}
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

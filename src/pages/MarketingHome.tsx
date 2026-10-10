import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronRight,
  Heart,
  Menu,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react'
import './marketing-home.css'

const slides = [
  {
    src: '/images/library/moments/all-in-hand.webp',
    alt: 'A quiet, sunlit moment in a beauty and wellness studio',
    label: 'Made for the moments that matter',
  },
  {
    src: '/images/library/treatments/signature-facial.webp',
    alt: 'A signature facial in a bright treatment room',
    label: 'Made for beautiful client experiences',
  },
  {
    src: '/images/library/rooms/reception-morning.webp',
    alt: 'A welcoming beauty studio in natural morning light',
    label: 'Made for a calmer working day',
  },
]

const promises = [
  {
    title: 'One beautifully organised place',
    copy: 'Your diary, people, payments and conversations belong together. No more piecing the day together across tabs.',
    icon: CalendarCheck2,
  },
  {
    title: 'Every client, thoughtfully remembered',
    copy: 'See visits, preferences and what comes next, so the relationship feels personal long after they leave.',
    icon: Heart,
  },
  {
    title: 'Confidence behind the scenes',
    copy: 'Clear records, sensible permissions and an honest picture of the business, without the unnecessary noise.',
    icon: ShieldCheck,
  },
]

const audiences = [
  { name: 'Skin studios', image: '/images/library/treatments/signature-facial.webp' },
  { name: 'Nail artists', image: '/images/library/treatments/manicure.webp' },
  { name: 'Spa teams', image: '/images/library/rooms/sunlit-treatment-room.webp' },
  { name: 'Hair stylists', image: '/images/library/treatments/hair-blowdry.webp' },
  { name: 'Massage therapists', image: '/images/library/details/towels-stacked.webp' },
  { name: 'Wellness spaces', image: '/images/library/rooms/reception-morning.webp' },
]

const faqs = [
  {
    question: 'Who is SALEANE made for?',
    answer:
      'Independent beauty, spa and wellness businesses, from solo practitioners to growing studios with several team members or locations. The first focus is non-clinical treatments.',
  },
  {
    question: 'Can my clients book online?',
    answer:
      'The online booking journey, availability checks and guest visit links are built for the review version. Public hosting and live payment or messaging providers still need to be configured before a real launch.',
  },
  {
    question: 'Can I bring my existing clients?',
    answer:
      'Yes. The local app can review and import a bounded client CSV, flag potential duplicates and keep marketing consent explicit rather than assuming it.',
  },
  {
    question: 'Can I try it without entering a card?',
    answer:
      'The current studio plan includes a 14-day trial without a card. SALEANE is still in a private, local review phase and live subscriptions are not being charged.',
  },
  {
    question: 'Does SALEANE work for studios in the UK and US?',
    answer:
      'Yes. The app supports UK and US studios with their own currency, local time zone and studio configuration. Live providers will be qualified separately for each market.',
  },
]

export function MarketingHome() {
  const [slide, setSlide] = useState(0)
  const [preview, setPreview] = useState<'studio' | 'guest'>('studio')
  const [region, setRegion] = useState<'UK' | 'US'>('UK')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    document.title = 'SALEANE | A calmer way to run your studio'
  }, [])
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="sl-site">
      <a className="sl-skip" href="#main">
        Skip to content
      </a>
      <header className="sl-header">
        <div className="sl-nav sl-container">
          <Link className="sl-logo" to="/" aria-label="SALEANE home" onClick={closeMenu}>
            SALEANE<span className="sl-logo-period">.</span>
          </Link>
          <nav
            className={menuOpen ? 'sl-menu is-open' : 'sl-menu'}
            id="sl-main-menu"
            aria-label="Main navigation"
          >
            <a href="#why-saleane" onClick={closeMenu}>
              Why SALEANE
            </a>
            <a href="#made-for" onClick={closeMenu}>
              Who it is for
            </a>
            <a href="#inside-saleane" onClick={closeMenu}>
              Inside SALEANE
            </a>
            <Link to="/pricing" onClick={closeMenu}>
              Pricing
            </Link>
          </nav>
          <div className="sl-nav-actions">
            <Link className="sl-sign-in" to="/account">
              Sign in
            </Link>
            <Link className="sl-nav-cta" to="/account">
              Open your studio <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <button
            className="sl-menu-toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="sl-main-menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={23} aria-hidden="true" /> : <Menu size={23} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main id="main">
        <section className="sl-hero sl-container" aria-labelledby="sl-hero-title">
          <div className="sl-hero-copy">
            <span className="sl-pill">
              <span className="sl-pill-dot" /> A NEW KIND OF STUDIO OS
            </span>
            <h1 id="sl-hero-title">
              Beautiful work deserves a <em>calmer business.</em>
            </h1>
            <p className="sl-lede">
              The thoughtful home for your appointments, clients, team and everything that keeps
              your beauty or wellness studio moving.
            </p>
            <div className="sl-hero-actions">
              <Link className="sl-button sl-button-dark" to="/today">
                Explore a sample studio <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <a className="sl-inline-link" href="#inside-saleane">
                See how it works <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
            <div className="sl-hero-footnote">
              <div className="sl-mini-portraits" aria-hidden="true">
                <img src="/images/library/treatments/signature-facial.webp" alt="" />
                <img src="/images/library/treatments/manicure.webp" alt="" />
                <img src="/images/library/treatments/hair-blowdry.webp" alt="" />
              </div>
              <span>Made for people who care deeply about their craft.</span>
            </div>
          </div>
          <div className="sl-hero-art">
            <div className="sl-hero-image-frame">
              <img
                className="sl-hero-image"
                src={slides[slide].src}
                alt={slides[slide].alt}
                fetchPriority="high"
              />
              <div className="sl-photo-tag">
                <Sparkles size={13} aria-hidden="true" /> A little more room to breathe
              </div>
            </div>
            <div
              className="sl-hero-float sl-hero-float-diary"
              aria-label="Illustrative diary preview"
            >
              <div className="sl-float-heading">
                <span>YOUR DAY, AT A GLANCE</span>
                <CalendarDays size={15} aria-hidden="true" />
              </div>
              <strong>Tuesday, beautifully planned.</strong>
              <div className="sl-diary-line">
                <span>09:30</span>
                <i className="sl-line-sage" />
                <span>Signature facial</span>
              </div>
              <div className="sl-diary-line">
                <span>11:00</span>
                <i className="sl-line-pink" />
                <span>Brow shaping</span>
              </div>
              <div className="sl-diary-line">
                <span>13:30</span>
                <i className="sl-line-sand" />
                <span>Wellness massage</span>
              </div>
            </div>
            <div className="sl-hero-float sl-hero-float-note">
              <span className="sl-float-heart">
                <Heart size={17} aria-hidden="true" />
              </span>
              <span>
                <strong>Keep the human touch.</strong>
                <small>We'll help with the rest.</small>
              </span>
            </div>
            <div className="sl-hero-pagination" role="group" aria-label="Hero photographs">
              {slides.map((item, index) => (
                <button
                  type="button"
                  key={item.src}
                  aria-label={'Show photograph ' + (index + 1) + ': ' + item.label}
                  aria-pressed={slide === index}
                  className={slide === index ? 'active' : ''}
                  onClick={() => setSlide(index)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="sl-principles" id="why-saleane" aria-labelledby="sl-principles-title">
          <div className="sl-container">
            <div className="sl-section-intro sl-intro-split">
              <div>
                <span className="sl-kicker">A LITTLE LESS ADMIN. A LOT MORE CARE.</span>
                <h2 id="sl-principles-title">
                  Because great care should not be <em>complicated.</em>
                </h2>
              </div>
              <p>
                We've thought about the busy mornings, the last-minute changes and the little
                details that make a guest feel known. SALEANE brings them together.
              </p>
            </div>
            <div className="sl-principles-grid">
              {promises.map(({ title, copy, icon: Icon }, index) => (
                <article className="sl-principle" key={title}>
                  <span className="sl-principle-icon">
                    <Icon size={21} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="sl-principle-number">0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="sl-audiences sl-container"
          id="made-for"
          aria-labelledby="sl-audience-title"
        >
          <span className="sl-kicker">MADE FOR YOUR WORLD</span>
          <h2 id="sl-audience-title">
            For every kind of <em>care.</em>
          </h2>
          <p>Different crafts, one beautifully considered way of working.</p>
          <div className="sl-audience-list">
            {audiences.map(({ name, image }) => (
              <div className="sl-audience-chip" key={name}>
                <img src={image} alt="" loading="lazy" />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          className="sl-product sl-container"
          id="inside-saleane"
          aria-labelledby="sl-product-title"
        >
          <div className="sl-product-heading">
            <span className="sl-kicker">ALL OF IT, BEAUTIFULLY CONNECTED</span>
            <h2 id="sl-product-title">
              We've done the organising.
              <br />
              <em>You do the extraordinary.</em>
            </h2>
            <p>
              From the first booking to the next visit, the experience should feel effortless on
              both sides of the desk.
            </p>
            <div className="sl-switch" role="group" aria-label="Choose interface preview">
              <button
                type="button"
                aria-pressed={preview === 'studio'}
                className={preview === 'studio' ? 'active' : ''}
                onClick={() => setPreview('studio')}
              >
                Your studio
              </button>
              <button
                type="button"
                aria-pressed={preview === 'guest'}
                className={preview === 'guest' ? 'active' : ''}
                onClick={() => setPreview('guest')}
              >
                Your guests
              </button>
            </div>
          </div>

          <div className="sl-product-grid">
            <article className="sl-product-card sl-product-one">
              <div className="sl-card-copy">
                <span className="sl-card-index">01 / AN EASIER DAY</span>
                <h3>{preview === 'studio' ? 'A day that flows.' : 'A booking that feels easy.'}</h3>
                <p>
                  {preview === 'studio'
                    ? 'The diary, your team and the next thing to do, without losing the little details.'
                    : 'Your guests find the right treatment and an available time, without the back and forth.'}
                </p>
              </div>
              <div
                className="sl-dashboard-mock"
                aria-label="Illustrative preview, not a live studio"
              >
                <div className="sl-mock-top">
                  <span>
                    SALEANE <b>/</b> {preview === 'studio' ? 'Today' : 'Booking'}
                  </span>
                  <span className="sl-mock-avatar">S</span>
                </div>
                {preview === 'studio' ? (
                  <>
                    <div className="sl-mock-welcome">
                      <small>GOOD MORNING</small>
                      <strong>Today is looking lovely.</strong>
                      <span>Tuesday · 24 March</span>
                    </div>
                    <div className="sl-mock-stats">
                      <div>
                        <small>Booked visits</small>
                        <strong>12</strong>
                      </div>
                      <div>
                        <small>Still to arrive</small>
                        <strong>7</strong>
                      </div>
                      <div>
                        <small>Next up</small>
                        <strong>09:30</strong>
                      </div>
                    </div>
                    <div className="sl-mock-appointment">
                      <span className="sl-mock-time">09:30</span>
                      <span className="sl-mock-avatar small">A</span>
                      <span>
                        <strong>Amelia P.</strong>
                        <small>Signature facial · 60 min</small>
                      </span>
                      <span className="sl-mock-status">Confirmed</span>
                    </div>
                    <div className="sl-mock-appointment">
                      <span className="sl-mock-time">11:00</span>
                      <span className="sl-mock-avatar small rose">M</span>
                      <span>
                        <strong>Maya R.</strong>
                        <small>Brow shape · 30 min</small>
                      </span>
                      <span className="sl-mock-status">Confirmed</span>
                    </div>
                  </>
                ) : (
                  <div className="sl-mock-guest">
                    <span className="sl-mock-eyebrow">A LITTLE TIME FOR YOU</span>
                    <strong>Choose your treatment</strong>
                    <img
                      src="/images/library/treatments/signature-facial.webp"
                      alt=""
                      loading="lazy"
                    />
                    <div>
                      <span>
                        Signature facial<small>60 minutes · from £85</small>
                      </span>
                      <ChevronRight size={20} aria-hidden="true" />
                    </div>
                    <div>
                      <span>Thoughtful moments, beautifully booked.</span>
                      <Check size={18} aria-hidden="true" />
                    </div>
                  </div>
                )}
              </div>
            </article>

            <article className="sl-product-card sl-product-two">
              <div className="sl-card-copy">
                <span className="sl-card-index">02 / BEAUTIFUL BOOKINGS</span>
                <h3>Your brand. Your bookings.</h3>
                <p>
                  A considered booking experience that feels like an extension of your own studio.
                </p>
              </div>
              <div className="sl-phone-wrap">
                <div className="sl-phone">
                  <div className="sl-phone-island" />
                  <div className="sl-phone-photo">
                    <img
                      src="/images/library/rooms/sunlit-treatment-room.webp"
                      alt=""
                      loading="lazy"
                    />
                  </div>
                  <div className="sl-phone-content">
                    <span>ATELIER STUDIO</span>
                    <strong>A moment just for you.</strong>
                    <small>Book your next visit</small>
                    <div>
                      Signature facial <ArrowRight size={14} aria-hidden="true" />
                    </div>
                    <div>
                      Brow & lash care <ArrowRight size={14} aria-hidden="true" />
                    </div>
                  </div>
                </div>
                <div className="sl-booking-float">
                  <Check size={16} aria-hidden="true" />
                  <span>
                    Visit confirmed<small>All the details, in one place</small>
                  </span>
                </div>
              </div>
            </article>

            <article className="sl-product-card sl-product-three">
              <div className="sl-card-copy">
                <span className="sl-card-index">03 / RELATIONSHIPS FIRST</span>
                <h3>Remember the person.</h3>
                <p>
                  A story that goes beyond one appointment, from the first hello to the next visit.
                </p>
              </div>
              <div className="sl-client-card">
                <div className="sl-client-top">
                  <span className="sl-client-avatar">M</span>
                  <span>
                    <strong>Maya R.</strong>
                    <small>Client relationship</small>
                  </span>
                  <span className="sl-client-dot" />
                </div>
                <div className="sl-client-rule" />
                <div className="sl-client-event">
                  <i />
                  <span>
                    <strong>Next visit</strong>
                    <small>Signature facial · Thursday 26 March</small>
                  </span>
                </div>
                <div className="sl-client-event">
                  <i />
                  <span>
                    <strong>Last visit</strong>
                    <small>Brow treatment · 4 March</small>
                  </span>
                </div>
                <div className="sl-client-note">
                  <Heart size={15} aria-hidden="true" /> Care that carries on.
                </div>
              </div>
            </article>

            <article className="sl-product-card sl-product-four">
              <div className="sl-card-copy">
                <span className="sl-card-index">04 / A CLEARER PICTURE</span>
                <h3>Know where you stand.</h3>
                <p>Payments, performance and the everyday numbers, all connected to real visits.</p>
              </div>
              <div className="sl-finance">
                <div className="sl-finance-header">
                  <span>
                    <Wallet size={15} aria-hidden="true" /> Business overview
                  </span>
                  <span>THIS WEEK</span>
                </div>
                <strong>£2,840.00</strong>
                <small>Illustrative collected payments</small>
                <div className="sl-bars" aria-hidden="true">
                  <i style={{ height: '36%' }} />
                  <i style={{ height: '58%' }} />
                  <i style={{ height: '72%' }} />
                  <i style={{ height: '48%' }} />
                  <i style={{ height: '91%' }} />
                  <i style={{ height: '66%' }} />
                  <i style={{ height: '82%' }} />
                </div>
                <div className="sl-finance-footer">
                  <span>
                    Visits completed <b>28</b>
                  </span>
                  <span>
                    Payment history <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                </div>
              </div>
            </article>
          </div>
          <p className="sl-preview-note">
            Interface illustrations use fictional sample details. Live services are not yet
            configured.
          </p>
        </section>

        <section className="sl-editorial sl-container" aria-labelledby="sl-editorial-title">
          <div className="sl-editorial-image">
            <img
              src="/images/library/rooms/studio-exterior.webp"
              loading="lazy"
              alt="The inviting entrance of a sunlit beauty studio"
            />
            <span>EVERY BEAUTIFUL STUDIO HAS A STORY.</span>
          </div>
          <div className="sl-editorial-copy">
            <span className="sl-kicker">THE BUSINESS BEHIND THE BEAUTY</span>
            <h2 id="sl-editorial-title">
              More space for the <em>human</em> side of your work.
            </h2>
            <p>
              Clients don't come back because you managed the diary perfectly. They come back
              because you made them feel looked after. SALEANE makes the work around that
              relationship feel lighter.
            </p>
            <div className="sl-editorial-details">
              <span>
                <Check size={17} aria-hidden="true" /> Thoughtful online booking
              </span>
              <span>
                <Check size={17} aria-hidden="true" /> A complete visit history
              </span>
              <span>
                <Check size={17} aria-hidden="true" /> A connected, calmer team
              </span>
            </div>
            <Link to="/today" className="sl-inline-link">
              Step inside the studio <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section
          className="sl-pricing sl-container"
          id="pricing"
          aria-labelledby="sl-pricing-title"
        >
          <div className="sl-pricing-content">
            <span className="sl-kicker">STRAIGHTFORWARD FROM THE START</span>
            <h2 id="sl-pricing-title">
              A clear price for the work behind every <em>beautiful day.</em>
            </h2>
            <p>
              No commission on your clients. No locked feature tiers. One price per location, with
              room to grow.
            </p>
            <div className="sl-faq" aria-label="Frequently asked questions">
              {faqs.map(({ question, answer }) => (
                <details key={question}>
                  <summary>
                    {question}
                    <span className="sl-faq-plus" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
          <div className="sl-pricing-visual">
            <div className="sl-price-card">
              <div className="sl-price-top">
                <span className="sl-price-symbol">S.</span>
                <span>ONE THOUGHTFUL PLAN</span>
              </div>
              <h3>A lovely place to begin.</h3>
              <p>Every feature included, however many people work in your studio.</p>
              <div className="sl-region-choice" role="group" aria-label="Choose pricing region">
                <button
                  type="button"
                  aria-pressed={region === 'UK'}
                  className={region === 'UK' ? 'active' : ''}
                  onClick={() => setRegion('UK')}
                >
                  United Kingdom
                </button>
                <button
                  type="button"
                  aria-pressed={region === 'US'}
                  className={region === 'US' ? 'active' : ''}
                  onClick={() => setRegion('US')}
                >
                  United States
                </button>
              </div>
              <div className="sl-price-number">
                <strong>{region === 'UK' ? '£49' : '$59'}</strong>
                <span>
                  / month, per location
                  <br />
                  <small>{region === 'UK' ? 'plus VAT' : 'plus applicable sales tax'}</small>
                </span>
              </div>
              <div className="sl-price-includes">
                <span>
                  <Check size={15} aria-hidden="true" /> 14 days free, no card needed
                </span>
                <span>
                  <Check size={15} aria-hidden="true" /> Your full studio, in one place
                </span>
                <span>
                  <Check size={15} aria-hidden="true" /> Month to month
                </span>
              </div>
              <Link className="sl-button sl-button-dark sl-price-button" to="/pricing">
                Explore the plan <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <small>Currently a local review build. Live subscriptions are not charged.</small>
            </div>
          </div>
        </section>

        <section className="sl-end" aria-labelledby="sl-end-title">
          <div className="sl-end-inner sl-container">
            <img
              className="sl-end-photo sl-end-photo-one"
              src="/images/library/details/tea-moment.webp"
              alt=""
              loading="lazy"
            />
            <img
              className="sl-end-photo sl-end-photo-two"
              src="/images/library/treatments/manicure.webp"
              alt=""
              loading="lazy"
            />
            <img
              className="sl-end-photo sl-end-photo-three"
              src="/images/library/rooms/hair-studio-daylight.webp"
              alt=""
              loading="lazy"
            />
            <span className="sl-kicker">YOUR NEXT CHAPTER STARTS HERE</span>
            <h2 id="sl-end-title">
              Make room for the work <em>you love.</em>
            </h2>
            <p>A more considered way to run your studio is taking shape. Come and see.</p>
            <div className="sl-end-buttons">
              <Link className="sl-button sl-button-dark" to="/account">
                Open your studio <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <Link className="sl-inline-link" to="/today">
                Explore the sample <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <span className="sl-end-monogram" aria-hidden="true">
              S
            </span>
          </div>
        </section>
      </main>

      <footer className="sl-footer">
        <div className="sl-container sl-footer-main">
          <div className="sl-footer-brand">
            <Link to="/" className="sl-logo">
              SALEANE<span className="sl-logo-period">.</span>
            </Link>
            <p>A considered way to run a remarkable business.</p>
          </div>
          <div className="sl-footer-links">
            <strong>Explore</strong>
            <a href="#why-saleane">Why SALEANE</a>
            <a href="#made-for">Who it is for</a>
            <a href="#inside-saleane">Features</a>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="sl-footer-links">
            <strong>Get started</strong>
            <Link to="/account">Your studio</Link>
            <Link to="/today">Sample studio</Link>
            <Link to="/design-language">Design language</Link>
          </div>
        </div>
        <div className="sl-container sl-footer-bottom">
          <span>© {new Date().getFullYear()} SALEANE</span>
          <span>Beauty, thoughtfully organised.</span>
          <span>UK &amp; USA · Local review version</span>
        </div>
      </footer>
    </div>
  )
}

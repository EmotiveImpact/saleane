import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, MapPin } from 'lucide-react'
import { photos } from '../design'
import '../booking.css'

/**
 * The guest booking page's frame: the studio photograph that stays in place while
 * the guest books, a feathered blur behind the welcome so it reads on any photo,
 * and, for the studio's own team only, a preview bar kept apart from the page.
 */
export function BookingFrame({
  studio,
  location,
  notice,
  pastWelcome,
  team,
  controls,
  summary,
  children,
}: {
  studio: string
  location: string
  /** An honest note about what the page does, such as test mode. Empty when there is none. */
  notice: string
  /** On phones the photo greets the guest on the first step only. */
  pastWelcome: boolean
  /** The viewer is the studio's own team, so the preview bar shows (never to guests). */
  team: boolean
  /** Extra preview controls, such as the demo market. */
  controls?: ReactNode
  /**
   * The guest's visit so far. On a wide screen it takes the welcome's place over the photograph
   * and stays in view; on a phone it is a bar that stays at the top of the page.
   */
  summary?: ReactNode
  children: ReactNode
}) {
  const [params] = useSearchParams()
  const asGuest = params.get('view') === 'guest'
  const showPreview = team && !asGuest
  const monogram = studio
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
  return (
    <div className={`public-booking ${showPreview ? 'has-preview' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to booking
      </a>
      {showPreview && (
        <section className="booking-preview-bar" aria-label="Studio preview">
          <span className="booking-preview-label">
            <Eye size={16} aria-hidden="true" />
            Your booking page, as guests see it
          </span>
          <div>
            {controls}
            <Link to="?view=guest">See it as a guest</Link>
            <Link to="/today">Back to workspace</Link>
          </div>
        </section>
      )}
      <div
        className={`public-booking-layout ${pastWelcome ? 'booking-past-welcome' : ''} ${summary ? 'has-summary' : ''}`}
      >
        <aside className="booking-story" aria-label={`Welcome to ${studio}`}>
          <img
            className="booking-story-image"
            src={photos.entrance}
            alt="A fictional studio entrance in soft morning light"
          />
          <div className="booking-brand">
            <span className="atelier-monogram" aria-hidden="true">
              {monogram}
            </span>
            <span>
              {studio}
              <small>Beauty & wellbeing</small>
            </span>
          </div>
          <div className="booking-story-card">
            <h1>
              <span>Care,</span> <span>considered.</span>
            </h1>
            <p>A little time, just for you. Thoughtful treatments, familiar faces.</p>
            <span className="story-location">
              <MapPin size={16} aria-hidden="true" />
              {location}
            </span>
          </div>
        </aside>
        {summary && <div className="booking-visit-slot">{summary}</div>}
        <main className="booking-main" id="main-content" tabIndex={-1} data-focus-fallback>
          {notice && <p className="booking-notice">{notice}</p>}
          {children}
        </main>
      </div>
      {asGuest && team && (
        <Link className="booking-exit-guest" to={{ search: '' }}>
          <ArrowLeft size={15} aria-hidden="true" />
          Leave guest view
        </Link>
      )}
    </div>
  )
}

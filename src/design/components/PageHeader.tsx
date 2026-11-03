import type { ReactNode } from 'react'
import { PhotoStrip } from './PhotoStrip'

/**
 * The one page top every staff page shares (docs/DESIGN_LANGUAGE.md, "Page tops"):
 *
 * 1. an eyebrow: the small capitalised label naming the part of SALEANE (Calendar, Clients,
 *    Business, Settings), or the date on a page that greets;
 * 2. the serif title, a short human line;
 * 3. one line of description saying what the page is for;
 * 4. the page's actions on the right (below the words on a phone), with one primary button.
 *
 * A page people arrive at (Clients, the waitlist, guest feedback, a professional's day, a
 * regional manager's area) leads with `photo`, one house photograph that fades into the words.
 * Dense working tools and forms (Calendar, Money, Stock, Settings) never carry it.
 *
 * `editorial` keeps the large serif greeting for moments of arrival. `compact` is for every
 * other page, where the content below needs the space.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  photo,
  variant = 'compact',
  headingLevel = 1,
}: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  /** A house photograph shown as a band above the heading, fading into it. */
  photo?: { src: string; position?: string }
  variant?: 'editorial' | 'compact'
  /** Only the design library changes this, to show headers as specimens. */
  headingLevel?: 1 | 2
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <>
      {photo && <PhotoStrip src={photo.src} position={photo.position} />}
      <div className={`page-heading page-heading-${variant}`}>
        <div>
          {eyebrow && (
            <p className={variant === 'editorial' ? 'date-caption' : 'eyebrow'}>{eyebrow}</p>
          )}
          <Heading>{title}</Heading>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </>
  )
}

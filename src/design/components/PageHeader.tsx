import type { ReactNode } from 'react'
import { PhotoStrip } from './PhotoStrip'

/**
 * The page title row every staff page shares: a small capitalised eyebrow naming the part of
 * SALEANE, the serif title, one line of description and the page's actions on the right. A
 * page that opens a part of the studio (Clients, the waitlist) can lead with a thin band of one
 * of the house photographs.
 *
 * `editorial` keeps the large serif greeting for moments of arrival (Today, guest booking,
 * accounts). `compact` is for working screens where the content below needs the space.
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
  /** A house photograph shown as a thin band above the heading. */
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

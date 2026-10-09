import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import './bookingSummary.css'

export type SummaryRow = {
  label: string
  value: ReactNode
  /** A quieter second line, such as an address or what a price includes. */
  detail?: ReactNode
}

/**
 * A guest's visit in one place: the treatment with its photograph, then who, where, when, the
 * price, the deposit and the cancellation rule. It only shows what it is given.
 *
 * As a panel it is the summary that stays with the guest through every step of booking: open
 * beside the steps on a wide screen, and on a phone a slim bar that opens to the full summary.
 * As a receipt it is the same summary, always open, once the visit is booked.
 */
export function BookingSummary({
  treatment,
  category,
  duration,
  photo,
  rows,
  glance,
  variant = 'panel',
  title = 'Your visit',
  headingLevel = 2,
}: {
  treatment: string
  category?: string
  /** How long the treatment takes, such as "60 minutes". */
  duration?: string
  photo?: { src: string; position: string }
  rows: SummaryRow[]
  /** A few words for the bar on a phone, such as "Wed 7 Oct, 10:00 · £95". */
  glance?: string
  variant?: 'panel' | 'receipt'
  title?: string
  headingLevel?: 2 | 3
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId(),
    titleId = useId()
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const thumb = photo ? (
    <span
      className="your-visit-photo"
      aria-hidden="true"
      style={{ backgroundImage: `url(${photo.src})`, backgroundPosition: photo.position }}
    />
  ) : null
  return (
    <section
      className={`your-visit your-visit-${variant}${open ? ' is-open' : ''}`}
      aria-labelledby={titleId}
    >
      {variant === 'panel' && (
        <button
          type="button"
          className="your-visit-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          {thumb}
          <span className="your-visit-glance">
            <strong>{treatment}</strong>
            {glance && <small>{glance}</small>}
          </span>
          <span className="your-visit-more">
            {open ? 'Hide' : 'Details'}
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </button>
      )}
      <div className="your-visit-body" id={bodyId}>
        <Heading className="your-visit-title" id={titleId}>
          {title}
        </Heading>
        <div className="your-visit-treatment">
          {thumb}
          <span>
            {category && <small>{category}</small>}
            <strong>{treatment}</strong>
            {duration && <span>{duration}</span>}
          </span>
        </div>
        <dl className="your-visit-rows">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                {row.value}
                {row.detail && <small>{row.detail}</small>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

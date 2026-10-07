import type { ReactNode } from 'react'

/**
 * Page title row. `editorial` keeps the large serif greeting for moments of
 * arrival (Today, guest booking, accounts). `compact` is for working screens
 * where the content below needs the space: one serif line, a short
 * description and the page's actions, in roughly a quarter of the height.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  variant = 'compact',
  headingLevel = 1,
}: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  variant?: 'editorial' | 'compact'
  /** Only the design library changes this, to show headers as specimens. */
  headingLevel?: 1 | 2
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
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
  )
}

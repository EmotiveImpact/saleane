import type { ReactNode } from 'react'
import { Definition } from './Definition'
import './stats.css'

/**
 * Headline figures as a row of white tiles: a label, the figure and, if useful, one quiet line
 * beneath. Every figure uses the same style as the Metric tiles on Today and the Business
 * overview (`.stat-figure`: Figtree, light, tabular digits). Money in a headline is whole pounds
 * (`wholeMoney`); receipts and tables keep the pence.
 */
export function Stats({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <dl className={`stats ${className}`}>{children}</dl>
}

export function Stat({
  label,
  value,
  detail,
  definition,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  /** How the figure is worked out, behind a small "i" beside the label. */
  definition?: ReactNode
}) {
  return (
    <div className="stat">
      <dt>
        {label}
        {definition && <Definition label={label}>{definition}</Definition>}
      </dt>
      <dd className="stat-figure">{value}</dd>
      {detail && <dd className="stat-detail">{detail}</dd>}
    </div>
  )
}

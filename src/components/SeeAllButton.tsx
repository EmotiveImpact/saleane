import { ChevronDown } from 'lucide-react'
import './seeAll.css'

/** "See all 5" under a shortened list, and "Show fewer" once it is open. */
export function SeeAllButton({
  list,
  all,
  hidden,
  total,
  toggle,
}: {
  /** The id of the list it opens. */
  list: string
  all: boolean
  hidden: number
  total: number
  toggle: () => void
}) {
  if (!hidden) return null
  return (
    <button
      type="button"
      className={`see-all ${all ? 'is-open' : ''}`}
      aria-expanded={all}
      aria-controls={list}
      onClick={toggle}
    >
      {all ? 'Show fewer' : `See all ${total}`}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
  )
}

import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useScrollEdges } from './useScrollEdges'
import './scrollNav.css'

/**
 * A row of section links that always stays on one line. When the row is wider than the screen it
 * scrolls sideways, fades softly at whichever edge has more to see, and brings the open section
 * (the link marked aria-current) into view. `current` is what changes when another section opens.
 */
export function ScrollNav({
  label,
  current,
  className = '',
  children,
}: {
  label: string
  current?: string
  className?: string
  children: ReactNode
}) {
  const track = useRef<HTMLDivElement>(null)
  const more = useScrollEdges(track)
  useLayoutEffect(() => {
    const row = track.current
    const open = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!row || !open) return
    // Centre the open section without moving the page itself.
    row.scrollLeft = Math.max(0, open.offsetLeft - (row.clientWidth - open.offsetWidth) / 2)
  }, [current])
  return (
    <nav
      className={`scroll-nav ${className}`}
      aria-label={label}
      data-more-before={more.before || undefined}
      data-more-after={more.after || undefined}
    >
      <div className="scroll-nav-track" ref={track}>
        {children}
      </div>
    </nav>
  )
}

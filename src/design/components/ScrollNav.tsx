import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  const [more, setMore] = useState({ before: false, after: false })
  useEffect(() => {
    const row = track.current
    if (!row) return
    const measure = () => {
      const before = row.scrollLeft > 1
      const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
      setMore((was) => (was.before === before && was.after === after ? was : { before, after }))
    }
    measure()
    row.addEventListener('scroll', measure, { passive: true })
    // The row's width changes with the window, and its contents once the fonts arrive.
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resized?.observe(row)
    for (const link of Array.from(row.children)) resized?.observe(link)
    window.addEventListener('resize', measure)
    return () => {
      row.removeEventListener('scroll', measure)
      resized?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
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

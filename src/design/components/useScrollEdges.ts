import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Whether a row that scrolls sideways has more to see before or after the part that is showing.
 * Pages use it to fade the edge with more, so people know the row carries on.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  const [more, setMore] = useState({ before: false, after: false })
  useEffect(() => {
    const row = ref.current
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
    for (const child of Array.from(row.children)) resized?.observe(child)
    window.addEventListener('resize', measure)
    return () => {
      row.removeEventListener('scroll', measure)
      resized?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return more
}

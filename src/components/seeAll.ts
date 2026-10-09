import { useState } from 'react'

/** The first few of a long list, with the rest a tap away (see SeeAllButton). */
export function useSeeAll<T>(items: T[], first = 2) {
  const [all, setAll] = useState(false)
  return {
    shown: all ? items : items.slice(0, first),
    all,
    hidden: Math.max(0, items.length - first),
    total: items.length,
    toggle: () => setAll((open) => !open),
  }
}

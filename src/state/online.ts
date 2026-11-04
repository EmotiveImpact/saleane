import { useEffect, useState } from 'react'
import { api } from './api'

let known: Promise<boolean> | undefined

/** Whether SALEANE answers at a public address rather than on this computer; asked once. */
export function runsOnline(): Promise<boolean> {
  known ??= api<{ localOnly?: boolean }>('/api/health').then(
    (health) => health.localOnly === false,
    () => {
      known = undefined
      return false
    },
  )
  return known
}

/** The same as a hook: false (this computer) until the answer comes. */
export function useRunsOnline() {
  const [online, setOnline] = useState(false)
  useEffect(() => {
    let active = true
    void runsOnline().then((value) => {
      if (active) setOnline(value)
    })
    return () => {
      active = false
    }
  }, [])
  return online
}

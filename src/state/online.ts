import { useEffect, useState } from 'react'
import { api } from './api'

let known: Promise<boolean> | undefined
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Whether SALEANE answers at a public address rather than on this computer; asked once. */
export function runsOnline(): Promise<boolean> {
  known ??= api<{ localOnly?: boolean }>('/api/health').then(
    (health) => health.localOnly === false,
    () => {
      known = undefined
      // While the server is being set up it cannot say, so the address in the browser decides.
      return !LOOPBACK.has(globalThis.location?.hostname ?? 'localhost')
    },
  )
  return known
}

/** A first guess before the server answers: any address other than this computer is online. */
export function seemsOnline() {
  return !LOOPBACK.has(globalThis.location?.hostname ?? 'localhost')
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

/** Hosting addresses that are not where people should be, and the one address that is. */
const MOVED: Record<string, string> = { 'saleane-app.vercel.app': 'https://saleane.vercel.app' }

/** Where to send a visitor who reached SALEANE by its hosting address, keeping the page. */
export function movedAddress(place: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>) {
  const home = MOVED[place.hostname]
  return home ? `${home}${place.pathname}${place.search}${place.hash}` : null
}

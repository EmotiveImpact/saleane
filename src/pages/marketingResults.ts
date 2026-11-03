import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { MarketingResults } from '../domain/marketing'

export type Results = MarketingResults & {
  mode: 'sandbox' | 'local'
  providers: { email: { live: boolean }; sms: { live: boolean } }
  /** NEXT-14: this month's marketing emails, used and included. A sample studio has none. */
  emails?: { used: number; limit: number }
}

/** What each campaign and automatic message did, from the server. Null until it answers. */
export function useMarketingResults() {
  const { state, mode } = useStore()
  const orgId = state.organisation.id
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode !== 'server') return
    let active = true
    api<Results>(`/api/workspaces/${encodeURIComponent(orgId)}/marketing`)
      .then((next) => {
        if (!active) return
        setResults(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The results could not be read.')
      })
    return () => {
      active = false
    }
  }, [mode, orgId, state.revision])
  return { results, error }
}

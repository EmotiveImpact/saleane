import { useEffect, useState } from 'react'
import { api } from '../state/api'
import { useStore } from '../state/context'

/**
 * NEXT-12: whether a real AI answers for this studio, as the server says. False in the browser
 * demo, in a sample studio and until SALEANE is given an AI supplier's key.
 */
export function useAiLive() {
  const { mode, slug, session } = useStore()
  const orgId = session?.workspaces.find((w) => w.slug === slug)?.id
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (mode !== 'server' || !orgId) return
    api<{ mode: 'live' | 'test' }>(`/api/workspaces/${encodeURIComponent(orgId)}/assistant`)
      .then((r) => setLive(r.mode === 'live'))
      .catch(() => {})
  }, [mode, orgId])
  return live
}

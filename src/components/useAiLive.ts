import { useEffect, useState } from 'react'
import { api } from '../state/api'
import { useStore } from '../state/context'

export type AiSupplierName = 'claude' | 'keiki'

/** Who reads questions and records once a real AI answers, said plainly for each supplier. */
export function aiReader(supplier?: AiSupplierName) {
  return supplier === 'keiki'
    ? { who: 'an AI model through Keiki, SALEANE’s AI supplier', where: 'Keiki' }
    : { who: 'Claude, an AI from Anthropic', where: 'Anthropic' }
}

/**
 * NEXT-12: whether a real AI answers for this studio, and which supplier, as the server says.
 * Not live in the browser demo, in a sample studio and until SALEANE is given a supplier's key.
 */
export function useAiStatus() {
  const { mode, slug, session } = useStore()
  const orgId = session?.workspaces.find((w) => w.slug === slug)?.id
  const [status, setStatus] = useState<{ live: boolean; supplier?: AiSupplierName }>({
    live: false,
  })
  useEffect(() => {
    if (mode !== 'server' || !orgId) return
    api<{ mode: 'live' | 'test'; supplier?: AiSupplierName }>(
      `/api/workspaces/${encodeURIComponent(orgId)}/assistant`,
    )
      .then((r) => setStatus({ live: r.mode === 'live', supplier: r.supplier }))
      .catch(() => {})
  }, [mode, orgId])
  return status
}

export function useAiLive() {
  return useAiStatus().live
}

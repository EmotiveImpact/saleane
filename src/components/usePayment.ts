import { useState } from 'react'
import { useStore } from '../state/context'
import { operations } from '../domain/operations'
import type { Command } from '../domain/commands'

/** Shared by the plan and gift card screens: hand-recorded payments and saving a command. */
export type Method = 'demo_card' | 'demo_cash' | 'cash' | 'external_card'

export function useRun() {
  const { commit } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command) {
    if (pending) return false
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      return result.ok
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error, setError }
}

export function usePayment() {
  const { state } = useStore()
  const sandbox = operations(state).mode === 'sandbox'
  const [method, setMethod] = useState<Method>(sandbox ? 'demo_card' : 'cash')
  const [reference, setReference] = useState('')
  const [collected, setCollected] = useState(false)
  return {
    fields: { method, setMethod, reference, setReference, collected, setCollected },
    ready: sandbox || collected,
    payment: { method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
    reset() {
      setReference('')
      setCollected(false)
    },
  }
}

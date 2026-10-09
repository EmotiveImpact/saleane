import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can, operations } from '../domain/operations'
import type { Holding } from '../domain/plansSchema'
import { dayMonth } from '../domain/planCards'

/**
 * Stage 1: what the server says about memberships paid from a saved card, and the requests that
 * change it. The screens are in PlanCards.tsx.
 */
export type PlanCharge = {
  id: string
  holdingId: string
  clientId: string
  kind: 'charge' | 'refund'
  periodStart: string
  amountMinor: number
  card: { brand: string; last4: string }
  try: number
  status: 'started' | 'processing' | 'succeeded' | 'failed' | 'unknown' | 'review'
  detail: string | null
  nextTryAt: string | null
  testMode: boolean
  createdAt: string
  updatedAt: string
}
export type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  createdAt: string
}
export type PlanCardsReply = {
  provider: { name: string; live: boolean }
  available: boolean
  held: boolean
  /** The studio is read only until its SALEANE bill is paid, so no card is tried meanwhile. */
  paused?: boolean
  cards: SavedCard[]
  charges: PlanCharge[]
}

export const planCardsBase = (orgId: string) =>
  `/api/workspaces/${encodeURIComponent(orgId)}/plan-cards`

/** Card payments for memberships, read from the server: one client's, or this month's. */
export function usePlanCards(clientId?: string) {
  const { mode, state, session, role } = useStore()
  const [reply, setReply] = useState<PlanCardsReply | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const orgId = state.organisation.id
  const available =
    mode === 'server' && !!session && operations(state).mode === 'local' && can(role, 'checkout')
  useEffect(() => {
    if (!available) return
    let active = true
    api<PlanCardsReply>(
      `${planCardsBase(orgId)}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
    )
      .then((next) => {
        if (!active) return
        setReply(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Card payments could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [orgId, clientId, available, state.revision, refresh])
  return { reply: available ? reply : null, error, load: () => setRefresh((n) => n + 1) }
}

/** Whether this person may set up or turn off card payments for this membership. */
export function useMayChange() {
  const { state, role, blocked, branch } = useStore()
  return (holding: Pick<Holding, 'locationId'>) =>
    !blocked &&
    can(role, 'plan-card') &&
    (role !== 'general' || (holding.locationId ?? state.organisation.locationId) === branch)
}

const TIMES = ['once', 'twice', 'three times', 'four times']

/** What the last try at the card, or refund to it, came to, in plain words. */
export function chargeWords(charge: PlanCharge, locale: string, day: (iso: string) => string) {
  const on = dayMonth(day(charge.createdAt), locale)
  if (charge.kind === 'refund')
    return {
      label:
        charge.status === 'succeeded'
          ? 'Returned to the card'
          : charge.status === 'failed'
            ? 'Refund not made'
            : charge.status === 'review'
              ? 'Refund needs review'
              : charge.status === 'unknown'
                ? 'Refund unclear'
                : 'Refund waiting for the provider',
      detail: charge.status === 'succeeded' ? `Returned on ${on}.` : (charge.detail ?? ''),
    }
  switch (charge.status) {
    case 'succeeded':
      return {
        label: 'Taken',
        detail: `Taken on ${on}.${charge.testMode ? ' Test payment, no money moved.' : ''}`,
      }
    case 'failed':
      if (charge.nextTryAt)
        return {
          label: `Declined, next try ${dayMonth(day(charge.nextTryAt), locale)}`,
          detail: `Declined on ${on}. SALEANE will try again on ${dayMonth(day(charge.nextTryAt), locale)}.`,
        }
      return charge.try >= TIMES.length
        ? {
            label: 'Stopped after four declines',
            detail: `Declined ${TIMES[TIMES.length - 1]}, so SALEANE stopped trying. The month stays unpaid until it is paid by hand.`,
          }
        : { label: 'Not taken, no more tries', detail: charge.detail ?? `Declined on ${on}.` }
    case 'unknown':
      return {
        label: 'Unclear',
        detail: `${charge.detail ?? 'The payment provider did not answer.'} Check again before doing anything else.`,
      }
    case 'review':
      return { label: 'Taken, needs review', detail: charge.detail ?? '' }
    default:
      return {
        label: 'Waiting for the provider',
        detail: 'The payment provider has not answered yet.',
      }
  }
}

/** Asks the provider again about an unclear answer, as the same request: it never charges twice. */
export function useCheckAgain(onDone: () => void) {
  const { state, reload } = useStore()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function check(id: string) {
    setBusy(id)
    setError('')
    try {
      await api<PlanCharge>(
        `${planCardsBase(state.organisation.id)}/charges/${encodeURIComponent(id)}/check`,
        {
          method: 'POST',
          body: {},
        },
      )
      await reload().catch(() => null)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment provider could not be asked again.')
    } finally {
      setBusy('')
    }
  }
  return { busy, error, check }
}

/**
 * Ending a membership whose current month the card paid: money returned goes back to that card
 * through the payment provider. The request keeps its key until the provider answers, so a second
 * click or a dropped connection never refunds twice.
 */
export function useCardEnd(holdingId: string, onDone: () => void) {
  const { state, reload } = useStore()
  // One key per membership, kept until the provider answers.
  const [slot, setSlot] = useState(() => ({ holdingId, key: crypto.randomUUID() }))
  const [settled, setCharge] = useState<PlanCharge | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const charge = settled?.holdingId === holdingId ? settled : null
  const settle = async (next: PlanCharge) => {
    setCharge(next)
    if (!['processing', 'unknown', 'started'].includes(next.status))
      setSlot({ holdingId, key: crypto.randomUUID() })
    if (next.status === 'succeeded') {
      await reload().catch(() => null)
      onDone()
    }
  }
  async function end(reason: string, refundMinor: number) {
    const key = slot.holdingId === holdingId ? slot.key : crypto.randomUUID()
    if (slot.holdingId !== holdingId) setSlot({ holdingId, key })
    setBusy(true)
    setError('')
    try {
      await settle(
        await api<PlanCharge>(
          `${planCardsBase(state.organisation.id)}/${encodeURIComponent(holdingId)}/end`,
          {
            method: 'POST',
            body: { reason, refundMinor },
            key,
          },
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The refund could not be started.')
    } finally {
      setBusy(false)
    }
  }
  async function check() {
    if (!charge) return
    setBusy(true)
    setError('')
    try {
      await settle(
        await api<PlanCharge>(
          `${planCardsBase(state.organisation.id)}/charges/${encodeURIComponent(charge.id)}/check`,
          { method: 'POST', body: {} },
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment provider could not be asked again.')
    } finally {
      setBusy(false)
    }
  }
  return { charge, busy, error, end, check }
}

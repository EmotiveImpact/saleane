import type { BusinessState } from './model'

/**
 * A payment or refund reference names one record wherever it was taken: visit payments, package
 * and membership payments, and gift cards share one set of references, as do their refunds.
 */
export function referenceTaken(s: BusinessState, reference?: string) {
  const ref = reference?.trim()
  return (
    !!ref &&
    (s.payments.some((p) => p.reference === ref) ||
      (s.holdings ?? []).some((h) => h.payments.some((p) => p.reference === ref)) ||
      (s.giftCards ?? []).some((c) => c.payment.reference === ref))
  )
}
/** Plan and gift card payments only: the ones visit payments do not already check. */
export function otherLedgerReference(s: BusinessState, reference?: string) {
  const ref = reference?.trim()
  return (
    !!ref &&
    ((s.holdings ?? []).some((h) => h.payments.some((p) => p.reference === ref)) ||
      (s.giftCards ?? []).some((c) => c.payment.reference === ref))
  )
}
export function refundReferenceTaken(s: BusinessState, reference: string) {
  const ref = reference.trim()
  return (
    (s.operations?.refunds ?? []).some((r) => r.reference === ref) ||
    (s.holdings ?? []).some((h) => h.refunds.some((r) => r.reference === ref)) ||
    (s.giftCards ?? []).some((c) => c.refunds.some((r) => r.reference === ref))
  )
}
/** Plan and gift card refunds only. */
export function otherLedgerRefund(s: BusinessState, reference: string) {
  const ref = reference.trim()
  return (
    (s.holdings ?? []).some((h) => h.refunds.some((r) => r.reference === ref)) ||
    (s.giftCards ?? []).some((c) => c.refunds.some((r) => r.reference === ref))
  )
}

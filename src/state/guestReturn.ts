// PILOT-02: bringing a guest back to their visit after the payment provider's page.

/** Survives the trip to the payment page, so the guest lands back on their own visit. */
export const RETURN_TOKEN = 'saleane-manage-token'

export function rememberToken(token: string) {
  try {
    sessionStorage.setItem(RETURN_TOKEN, token)
  } catch {
    /* Private windows may refuse storage; the guest then reopens their link. */
  }
}
export function returnedToken() {
  try {
    return sessionStorage.getItem(RETURN_TOKEN) ?? ''
  } catch {
    return ''
  }
}

const RETURN_NOTES: Record<string, string> = {
  done: 'Thank you. Your payment is being confirmed and will show here shortly.',
  cancelled: 'You left the payment page. Nothing was taken.',
  declined: 'The card was declined. Nothing was taken.',
}
export function returnNote(search: string) {
  return RETURN_NOTES[new URLSearchParams(search).get('payment') ?? ''] ?? ''
}

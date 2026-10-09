import { api } from './api'
import { rememberToken } from './guestReturn'

/**
 * PILOT-02: opens the payment provider's own page for a guest's deposit, or to save a card,
 * from their private visit link: the same start the guest's visit page uses. The token stays
 * in this tab, so the guest lands back on their own visit afterwards. In test mode the page is
 * SALEANE's labelled test page, where no card is asked for and no money moves.
 */
export async function startGuestPayment(
  token: string,
  purpose: 'deposit' | 'save_card',
  saveCard = false,
) {
  const { url } = await api<{ url: string }>('/api/guest/pay', {
    method: 'POST',
    body: { token, purpose, saveCard },
  })
  rememberToken(token)
  window.location.assign(url)
}

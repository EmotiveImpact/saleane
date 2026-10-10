import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { billingNotice } from '../domain/billing'
import './billingBanner.css'

/** NEXT-02: a quiet line above every screen when the SALEANE plan needs the owner, or is read only. */
export function BillingBanner({ onOpen }: { onOpen: () => void }) {
  const { billing, role, state } = useStore()
  const now = useClock()
  const notice = billingNotice(billing, role, state.organisation, Date.parse(now))
  if (!notice) return null
  return (
    <div
      className={`billing-banner is-${notice.tone}`}
      role={notice.tone === 'stopped' ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      {notice.action && (
        <button type="button" onClick={onOpen}>
          {notice.action}
        </button>
      )}
    </div>
  )
}

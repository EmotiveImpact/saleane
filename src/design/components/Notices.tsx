import { useSyncExternalStore } from 'react'
import { readNotices, subscribeNotices } from './notices'
import { Toast } from 'radix-ui'
import { X } from 'lucide-react'

/** Placed once, in the app's frame. Built on Radix Toast: F8 reaches them, a swipe clears one. */
export function Notices() {
  const shown = useSyncExternalStore(subscribeNotices, readNotices, readNotices)
  return (
    <Toast.Provider swipeDirection="right" duration={4500} label="Notices">
      {shown.map((notice) => (
        <Toast.Root
          key={notice.id}
          className={`notice notice-${notice.tone}`}
          type={notice.tone === 'problem' ? 'foreground' : 'background'}
        >
          <Toast.Description className="notice-text">{notice.text}</Toast.Description>
          <Toast.Close className="notice-close" aria-label="Dismiss">
            <X size={16} aria-hidden="true" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className="notices" />
    </Toast.Provider>
  )
}

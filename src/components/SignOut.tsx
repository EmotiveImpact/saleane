import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useStore } from '../state/context'
import './signOut.css'

/**
 * Sign out from a practitioner's day or a regional manager's area, as from the account page: the
 * day sheet leaves this tab, the session ends and the sign-in page opens. On a phone only the icon
 * shows; its name is still read out.
 */
export function SignOut({ onError }: { onError: (message: string) => void }) {
  const store = useStore()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      className="button button-secondary sign-out"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        onError('')
        try {
          await store.logout()
          navigate('/account', { replace: true })
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Sign out could not be confirmed.')
          setPending(false)
        }
      }}
    >
      <LogOut size={16} aria-hidden="true" />
      <span className="sign-out-label">{pending ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
}

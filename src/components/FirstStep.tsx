import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { setupFinished, setupPlace } from '../domain/setup'

/**
 * The one next step on a new studio's welcome. The owner who has not finished setting up is taken
 * back to the setup screens, where they left off; everyone else gets the page's own next step.
 */
export function FirstStep({ to, children }: { to?: string; children?: string }) {
  const { state, role } = useStore()
  if (role === 'owner' && !setupFinished(state))
    return (
      <Link className="button button-primary" to="/setup">
        {setupPlace(state) ? 'Pick up where you left off' : 'Set up step by step'}
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    )
  if (!to || !children) return null
  return (
    <Link className="button button-primary" to={to}>
      {children}
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  )
}

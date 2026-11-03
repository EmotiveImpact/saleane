import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useStore } from '../state/context'
import { roleNames } from '../domain/operations'
import { PageHeader } from '../design'
import { PreferencesSection } from '../components/SettingsSections'
import { YourSignIn } from '../components/YourSignIn'
import '../components/management.css'

/**
 * You: what is one person's own, never the studio's. How SALEANE looks for them and how they sign
 * in. It opens from their name at the top, for every role, so nobody looks for their own password
 * in the studio's Settings.
 */
export function You() {
  const { session, role, mode } = useStore()
  const name = session?.user.name ?? 'Demo operator'
  const { hash } = useLocation()
  // "Password, two-step and Face ID" opens this page at Signing in.
  useEffect(() => {
    if (hash === '#signing-in')
      document.getElementById('signing-in')?.scrollIntoView({ block: 'start' })
  }, [hash])
  return (
    <div className="manage-page you-page">
      <PageHeader
        variant="compact"
        eyebrow="You"
        title="Yours alone."
        description={`${name}, ${(roleNames[role] ?? role).toLowerCase()}. Nothing here changes the studio or anyone else.`}
      />
      <div className="you-layout">
        <PreferencesSection />
        <YourSignIn signedIn={mode === 'server'} />
        {mode === 'server' && (
          <section className="surface ops-panel">
            <header>
              <div>
                <h2>Your accounts and studios</h2>
                <p>Every studio you can open, and the email you sign in with.</p>
              </div>
              <UserRound size={21} aria-hidden="true" />
            </header>
            <Link className="button button-secondary" to="/account">
              Open your accounts
            </Link>
          </section>
        )}
      </div>
    </div>
  )
}

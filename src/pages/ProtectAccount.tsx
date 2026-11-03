import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, ErrorMessage } from '../design'
import { photos } from '../design/photos'
import { TwoStepSettings } from '../components/TwoStepSettings'
import '../account.css'
import '../components/accessPanel.css'
import './protectAccount.css'

/**
 * Stage 6: "Protect your account". A studio that asks everyone to use two-step sign-in refuses
 * everyone in it who has not set it up (server/context.ts, `orgFor`), and the app shows this in
 * place of every studio page until they have. One job: set it up, then open the studio. Signing
 * out and choosing another studio stay in reach; nothing else of the studio is shown.
 */
export function ProtectAccount() {
  const store = useStore()
  const navigate = useNavigate()
  const hold = store.hold!
  const session = store.session
  const studio = session?.workspaces.find((w) => w.id === hold.workspaceId)
  const name = studio?.name ?? 'Your studio'
  const others = (session?.workspaces ?? []).filter((w) => w.id !== hold.workspaceId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
    // Who they are and which studios ask, read afresh: the session may be from before the switch.
    void store.refreshSession().catch(() => {})
    // Once per hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold.workspaceId])
  const on = !!session?.user.twoStep

  /** Opens the studio that asked, each role at its own page. */
  async function proceed() {
    setPending(true)
    setError('')
    try {
      const current = await store.refreshSession()
      const role = current?.workspaces.find((w) => w.id === hold.workspaceId)?.role
      const id = encodeURIComponent(hold.workspaceId)
      if (!role) {
        store.releaseHold?.()
        navigate('/account', { replace: true })
      } else if (role === 'practitioner' || role === 'regional') {
        store.releaseHold?.()
        navigate(role === 'practitioner' ? `/practice/${id}` : `/area/${id}`, { replace: true })
      } else {
        // A refusal while opening sets the hold again, so it is released only once open.
        await store.openWorkspace(hold.workspaceId)
        store.releaseHold?.()
        navigate('/today', { replace: true })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${name} could not be opened.`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="account-layout protect-layout">
      <aside className="account-story">
        <span className="wordmark">SALEANE</span>
        <div>
          <span className="eyebrow">{name}</span>
          <p className="account-story-title">
            Guests trust
            <br />
            you with
            <br />
            their details.
          </p>
          <p>A code from your phone keeps them safe, even if a password is ever guessed.</p>
        </div>
        <img src={photos.windowLight} alt="" />
      </aside>
      {/* `settle` arrives with the calm motion of the quality bar once it is in the library. */}
      <main className="account-main protect-main settle" aria-labelledby="protect-title">
        <p className="date-caption">Before you open {name}</p>
        <h1 id="protect-title" ref={heading} tabIndex={-1}>
          Protect your account
        </h1>
        <p className="account-intro">
          {on
            ? `Two-step sign-in is on for ${session?.user.email ?? 'your account'}. You can open ${name} now.`
            : `${name} asks everyone to use two-step sign-in. Once it is set up, signing in asks for a code from your phone as well as your password, and ${name} opens straight away.`}
        </p>
        {on ? (
          <div className="protect-open">
            <Button disabled={pending} onClick={() => void proceed()}>
              {pending ? 'Opening…' : `Open ${name}`}
              {!pending && <ArrowRight size={17} />}
            </Button>
          </div>
        ) : (
          <TwoStepSettings plain onDone={() => void proceed()} />
        )}
        <ErrorMessage error={error} />
        <div className="account-actions protect-actions">
          {others.length > 0 && (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                store.releaseHold?.()
                navigate('/account')
              }}
            >
              Choose another studio
            </Button>
          )}
          <Button
            variant="quiet"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              try {
                await store.logout()
                navigate('/account', { replace: true })
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Sign out could not be confirmed.')
                setPending(false)
              }
            }}
          >
            Sign out
          </Button>
        </div>
      </main>
    </div>
  )
}

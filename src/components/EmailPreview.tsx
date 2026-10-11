import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage, Modal, SegmentedControl } from '../design'
import { lookKinds, sampleKindLabel } from '../email/samples'
import type { SampleKind } from '../email/samples'

/** NEXT-13: an email as the server made it. */
type Designed = { subject: string; html: string }

/**
 * An email shown as a guest sees it. The frame runs no scripts; a link in it opens in a new tab,
 * and the button to manage a visit goes nowhere, as no private link is made for a look.
 */
export function EmailFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(560)
  const fit = () => {
    const body = frame.current?.contentDocument?.body
    if (body) setHeight(Math.max(200, Math.ceil(body.scrollHeight)))
  }
  useEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    // The email wraps differently on a narrower screen, so it is measured again.
    const watch = new ResizeObserver(() => fit())
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  return (
    <iframe
      ref={frame}
      className="email-frame"
      title={title}
      srcDoc={html.replace('<head>', '<head><base target="_blank">')}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={fit}
      style={{ height }}
    />
  )
}

/** Settings, Messages: the studio's emails before any guest gets one. */
export function EmailLook() {
  const { mode, session, state, role } = useStore()
  const [kind, setKind] = useState<SampleKind>('confirmation')
  const [shown, setShown] = useState<{ kind: SampleKind; email: Designed } | null>(null)
  const [error, setError] = useState('')
  const orgId = state.organisation.id
  const available = mode === 'server' && !!session && role !== 'practitioner'
  useEffect(() => {
    if (!available) return
    let active = true
    api<Designed>(`/api/workspaces/${encodeURIComponent(orgId)}/outbox/sample?kind=${kind}`)
      .then((email) => {
        if (!active) return
        setShown({ kind, email })
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The email could not be shown.')
      })
    return () => {
      active = false
    }
  }, [available, orgId, kind, state.revision])
  if (!available) return null
  return (
    <section className="surface ops-panel settings-panel" aria-labelledby="email-look-title">
      <header>
        <div>
          <h2 id="email-look-title">How your emails look</h2>
          <p>
            Every email goes in your studio&rsquo;s colours, with the same words as the plain
            version some email apps show instead.
          </p>
        </div>
        <Mail size={21} />
      </header>
      <div className="settings-body email-look">
        <SegmentedControl
          label="Which email"
          value={kind}
          onChange={setKind}
          appearance="chips"
          options={lookKinds.map((value) => ({ value, label: sampleKindLabel[value] }))}
        />
        <ErrorMessage error={error} />
        {shown ? (
          <EmailFrame
            html={shown.email.html}
            title={`The ${sampleKindLabel[shown.kind].toLowerCase()} email, as a guest sees it`}
          />
        ) : (
          !error && <p className="subtle">Loading…</p>
        )}
        <p className="subtle">
          Written for a made-up guest, Alex, booked tomorrow at 10:00. In a real email the button to
          manage the visit opens that guest&rsquo;s own private link; here it goes nowhere. Your
          colours are in Settings, Booking page &amp; colours.
        </p>
      </div>
    </section>
  )
}

/** The Sent list: one email as the guest sees it, in the studio's colours today. */
export function SentEmail({ id }: { id: string }) {
  const { state } = useStore()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<Designed | null>(null)
  const [error, setError] = useState('')
  const orgId = state.organisation.id
  useEffect(() => {
    if (!open) return
    let active = true
    api<Designed>(
      `/api/workspaces/${encodeURIComponent(orgId)}/outbox/${encodeURIComponent(id)}/email`,
    )
      .then((next) => {
        if (active) setEmail(next)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'The email could not be shown.')
      })
    return () => {
      active = false
    }
  }, [open, orgId, id])
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Mail size={15} />
        See the email
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={email?.subject ?? 'The email'}
        description="As the guest sees it, in your studio's colours today. The button to manage the visit goes nowhere here."
        wide
      >
        <ErrorMessage error={error} />
        {email ? (
          <EmailFrame
            html={email.html}
            title={`The email, ${email.subject}, as the guest sees it`}
          />
        ) : (
          !error && <p className="subtle">Loading…</p>
        )}
      </Modal>
    </>
  )
}

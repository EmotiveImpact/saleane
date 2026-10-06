import { useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { Button, ErrorMessage } from './ui'
import '../guest.css'

/**
 * LOCAL-02: lets the desk give a guest a private link to view or cancel one visit. Creating a
 * link stops any earlier one; nothing is sent, so the desk shares it by hand.
 */
export function GuestLinkPanel({ appointmentId }: { appointmentId: string }) {
  const { state, role } = useStore()
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!['owner', 'manager', 'reception'].includes(role)) return null
  const path = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/guest-links`
  async function act(revoke: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (revoke) {
        await api(`${path}/revoke`, { method: 'POST', body: { appointmentId } })
        setUrl('')
        setNotice('Every manage link for this visit has stopped working.')
      } else {
        const link = await api<{ url: string }>(path, { method: 'POST', body: { appointmentId } })
        setUrl(link.url)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The guest link could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="guest-link-panel">
      <strong>Guest manage link</strong>
      {url ? (
        <>
          <label htmlFor={`guest-link-${appointmentId}`}>Private link for this visit</label>
          <input
            id={`guest-link-${appointmentId}`}
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <small>Not sent. Share it with the guest yourself; any earlier link has stopped.</small>
        </>
      ) : (
        <small>The guest can view this visit and cancel it under the 24-hour deposit policy.</small>
      )}
      {notice && <small role="status">{notice}</small>}
      <ErrorMessage error={error} />
      <div className="guest-link-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void act(false)}>
          {url ? 'Create a new link' : 'Create link'}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void act(true)}>
          Stop all links
        </Button>
      </div>
    </div>
  )
}

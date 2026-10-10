import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Lock } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { StudioExport } from '../domain/privacy'
import { PlanBilling } from '../components/PlanBilling'
import { Button, ErrorMessage } from '../design'
import './lockedStudio.css'

function save(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * NEXT-02: a studio that stayed unpaid 30 days after the last day paid for is locked. Only the
 * owner reaches this page (the server refuses everyone else); from here they can pay, which opens
 * the studio again for everyone, or download the studio's records. Nothing has been deleted.
 */
export function LockedStudio() {
  const { state, billing } = useStore()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const name = state.organisation.name
  const why =
    billing?.stopReason === 'trial_ended'
      ? 'The free trial ended without a card'
      : billing?.stopReason === 'cancelled'
        ? 'The SALEANE plan stopped'
        : 'The SALEANE bill is unpaid'

  async function download() {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const { export: file } = await api<{ export: StudioExport }>(
        `/api/workspaces/${encodeURIComponent(state.organisation.id)}/privacy/studio/export`,
        { method: 'POST', body: {} },
      )
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'studio'
      save(`${slug}-studio-export.json`, JSON.stringify(file, null, 2))
      setDone('Downloaded. This export is recorded in the studio’s audit log.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The records could not be downloaded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="locked-studio" id="main-content">
      <span className="wordmark">SALEANE</span>
      <section className="locked-intro" aria-labelledby="locked-title">
        <p className="date-caption">
          <Lock size={16} aria-hidden="true" />
          Locked
        </p>
        <h1 id="locked-title">{name} is locked</h1>
        <p>
          {why}, so the studio is locked. Your team cannot open it, and online booking is closed;
          bookings already made still stand. Nothing has been deleted. Pay below to open it again
          for everyone.
        </p>
        <div className="locked-actions">
          <Button variant="secondary" disabled={busy} onClick={() => void download()}>
            <Download size={16} aria-hidden="true" />
            {busy ? 'Preparing…' : 'Download the studio’s records'}
          </Button>
          <Button variant="quiet" onClick={() => navigate('/account')}>
            Switch studio or sign out
          </Button>
        </div>
        {done && <p role="status">{done}</p>}
        <ErrorMessage error={error} />
      </section>
      <PlanBilling />
    </main>
  )
}

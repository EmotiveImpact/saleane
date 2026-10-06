import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, RotateCcw } from 'lucide-react'
import { useStore } from '../state/context'
import { storageKey } from '../state/storage'
import { Button, ErrorMessage, Modal } from '../design'

export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { state, reset, region, changeRegion, mode, role, reload, enterDemo } = useStore()
  const [confirmReset, setConfirmReset] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('')
  function download() {
    let saved = JSON.stringify(state, null, 2)
    if (mode === 'demo')
      try {
        saved = localStorage.getItem(storageKey(region)) ?? saved
      } catch {
        /* Export the readable snapshot. */
      }
    const url = URL.createObjectURL(new Blob([saved], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `saleane-${mode}-${region}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'demo' ? 'Your demo workspace' : state.organisation.name}
      description="SALEANE 1.0 release candidate · built for local review."
    >
      <div className="settings-body">
        <Link className="button button-primary" onClick={onClose} to="/account">
          {mode === 'demo' ? 'Create or open a local account' : 'Your accounts and studios'}
        </Link>
        {mode === 'demo' ? (
          <>
            <label>
              Demo market
              <select
                value={region}
                onChange={(e) => changeRegion(e.target.value as typeof region)}
              >
                <option value="UK">United Kingdom · GBP · Europe/London</option>
                <option value="US">United States · USD · America/New_York</option>
              </select>
            </label>
            <p>
              These are separate fictional browser workspaces. Changing market does not convert
              prices or transfer records.
            </p>
          </>
        ) : (
          <>
            <p>
              Accounts and studio records are saved on this computer’s local server. Your access:{' '}
              {role}. Live payment and email providers remain unconfigured.
            </p>
            <Link className="button button-secondary" onClick={onClose} to="/business/manage">
              Manage your studio
            </Link>
          </>
        )}
        <p>
          This is a local release candidate. Use fictional client details while reviewing. Hosted
          operations, payment settlement and message delivery are later release gates.
        </p>
        {(mode === 'demo' || role === 'owner' || role === 'manager') && (
          <Button variant="secondary" onClick={download}>
            <Download size={16} />
            Export workspace snapshot
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={pending}
          onClick={async () => {
            setPending(true)
            setError('')
            try {
              await reload()
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Records could not be refreshed.')
            } finally {
              setPending(false)
            }
          }}
        >
          Reload saved records
        </Button>
        <ErrorMessage error={error} />
        <div className="detail-divider" />
        {mode === 'server' ? (
          <Button
            variant="quiet"
            onClick={() => {
              enterDemo()
              onClose()
            }}
          >
            Explore the fictional browser demo
          </Button>
        ) : confirmReset ? (
          <>
            <p role="alert">
              Resetting replaces this {region} demo’s saved records. Export first to keep them.
            </p>
            <div className="dialog-footer">
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>
                Keep my changes
              </Button>
              <Button
                onClick={() => {
                  reset()
                  onClose()
                }}
              >
                Reset this demo
              </Button>
            </div>
          </>
        ) : (
          <Button variant="quiet" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} />
            Reset demo data
          </Button>
        )}
      </div>
    </Modal>
  )
}

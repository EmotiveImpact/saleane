import { useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { useStore } from '../state/context'
import { storageKey } from '../state/storage'
import { Button, Modal } from './ui'

export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { state, reset, region, changeRegion } = useStore()
  const [confirmReset, setConfirmReset] = useState(false)
  function download() {
    let saved = JSON.stringify(state, null, 2)
    try {
      saved = localStorage.getItem(storageKey(region)) ?? saved
    } catch {
      /* The current readable snapshot is still exportable. */
    }
    const blob = new Blob([saved], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `saleane-demo-${region}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Your demo workspace"
      description="SALEANE Foundation v0.2.0 · fictional data, saved on this browser."
    >
      <div className="settings-body">
        <label>
          Market
          <select value={region} onChange={(e) => changeRegion(e.target.value as typeof region)}>
            <option value="UK">United Kingdom · GBP · Europe/London</option>
            <option value="US">United States · USD · America/New_York</option>
          </select>
        </label>
        <p>
          These are separate fictional workspaces. Changing market doesn’t convert prices or
          transfer client records.
        </p>
        <p>
          Bookings, deposits and checkout are simulated. No authentication, server, payment
          provider, messaging provider or AI service is connected. Use fictional client details
          only.
        </p>
        <Button variant="secondary" onClick={download}>
          <Download size={16} />
          Export saved demo data
        </Button>
        <div className="detail-divider" />
        {confirmReset ? (
          <>
            <p role="alert">
              Resetting replaces this {region} demo’s saved records. Export them first if you want
              to keep them.
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

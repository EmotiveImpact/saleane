import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, RotateCcw } from 'lucide-react'
import { useStore } from '../state/context'
import { storageKey } from '../state/storage'
import { Button, ErrorMessage, Modal } from '../design'
import { firstColours, readColours, saveColours, secondColours } from '../state/studioColours'
import type { StudioColours } from '../state/studioColours'
import { readInboxView, saveInboxView } from '../state/inboxView'
import type { InboxView } from '../state/inboxView'

function ColourChoice({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: readonly { name: string; value: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="colour-choice">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.value} className="colour-swatch">
            <input
              type="radio"
              name={legend}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span style={{ background: option.value }} aria-hidden="true" />
            {option.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { state, reset, region, changeRegion, mode, role, reload, enterDemo, session } = useStore()
  const [confirmReset, setConfirmReset] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [colours, setColours] = useState(() => readColours(state.organisation.id)),
    [inboxView, setInboxView] = useState(() => readInboxView(session?.user.id))
  const canStyle = mode === 'demo' || role === 'owner' || role === 'manager'
  function choose(next: StudioColours) {
    setColours(next)
    saveColours(state.organisation.id, next)
  }
  function chooseInboxView(next: InboxView) {
    setInboxView(next)
    saveInboxView(session?.user.id, next)
  }
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
              {role}. Card payments and email sending are not connected yet.
            </p>
            <Link className="button button-secondary" onClick={onClose} to="/business/manage">
              Manage your studio
            </Link>
          </>
        )}
        {canStyle && (
          <section className="studio-colours" aria-labelledby="studio-colours-title">
            <h3 id="studio-colours-title">Studio colours</h3>
            <p>
              Your first colour leads buttons and selections. Your second marks the now line and
              clients ready to return. Saved in this browser for now.
            </p>
            <ColourChoice
              legend="First colour"
              options={firstColours}
              value={colours.first}
              onChange={(first) => choose({ ...colours, first })}
            />
            <ColourChoice
              legend="Second colour"
              options={secondColours}
              value={colours.second}
              onChange={(second) => choose({ ...colours, second })}
            />
          </section>
        )}
        <section className="studio-colours" aria-labelledby="inbox-view-title">
          <h3 id="inbox-view-title">Inbox layout</h3>
          <p>Your own choice, saved in this browser.</p>
          <fieldset className="colour-choice layout-choice">
            <legend className="sr-only">Inbox layout</legend>
            <div>
              {(
                [
                  ['columns', 'Two columns, like email'],
                  ['panel', 'List with a side panel'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="colour-swatch">
                  <input
                    type="radio"
                    name="inbox-view"
                    value={value}
                    checked={inboxView === value}
                    onChange={() => chooseInboxView(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
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

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Palette, RotateCcw, SlidersHorizontal, Store } from 'lucide-react'
import { useStore } from '../state/context'
import { storageKey } from '../state/storage'
import { Button, ErrorMessage } from '../design'
import { firstColours, readColours, saveColours, secondColours } from '../state/studioColours'
import type { StudioColours } from '../state/studioColours'
import { readInboxView, saveInboxView } from '../state/inboxView'
import type { InboxView } from '../state/inboxView'

/**
 * The parts of Settings that are not studio records: each person's own
 * preferences, the studio's colours and this workspace's local controls.
 */

function Choice<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string
  name: string
  options: readonly { label: string; value: T; swatch?: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <fieldset className={`colour-choice ${options[0]?.swatch ? '' : 'layout-choice'}`}>
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.value} className="colour-swatch">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            {option.swatch && <span style={{ background: option.swatch }} aria-hidden="true" />}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function PreferencesSection() {
  const { session } = useStore()
  const [inboxView, setInboxView] = useState(() => readInboxView(session?.user.id))
  function choose(next: InboxView) {
    setInboxView(next)
    saveInboxView(session?.user.id, next)
  }
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Your preferences</h2>
          <p>How SALEANE looks for you. Saved in this browser, and nobody else is affected.</p>
        </div>
        <SlidersHorizontal size={21} />
      </header>
      <Choice
        legend="Inbox layout"
        name="inbox-view"
        value={inboxView}
        onChange={choose}
        options={[
          { value: 'columns', label: 'Two columns, like email' },
          { value: 'panel', label: 'List with a side panel' },
        ]}
      />
    </section>
  )
}

export function BrandSection() {
  const { state, mode, role } = useStore()
  const [colours, setColours] = useState(() => readColours(state.organisation.id))
  const canStyle = mode === 'demo' || role === 'owner' || role === 'manager'
  function choose(next: StudioColours) {
    setColours(next)
    saveColours(state.organisation.id, next)
  }
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Studio colours</h2>
          <p>
            Your first colour leads buttons and selections. Your second marks the now line and
            clients ready to return. Saved in this browser for now, so guests and other devices see
            the house colours until studio settings are stored on the server.
          </p>
        </div>
        <Palette size={21} />
      </header>
      <Choice
        legend="First colour"
        name="first-colour"
        value={colours.first}
        disabled={!canStyle}
        onChange={(first) => choose({ ...colours, first })}
        options={firstColours.map((c) => ({ value: c.value, label: c.name, swatch: c.value }))}
      />
      <Choice
        legend="Second colour"
        name="second-colour"
        value={colours.second}
        disabled={!canStyle}
        onChange={(second) => choose({ ...colours, second })}
        options={secondColours.map((c) => ({ value: c.value, label: c.name, swatch: c.value }))}
      />
      {!canStyle && <p className="ops-help">Only owners and managers can change the colours.</p>}
      <div className="settings-booking-link">
        <img src="/images/saleane-studio-warm-small.jpg" alt="" />
        <div>
          <strong>Your booking page</strong>
          <p>See how guests meet your studio, in its colours.</p>
        </div>
        <Link className="button button-secondary" to="/booking">
          Preview
        </Link>
      </div>
    </section>
  )
}

export function WorkspaceSection() {
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
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>{mode === 'demo' ? 'Your demo workspace' : 'This workspace'}</h2>
          <p>SALEANE 1.0 release candidate, built for local review.</p>
        </div>
        <Store size={21} />
      </header>
      <div className="settings-body">
        <Link className="button button-primary" to="/account">
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
          <p>
            Accounts and studio records are saved on this computer’s local server. Your access:{' '}
            {role}. Card payments and email sending are not connected yet.
          </p>
        )}
        <p>
          This is a local release candidate. Use fictional client details while reviewing. Hosted
          operations, payment settlement and message delivery are later release gates.
        </p>
        <div className="settings-actions">
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
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Records could not be refreshed.')
              } finally {
                setPending(false)
              }
            }}
          >
            Reload saved records
          </Button>
        </div>
        <ErrorMessage error={error} />
        <div className="detail-divider" />
        {mode === 'server' ? (
          <Button variant="quiet" onClick={enterDemo}>
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
                  setConfirmReset(false)
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
    </section>
  )
}

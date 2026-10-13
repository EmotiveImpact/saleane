import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Palette, Play, RotateCcw, SlidersHorizontal, Store } from 'lucide-react'
import { useStore } from '../state/context'
import { storageKey } from '../state/storage'
import { Button, ErrorMessage, MoreOptions, Select, photos } from '../design'
import { coloursFor, firstColours, saveColours, secondColours } from '../state/studioColours'
import type { StudioColours } from '../state/studioColours'
import type { StudioLook } from '../domain/brandRulesSchema'
import { can, operations } from '../domain/operations'
import { readInboxView, saveInboxView } from '../state/inboxView'
import type { InboxView } from '../state/inboxView'
import { setWelcomeOff, watchWelcome, welcomeOff } from '../state/welcomeMemory'
import { WELCOME_NAMES, WELCOME_SCENES } from '../domain/welcomeScene'

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
  const [welcome, setWelcome] = useState<'on' | 'off'>(() =>
    welcomeOff(session?.user.id) ? 'off' : 'on',
  )
  function choose(next: InboxView) {
    setInboxView(next)
    saveInboxView(session?.user.id, next)
  }
  function chooseWelcome(next: 'on' | 'off') {
    setWelcome(next)
    setWelcomeOff(session?.user.id, next === 'off')
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
      <Choice
        legend="Welcome when SALEANE opens"
        name="welcome"
        value={welcome}
        onChange={chooseWelcome}
        options={[
          { value: 'on', label: 'Play it' },
          { value: 'off', label: 'Open straight to the studio' },
        ]}
      />
      <MoreOptions label="Watch a welcome again">
        <div className="welcome-watch">
          <p>
            A short film greets you as SALEANE opens: one for the first open of the day, coming back
            later, closing up, your very first sign in and the studio’s birthday. Watch any of them
            now with today’s visits.
          </p>
          <div>
            {WELCOME_SCENES.map((scene) => (
              <Button key={scene} variant="secondary" onClick={() => watchWelcome(scene)}>
                <Play size={15} aria-hidden="true" />
                {WELCOME_NAMES[scene]}
              </Button>
            ))}
          </div>
        </div>
      </MoreOptions>
    </section>
  )
}

export function BrandSection() {
  const { state, role, blocked, commit } = useStore()
  const look = operations(state).look
  const [colours, setColours] = useState(() => coloursFor(state.organisation.id, look))
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const canStyle = !blocked && can(role, 'studio-look')
  // V5: kept with the studio, so every location, device and guest sees the same colours.
  async function choose(next: StudioColours) {
    if (pending) return
    const before = colours
    setColours(next)
    setError('')
    setPending(true)
    try {
      const result = await commit({ type: 'studio-look', look: next as StudioLook })
      if (result.ok) saveColours(state.organisation.id, next)
      else {
        setColours(before)
        setError(result.error)
      }
    } catch {
      setColours(before)
      setError('Could not save the colours. Try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Studio colours</h2>
          <p>
            Your first colour leads buttons and selections. Your second marks the now line and
            clients ready to return. They are kept with the studio, so every location, every device
            and your booking page show the same colours.
          </p>
        </div>
        <Palette size={21} />
      </header>
      <Choice
        legend="First colour"
        name="first-colour"
        value={colours.first}
        disabled={!canStyle || pending}
        onChange={(first) => void choose({ ...colours, first })}
        options={firstColours.map((c) => ({ value: c.value, label: c.name, swatch: c.value }))}
      />
      <Choice
        legend="Second colour"
        name="second-colour"
        value={colours.second}
        disabled={!canStyle || pending}
        onChange={(second) => void choose({ ...colours, second })}
        options={secondColours.map((c) => ({ value: c.value, label: c.name, swatch: c.value }))}
      />
      <ErrorMessage error={error} />
      {!canStyle && <p className="ops-help">Only owners and managers can change the colours.</p>}
      <div className="settings-booking-link">
        <img src={photos.bookingPage} alt="" />
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

const roleName: Record<string, string> = {
  regional: 'regional manager',
  general: 'general manager',
}

export function WorkspaceSection({ onReset }: { onReset?: () => void } = {}) {
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
          <h2>About this version</h2>
          <p>
            SALEANE 1.0 preview, running {mode === 'demo' ? 'in this browser' : 'on this computer'}.
          </p>
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
              <Select
                value={region}
                onChange={(e) => changeRegion(e.target.value as typeof region)}
              >
                <option value="UK">United Kingdom · GBP · Europe/London</option>
                <option value="US">United States · USD · America/New_York</option>
              </Select>
            </label>
            <p>
              Each market is its own made-up studio. Changing market does not convert prices or move
              records.
            </p>
          </>
        ) : (
          <p>
            Accounts and studio records are saved on this computer. Your access:{' '}
            {roleName[role] ?? role}. Card payments and email sending are not connected yet.
          </p>
        )}
        <p>
          This is a preview. Use made-up client details while you try it. Real card payments and
          real messages come once those accounts are connected.
        </p>
        <div className="settings-actions">
          {(mode === 'demo' || role === 'owner' || role === 'manager') && (
            <Button variant="secondary" onClick={download}>
              <Download size={16} />
              Download a copy of the records
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
                  onReset?.()
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

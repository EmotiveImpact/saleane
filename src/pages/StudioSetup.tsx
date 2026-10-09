import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Copy, FlaskConical, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import type { BusinessState, Service } from '../domain/model'
import type { StudioLook } from '../domain/brandRulesSchema'
import { firstColours, secondColours } from '../domain/brandRulesSchema'
import { operations } from '../domain/operations'
import { money } from '../domain/format'
import { parseMinor } from '../domain/money'
import { bookable } from '../domain/readiness'
import { coloursFor } from '../state/studioColours'
import { SETUP_STEPS } from '../domain/setupSchema'
import type { SetupPlace, SetupStep } from '../domain/setupSchema'
import { STARTER_TREATMENTS, resumeStep, setupPassed } from '../domain/setup'
import {
  depositsAsShare,
  hoursDraft,
  hoursScreen,
  lookDraft,
  lookScreen,
  moneyDraft,
  moneyScreen,
  newRowKey,
  openScreen,
  roomsDraft,
  roomsScreen,
  studioDraft,
  studioScreen,
  teamDraft,
  teamScreen,
  treatmentRow,
  treatmentsDraft,
  treatmentsScreen,
  usualRole,
} from '../domain/setupScreens'
import type {
  MoneyDraft,
  RoomsDraft,
  StudioDraft,
  TeamDraft,
  TreatmentsDraft,
} from '../domain/setupScreens'
import {
  Button,
  ChoiceTiles,
  ErrorMessage,
  SegmentedControl,
  WizardFooter,
  WizardSteps,
  photos,
  useWizardStep,
} from '../design'
import { HoursList, RemoveButton, RoomCards } from '../components/SetupParts'
import '../components/management.css'
import './studioSetup.css'

/**
 * "Set up your studio": a new owner's way from signing up to taking bookings, one job per screen.
 * Each screen saves when they press Continue, so they can stop at any point and pick up where
 * they left off, here or on another device. Everything it sets can be changed later in Settings.
 */
type WeekHours = ReturnType<typeof operations>['hours']
type Drafts = {
  studio?: StudioDraft
  hours?: WeekHours
  treatments?: TreatmentsDraft
  team?: TeamDraft
  rooms?: RoomsDraft
  look?: StudioLook
  deposits?: MoneyDraft
  open?: boolean
}

const NAMES: Record<SetupStep, string> = {
  studio: 'Studio',
  hours: 'Hours',
  treatments: 'Treatments',
  team: 'Team',
  rooms: 'Rooms',
  look: 'Look',
  deposits: 'Deposits',
  open: 'Open',
}
/** A house photograph and a line for each screen, beside the form on a wide screen. */
const STORY: Record<SetupStep, { photo: string; line: string }> = {
  studio: { photo: photos.entrance, line: 'Make it easy to find you.' },
  hours: { photo: photos.windowLight, line: 'Open when you are, closed when you are not.' },
  treatments: { photo: photos.facial, line: 'Your menu, at your prices.' },
  team: { photo: photos.calmStudio, line: 'The people behind every visit.' },
  rooms: { photo: photos.sunlitRoom, line: 'A place for every treatment.' },
  look: { photo: photos.hairStudio, line: 'Your colours, wherever guests meet you.' },
  deposits: { photo: photos.tea, line: 'Clear terms, kindly put.' },
  open: { photo: photos.reception, line: 'Ready for your first guests.' },
}
const LENGTHS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240]
const KINDS = ['Skin', 'Body', 'Hair'] as const
function lengthLabel(minutes: number) {
  const h = Math.floor(minutes / 60),
    m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function StudioSetup() {
  const { state, commit, role, mode, blocked, slug, session } = useStore()
  const navigate = useNavigate()
  const [step, setStep] = useState<SetupStep>(() => resumeStep(state))
  const [drafts, setDrafts] = useState<Drafts>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const index = SETUP_STEPS.indexOf(step)
  const last = index === SETUP_STEPS.length - 1
  const heading = useWizardStep(index + 1)
  const headingId = useId()
  const studio = state.organisation.id
  const savedLook = operations(state).look
  const preview = drafts.look

  useEffect(() => {
    document.title = `Set up ${state.organisation.name} · SALEANE`
  }, [state.organisation.name])
  // The colours being chosen show across the whole page; leaving puts the saved ones back.
  useEffect(() => {
    if (!preview) return
    const root = document.documentElement.style
    root.setProperty('--brand', preview.first)
    root.setProperty('--rose', preview.second)
    return () => {
      const back = coloursFor(studio, savedLook)
      root.setProperty('--brand', back.first)
      root.setProperty('--rose', back.second)
    }
  }, [preview, savedLook, studio])

  // Only the owner of a studio of their own sets it up; everyone else carries on as before.
  if (mode !== 'server' || operations(state).mode !== 'local' || role !== 'owner')
    return <Navigate to="/today" replace />

  const draft = {
    studio: drafts.studio ?? studioDraft(state),
    hours: drafts.hours ?? hoursDraft(state),
    treatments: drafts.treatments ?? treatmentsDraft(state),
    team: drafts.team ?? teamDraft(state),
    rooms: drafts.rooms ?? roomsDraft(state),
    look: drafts.look ?? lookDraft(state),
    deposits: drafts.deposits ?? moneyDraft(state),
    open: drafts.open ?? (operations(state).bookingEnabled || bookable(state)),
  }
  const screen = {
    studio: () => studioScreen(state, draft.studio),
    hours: () => hoursScreen(state, draft.hours),
    treatments: () => treatmentsScreen(state, draft.treatments),
    team: () => teamScreen(state, draft.team),
    rooms: () => roomsScreen(state, draft.rooms),
    look: () => lookScreen(state, draft.look),
    deposits: () => moneyScreen(state, draft.deposits),
    open: () => openScreen(state, draft.open && bookable(state)),
  }[step]()
  const dirty = drafts[step] !== undefined && screen.changes.length > 0
  const set =
    <K extends keyof Drafts>(key: K) =>
    (value: NonNullable<Drafts[K]>) => {
      setError('')
      setLeaving(false)
      setDrafts((current) => ({ ...current, [key]: value }))
    }

  /** Saves this screen and where to pick up; true once the studio has it. */
  async function save(next: SetupPlace) {
    if (!screen.changes.length && setupPassed(state, step) && next !== 'done') return true
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'setup-step', next, changes: screen.changes })
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setDrafts((current) => ({ ...current, [step]: undefined }))
      return true
    } catch {
      setError('This screen could not be saved. Your entries are still here; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  async function forward() {
    const next: SetupPlace = last ? 'done' : SETUP_STEPS[index + 1]
    if (!(await save(next))) return
    if (next === 'done') navigate('/today')
    else setStep(next)
  }
  async function later() {
    if (!dirty) return navigate('/today')
    if (screen.problem) return setLeaving(true)
    if (await save(step)) navigate('/today')
  }

  const ready = bookable(state)
  return (
    <div className="setup-layout">
      <aside className="setup-story">
        <Link className="wordmark" to="/today">
          SALEANE
        </Link>
        <div>
          <p className="eyebrow">Setting up</p>
          <p className="setup-story-title">{state.organisation.name}</p>
          <p>{STORY[step].line}</p>
        </div>
        <img src={STORY[step].photo} alt="" />
      </aside>
      <main className="setup-main" aria-labelledby={headingId}>
        <div className="setup-top">
          <p className="date-caption">
            Step {index + 1} of {SETUP_STEPS.length}
          </p>
          <Button variant="quiet" disabled={pending} onClick={() => void later()}>
            Finish later
          </Button>
        </div>
        <WizardSteps
          steps={SETUP_STEPS.map((id) => NAMES[id])}
          current={index + 1}
          label="Setting up your studio"
        />
        <section className="setup-screen">
          <h1 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading setup-heading">
            {
              {
                studio: 'Where guests find you',
                hours: 'When you are open',
                treatments: 'What you offer',
                team: 'Who does what',
                rooms: 'Where treatments happen',
                look: 'How your booking page looks',
                deposits: 'Deposits, fees and tax',
                open: ready ? 'Ready for bookings' : 'Nearly there',
              }[step]
            }
          </h1>
          {step === 'studio' && (
            <StudioScreen
              value={draft.studio}
              onChange={set('studio')}
              placeholder={state.organisation.region === 'UK' ? '020 7946 0123' : '(212) 555-0123'}
            />
          )}
          {step === 'hours' && (
            <HoursScreen
              value={draft.hours}
              onChange={set('hours')}
              locale={state.organisation.locale}
            />
          )}
          {step === 'treatments' && (
            <TreatmentsScreen
              value={draft.treatments}
              onChange={set('treatments')}
              currency={state.organisation.currency}
            />
          )}
          {step === 'team' && (
            <TeamScreen
              value={draft.team}
              onChange={set('team')}
              services={state.services.filter((x) => !x.archived)}
              you={session?.user.name ?? ''}
              role={usualRole(state)}
            />
          )}
          {step === 'rooms' && (
            <RoomsScreen
              value={draft.rooms}
              onChange={set('rooms')}
              services={state.services.filter((x) => !x.archived)}
            />
          )}
          {step === 'look' && (
            <LookScreen value={draft.look} onChange={set('look')} state={state} />
          )}
          {step === 'deposits' && (
            <MoneyScreen value={draft.deposits} onChange={set('deposits')} state={state} />
          )}
          {step === 'open' && (
            <OpenScreen
              online={draft.open}
              onChange={set('open')}
              state={state}
              slug={slug}
              onStep={setStep}
            />
          )}
          {screen.problem && (
            <p className="setup-problem" role="status">
              {screen.problem}
            </p>
          )}
          {leaving && (
            <div className="setup-leaving" role="alert">
              <p>
                This screen is not finished, so it cannot be saved yet. Leave without saving it? The
                screens before it are already saved.
              </p>
              <Button variant="secondary" onClick={() => navigate('/today')}>
                Leave without saving this screen
              </Button>
            </div>
          )}
          {blocked && <p className="ops-help">Changes are paused until the connection is back.</p>}
          <ErrorMessage error={error} />
        </section>
        <WizardFooter>
          {index > 0 ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setError('')
                setLeaving(false)
                setStep(SETUP_STEPS[index - 1])
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={pending || blocked || !!screen.problem} onClick={() => void forward()}>
            {pending
              ? 'Saving…'
              : last
                ? draft.open && ready
                  ? 'Open for bookings'
                  : 'Finish'
                : 'Continue'}
            {!pending && (last ? <Check size={17} /> : <ArrowRight size={17} />)}
          </Button>
        </WizardFooter>
      </main>
    </div>
  )
}

function Intro({ children }: { children: ReactNode }) {
  return <p className="setup-intro">{children}</p>
}

function StudioScreen({
  value,
  onChange,
  placeholder,
}: {
  value: StudioDraft
  onChange: (value: StudioDraft) => void
  placeholder: string
}) {
  const field = (key: keyof StudioDraft) => ({
    value: value[key],
    onChange: (event: { target: { value: string } }) =>
      onChange({ ...value, [key]: event.target.value }),
  })
  return (
    <>
      <Intro>
        Your studio’s name and address appear on your booking page and in every confirmation.
      </Intro>
      <div className="ops-fields">
        <label>
          Business name
          <input required minLength={2} maxLength={100} {...field('name')} />
        </label>
        <label>
          This location
          <input required minLength={2} maxLength={100} {...field('locationName')} />
          <small>Such as the area you are in. You can add more locations later.</small>
        </label>
        <label className="ops-wide">
          Address
          <textarea required rows={2} maxLength={300} {...field('address')} />
        </label>
        <label>
          Phone for guests (optional)
          <input
            type="tel"
            maxLength={40}
            autoComplete="off"
            placeholder={placeholder}
            {...field('phone')}
          />
        </label>
        <label>
          Email for guests (optional)
          <input
            type="email"
            maxLength={254}
            autoComplete="off"
            placeholder="hello@yourstudio.com"
            {...field('email')}
          />
        </label>
      </div>
    </>
  )
}

function HoursScreen({
  value,
  onChange,
  locale,
}: {
  value: WeekHours
  onChange: (value: WeekHours) => void
  locale: string
}) {
  return (
    <>
      <Intro>
        Guests can book only while you are open. Each person can have their own working days later,
        in Settings under Team.
      </Intro>
      <HoursList value={value} onChange={onChange} locale={locale} />
    </>
  )
}

function TreatmentsScreen({
  value,
  onChange,
  currency,
}: {
  value: TreatmentsDraft
  onChange: (value: TreatmentsDraft) => void
  currency: string
}) {
  const [kind, setKind] = useState<Service['category']>(() => value.rows.at(-1)?.category ?? 'Hair')
  const [focusKey, setFocusKey] = useState('')
  const rows = value.rows
  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    onChange({ ...value, rows: rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) })
  const add = (row: (typeof rows)[number]) => {
    setFocusKey(row.key)
    onChange({ ...value, rows: [...rows, row] })
  }
  const taken = new Set(rows.map((row) => row.name.trim().toLowerCase()))
  const starters = STARTER_TREATMENTS[kind].filter((t) => !taken.has(t.name.toLowerCase()))
  return (
    <>
      <Intro>
        Add each treatment with its length and your price. Descriptions, patch tests and how soon
        guests usually come back can be added later in Settings.
      </Intro>
      <div className="setup-starters">
        <div className="setup-starters-head">
          <strong>Add a common one</strong>
          <SegmentedControl
            label="Kind of treatment"
            appearance="chips"
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: k }))}
          />
        </div>
        {starters.length ? (
          <div className="setup-chips">
            {starters.map((t) => (
              <button
                key={t.name}
                type="button"
                className="setup-chip"
                onClick={() => add(treatmentRow(newRowKey(), kind, t.name, t.minutes))}
              >
                <Plus size={14} aria-hidden="true" />
                {t.name}
                <small>{lengthLabel(t.minutes)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="ops-help">All of these are on your menu.</p>
        )}
        <p className="ops-help">The price is always yours to add.</p>
      </div>
      {!!rows.length && (
        <ul className="setup-rows" aria-label="Your treatments">
          {rows.map((row) => (
            <li className="setup-row" key={row.key}>
              <div className="setup-row-grid setup-treatment">
                <label className="setup-span-name">
                  Treatment
                  <input
                    value={row.name}
                    maxLength={100}
                    autoFocus={focusKey === row.key && !row.name}
                    aria-invalid={row.name.trim().length < 2 || undefined}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                  />
                </label>
                <label>
                  Price ({currency})
                  <input
                    inputMode="decimal"
                    value={row.price}
                    placeholder="0.00"
                    autoFocus={focusKey === row.key && !!row.name}
                    aria-invalid={!Number.isFinite(parseMinor(row.price)) || undefined}
                    onChange={(e) => update(row.key, { price: e.target.value })}
                  />
                </label>
                <label>
                  Length
                  <select
                    value={row.minutes}
                    onChange={(e) => update(row.key, { minutes: Number(e.target.value) })}
                  >
                    {[...new Set([...LENGTHS, row.minutes])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {lengthLabel(m)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Kind
                  <select
                    value={row.category}
                    onChange={(e) => {
                      const category = e.target.value as Service['category']
                      update(row.key, {
                        category,
                        place: row.id ? row.place : category === 'Hair' ? 'chair' : 'treatment',
                      })
                    }}
                  >
                    {KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Needs
                  <select
                    value={row.place}
                    onChange={(e) =>
                      update(row.key, { place: e.target.value as 'treatment' | 'chair' })
                    }
                  >
                    <option value="treatment">Treatment room</option>
                    <option value="chair">Styling chair</option>
                  </select>
                </label>
                <RemoveButton
                  name={row.name || 'this treatment'}
                  onClick={() =>
                    onChange({
                      rows: rows.filter((x) => x.key !== row.key),
                      removed: row.id ? [...value.removed, row.id] : value.removed,
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        className="setup-quiet-action"
        onClick={() => add(treatmentRow(newRowKey(), kind))}
      >
        <Plus size={16} />
        Add a treatment
      </Button>
    </>
  )
}

function TeamScreen({
  value,
  onChange,
  services,
  you,
  role,
}: {
  value: TeamDraft
  onChange: (value: TeamDraft) => void
  services: Service[]
  you: string
  role: string
}) {
  const [focusKey, setFocusKey] = useState('')
  const rows = value.rows
  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    onChange({ ...value, rows: rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) })
  const add = (row: (typeof rows)[number]) => {
    setFocusKey(row.key)
    onChange({ ...value, rows: [...rows, row] })
  }
  const yourself = you.trim() && !rows.some((row) => row.name.trim() === you.trim())
  return (
    <>
      <Intro>
        Add everyone who gives treatments and tick what each person does. Adding someone here does
        not give them a sign-in; you can invite them from Settings when you are ready.
      </Intro>
      {!!rows.length && (
        <ul className="setup-rows" aria-label="Your team">
          {rows.map((row) => {
            const all = services.every((x) => row.serviceIds.includes(x.id))
            const who = row.name.trim() || 'this person'
            return (
              <li className="setup-row" key={row.key}>
                <div className="setup-row-grid setup-person">
                  <label>
                    Name
                    <input
                      value={row.name}
                      maxLength={100}
                      autoFocus={focusKey === row.key && !row.name}
                      aria-invalid={row.name.trim().length < 2 || undefined}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    What they do
                    <input
                      value={row.role}
                      maxLength={100}
                      placeholder={role}
                      aria-invalid={row.role.trim().length < 2 || undefined}
                      onChange={(e) => update(row.key, { role: e.target.value })}
                    />
                  </label>
                  <RemoveButton
                    name={row.name || 'this person'}
                    onClick={() =>
                      onChange({
                        rows: rows.filter((x) => x.key !== row.key),
                        removed: row.id ? [...value.removed, row.id] : value.removed,
                      })
                    }
                  />
                </div>
                <fieldset className="setup-gives">
                  <legend>Treatments {who} gives</legend>
                  <div className="setup-chips">
                    {services.map((service) => {
                      const on = row.serviceIds.includes(service.id)
                      return (
                        <label key={service.id} className="setup-tick">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              update(row.key, {
                                serviceIds: on
                                  ? row.serviceIds.filter((id) => id !== service.id)
                                  : [...row.serviceIds, service.id],
                              })
                            }
                          />
                          {service.name}
                        </label>
                      )
                    })}
                    {services.length > 2 && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          update(row.key, { serviceIds: all ? [] : services.map((x) => x.id) })
                        }
                      >
                        {all ? 'Untick all' : 'Tick all'}
                      </button>
                    )}
                  </div>
                </fieldset>
              </li>
            )
          })}
        </ul>
      )}
      <div className="setup-actions">
        {yourself && (
          <Button
            variant={rows.length ? 'secondary' : 'primary'}
            onClick={() =>
              add({
                key: newRowKey(),
                name: you.trim(),
                role: '',
                serviceIds: services.map((x) => x.id),
              })
            }
          >
            <Plus size={16} />
            Add yourself
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => add({ key: newRowKey(), name: '', role: '', serviceIds: [] })}
        >
          <Plus size={16} />
          Add someone
        </Button>
      </div>
      <p className="ops-help">
        Everyone works your opening hours to begin with. Set each person’s own days later in
        Settings under Team.
      </p>
    </>
  )
}

function RoomsScreen({
  value,
  onChange,
  services,
}: {
  value: RoomsDraft
  onChange: (value: RoomsDraft) => void
  services: Service[]
}) {
  return (
    <>
      <Intro>
        Each visit takes a room or a chair, so SALEANE never books two guests into the same one at
        once. Add each one you have.
      </Intro>
      <RoomCards
        rows={value.rows}
        services={services}
        onChange={(rows) => onChange({ ...value, rows })}
        onRemove={(row) => {
          if (row.id)
            onChange({
              rows: value.rows.filter((x) => x.key !== row.key),
              removed: [...value.removed, row.id],
            })
        }}
      />
    </>
  )
}

function LookScreen({
  value,
  onChange,
  state,
}: {
  value: StudioLook
  onChange: (value: StudioLook) => void
  state: BusinessState
}) {
  const shown = state.services.filter((x) => !x.archived).slice(0, 3)
  return (
    <>
      <Intro>
        Choose two colours. The first leads buttons and choices, and the second picks out small
        details. This page shows them as you choose.
      </Intro>
      <div className="setup-look">
        <div>
          <Swatches
            legend="First colour"
            name="setup-first"
            options={firstColours}
            value={value.first}
            onChange={(first) => onChange({ ...value, first: first as StudioLook['first'] })}
          />
          <Swatches
            legend="Second colour"
            name="setup-second"
            options={secondColours}
            value={value.second}
            onChange={(second) => onChange({ ...value, second: second as StudioLook['second'] })}
          />
        </div>
        <figure className="setup-preview" aria-label="How guests see it">
          <div
            className="setup-preview-photo"
            style={{ backgroundImage: `url(${photos.sunlitRoom})` }}
            aria-hidden="true"
          />
          <div className="setup-preview-body">
            <p className="setup-preview-name">{state.organisation.name}</p>
            <p className="setup-preview-place">{state.organisation.locationName}</p>
            <ul>
              {(shown.length
                ? shown
                : [{ id: 'none', name: 'Your treatments', priceMinor: 0 }]
              ).map((x, i) => (
                <li key={x.id} className={i === 0 ? 'is-chosen' : undefined}>
                  <span>{x.name}</span>
                  {!!x.priceMinor && <span>{money(x.priceMinor, state.organisation)}</span>}
                </li>
              ))}
            </ul>
            <span className="setup-preview-button">Choose a time</span>
          </div>
          <figcaption>A sketch of your booking page in these colours</figcaption>
        </figure>
      </div>
    </>
  )
}

function Swatches({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string
  name: string
  options: readonly { name: string; value: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="colour-choice setup-colours">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.value} className="colour-swatch">
            <input
              type="radio"
              name={name}
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

function MoneyScreen({
  value,
  onChange,
  state,
}: {
  value: MoneyDraft
  onChange: (value: MoneyDraft) => void
  state: BusinessState
}) {
  const uk = state.organisation.region === 'UK'
  const tax = uk ? 'VAT' : 'sales tax'
  const services = state.services.filter((x) => !x.archived)
  return (
    <>
      <Intro>
        Choose what guests pay ahead and what happens if they miss a visit. Everything here can be
        changed later in Settings.
      </Intro>
      <div className="ops-banner">
        <FlaskConical size={20} aria-hidden="true" />
        <div>
          <strong>Card payments are in test mode.</strong>
          <p>
            Guests and the desk can try every step and no money moves. Real payments start once you
            connect a payment account.
          </p>
        </div>
      </div>
      <h2 className="setup-subhead">Deposits</h2>
      <div className="setup-actions setup-actions-tight">
        {[
          ['No deposits', 0],
          ['20% of each price', 20],
          ['50% of each price', 50],
        ].map(([label, percent]) => (
          <Button
            key={label}
            variant="secondary"
            onClick={() =>
              onChange({ ...value, deposits: depositsAsShare(state, percent as number) })
            }
          >
            {label}
          </Button>
        ))}
      </div>
      <ul className="setup-deposits" aria-label="Deposit for each treatment">
        {services.map((service) => (
          <li key={service.id}>
            <span>
              <strong>{service.name}</strong>
              <small>{money(service.priceMinor, state.organisation)}</small>
            </span>
            <label>
              <span className="sr-only">Deposit for {service.name}</span>
              <input
                inputMode="decimal"
                placeholder="No deposit"
                value={value.deposits[service.id] ?? ''}
                aria-invalid={
                  parseMinor(value.deposits[service.id] ?? '', 0) > service.priceMinor || undefined
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    deposits: { ...value.deposits, [service.id]: e.target.value },
                  })
                }
              />
            </label>
          </li>
        ))}
      </ul>
      <h2 className="setup-subhead">If a guest misses their visit</h2>
      <div className="ops-fields">
        <label>
          Missed visit and late cancellation fee
          <select
            value={value.feePercent}
            onChange={(e) => onChange({ ...value, feePercent: Number(e.target.value) })}
          >
            <option value={0}>No fee</option>
            <option value={25}>Up to 25% of the booked price</option>
            <option value={50}>Up to 50% of the booked price</option>
            <option value={100}>Up to the full booked price</option>
          </select>
          <small>
            Only for a missed visit or one cancelled less than 24 hours ahead. It comes off any
            deposit paid, and a person charges it, never SALEANE by itself.
          </small>
        </label>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={value.saveCard}
            onChange={(e) => onChange({ ...value, saveCard: e.target.checked })}
          />
          Let guests save a card from the link to their visit
        </label>
      </div>
      <h2 className="setup-subhead">{uk ? 'VAT' : 'Sales tax'}</h2>
      <ChoiceTiles
        label={uk ? 'VAT' : 'Sales tax'}
        value={value.taxed === null ? null : value.taxed ? 'yes' : 'no'}
        onChange={(answer) => onChange({ ...value, taxed: answer === 'yes' })}
        options={[
          { value: 'yes', label: uk ? 'I charge VAT' : 'I charge sales tax' },
          { value: 'no', label: uk ? 'I do not charge VAT' : 'I do not charge sales tax' },
        ]}
      />
      {value.taxed && (
        <div className="ops-fields setup-tax">
          <label>
            Rate (%)
            <input
              inputMode="decimal"
              value={value.rate}
              placeholder={uk ? '20' : '8.875'}
              onChange={(e) => onChange({ ...value, rate: e.target.value })}
            />
          </label>
          <label className="ops-check">
            <input
              type="checkbox"
              checked={value.included}
              onChange={(e) => onChange({ ...value, included: e.target.checked })}
            />
            My prices already include {tax}
          </label>
        </div>
      )}
      <p className="ops-help">
        SALEANE does not look up tax rates or file returns. Choose what is right for your business.
      </p>
    </>
  )
}

function OpenScreen({
  online,
  onChange,
  state,
  slug,
  onStep,
}: {
  online: boolean
  onChange: (online: boolean) => void
  state: BusinessState
  slug: string
  onStep: (step: SetupStep) => void
}) {
  const [copied, setCopied] = useState(false)
  const live = <T extends { archived?: boolean }>(rows: T[]) => rows.filter((r) => !r.archived)
  const services = live(state.services),
    team = live(state.staff),
    rooms = live(state.resources)
  const ready = bookable(state)
  const link = `${window.location.origin}/book/${encodeURIComponent(slug)}`
  const o = operations(state)
  const open = o.hours.filter((h) => !h.closed).length
  const lines: { step: SetupStep; label: string; detail: string; done: boolean }[] = [
    {
      step: 'studio',
      label: 'Your studio',
      detail: [state.organisation.locationName, state.organisation.address]
        .filter(Boolean)
        .join(', '),
      done: !!state.organisation.address,
    },
    {
      step: 'hours',
      label: 'Opening hours',
      detail: `Open ${open} ${open === 1 ? 'day' : 'days'} a week`,
      done: open > 0,
    },
    {
      step: 'treatments',
      label: 'Treatments',
      detail: `${services.length} on your menu`,
      done: services.length > 0,
    },
    {
      step: 'team',
      label: 'Team',
      detail: team.map((p) => p.name).join(', ') || 'Nobody yet',
      done: team.some((p) => p.serviceIds.length > 0),
    },
    {
      step: 'rooms',
      label: 'Rooms and chairs',
      detail: `${rooms.length} ready`,
      done: rooms.length > 0,
    },
    {
      step: 'deposits',
      label: 'Deposits, fees and tax',
      detail: o.protection?.feePercent
        ? `Up to ${o.protection.feePercent}% for a missed visit`
        : 'No missed visit fee',
      done: !!o.tax,
    },
  ]
  return (
    <>
      <Intro>
        {ready
          ? 'Everything a guest needs to book is in place. Look it over, then open your booking page.'
          : 'Guests cannot book yet. They need a treatment, someone who gives it, and a room or chair for it.'}
      </Intro>
      <ul className="setup-summary">
        {lines.map((line) => (
          <li key={line.step} className={line.done ? 'is-done' : undefined}>
            <span className="setup-summary-mark" aria-hidden="true">
              {line.done ? <Check size={14} /> : null}
            </span>
            <span>
              <strong>{line.label}</strong>
              <small>{line.detail}</small>
            </span>
            <button type="button" className="text-link" onClick={() => onStep(line.step)}>
              Change<span className="sr-only"> {line.label.toLowerCase()}</span>
            </button>
          </li>
        ))}
      </ul>
      {ready && (
        <>
          <label className="ops-check setup-online">
            <input type="checkbox" checked={online} onChange={(e) => onChange(e.target.checked)} />
            <span>
              <strong>Take bookings online</strong>
              <small>Guests can book from your booking page at the times you are open.</small>
            </span>
          </label>
          <div className="setup-link">
            <span>
              <strong>Your booking page</strong>
              <small>{link}</small>
            </span>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              <Copy size={15} />
              {copied ? 'Copied' : 'Copy the link'}
            </Button>
          </div>
        </>
      )}
      <p className="ops-help">
        Next, Today has your day ahead. Settings holds everything you set here, and Moving in brings
        your clients across from another system.
      </p>
    </>
  )
}

import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Plus, ReceiptText } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { Service } from '../domain/model'
import { operations } from '../domain/operations'
import { money } from '../domain/format'
import { parseMinor } from '../domain/money'
import { PRICE, priceLabel } from '../domain/pricing'
import { places } from '../domain/locations'
import {
  OPENING_STEPS,
  coreTreatment,
  menuRow,
  openDays,
  openingCommand,
  openingDraft,
  openingHours,
  openingBill,
  openingImpact,
  openingGaps,
  openingProblem,
  bookedWeekdays,
  priceLimits,
  startingRooms,
} from '../domain/locationOpening'
import type { OpeningDraft } from '../domain/locationOpening'
import type { BillingView } from '../domain/billing'
import { WEEKDAYS, WEEK_ORDER, newRowKey } from '../domain/setupScreens'
import {
  Button,
  ChoiceTiles,
  ErrorMessage,
  Modal,
  WizardFooter,
  WizardSteps,
  useWizardStep,
} from '../design'
import { AffectedVisits } from './ScheduleImpact'
import { HoursList, RemoveButton, RoomCards } from './SetupParts'
import './management.css'
import './locationOpening.css'

/**
 * "Add a location": a new location's details, hours, menu, rooms and team, one job per screen,
 * saved together on the last screen. Editing a location later stays a single form in Settings.
 */
const NAMES = ['Where', 'Hours', 'Treatments', 'Rooms', 'Team', 'Check']
const TITLES = {
  where: 'Where is the new location?',
  hours: 'When is it open?',
  treatments: 'What it offers',
  rooms: 'Its rooms and chairs',
  team: 'Who works there',
  open: 'Check and add',
} as const
const short = (day: number) => WEEKDAYS[day].slice(0, 3)

export function LocationOpening({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state, commit, blocked } = useStore()
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<OpeningDraft>(() => openingDraft(state))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const heading = useWizardStep(step)
  const headingId = useId()
  const id = OPENING_STEPS[step - 1]
  const name = draft.name.trim()
  const impact = useMemo(
    () =>
      id === 'team' || id === 'open' ? openingImpact(state, draft, new Date().toISOString()) : [],
    [state, draft, id],
  )
  const problem = openingProblem(state, id, draft, impact)
  const gaps = id === 'team' ? openingGaps(state, draft) : null
  const services = state.services.filter((x) => !x.archived)
  const offered = services.filter((x) => menuRow(draft, x).offered)
  const change = (patch: Partial<OpeningDraft>) => {
    setError('')
    setDraft((current) => ({ ...current, ...patch }))
  }

  function go(next: number) {
    setError('')
    // The rooms screen starts with one room or chair of each kind the menu here needs.
    if (OPENING_STEPS[next - 1] === 'rooms' && !draft.rooms.length)
      setDraft((current) => ({ ...current, rooms: startingRooms(state, current) }))
    setStep(next)
  }
  async function save() {
    setPending(true)
    setError('')
    try {
      const result = await commit(openingCommand(state, draft))
      if (!result.ok) setError(result.error)
      else onDone(`${name} is added, with its rooms, team and menu.`)
    } catch {
      setError('This location could not be added. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Add a location"
      description="Six short steps. Nothing is saved until the last one."
    >
      <div className="opening">
        <WizardSteps steps={NAMES} current={step} label="Adding a location" />
        <section key={id} className="settle" aria-labelledby={headingId}>
          <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
            {TITLES[id]}
          </h3>
          {id === 'where' && <Where draft={draft} change={change} />}
          {id === 'hours' && (
            <>
              <p className="ops-help">
                Guests can book here only while it is open. Each person’s days here are chosen on
                the Team step.
              </p>
              <ChoiceTiles
                label="Opening hours"
                value={draft.ownHours ? 'own' : 'same'}
                onChange={(answer) => change({ ownHours: answer === 'own' })}
                options={[
                  { value: 'same', label: `The same as ${state.organisation.locationName}` },
                  { value: 'own', label: 'Its own hours' },
                ]}
              />
              {draft.ownHours && (
                <div className="opening-hours">
                  <HoursList
                    value={draft.hours}
                    onChange={(hours) => change({ hours })}
                    locale={state.organisation.locale}
                  />
                </div>
              )}
            </>
          )}
          {id === 'treatments' && <Menu draft={draft} change={change} services={services} />}
          {id === 'rooms' && (
            <>
              <p className="ops-help">
                Each visit here takes one of these, so two guests are never booked into the same
                room at once.
              </p>
              <RoomCards
                rows={draft.rooms}
                onChange={(rooms) => change({ rooms })}
                services={offered}
                at={name}
              />
            </>
          )}
          {id === 'team' && <Team draft={draft} change={change} offered={offered} />}
          {id === 'open' && <Summary draft={draft} offered={offered} />}
          {(id === 'team' || id === 'open') && (
            <AffectedVisits visits={impact} locale={state.organisation.locale} />
          )}
          {problem && !impact.length && (
            <p className="setup-problem" role="status">
              {problem}
            </p>
          )}
          {gaps && !problem && <p className="ops-help opening-gaps">{gaps}</p>}
        </section>
        {blocked && <p className="ops-help">Changes are paused until the connection is back.</p>}
        <ErrorMessage error={error} />
        <WizardFooter>
          {step > 1 ? (
            <Button variant="quiet" disabled={pending} onClick={() => go(step - 1)}>
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          )}
          {id !== 'open' ? (
            <Button disabled={!!problem} onClick={() => go(step + 1)}>
              Continue <ArrowRight size={17} />
            </Button>
          ) : (
            <Button disabled={pending || blocked || !!impact.length} onClick={() => void save()}>
              {pending ? 'Adding…' : `Add ${name}`}
              {!pending && <Check size={17} />}
            </Button>
          )}
        </WizardFooter>
      </div>
    </Modal>
  )
}

type Change = (patch: Partial<OpeningDraft>) => void

function Where({ draft, change }: { draft: OpeningDraft; change: Change }) {
  const { state } = useStore()
  const field = (key: 'name' | 'address' | 'phone' | 'email' | 'note') => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => change({ [key]: event.target.value }),
  })
  return (
    <>
      <p className="ops-help">
        Guests see its name and address when they choose where to book, and in their messages.
      </p>
      <div className="ops-fields">
        <label className="ops-wide">
          Name
          <input minLength={2} maxLength={100} placeholder="Such as Islington" {...field('name')} />
        </label>
        <label className="ops-wide">
          Address
          <textarea rows={2} maxLength={300} {...field('address')} />
        </label>
        <label>
          Phone for guests (optional)
          <input
            type="tel"
            maxLength={40}
            autoComplete="off"
            placeholder={state.organisation.region === 'UK' ? '020 7946 0123' : '(212) 555-0123'}
            {...field('phone')}
          />
          <small>Leave empty to use the studio’s.</small>
        </label>
        <label>
          Email for guests (optional)
          <input type="email" maxLength={254} autoComplete="off" {...field('email')} />
          <small>Leave empty to use the studio’s.</small>
        </label>
        <label className="ops-wide">
          Before you arrive (optional)
          <textarea
            rows={2}
            maxLength={400}
            placeholder="Directions, parking, which door to use"
            {...field('note')}
          />
        </label>
      </div>
    </>
  )
}

function Menu({
  draft,
  change,
  services,
}: {
  draft: OpeningDraft
  change: Change
  services: Service[]
}) {
  const { state } = useStore()
  const hint = useId()
  const set = (service: Service, patch: Partial<{ offered: boolean; price: string }>) =>
    change({ menu: { ...draft.menu, [service.id]: { ...menuRow(draft, service), ...patch } } })
  return (
    <>
      <p className="ops-help">
        Every treatment starts on the menu here at the house price. Untick any it does not offer,
        and change a price that is different here.
      </p>
      <ul className="opening-menu" aria-label="Treatments here">
        {services.map((service) => {
          const row = menuRow(draft, service)
          const core = coreTreatment(state, service.id)
          const limits = priceLimits(state, service)
          const price = parseMinor(row.price)
          const own = row.offered && Number.isFinite(price) && price !== service.priceMinor
          return (
            <li key={service.id} className={row.offered ? undefined : 'is-off'}>
              <label className="opening-offered">
                <input
                  type="checkbox"
                  checked={row.offered}
                  disabled={core}
                  onChange={(e) => set(service, { offered: e.target.checked })}
                />
                <span>
                  <strong>{service.name}</strong>
                  <small>
                    {core
                      ? 'A core treatment, on every location’s menu'
                      : `House price ${money(service.priceMinor, state.organisation)}`}
                  </small>
                </span>
              </label>
              {row.offered && (
                <div className="opening-price">
                  <input
                    inputMode="decimal"
                    value={row.price}
                    aria-label={`Price of ${service.name} here`}
                    aria-describedby={`${hint}-${service.id}`}
                    aria-invalid={!Number.isFinite(price) || undefined}
                    onChange={(e) => set(service, { price: e.target.value })}
                  />
                  <small id={`${hint}-${service.id}`}>
                    {limits
                      ? limits.band === 0
                        ? 'The same everywhere'
                        : `${money(limits.min, state.organisation)} to ${money(limits.max, state.organisation)}`
                      : own
                        ? 'Its own price here'
                        : 'House price'}
                  </small>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function DayTicks({
  days,
  open,
  booked = new Set(),
  onChange,
  who,
}: {
  days: number[]
  open: Set<number>
  /** Days with visits already booked at another location, marked with a dot. */
  booked?: Set<number>
  onChange: (days: number[]) => void
  who: string
}) {
  return (
    <fieldset className="opening-days">
      <legend>Days {who} works here</legend>
      <div className="setup-chips">
        {WEEK_ORDER.map((day) => {
          const on = days.includes(day) && open.has(day)
          return (
            <label
              key={day}
              className={`setup-tick${booked.has(day) && open.has(day) ? ' is-booked' : ''}`}
              title={
                !open.has(day)
                  ? 'Closed'
                  : booked.has(day)
                    ? 'Visits already booked on this day'
                    : undefined
              }
            >
              <input
                type="checkbox"
                aria-label={
                  !open.has(day)
                    ? `${WEEKDAYS[day]}, closed`
                    : booked.has(day)
                      ? `${WEEKDAYS[day]}, visits already booked`
                      : WEEKDAYS[day]
                }
                checked={on}
                disabled={!open.has(day)}
                onChange={() => onChange(on ? days.filter((d) => d !== day) : [...days, day])}
              />
              <span aria-hidden="true">{short(day)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Team({
  draft,
  change,
  offered,
}: {
  draft: OpeningDraft
  change: Change
  offered: Service[]
}) {
  const { state } = useStore()
  const open = openDays(state, draft)
  const team = state.staff.filter((p) => !p.archived)
  const booked = useMemo(() => {
    const now = new Date().toISOString()
    return new Map(state.staff.map((p) => [p.id, bookedWeekdays(state, p.id, now)]))
  }, [state])
  const anyBooked = team.some((p) => [...(booked.get(p.id) ?? [])].some((day) => open.has(day)))
  const where = new Map(places(state, true).map((p) => [p.id, p.name]))
  /** Where someone works on their working days now, such as "Bath Tue to Sat". */
  const usually = (staffId: string) => {
    const person = team.find((p) => p.id === staffId)!
    const hours = person.hours ?? operations(state).hours
    const groups = new Map<string, number[]>()
    for (const day of WEEK_ORDER) {
      const h = hours.find((x) => x.day === day)
      if (!h || h.closed) continue
      const at = where.get(h.locationId ?? state.organisation.locationId) ?? ''
      groups.set(at, [...(groups.get(at) ?? []), day])
    }
    return [...groups].map(([at, days]) => `${at} ${days.map(short).join(', ')}`).join(' · ')
  }
  const updateNew = (key: string, patch: Partial<OpeningDraft['newTeam'][number]>) =>
    change({ newTeam: draft.newTeam.map((p) => (p.key === key ? { ...p, ...patch } : p)) })
  return (
    <>
      <p className="ops-help">
        Tick the days each person works here. A day they already work moves here; a day off becomes
        a working day at this location’s hours. Everything else stays as it is.
      </p>
      <ul className="setup-rows" aria-label="Your team">
        {team.map((person) => (
          <li className="setup-row opening-person" key={person.id}>
            <div>
              <strong>{person.name}</strong>
              <small>
                {person.role} · {usually(person.id) || 'No working days yet'}
              </small>
            </div>
            <DayTicks
              who={person.name}
              open={open}
              booked={booked.get(person.id)}
              days={draft.days[person.id] ?? []}
              onChange={(days) => change({ days: { ...draft.days, [person.id]: days } })}
            />
          </li>
        ))}
        {draft.newTeam.map((person) => {
          const who = person.name.trim() || 'this person'
          return (
            <li className="setup-row" key={person.key}>
              <div className="setup-row-grid setup-person">
                <label>
                  Name
                  <input
                    value={person.name}
                    maxLength={100}
                    autoFocus={!person.name}
                    onChange={(e) => updateNew(person.key, { name: e.target.value })}
                  />
                </label>
                <label>
                  What they do
                  <input
                    value={person.role}
                    maxLength={100}
                    onChange={(e) => updateNew(person.key, { role: e.target.value })}
                  />
                </label>
                <RemoveButton
                  name={person.name || 'this person'}
                  onClick={() =>
                    change({ newTeam: draft.newTeam.filter((p) => p.key !== person.key) })
                  }
                />
              </div>
              <fieldset className="setup-gives">
                <legend>Treatments {who} gives</legend>
                <div className="setup-chips">
                  {offered.map((service) => {
                    const on = person.serviceIds.includes(service.id)
                    return (
                      <label key={service.id} className="setup-tick">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            updateNew(person.key, {
                              serviceIds: on
                                ? person.serviceIds.filter((x) => x !== service.id)
                                : [...person.serviceIds, service.id],
                            })
                          }
                        />
                        {service.name}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <DayTicks
                who={who}
                open={open}
                days={person.days}
                onChange={(days) => updateNew(person.key, { days })}
              />
            </li>
          )
        })}
      </ul>
      {anyBooked && (
        <p className="ops-help opening-booked-note">
          <span className="opening-dot" aria-hidden="true" /> A dot marks a day with visits already
          booked. Choosing it would leave those visits without their professional, so move them
          first or choose another day.
        </p>
      )}
      <div className="setup-actions">
        <Button
          variant="secondary"
          onClick={() =>
            change({
              newTeam: [
                ...draft.newTeam,
                { key: newRowKey(), name: '', role: '', serviceIds: [], days: [] },
              ],
            })
          }
        >
          <Plus size={16} />
          Add someone new
        </Button>
      </div>
    </>
  )
}

function Summary({ draft, offered }: { draft: OpeningDraft; offered: Service[] }) {
  const { state, mode } = useStore()
  const command = openingCommand(state, draft)
  const region = state.organisation.region
  const open = openingHours(state, draft).filter((h) => !h.closed).length
  const people = [
    ...command.team.map((row) => {
      const person = state.staff.find((p) => p.id === row.staffId)!
      return `${person.name} (${row.days.map(short).join(', ')})`
    }),
    ...command.newTeam.map((p) => `${p.name} (${p.days.map(short).join(', ')}, new)`),
  ]
  const count = places(state).length + 1
  const sample = mode === 'demo' || operations(state).mode === 'sandbox'
  const real = mode === 'server' && operations(state).mode === 'local'
  // The studio's own plan, so the owner sees what their bill becomes, not just the price.
  const [plan, setPlan] = useState<BillingView | null>(null)
  useEffect(() => {
    if (!real) return
    let active = true
    api<BillingView>(`/api/workspaces/${encodeURIComponent(state.organisation.id)}/billing`)
      .then((view) => {
        if (active) setPlan(view)
      })
      .catch(() => {
        // The price for each location still shows; the plan is in Settings, Plan and billing.
      })
    return () => {
      active = false
    }
  }, [real, state.organisation.id])
  const bill = plan && openingBill(plan, state.organisation)
  const gaps = openingGaps(state, draft)
  const lines = [
    ['Where', [draft.name.trim(), draft.address.trim()].join(', ')],
    [
      'Hours',
      draft.ownHours
        ? `Its own hours, open ${open} ${open === 1 ? 'day' : 'days'} a week`
        : `The same as ${state.organisation.locationName}`,
    ],
    [
      'Treatments',
      `${offered.length} of ${state.services.filter((x) => !x.archived).length} treatments, ` +
        (command.prices.length === 1
          ? '1 at its own price here'
          : command.prices.length
            ? `${command.prices.length} at their own price here`
            : 'all at the house price'),
    ],
    ['Rooms and chairs', command.rooms.map((r) => r.name).join(', ')],
    ['Team', people.join(', ')],
  ]
  return (
    <>
      <p className="ops-help">Look it over. Nothing is saved until you add it.</p>
      <ul className="setup-summary">
        {lines.map(([label, detail]) => (
          <li key={label} className="is-done">
            <span className="setup-summary-mark" aria-hidden="true">
              <Check size={14} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </li>
        ))}
      </ul>
      {gaps && <p className="ops-help opening-gaps">{gaps}</p>}
      <div className="ops-banner opening-price-note">
        <ReceiptText size={20} aria-hidden="true" />
        {bill ? (
          <div key="bill" className="settle">
            <strong>{bill.heading}</strong>
            <p>
              {draft.name.trim()} makes {count} locations, each {priceLabel(plan!.region)} a month.{' '}
              {bill.detail}
            </p>
          </div>
        ) : (
          <div>
            <strong>
              Each location is {priceLabel(region)} a month, {PRICE[region].tax}.
            </strong>
            <p>
              {draft.name.trim()} makes {count} locations.{' '}
              {sample
                ? 'This is a sample studio, so nothing is ever charged.'
                : 'Settings, Plan and billing shows when each bill is taken.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Building2, CalendarDays, Plus, Scissors, Users, Armchair, ShieldCheck } from 'lucide-react'
import { useStore } from '../state/context'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { OperatingCommand } from '../domain/commandSchema'
import { scheduleImpact } from '../domain/schedule'
import { operations, can, permissionFor } from '../domain/operations'
import { money, dateLabel, timeLabel } from '../domain/format'
import { parseMinor } from '../domain/money'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, Tabs } from '../design'
import { AffectedVisits, ScheduleHistory } from '../components/ScheduleImpact'
import { StudioPrivacy } from '../components/Privacy'
import '../components/management.css'

const sections = [
  { id: 'business', label: 'Business', icon: Building2 },
  { id: 'service', label: 'Services', icon: Scissors },
  { id: 'staff', label: 'Team', icon: Users },
  { id: 'resource', label: 'Spaces & equipment', icon: Armchair },
  { id: 'hours', label: 'Hours & closures', icon: CalendarDays },
  { id: 'privacy', label: 'Data & privacy', icon: ShieldCheck },
] as const
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const clock = (value: number) =>
  Number.isFinite(value)
    ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    : ''
const minutes = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim()
const numeric = (data: FormData, name: string) => Number(data.get(name))
type Editor = { kind: 'service' | 'staff' | 'resource' | 'closure'; id?: string }
type WeekHours = ReturnType<typeof operations>['hours']
const weekOrder = [1, 2, 3, 4, 5, 6, 0]
/** LOCAL-04: the booked visits a proposed change would strand, checked as the form changes. */
function previewImpact(state: BusinessState, command: Command | null) {
  if (!command || !['hours', 'closure', 'staff', 'resource'].includes(command.type)) return []
  return scheduleImpact(state, command as OperatingCommand, new Date().toISOString())
}
/** A professional's own week from the form, using `fallback` for days not shown yet. */
function ownHours(data: FormData, fallback: WeekHours): WeekHours {
  return fallback.map((day) => {
    const open = data.get(`own-${day.day}-open`)
    if (open === null) return { ...day }
    return {
      day: day.day,
      closed: data.get(`own-${day.day}-on`) !== 'on',
      open: minutes(String(open)),
      close: minutes(String(data.get(`own-${day.day}-close`) ?? '')),
    }
  })
}

export function Manage({ accessPanel }: { accessPanel?: ReactNode }) {
  const { state, commit, blocked, role } = useStore()
  const config = operations(state)
  const [section, setSection] = useState<(typeof sections)[number]['id']>('business')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [hours, setHours] = useState(() => config.hours.map((day) => ({ ...day })))
  const [draft, setDraft] = useState<Command | null>(null)
  const [customHours, setCustomHours] = useState(false)
  const hoursImpact = useMemo(() => previewImpact(state, { type: 'hours', hours }), [state, hours])
  const editorImpact = useMemo(() => previewImpact(state, draft), [state, draft])
  const locale = state.organisation.locale
  const service = state.services.find((item) => item.id === editor?.id)
  const person = state.staff.find((item) => item.id === editor?.id)
  const resource = state.resources.find((item) => item.id === editor?.id)
  const allowed = (action: string) => !blocked && can(role, action)
  async function save(command: Command, message: string, close = false) {
    if (pending || !allowed(permissionFor(command))) return
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit(command)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(message)
      if (close) setEditor(null)
    } catch {
      setError('Could not save. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  function open(kind: Editor['kind'], id?: string) {
    setError('')
    setSaved('')
    setDraft(null)
    setCustomHours(!!state.staff.find((item) => item.id === id)?.hours)
    setEditor({ kind, id })
  }
  function commandFrom(editor: Editor, data: FormData, custom = customHours): Command {
    const archived = data.get('archived') === 'on'
    if (editor.kind === 'service')
      return {
        type: 'service',
        id: editor.id,
        input: {
          name: text(data, 'name'),
          description: text(data, 'description'),
          category: text(data, 'category') as 'Skin' | 'Body' | 'Hair',
          durationMinutes: numeric(data, 'duration'),
          bufferMinutes: numeric(data, 'buffer'),
          priceMinor: parseMinor(data.get('price')),
          depositMinor: parseMinor(data.get('deposit')),
          resourceType: text(data, 'resourceType') as 'treatment' | 'chair',
          archived,
        },
      }
    if (editor.kind === 'staff') {
      const current = state.staff.find((item) => item.id === editor.id)
      return {
        type: 'staff',
        id: editor.id,
        input: {
          name: text(data, 'name'),
          role: text(data, 'role'),
          tone: text(data, 'tone') as 'sage' | 'blue' | 'sand',
          serviceIds: data.getAll('serviceIds').map(String),
          hours: custom ? ownHours(data, current?.hours ?? config.hours) : undefined,
          archived,
        },
      }
    }
    if (editor.kind === 'resource')
      return {
        type: 'resource',
        id: editor.id,
        input: {
          name: text(data, 'name'),
          type: text(data, 'resourceType') as 'treatment' | 'chair',
          archived,
        },
      }
    return {
      type: 'closure',
      input: {
        date: text(data, 'date'),
        staffId: text(data, 'staffId') || undefined,
        startMinutes: minutes(text(data, 'start')),
        endMinutes: minutes(text(data, 'end')),
        reason: text(data, 'reason'),
      },
    }
  }
  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || editorImpact.length) return
    const command = commandFrom(editor, new FormData(event.currentTarget))
    const message = {
      service: 'Service saved. Booked prices and durations are preserved.',
      staff: 'Professional saved.',
      resource: 'Resource saved.',
      closure: 'Time away saved.',
    }[editor.kind]
    void save(command, message, true)
  }
  const status = (
    <>
      <ErrorMessage error={editor ? '' : error} />
      <p className="ops-save-note" role="status">
        {saved}
      </p>
    </>
  )
  const editButton = (kind: Editor['kind'], id: string, name: string) => (
    <Button
      variant="secondary"
      aria-label={`Edit ${name}`}
      disabled={!allowed(kind === 'closure' ? 'hours' : 'catalogue') || pending}
      onClick={() => open(kind, id)}
    >
      Edit<span className="sr-only"> {name}</span>
    </Button>
  )
  const archivedTag = (archived?: boolean) =>
    archived ? <span className="ops-tag">Archived</span> : null
  return (
    <div className="manage-page">
      <PageHeader
        variant="compact"
        title="Your business, considered."
        description="Shape the services, people and spaces behind every visit."
      />
      <Tabs
        label="Business settings sections"
        value={section}
        disabled={pending}
        onChange={(id) => {
          setSection(id)
          setError('')
          setSaved('')
        }}
        tabs={sections.map(({ id, label, icon: Icon }) => ({
          value: id,
          label: (
            <>
              <Icon size={17} />
              {label}
            </>
          ),
        }))}
      >
        <div className="ops-layout">
          <div>
            {section === 'privacy' && <StudioPrivacy />}
            {section === 'business' && (
              <section className="surface ops-panel">
                <header>
                  <div>
                    <h2>Business details</h2>
                    <p>The identity guests see when they book.</p>
                  </div>
                  <Building2 size={21} />
                </header>
                <form
                  aria-busy={pending}
                  onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    void save(
                      {
                        type: 'organisation',
                        name: text(data, 'name'),
                        locationName: text(data, 'locationName'),
                        address: text(data, 'address'),
                        timeZone: text(data, 'timeZone'),
                        bookingEnabled: data.get('bookingEnabled') === 'on',
                        botCheck: data.get('botCheck') === 'on',
                      },
                      'Business settings saved.',
                    )
                  }}
                >
                  <div className="ops-fields">
                    <label>
                      Business name
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={100}
                        defaultValue={state.organisation.name}
                      />
                    </label>
                    <label>
                      Location name
                      <input
                        name="locationName"
                        required
                        maxLength={100}
                        defaultValue={state.organisation.locationName}
                      />
                    </label>
                    <label className="ops-wide">
                      Address
                      <textarea
                        name="address"
                        required
                        rows={2}
                        maxLength={300}
                        defaultValue={state.organisation.address}
                      />
                    </label>
                    <label>
                      Venue time zone
                      <select name="timeZone" defaultValue={state.organisation.timeZone}>
                        {Array.from(
                          new Set([
                            state.organisation.timeZone,
                            'Europe/London',
                            'America/New_York',
                            'America/Chicago',
                            'America/Denver',
                            'America/Los_Angeles',
                            'America/Phoenix',
                            'Pacific/Honolulu',
                            'America/Anchorage',
                          ]),
                        ).map((zone) => (
                          <option key={zone}>{zone}</option>
                        ))}
                      </select>
                    </label>
                    <div className="ops-field">
                      <span>Market & currency</span>
                      <p>
                        {state.organisation.region === 'UK' ? 'United Kingdom' : 'United States'} ·{' '}
                        {state.organisation.currency}
                      </p>
                      <small>Existing money keeps its recorded currency.</small>
                    </div>
                  </div>
                  <label className="ops-check">
                    <input
                      type="checkbox"
                      name="bookingEnabled"
                      defaultChecked={config.bookingEnabled}
                    />
                    Allow bookings in this local workspace
                  </label>
                  <label className="ops-check">
                    <input type="checkbox" name="botCheck" defaultChecked={!!config.botCheck} />
                    Ask online guests to pass a quick bot check before a time is held
                  </label>
                  <p className="ops-help">
                    Uses Cloudflare Turnstile. It needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY
                    on the server and stays off until both are set.
                  </p>
                  <p className="ops-help">
                    Payment and message delivery services are unconfigured.
                  </p>
                  {status}
                  <div className="ops-actions">
                    <Button type="submit" disabled={pending || !allowed('organisation')}>
                      {pending ? 'Saving…' : 'Save business details'}
                    </Button>
                  </div>
                </form>
              </section>
            )}
            {section === 'business' && (
              <section className="surface ops-panel">
                <header>
                  <div>
                    <h2>Checkout tax</h2>
                    <p>
                      Configure the rate used on future checkouts. Recorded receipts retain their
                      original amounts.
                    </p>
                  </div>
                </header>
                <form
                  aria-busy={pending}
                  onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    void save(
                      {
                        type: 'tax',
                        label: text(data, 'taxLabel'),
                        rateBps: Math.round(numeric(data, 'taxRate') * 100),
                        inclusive: data.get('taxInclusive') === 'on',
                      },
                      'Tax configuration saved for future checkouts.',
                    )
                  }}
                >
                  <div className="ops-fields">
                    <label>
                      Tax label
                      <input
                        name="taxLabel"
                        maxLength={40}
                        defaultValue={config.tax?.label ?? ''}
                        placeholder="VAT or sales tax"
                      />
                    </label>
                    <label>
                      Rate (%)
                      <input
                        name="taxRate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        required
                        defaultValue={(config.tax?.rateBps ?? 0) / 100}
                      />
                    </label>
                  </div>
                  <label className="ops-check">
                    <input
                      name="taxInclusive"
                      type="checkbox"
                      defaultChecked={config.tax?.inclusive ?? false}
                    />
                    Tax is already included in service prices
                  </label>
                  <p className="ops-help">
                    No automatic jurisdiction lookup or tax filing is connected. Choose the rate and
                    price basis that apply to your business.
                  </p>
                  <div className="ops-actions">
                    <Button type="submit" disabled={pending || !allowed('tax')}>
                      {pending ? 'Saving…' : 'Save tax configuration'}
                    </Button>
                  </div>
                </form>
              </section>
            )}
            {section === 'service' && (
              <section className="surface ops-panel">
                <header>
                  <div>
                    <h2>Service catalogue</h2>
                    <p>Clear promises, protected once a visit is booked.</p>
                  </div>
                  <Button disabled={!allowed('catalogue')} onClick={() => open('service')}>
                    <Plus size={16} />
                    Add service
                  </Button>
                </header>
                {status}
                <div className="ops-ledger">
                  {state.services.map((item) => (
                    <div className="ops-record" key={item.id}>
                      <div className="ops-record-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {item.category} · {item.durationMinutes} min + {item.bufferMinutes} min
                          turnaround
                        </small>
                        <small>{item.description}</small>
                      </div>
                      <div className="ops-record-controls">
                        <span className="ops-record-money">
                          {money(item.priceMinor, state.organisation)}
                        </span>
                        {archivedTag(item.archived)}
                        {editButton('service', item.id, item.name)}
                      </div>
                    </div>
                  ))}
                </div>
                {!state.services.length && (
                  <p className="ops-help">
                    Add a service, then qualify a professional and create a suitable space.
                  </p>
                )}
              </section>
            )}
            {section === 'staff' && (
              <>
                <section className="surface ops-panel">
                  <header>
                    <div>
                      <h2>The people behind every visit</h2>
                      <p>Professional capability is separate from account access.</p>
                    </div>
                    <Button disabled={!allowed('catalogue')} onClick={() => open('staff')}>
                      <Plus size={16} />
                      Add professional
                    </Button>
                  </header>
                  {status}
                  <div className="ops-ledger">
                    {state.staff.map((item) => (
                      <div className="ops-record" key={item.id}>
                        <Avatar identity={item.id} name={item.name} tone={item.tone} />
                        <div className="ops-record-copy">
                          <strong>{item.name}</strong>
                          <small>
                            {item.role} · {item.serviceIds.length} qualified{' '}
                            {item.serviceIds.length === 1 ? 'service' : 'services'}
                          </small>
                        </div>
                        <div className="ops-record-controls">
                          {archivedTag(item.archived)}
                          {editButton('staff', item.id, item.name)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                {accessPanel ?? (
                  <div className="ops-banner">
                    <ShieldCheck size={19} />
                    <div>
                      <strong>Practitioners and account access are separate.</strong>
                      <p>
                        Adding a professional records qualifications. It does not create a login or
                        send an invitation.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
            {section === 'resource' && (
              <section className="surface ops-panel">
                <header>
                  <div>
                    <h2>A place for every service</h2>
                    <p>Spaces shared across the team, with one appointment at a time.</p>
                  </div>
                  <Button disabled={!allowed('catalogue')} onClick={() => open('resource')}>
                    <Plus size={16} />
                    Add resource
                  </Button>
                </header>
                {status}
                <div className="ops-ledger">
                  {state.resources.map((item) => (
                    <div className="ops-record" key={item.id}>
                      <Armchair size={24} />
                      <div className="ops-record-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {item.type === 'treatment' ? 'Treatment space' : 'Styling chair'}
                        </small>
                      </div>
                      <div className="ops-record-controls">
                        {archivedTag(item.archived)}
                        {editButton('resource', item.id, item.name)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {section === 'hours' && (
              <>
                <section className="surface ops-panel">
                  <header>
                    <div>
                      <h2>The working week</h2>
                      <p>
                        Venue time · {state.organisation.timeZone}. Treatment and turnaround must
                        fit.
                      </p>
                    </div>
                  </header>
                  <form
                    aria-busy={pending}
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!hoursImpact.length)
                        void save({ type: 'hours', hours }, 'Opening hours saved.')
                    }}
                  >
                    <div className="ops-hours">
                      {weekOrder.map((weekday) => {
                        const day = hours.find((item) => item.day === weekday)
                        if (!day) return null
                        const update = (patch: Partial<typeof day>) =>
                          setHours((current) =>
                            current.map((item) =>
                              item.day === weekday ? { ...item, ...patch } : item,
                            ),
                          )
                        return (
                          <div className="ops-day" key={weekday}>
                            <label>
                              <input
                                type="checkbox"
                                checked={!day.closed}
                                onChange={(event) => update({ closed: !event.target.checked })}
                              />
                              {days[weekday]}
                            </label>
                            <label className="ops-field">
                              Opens
                              <input
                                type="time"
                                aria-label={`${days[weekday]} opens`}
                                required={!day.closed}
                                disabled={day.closed}
                                value={clock(day.open)}
                                onChange={(event) => update({ open: minutes(event.target.value) })}
                              />
                            </label>
                            <label className="ops-field">
                              Closes
                              <input
                                type="time"
                                aria-label={`${days[weekday]} closes`}
                                required={!day.closed}
                                disabled={day.closed}
                                value={clock(day.close)}
                                onChange={(event) => update({ close: minutes(event.target.value) })}
                              />
                            </label>
                          </div>
                        )
                      })}
                    </div>
                    <AffectedVisits visits={hoursImpact} locale={locale} />
                    {status}
                    <div className="ops-actions">
                      <Button
                        type="submit"
                        disabled={pending || !allowed('hours') || hoursImpact.length > 0}
                      >
                        {pending ? 'Saving…' : 'Save opening hours'}
                      </Button>
                    </div>
                  </form>
                </section>
                <section className="surface ops-panel">
                  <header>
                    <div>
                      <h2>Time away</h2>
                      <p>
                        One-off closures for the venue, or a break or leave for one professional.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!allowed('hours')}
                      onClick={() => open('closure')}
                    >
                      <Plus size={16} />
                      Add closure
                    </Button>
                  </header>
                  {config.closures.map((closure) => (
                    <div className="ops-record" key={closure.id}>
                      <div className="ops-record-copy">
                        <strong>{closure.reason}</strong>
                        <small>
                          {dateLabel(closure.date, state.organisation.locale)} ·{' '}
                          {timeLabel(closure.startMinutes, state.organisation.locale)}–
                          {timeLabel(closure.endMinutes, state.organisation.locale)}
                        </small>
                        <small>
                          {closure.staffId
                            ? state.staff.find((item) => item.id === closure.staffId)?.name
                            : 'Whole venue'}
                        </small>
                      </div>
                      <Button
                        variant="quiet"
                        disabled={pending || !allowed('hours')}
                        onClick={() => {
                          void save(
                            { type: 'remove-closure', closureId: closure.id },
                            'Closure removed.',
                          )
                        }}
                      >
                        Remove<span className="sr-only"> {closure.reason}</span>
                      </Button>
                    </div>
                  ))}
                  {!config.closures.length && (
                    <p className="ops-help">No one-off closures recorded.</p>
                  )}
                </section>
                <ScheduleHistory
                  entries={config.scheduleHistory ?? []}
                  organisation={state.organisation}
                />
              </>
            )}
          </div>
          <aside className="ops-aside">
            <h2>A steady foundation.</h2>
            <p>
              Services, people and spaces share the same calendar. Changes here guide the next
              booking.
            </p>
            <p>Booked prices, durations and deposits remain attached to the original visit.</p>
            <img
              src="/images/saleane-studio-warm.png"
              alt="Sunlit treatment studio with cream linens"
            />
          </aside>
        </div>
      </Tabs>
      {editor && (
        <Modal
          open
          onClose={() => {
            if (!pending) {
              setEditor(null)
              setError('')
            }
          }}
          title={
            editor.kind === 'closure'
              ? 'Time away'
              : `${editor.id ? 'Edit' : 'Add'} ${editor.kind === 'staff' ? 'professional' : editor.kind}`
          }
          description="Changes are saved to this workspace. Existing history is preserved."
        >
          <form
            onSubmit={submitEditor}
            onChange={(event) => setDraft(commandFrom(editor, new FormData(event.currentTarget)))}
            aria-busy={pending}
          >
            <div className="ops-fields">
              {editor.kind !== 'closure' && (
                <label className="ops-wide">
                  Name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={service?.name ?? person?.name ?? resource?.name}
                  />
                </label>
              )}
              {editor.kind === 'service' && (
                <>
                  <label className="ops-wide">
                    Description
                    <textarea
                      name="description"
                      rows={2}
                      maxLength={1000}
                      defaultValue={service?.description}
                    />
                  </label>
                  <label>
                    Category
                    <select name="category" defaultValue={service?.category ?? 'Skin'}>
                      <option>Skin</option>
                      <option>Body</option>
                      <option>Hair</option>
                    </select>
                  </label>
                  <label>
                    Required space
                    <select name="resourceType" defaultValue={service?.resourceType ?? 'treatment'}>
                      <option value="treatment">Treatment space</option>
                      <option value="chair">Styling chair</option>
                    </select>
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      name="duration"
                      type="number"
                      min="1"
                      max="720"
                      required
                      defaultValue={service?.durationMinutes ?? 60}
                    />
                  </label>
                  <label>
                    Turnaround (minutes)
                    <input
                      name="buffer"
                      type="number"
                      min="0"
                      max="240"
                      required
                      defaultValue={service?.bufferMinutes ?? 15}
                    />
                  </label>
                  <label>
                    Price ({state.organisation.currency})
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue={(service?.priceMinor ?? 0) / 100}
                    />
                  </label>
                  <label>
                    Deposit ({state.organisation.currency})
                    <input
                      name="deposit"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue={(service?.depositMinor ?? 0) / 100}
                    />
                  </label>
                </>
              )}
              {editor.kind === 'staff' && (
                <>
                  <label>
                    Role
                    <input
                      name="role"
                      required
                      maxLength={100}
                      defaultValue={person?.role ?? 'Professional'}
                    />
                  </label>
                  <label>
                    Calendar colour
                    <select name="tone" defaultValue={person?.tone ?? 'sage'}>
                      <option value="sage">Sage</option>
                      <option value="blue">Stone blue</option>
                      <option value="sand">Warm sand</option>
                    </select>
                  </label>
                  <fieldset className="ops-checks ops-wide">
                    <legend>Qualified services</legend>
                    {state.services
                      .filter((item) => !item.archived || person?.serviceIds.includes(item.id))
                      .map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            name="serviceIds"
                            value={item.id}
                            defaultChecked={person?.serviceIds.includes(item.id)}
                          />
                          {item.name}
                          {item.archived ? ' (archived)' : ''}
                        </label>
                      ))}
                    {!state.services.length && (
                      <p>Add a service before assigning qualifications.</p>
                    )}
                  </fieldset>
                  <fieldset className="ops-checks ops-wide">
                    <legend>Working hours</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={!customHours}
                        onChange={(event) => {
                          // Handled here so the preview uses the new choice, not the old one.
                          event.stopPropagation()
                          const custom = !event.target.checked
                          setCustomHours(custom)
                          const form = event.currentTarget.form
                          if (form) setDraft(commandFrom(editor, new FormData(form), custom))
                        }}
                      />
                      Follows the venue opening hours
                    </label>
                    {customHours && (
                      <div className="ops-hours">
                        {weekOrder.map((weekday) => {
                          const day = (person?.hours ?? config.hours).find(
                            (item) => item.day === weekday,
                          )
                          if (!day) return null
                          return (
                            <div className="ops-day" key={weekday}>
                              <label>
                                <input
                                  type="checkbox"
                                  name={`own-${weekday}-on`}
                                  defaultChecked={!day.closed}
                                />
                                {days[weekday]}
                              </label>
                              <label className="ops-field">
                                Starts
                                <input
                                  type="time"
                                  name={`own-${weekday}-open`}
                                  aria-label={`${days[weekday]} starts`}
                                  required
                                  defaultValue={clock(day.open)}
                                />
                              </label>
                              <label className="ops-field">
                                Finishes
                                <input
                                  type="time"
                                  name={`own-${weekday}-close`}
                                  aria-label={`${days[weekday]} finishes`}
                                  required
                                  defaultValue={clock(day.close)}
                                />
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </fieldset>
                </>
              )}
              {editor.kind === 'resource' && (
                <label>
                  Resource type
                  <select name="resourceType" defaultValue={resource?.type ?? 'treatment'}>
                    <option value="treatment">Treatment space</option>
                    <option value="chair">Styling chair</option>
                  </select>
                </label>
              )}
              {editor.kind === 'closure' && (
                <>
                  <label>
                    Date
                    <input name="date" type="date" required />
                  </label>
                  <label>
                    Applies to
                    <select name="staffId">
                      <option value="">Whole venue</option>
                      {state.staff
                        .filter((item) => !item.archived)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    From
                    <input name="start" type="time" required defaultValue="09:00" />
                  </label>
                  <label>
                    Until
                    <input name="end" type="time" required defaultValue="18:00" />
                  </label>
                  <label className="ops-wide">
                    Reason
                    <input
                      name="reason"
                      required
                      minLength={2}
                      maxLength={300}
                      placeholder="Annual leave or maintenance"
                    />
                  </label>
                  <p className="ops-help ops-wide">
                    Choose one professional for a break or leave. Booked visits are checked before
                    time away can be saved.
                  </p>
                </>
              )}
              {editor.id && (
                <label className="ops-check ops-wide">
                  <input
                    type="checkbox"
                    name="archived"
                    defaultChecked={
                      service?.archived ?? person?.archived ?? resource?.archived ?? false
                    }
                  />
                  Archive for future bookings; retain history.
                </label>
              )}
            </div>
            <AffectedVisits visits={editorImpact} locale={locale} />
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button
                type="submit"
                disabled={
                  pending ||
                  !allowed(editor.kind === 'closure' ? 'hours' : 'catalogue') ||
                  editorImpact.length > 0
                }
              >
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setEditor(null)
                  setError('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

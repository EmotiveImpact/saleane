import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Armchair,
  BellRing,
  Building2,
  CalendarDays,
  Palette,
  Plus,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Users,
  CreditCard,
  ArrowRightLeft,
  Layers,
  MapPin,
  ClipboardList,
  Plug,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
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
import { BrandSection, PreferencesSection, WorkspaceSection } from '../components/SettingsSections'
import { MessageSettings } from '../components/AppointmentMessages'
import { GuestNotesSettings } from '../components/GuestNotesSettings'
import { PatchTestRules } from '../components/PatchTests'
import { ShareBookingPage } from '../components/ShareBookingPage'
import { PaymentSettings } from '../components/CardPayments'
import { SwitchingSettings } from '../components/Switching'
import { PlanSettings } from '../components/Plans'
import { LocationsSettings } from '../components/LocationsSettings'
import { hasLocations, placeOf, places, resourceLocation } from '../domain/locations'
import { FormSettings } from '../components/GuestForms'
import { EmailNewsWording } from '../components/EmailConsent'
import { SavedReplies } from '../components/SavedReplies'
import { Connections } from '../components/Connections'
import { AccessKeys } from '../components/AccessKeys'
import { ReceptionistSettings } from '../components/ReceptionistSettings'
import { GoogleBooking } from '../components/GoogleBooking'
import { HouseRules } from '../components/HouseRules'
import { houseRuleNote } from '../domain/brandRules'
import { SocialAccounts } from '../components/SocialAccounts'
import '../components/management.css'

const sections = [
  { id: 'preferences', label: 'Your preferences', icon: SlidersHorizontal },
  { id: 'business', label: 'Studio details', icon: Building2 },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'brand', label: 'Colours & booking page', icon: Palette },
  { id: 'messages', label: 'Messages to guests', icon: BellRing },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'service', label: 'Services', icon: Scissors },
  { id: 'plans', label: 'Packages & memberships', icon: Layers },
  { id: 'forms', label: 'Guest forms', icon: ClipboardList },
  { id: 'staff', label: 'Team', icon: Users },
  { id: 'resource', label: 'Spaces & equipment', icon: Armchair },
  { id: 'hours', label: 'Hours & closures', icon: CalendarDays },
  { id: 'connections', label: 'Connected software', icon: Plug },
  { id: 'privacy', label: 'Data & privacy', icon: ShieldCheck },
  { id: 'switching', label: 'Switching over', icon: ArrowRightLeft },
  { id: 'workspace', label: 'This workspace', icon: Store },
] as const
type SectionId = (typeof sections)[number]['id']
const isSection = (value: string | null): value is SectionId =>
  sections.some((item) => item.id === value)
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
  if (!command || !['hours', 'closure', 'staff', 'resource', 'location'].includes(command.type))
    return []
  return scheduleImpact(state, command as OperatingCommand, new Date().toISOString())
}
/** A professional's own week from the form, using `fallback` for days not shown yet. */
function ownHours(data: FormData, fallback: WeekHours, main: string): WeekHours {
  return fallback.map((day) => {
    const open = data.get(`own-${day.day}-open`)
    if (open === null) return { ...day }
    // V2: where they work that day; the main location is left unnamed.
    const where = String(data.get(`own-${day.day}-loc`) ?? '')
    return {
      day: day.day,
      closed: data.get(`own-${day.day}-on`) !== 'on',
      open: minutes(String(open)),
      close: minutes(String(data.get(`own-${day.day}-close`) ?? '')),
      ...(where && where !== main ? { locationId: where } : {}),
    }
  })
}

export function Manage({ accessPanel }: { accessPanel?: ReactNode }) {
  const { state, commit, blocked, role } = useStore()
  const config = operations(state)
  // The open section lives in the address, so links elsewhere can open Settings at the right place.
  const [params, setParams] = useSearchParams()
  const requested = params.get('section')
  const section: SectionId = isSection(requested) ? requested : 'business'
  const setSection = (id: SectionId) => setParams({ section: id }, { replace: true })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [hours, setHours] = useState(() => config.hours.map((day) => ({ ...day })))
  const [draft, setDraft] = useState<Command | null>(null)
  const [customHours, setCustomHours] = useState(false)
  // A demo reset replaces the records under this page, so unsaved copies are taken afresh.
  const [replaced, setReplaced] = useState(false)
  if (replaced) {
    setReplaced(false)
    setHours(config.hours.map((day) => ({ ...day })))
    setEditor(null)
    setDraft(null)
  }
  const hoursImpact = useMemo(() => previewImpact(state, { type: 'hours', hours }), [state, hours])
  const editorImpact = useMemo(() => previewImpact(state, draft), [state, draft])
  const locale = state.organisation.locale
  const service = state.services.find((item) => item.id === editor?.id)
  const person = state.staff.find((item) => item.id === editor?.id)
  const resource = state.resources.find((item) => item.id === editor?.id)
  const allowed = (action: string) => !blocked && can(role, action)
  const multiSite = hasLocations(state)
  /** " · £120.00 at Islington · not at Marylebone", for the list of treatments. */
  const menuSummary = (item: (typeof state.services)[number]) =>
    [
      ...(item.locationPrices ?? []).map(
        (r) =>
          `${money(r.priceMinor, state.organisation)} at ${placeOf(state, r.locationId)?.name ?? ''}`,
      ),
      ...(item.notOfferedAt ?? []).map((id) => `not at ${placeOf(state, id)?.name ?? ''}`),
    ]
      .map((part) => ` · ${part}`)
      .join('')
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
  /** V2: a treatment's price at each other location, and where it is left off the menu. */
  function menuAtPlaces(data: FormData) {
    if (!multiSite) return {}
    const locationPrices = places(state)
      .filter((place) => !place.main && String(data.get(`price-${place.id}`) ?? '').trim())
      .map((place) => ({
        locationId: place.id,
        priceMinor: parseMinor(data.get(`price-${place.id}`)),
      }))
    const notOfferedAt = places(state)
      .filter((place) => data.get(`offered-${place.id}`) !== 'on')
      .map((place) => place.id)
    return {
      ...(locationPrices.length ? { locationPrices } : {}),
      ...(notOfferedAt.length ? { notOfferedAt } : {}),
    }
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
          patchTest: data.get('patchTest') === 'on',
          returnWeeks: String(data.get('returnWeeks') ?? '').trim()
            ? numeric(data, 'returnWeeks')
            : null,
          archived,
          ...menuAtPlaces(data),
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
          hours: custom
            ? ownHours(data, current?.hours ?? config.hours, state.organisation.locationId)
            : undefined,
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
          ...(numeric(data, 'restMinutes') > 0
            ? { restMinutes: numeric(data, 'restMinutes') }
            : {}),
          archived,
          ...(text(data, 'locationId') && text(data, 'locationId') !== state.organisation.locationId
            ? { locationId: text(data, 'locationId') }
            : {}),
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
    <div className="manage-page settings-page">
      <PageHeader
        variant="compact"
        eyebrow="Settings"
        title="Your studio, considered."
        description="Your own preferences, and the services, people and spaces behind every visit."
      />
      <Tabs
        label="Settings sections"
        orientation="vertical"
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
            {section === 'preferences' && <PreferencesSection />}
            {section === 'brand' && (
              <>
                <BrandSection />
                <ReceptionistSettings />
              </>
            )}
            {section === 'messages' && (
              <>
                <MessageSettings />
                <SavedReplies />
                <EmailNewsWording />
              </>
            )}
            {section === 'payments' && <PaymentSettings />}
            {section === 'workspace' && <WorkspaceSection onReset={() => setReplaced(true)} />}
            {section === 'privacy' && <StudioPrivacy />}
            {section === 'connections' && (
              <>
                <Connections />
                <AccessKeys />
              </>
            )}
            {section === 'switching' && <SwitchingSettings />}
            {section === 'plans' && <PlanSettings />}
            {section === 'locations' && (
              <>
                <LocationsSettings />
                <HouseRules />
              </>
            )}
            {section === 'forms' && <FormSettings />}
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
                        reviewUrl: text(data, 'reviewUrl'),
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
                    <label className="ops-wide">
                      Public review page (optional)
                      <input
                        name="reviewUrl"
                        type="url"
                        inputMode="url"
                        maxLength={300}
                        placeholder="https://g.page/r/your-studio/review"
                        defaultValue={state.organisation.reviewUrl ?? ''}
                      />
                      <small>
                        Every guest is invited to leave a public review here after their visit, in
                        the same words whatever they told you privately.
                      </small>
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
                    Uses Cloudflare&rsquo;s free bot check. Whoever runs your server adds two
                    Cloudflare keys first; until then this stays off.
                  </p>
                  <p className="ops-help">
                    Card payments and message sending are not connected yet.
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
            {section === 'business' && (
              <>
                <ShareBookingPage />
                <GoogleBooking />
                <SocialAccounts />
                <GuestNotesSettings />
              </>
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
                          turnaround{item.patchTest ? ' · Needs a patch test' : ''}
                          {multiSite ? menuSummary(item) : ''}
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
            {section === 'service' && <PatchTestRules />}
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
                          {multiSite
                            ? ` · ${places(state, true).find((p) => p.id === resourceLocation(state, item))?.name ?? ''}`
                            : ''}
                          {item.restMinutes
                            ? ` · rests ${item.restMinutes} minutes after each visit`
                            : ''}
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
              src="/images/saleane-studio-warm.jpg"
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
                  {multiSite && (
                    <fieldset className="ops-wide service-places">
                      <legend>At each location</legend>
                      {houseRuleNote(state, service?.id) && (
                        <p className="subtle ops-wide">{houseRuleNote(state, service?.id)}</p>
                      )}
                      {places(state).map((place) => (
                        <div className="service-place" key={place.id}>
                          <label className="ops-check">
                            <input
                              type="checkbox"
                              name={`offered-${place.id}`}
                              defaultChecked={!service?.notOfferedAt?.includes(place.id)}
                            />
                            Offered at {place.name}
                          </label>
                          {!place.main && (
                            <label>
                              Price at {place.name} ({state.organisation.currency})
                              <input
                                name={`price-${place.id}`}
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Same price"
                                defaultValue={
                                  service?.locationPrices?.find((r) => r.locationId === place.id)
                                    ? service.locationPrices.find((r) => r.locationId === place.id)!
                                        .priceMinor / 100
                                    : ''
                                }
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </fieldset>
                  )}
                  <label>
                    Usually back after (weeks)
                    <input
                      name="returnWeeks"
                      type="number"
                      min="1"
                      max="52"
                      defaultValue={service?.returnWeeks ?? ''}
                      aria-describedby="return-weeks-help"
                    />
                    <small id="return-weeks-help">
                      Optional. Guests who agreed to hear from you get a gentle note when they are
                      due.
                    </small>
                  </label>
                  <label className="ops-check ops-wide">
                    <input type="checkbox" name="patchTest" defaultChecked={!!service?.patchTest} />
                    Needs a patch test, such as a colour. Guests need a clear test before this
                    treatment.
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
                    {multiSite && !customHours && (
                      <p className="ops-help">
                        Following the venue hours means working at the main location. Set their own
                        hours to choose a location for each day.
                      </p>
                    )}
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
                              {(multiSite || day.locationId) && (
                                <label className="ops-field">
                                  At
                                  <select
                                    name={`own-${weekday}-loc`}
                                    aria-label={`${days[weekday]} location`}
                                    defaultValue={day.locationId ?? state.organisation.locationId}
                                  >
                                    {places(state).map((place) => (
                                      <option value={place.id} key={place.id}>
                                        {place.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
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
              {editor.kind === 'resource' && (multiSite || resource?.locationId) && (
                <label>
                  Location
                  <select
                    name="locationId"
                    defaultValue={resource ? resourceLocation(state, resource) : undefined}
                  >
                    {places(state).map((place) => (
                      <option value={place.id} key={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {editor.kind === 'resource' && (
                <label>
                  Resting time after each visit
                  <select name="restMinutes" defaultValue={String(resource?.restMinutes ?? 0)}>
                    {[0, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m ? `${m} minutes empty` : 'None'}
                      </option>
                    ))}
                  </select>
                  <small>
                    The space stays empty this long after each visit, for airing, cooling or a deep
                    clean. The professional is free to work elsewhere. Visits already booked stay as
                    they are.
                  </small>
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

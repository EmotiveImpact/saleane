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
  Search,
  Store,
  CreditCard,
  ArrowRightLeft,
  Layers,
  NotebookText,
  Globe,
  MapPin,
  ClipboardList,
  MessageCircle,
  Plug,
  History,
  Receipt,
  Printer,
} from 'lucide-react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/context'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { OperatingCommand } from '../domain/commandSchema'
import { TimeField, Select, Checkbox } from '../design'
import { StudioDateField } from '../components/StudioDateField'
import { scheduleImpact } from '../domain/schedule'
import { businessDate, operations, can, permissionFor } from '../domain/operations'
import { money, dateLabel, timeLabel } from '../domain/format'
import { parseMinor } from '../domain/money'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, Tabs, treatmentPhoto } from '../design'
import { AffectedVisits, ScheduleHistory } from '../components/ScheduleImpact'
import { StudioPrivacy } from '../components/Privacy'
import { ChangeRecord } from '../components/ChangeRecord'
import { PlanBilling } from '../components/PlanBilling'
import { peopleChange, treatmentChange } from '../domain/billing'
import { BrandSection, WorkspaceSection } from '../components/SettingsSections'
import { MessageSettings } from '../components/AppointmentMessages'
import { GuestNotesSettings } from '../components/GuestNotesSettings'
import { EmailLook } from '../components/EmailPreview'
import { PatchTestRules } from '../components/PatchTests'
import { ShareBookingPage } from '../components/ShareBookingPage'
import { PaymentSettings } from '../components/CardPayments'
import { TillSettings } from '../components/TillSettings'
import { SwitchingSettings } from '../components/Switching'
import { PlanSettings } from '../components/Plans'
import { LocationsSettings } from '../components/LocationsSettings'
import { hasLocations, placeOf, places, resourceLocation } from '../domain/locations'
import { usuallyAt } from '../domain/team'
import { FormSettings } from '../components/GuestForms'
import { SavedReplies } from '../components/SavedReplies'
import { Connections } from '../components/Connections'
import { AccessKeys } from '../components/AccessKeys'
import { DiaryLinks } from '../components/DiaryLinks'
import { ReceptionistSettings } from '../components/ReceptionistSettings'
import { AiVoiceSettings } from '../components/AiVoiceSettings'
import { GoogleBooking } from '../components/GoogleBooking'
import { AiBooking } from '../components/AiBooking'
import { HouseRules } from '../components/HouseRules'
import { houseRuleNote } from '../domain/brandRules'
import { SocialAccounts } from '../components/SocialAccounts'
import { StaffMoveDialog, StaffMoveEntry } from '../components/StaffMove'
import { whereTheyWork } from '../domain/staffMoves'
import '../components/management.css'

/**
 * The sections of Settings, in four groups: how the studio runs, never one person's own choices
 * (those are under "You") or the team (its own sidebar item). Each keeps the id it has always had
 * in the address (`/settings?section=service` still opens Treatments), so older links still land.
 * The words beside each are what "Find a setting" also matches.
 */
const groups = [
  {
    label: 'Studio',
    sections: [
      {
        id: 'business',
        label: 'Studio details',
        icon: Building2,
        words: 'name address phone email review time zone currency',
      },
      { id: 'locations', label: 'Locations', icon: MapPin, words: 'branch house rules' },
      {
        id: 'hours',
        label: 'Hours & closures',
        icon: CalendarDays,
        words: 'opening times holidays bank holiday closed',
      },
      {
        id: 'resource',
        label: 'Spaces & equipment',
        icon: Armchair,
        words: 'rooms chairs beds machines',
      },
      {
        id: 'brand',
        label: 'Booking page & colours',
        icon: Palette,
        words:
          'online booking link share google instagram facebook whatsapp chatgpt claude bot check logo',
      },
    ],
  },
  {
    label: 'Treatments and payments',
    sections: [
      {
        id: 'service',
        label: 'Treatments',
        icon: Scissors,
        words: 'services prices menu durations patch tests',
      },
      {
        id: 'plans',
        label: 'Packages & memberships',
        icon: Layers,
        words: 'courses bundles subscriptions',
      },
      {
        id: 'payments',
        label: 'Payments & tax',
        icon: CreditCard,
        words: 'deposits cards stripe vat cancellation no-show refunds',
      },
      { id: 'till', label: 'Till and printer', icon: Printer, words: 'receipts cash drawer' },
    ],
  },
  {
    label: 'Guests',
    sections: [
      {
        id: 'messages',
        label: 'Messages to guests',
        icon: BellRing,
        words: 'reminders confirmations emails texts look saved replies',
      },
      {
        id: 'notes',
        label: 'Before and after a visit',
        icon: NotebookText,
        words: 'directions parking arrival aftercare notes',
      },
      {
        id: 'forms',
        label: 'Guest forms',
        icon: ClipboardList,
        words: 'consultation consent questions',
      },
      {
        id: 'receptionist',
        label: 'AI and voice',
        icon: MessageCircle,
        words: 'receptionist phone assistant ask calls',
      },
    ],
  },
  {
    label: 'Studio account',
    sections: [
      {
        id: 'billing',
        label: 'Plan and billing',
        icon: Receipt,
        words: 'subscription price invoice',
      },
      {
        id: 'connections',
        label: 'Connected software',
        icon: Plug,
        words: 'xero quickbooks access keys google apple calendar diaries',
      },
      {
        id: 'privacy',
        label: 'Data & privacy',
        icon: ShieldCheck,
        words: 'gdpr export delete keep records',
      },
      { id: 'changes', label: 'Who changed what', icon: History, words: 'history record log' },
      {
        id: 'switching',
        label: 'Moving in',
        icon: ArrowRightLeft,
        words: 'import switching another system fresha phorest timely',
      },
      {
        id: 'workspace',
        label: 'About this version',
        icon: Store,
        words: 'version reset backup recovery',
      },
    ],
  },
] as const
/** The team now has its own page, which shows this section alone. */
type SectionId = (typeof groups)[number]['sections'][number]['id'] | 'staff'
const sectionIds: readonly string[] = groups.flatMap((group) =>
  (group.sections as readonly { id: SectionId }[]).map((item) => item.id),
)
const isSection = (value: string | null): value is SectionId =>
  value !== null && sectionIds.includes(value)
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
/** The permission each editor saves with: rooms and chairs have their own (Stage 4). */
const editorPermission = (kind: Editor['kind']) =>
  kind === 'closure' ? 'hours' : kind === 'resource' ? 'rooms' : 'catalogue'
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

/** The house photograph for a kind of treatment, beside it in the list. */
function TreatmentPhoto({ category, nth }: { category: string; nth: number }) {
  const photo = treatmentPhoto(category, nth)
  return (
    <span
      className="ops-record-photo"
      aria-hidden="true"
      style={{ backgroundImage: `url(${photo.src})`, backgroundPosition: photo.position }}
    />
  )
}

export function Manage({ accessPanel, only }: { accessPanel?: ReactNode; only?: 'staff' }) {
  const { state, commit, blocked, role, mode, branch } = useStore()
  // Stage 4: a general manager looks after the rooms and chairs at their own location only.
  const own = role === 'general' && branch ? branch : undefined
  const config = operations(state)
  // The open section lives in the address, so links elsewhere can open Settings at the right place.
  const [params, setParams] = useSearchParams()
  const requested = params.get('section')
  // NEXT-05 and NEXT-02: only the owner sees who changed what, and the SALEANE plan.
  const shownSection = (id: SectionId) => (id !== 'changes' && id !== 'billing') || role === 'owner'
  // The Google and Apple diaries joined Connected software.
  const asked = requested === 'diaries' ? 'connections' : requested
  const section: SectionId = only ?? (isSection(asked) && shownSection(asked) ? asked : 'business')
  const [find, setFind] = useState('')
  const setSection = (id: SectionId) => setParams({ section: id }, { replace: true })
  const [editor, setEditor] = useState<Editor | null>(null)
  // Stage 4: someone being moved to another location from a date.
  const [moving, setMoving] = useState<string | null>(null)
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
  // The per-person price: only the owner, who sees the bill, is told a change moves it.
  const billed = role === 'owner' && mode === 'server' && config.mode === 'local'
  const billNote = !billed
    ? ''
    : draft?.type === 'staff'
      ? peopleChange(state, places(state).length, { ...draft.input, id: draft.id })
      : draft?.type === 'service'
        ? treatmentChange(state, places(state).length, {
            id: draft.id,
            archived: draft.input.archived,
          })
        : ''
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
          ...(data.get('forTwo') ? { forTwo: true as const } : {}),
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
      service: 'Treatment saved. Booked prices and durations are preserved.',
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
      disabled={!allowed(editorPermission(kind)) || pending}
      onClick={() => open(kind, id)}
    >
      Edit<span className="sr-only"> {name}</span>
    </Button>
  )
  const archivedTag = (archived?: boolean) =>
    archived ? <span className="ops-tag">Archived</span> : null
  // Your own choices are under your name now, and the team has its own page.
  if (!only && requested === 'staff') return <Navigate to="/team" replace />
  if (!only && requested === 'preferences') return <Navigate to="/you" replace />
  const query = find.trim().toLowerCase()
  const matches = (item: { label: string; words: string }) =>
    !query || `${item.label} ${item.words}`.toLowerCase().includes(query)
  const shownGroups = groups
    .map((group) => ({
      label: group.label,
      tabs: (group.sections as readonly (typeof group.sections)[number][])
        .filter(({ id }) => shownSection(id))
        .filter(matches)
        .map(({ id, label, icon: Icon }) => ({
          value: id as SectionId,
          text: label,
          label: (
            <>
              <Icon size={17} aria-hidden="true" />
              {label}
            </>
          ),
        })),
    }))
    .filter((group) => group.tabs.length > 0)
  const body = (
    <div className="ops-layout">
      <div>
        {section === 'receptionist' && (
          <>
            <ReceptionistSettings />
            <AiVoiceSettings />
          </>
        )}
        {section === 'messages' && (
          <>
            <MessageSettings />
            <EmailLook />
            <SavedReplies />
          </>
        )}
        {section === 'payments' && <PaymentSettings />}
        {section === 'till' && <TillSettings />}
        {section === 'workspace' && <WorkspaceSection onReset={() => setReplaced(true)} />}
        {section === 'privacy' && <StudioPrivacy />}
        {section === 'changes' && <ChangeRecord />}
        {section === 'billing' && <PlanBilling />}
        {section === 'connections' && (
          <>
            <Connections />
            <DiaryLinks workspaceId={state.organisation.id} demo={mode !== 'server'} />
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
                <h2>Studio details</h2>
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
                    // Taking bookings online is set beside the booking page.
                    bookingEnabled: config.bookingEnabled,
                    reviewUrl: text(data, 'reviewUrl'),
                    phone: text(data, 'phone'),
                    email: text(data, 'email'),
                  },
                  'Studio details saved.',
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
                  Phone for guests (optional)
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    autoComplete="off"
                    placeholder={
                      state.organisation.region === 'UK' ? '020 7946 0123' : '(212) 555-0123'
                    }
                    defaultValue={state.organisation.phone ?? ''}
                  />
                </label>
                <label>
                  Email for guests (optional)
                  <input
                    name="email"
                    type="email"
                    maxLength={254}
                    autoComplete="off"
                    placeholder="hello@yourstudio.com"
                    defaultValue={state.organisation.email ?? ''}
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
                    Every guest is invited to leave a public review here after their visit, in the
                    same words whatever they told you privately.
                  </small>
                </label>
                <label>
                  Venue time zone
                  <Select name="timeZone" defaultValue={state.organisation.timeZone}>
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
                  </Select>
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
              <p className="ops-help">Card payments and message sending are not connected yet.</p>
              {status}
              <div className="ops-actions">
                <Button type="submit" disabled={pending || !allowed('organisation')}>
                  {pending ? 'Saving…' : 'Save studio details'}
                </Button>
              </div>
            </form>
          </section>
        )}
        {section === 'payments' && (
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
                <Checkbox name="taxInclusive" defaultChecked={config.tax?.inclusive ?? false} />
                Tax is already included in treatment prices
              </label>
              <p className="ops-help">
                SALEANE does not look up tax rates or file tax returns. Choose the rate, and whether
                prices include it, for your business.
              </p>
              <div className="ops-actions">
                <Button type="submit" disabled={pending || !allowed('tax')}>
                  {pending ? 'Saving…' : 'Save tax configuration'}
                </Button>
              </div>
            </form>
          </section>
        )}
        {section === 'brand' && (
          <section className="surface ops-panel" aria-labelledby="online-booking-title">
            <header>
              <div>
                <h2 id="online-booking-title">Taking bookings online</h2>
                <p>Whether guests can book themselves, and how a held time is protected.</p>
              </div>
              <Globe size={21} />
            </header>
            <form
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                // The studio's details go back as they are; its phone, email and review page are
                // left out, which keeps them.
                const studio = state.organisation
                void save(
                  {
                    type: 'organisation',
                    name: studio.name,
                    locationName: studio.locationName,
                    address: studio.address,
                    timeZone: studio.timeZone,
                    bookingEnabled: data.get('bookingEnabled') === 'on',
                    botCheck: data.get('botCheck') === 'on',
                  },
                  'Online booking saved.',
                )
              }}
            >
              <label className="ops-check">
                <Checkbox name="bookingEnabled" defaultChecked={config.bookingEnabled} />
                Take bookings online
              </label>
              <label className="ops-check">
                <Checkbox name="botCheck" defaultChecked={!!config.botCheck} />
                Ask online guests to pass a quick bot check before a time is held
              </label>
              <p className="ops-help">
                Uses Cloudflare&rsquo;s free bot check. Whoever runs your server adds two Cloudflare
                keys first; until then this stays off.
              </p>
              {status}
              <div className="ops-actions">
                <Button type="submit" disabled={pending || !allowed('organisation')}>
                  {pending ? 'Saving…' : 'Save online booking'}
                </Button>
              </div>
            </form>
          </section>
        )}
        {section === 'brand' && (
          <>
            <ShareBookingPage />
            <GoogleBooking />
            <AiBooking />
            <SocialAccounts />
            <BrandSection />
          </>
        )}
        {section === 'notes' && <GuestNotesSettings />}
        {section === 'service' && (
          <section className="surface ops-panel">
            <header>
              <div>
                <h2>Treatments</h2>
                <p>Clear promises, protected once a visit is booked.</p>
              </div>
              <Button disabled={!allowed('catalogue')} onClick={() => open('service')}>
                <Plus size={16} />
                Add treatment
              </Button>
            </header>
            {status}
            <div className="ops-ledger">
              {state.services.map((item, index, all) => (
                <div className="ops-record" key={item.id}>
                  <TreatmentPhoto
                    category={item.category}
                    nth={all.slice(0, index).filter((s) => s.category === item.category).length}
                  />
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
                Add a treatment, then qualify a professional and create a suitable space.
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
                {state.staff
                  .filter((item) => !own || usuallyAt(state, item.id, own, businessDate(state)))
                  .map((item) => (
                    <div className="ops-record" key={item.id}>
                      <Avatar identity={item.id} name={item.name} tone={item.tone} />
                      <div className="ops-record-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {item.role} · {item.serviceIds.length} qualified{' '}
                          {item.serviceIds.length === 1 ? 'treatment' : 'treatments'}
                        </small>
                        {multiSite && !item.archived && (
                          <small>{whereTheyWork(state, item.id, businessDate(state))}</small>
                        )}
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
                    Adding a professional records qualifications. It does not create a login or send
                    an invitation.
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
                <h2>A place for every treatment</h2>
                <p>Spaces shared across the team, with one visit at a time.</p>
              </div>
              <Button disabled={!allowed('rooms')} onClick={() => open('resource')}>
                <Plus size={16} />
                Add resource
              </Button>
            </header>
            {own && (
              <p className="ops-help">
                The rooms and chairs at {placeOf(state, own)?.name ?? 'your location'}. You can add,
                rename, change and archive them here. Moving one to another location is for the
                owner or a manager.
              </p>
            )}
            {status}
            <div className="ops-ledger">
              {state.resources
                .filter((item) => !own || resourceLocation(state, item) === own)
                .map((item) => (
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
                        {item.forTwo ? ' · room for two' : ''}
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
                    Venue time · {state.organisation.timeZone}. Treatment and turnaround must fit.
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
                          <Checkbox
                            checked={!day.closed}
                            onChange={(event) => update({ closed: !event.target.checked })}
                          />
                          {days[weekday]}
                        </label>
                        <label className="ops-field">
                          Opens
                          <TimeField
                            locale={locale}
                            aria-label={`${days[weekday]} opens`}
                            required={!day.closed}
                            disabled={day.closed}
                            value={clock(day.open)}
                            onChange={(time) => update({ open: minutes(time) })}
                          />
                        </label>
                        <label className="ops-field">
                          Closes
                          <TimeField
                            locale={locale}
                            aria-label={`${days[weekday]} closes`}
                            required={!day.closed}
                            disabled={day.closed}
                            value={clock(day.close)}
                            onChange={(time) => update({ close: minutes(time) })}
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
                  <p>One-off closures for the venue, or a break or leave for one professional.</p>
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
              {!config.closures.length && <p className="ops-help">No one-off closures recorded.</p>}
            </section>
            <ScheduleHistory
              entries={config.scheduleHistory ?? []}
              organisation={state.organisation}
            />
          </>
        )}
      </div>
    </div>
  )
  const dialogs = (
    <>
      {moving && (
        <StaffMoveDialog
          staffId={moving}
          onClose={() => setMoving(null)}
          onDone={(message) => {
            setMoving(null)
            setSaved(message)
          }}
        />
      )}
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
              : `${editor.id ? 'Edit' : 'Add'} ${{ service: 'treatment', staff: 'professional', resource: 'resource' }[editor.kind]}`
          }
          description="Changes are saved to this studio. Existing history is kept."
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
                    <Select name="category" defaultValue={service?.category ?? 'Skin'}>
                      <option>Skin</option>
                      <option>Body</option>
                      <option>Hair</option>
                    </Select>
                  </label>
                  <label>
                    Required space
                    <Select name="resourceType" defaultValue={service?.resourceType ?? 'treatment'}>
                      <option value="treatment">Treatment space</option>
                      <option value="chair">Styling chair</option>
                    </Select>
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
                            <Checkbox
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
                    <Checkbox name="patchTest" defaultChecked={!!service?.patchTest} />
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
                    <Select name="tone" defaultValue={person?.tone ?? 'sage'}>
                      <option value="sage">Sage</option>
                      <option value="blue">Stone blue</option>
                      <option value="sand">Warm sand</option>
                    </Select>
                  </label>
                  <fieldset className="ops-checks ops-wide">
                    <legend>Treatments they give</legend>
                    {state.services
                      .filter((item) => !item.archived || person?.serviceIds.includes(item.id))
                      .map((item) => (
                        <label key={item.id}>
                          <Checkbox
                            name="serviceIds"
                            value={item.id}
                            defaultChecked={person?.serviceIds.includes(item.id)}
                          />
                          {item.name}
                          {item.archived ? ' (archived)' : ''}
                        </label>
                      ))}
                    {!state.services.length && <p>Add a treatment before choosing who gives it.</p>}
                  </fieldset>
                  <fieldset className="ops-checks ops-wide">
                    <legend>Working hours</legend>
                    <label>
                      <Checkbox
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
                                <Checkbox name={`own-${weekday}-on`} defaultChecked={!day.closed} />
                                {days[weekday]}
                              </label>
                              <label className="ops-field">
                                Starts
                                <TimeField
                                  locale={locale}
                                  name={`own-${weekday}-open`}
                                  aria-label={`${days[weekday]} starts`}
                                  required
                                  defaultValue={clock(day.open)}
                                />
                              </label>
                              <label className="ops-field">
                                Finishes
                                <TimeField
                                  locale={locale}
                                  name={`own-${weekday}-close`}
                                  aria-label={`${days[weekday]} finishes`}
                                  required
                                  defaultValue={clock(day.close)}
                                />
                              </label>
                              {(multiSite || day.locationId) && (
                                <label className="ops-field">
                                  At
                                  <Select
                                    name={`own-${weekday}-loc`}
                                    aria-label={`${days[weekday]} location`}
                                    defaultValue={day.locationId ?? state.organisation.locationId}
                                  >
                                    {places(state).map((place) => (
                                      <option value={place.id} key={place.id}>
                                        {place.name}
                                      </option>
                                    ))}
                                  </Select>
                                </label>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </fieldset>
                  {multiSite && person && !person.archived && (
                    <StaffMoveEntry
                      staffId={person.id}
                      allowed={allowed('staff-move') && !pending}
                      onMove={() => {
                        setEditor(null)
                        setError('')
                        setSaved('')
                        setMoving(person.id)
                      }}
                    />
                  )}
                </>
              )}
              {editor.kind === 'resource' && (
                <label>
                  Resource type
                  <Select name="resourceType" defaultValue={resource?.type ?? 'treatment'}>
                    <option value="treatment">Treatment space</option>
                    <option value="chair">Styling chair</option>
                  </Select>
                </label>
              )}
              {editor.kind === 'resource' && own && (
                <p className="ops-help">
                  At {placeOf(state, own)?.name ?? 'your location'}.
                  <input type="hidden" name="locationId" value={own} />
                </p>
              )}
              {editor.kind === 'resource' && !own && (multiSite || resource?.locationId) && (
                <label>
                  Location
                  <Select
                    name="locationId"
                    defaultValue={resource ? resourceLocation(state, resource) : undefined}
                  >
                    {places(state).map((place) => (
                      <option value={place.id} key={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {editor.kind === 'resource' && (
                <label>
                  Resting time after each visit
                  <Select name="restMinutes" defaultValue={String(resource?.restMinutes ?? 0)}>
                    {[0, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m ? `${m} minutes empty` : 'None'}
                      </option>
                    ))}
                  </Select>
                  <small>
                    The space stays empty this long after each visit, for airing, cooling or a deep
                    clean. The professional is free to work elsewhere. Visits already booked stay as
                    they are.
                  </small>
                </label>
              )}
              {editor.kind === 'resource' && (
                <>
                  <label className="ops-check">
                    <Checkbox name="forTwo" defaultChecked={!!resource?.forTwo} />A room for two
                  </label>
                  <p className="ops-help">
                    Two people booked together, such as a couple, can have it at the same time.
                    Anyone else has it to themselves.
                  </p>
                </>
              )}
              {editor.kind === 'closure' && (
                <>
                  <label>
                    Date
                    <StudioDateField name="date" required />
                  </label>
                  <label>
                    Applies to
                    <Select name="staffId">
                      <option value="">Whole venue</option>
                      {state.staff
                        .filter((item) => !item.archived)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                  <label>
                    From
                    <TimeField locale={locale} name="start" required defaultValue="09:00" />
                  </label>
                  <label>
                    Until
                    <TimeField locale={locale} name="end" required defaultValue="18:00" />
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
                  <Checkbox
                    name="archived"
                    defaultChecked={
                      service?.archived ?? person?.archived ?? resource?.archived ?? false
                    }
                  />
                  Archive for future bookings; retain history.
                </label>
              )}
            </div>
            {billNote && (
              <p className="ops-help" role="status">
                {billNote}
              </p>
            )}
            <AffectedVisits visits={editorImpact} locale={locale} />
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button
                type="submit"
                disabled={
                  pending || !allowed(editorPermission(editor.kind)) || editorImpact.length > 0
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
    </>
  )
  if (only === 'staff')
    return (
      <div className="manage-page team-page">
        <PageHeader
          variant="compact"
          eyebrow="Team"
          title="Who does what."
          description="Each person, the treatments they give and where they work. Signing in is set separately, below."
        />
        {body}
        {dialogs}
      </div>
    )
  return (
    <div className="manage-page settings-page">
      <PageHeader
        variant="compact"
        eyebrow="Settings"
        title="Your studio, considered."
        description="How the studio runs: its places, treatments, payments and messages."
      />
      <Tabs
        label="Settings sections"
        picker="Section"
        orientation="vertical"
        value={section}
        disabled={pending}
        onChange={(id) => {
          setSection(id)
          setError('')
          setSaved('')
        }}
        find={
          <label className="settings-find">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Find a setting</span>
            <input
              type="search"
              value={find}
              placeholder="Find a setting"
              onChange={(event) => setFind(event.target.value)}
            />
          </label>
        }
        empty={<p className="settings-find-none">Nothing matches “{find.trim()}”.</p>}
        groups={shownGroups}
      >
        {body}
      </Tabs>
      {dialogs}
    </div>
  )
}

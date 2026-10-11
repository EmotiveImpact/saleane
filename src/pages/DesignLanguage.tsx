import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  Avatar,
  Button,
  ChoiceTiles,
  DateField,
  DateStrip,
  Definition,
  Empty,
  ErrorMessage,
  LoadingShapes,
  Menu,
  MenuItem,
  MenuSeparator,
  Metric,
  Modal,
  MoreOptions,
  MovingList,
  MovingRow,
  PageHeader,
  SegmentedControl,
  Select,
  Stat,
  Stats,
  Status,
  Switch,
  Tabs,
  TimeChoices,
  TimeField,
  Tip,
  WizardSteps,
  photos,
  Checkbox,
  notify,
} from '../design'
import {
  audiences,
  errors,
  refusals,
  regionalForms,
  truthWords,
  voiceRules,
  wordChoices,
} from '../design/voice'
import '../design/library.css'

const colours = [
  ['--ink', 'Ink', 'Text and headings'],
  ['--muted', 'Muted', 'Secondary text and details'],
  ['--paper', 'Paper', 'Panels, cards and fields'],
  ['--mineral', 'Ground', 'The warm off-white behind every page'],
  ['--side', 'Side', 'The menu beside the page'],
  ['--stone', 'Stone', 'Quiet fills and initials'],
  ['--line', 'Line', 'Hairlines between rows and sections'],
  ['--brand', 'First studio colour', 'Chosen by the studio. Selection, focus, figures'],
  ['--action', 'Action', 'Primary buttons: the first colour deepened for white text'],
  ['--brand-soft', 'First colour, soft', 'Selected fills, attention, skin and wellbeing'],
  ['--rose', 'Second studio colour', 'Chosen by the studio. The now line, counts, due back'],
  ['--blue', 'Mist', 'Body treatments'],
  ['--brass', 'Brass', 'Small warm accents only'],
  ['--danger', 'Clay', 'Errors and anything that cannot be undone'],
] as const

// Text and background pairs the workspace relies on. Each must reach 4.5:1.
const pairs = [
  ['--ink', '--paper'],
  ['--muted', '--paper'],
  ['--muted', '--mineral'],
  ['--muted', '--sage'],
  ['--tone-sage-ink', '--tone-sage-bg'],
  ['--tone-blue-ink', '--tone-blue-bg'],
  ['--tone-sand-ink', '--tone-sand-bg'],
  ['--paper', '--action'],
  ['--rose-ink', '--paper'],
  ['--brand-ink', '--sage'],
  ['--danger', '--danger-soft'],
] as const

const typeScale = [
  ['--text-greeting', 'Greeting', 'The welcome on Today and a person’s own day', 'editorial'],
  ['--text-display', 'Display', 'Page titles on a computer', 'editorial'],
  ['--text-title-m', 'Title', 'Panel and side-sheet headings, page titles on a phone', 'editorial'],
  ['--text-stat', 'Figure', 'Headline figures, in light Figtree with even digits', 'figure'],
  ['--text-title-s', 'Section', 'Section headings', 'sans'],
  ['--text-lead', 'Lead', 'Lead paragraphs and names in cards', 'sans'],
  ['--text-body', 'Body', 'Working text, buttons and fields', 'sans'],
  ['--text-small', 'Small', 'Supporting text and table cells', 'sans'],
  ['--text-meta', 'Meta', 'Labels and secondary detail', 'sans'],
  ['--text-micro', 'Micro', 'The floor: statuses, times, captions', 'sans'],
] as const

const spaces = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-10',
]

const corners = [
  ['--radius', 'Cards and sections'],
  ['--radius-panel', 'Panels inside a page'],
  ['--radius-control', 'Fields'],
  ['--radius-inner', 'Small marks inside a control'],
  ['--radius-pill', 'Buttons, tags and chips'],
] as const

const components = [
  ['PageHeader', 'native', 'The top of every staff page: eyebrow, title, one line, actions'],
  ['Button', 'native', 'Primary, secondary, quiet and light. Name the action'],
  ['SegmentedControl', 'Radix Toggle Group, Motion', 'One choice between views of the same thing'],
  ['Tabs', 'Radix Tabs, Motion', 'Sections that replace each other in place'],
  ['Menu, MenuItem, MenuChoices', 'Radix Dropdown Menu', 'A few things to do from one button'],
  ['Tip', 'Radix Tooltip', 'A hint beside an arrow or icon whose meaning is not written on it'],
  ['Select', 'Radix Select', 'One choice from a list, drawn in SALEANE’s own fields'],
  [
    'Checkbox, Switch',
    'Radix Checkbox, Radix Switch',
    'A tick in a list, or a setting that is on or off',
  ],
  [
    'Notices, notify',
    'Radix Toast',
    'A short corner notice for something that happened out of view',
  ],
  ['Metric, Stats, Stat', 'native', 'Label, figure and a plain line saying what it covers'],
  ['Definition', 'Radix Popover', 'How a figure is measured, by tap, click or keyboard'],
  ['Status', 'native', 'A visit’s state as words and a dot'],
  ['Avatar', 'native', 'A fictional portrait or initials beside a visible name'],
  ['TimeChoices', 'native radios', 'Picking a time from a short list'],
  ['DateStrip', 'native radios', 'The next fortnight, each day saying if it has space'],
  ['DateField, TimeField', 'Radix Popover, Radix Select', 'A date or time in a form, written out'],
  ['Modal', 'Radix Dialog, Motion', 'One decision or one record. Escape closes it'],
  ['MovingList, MovingRow', 'Motion', 'A list that changes while someone is looking at it'],
  ['CalmMotion, ChosenMark', 'Motion', 'The one calm timing, and the mark under a chosen tab'],
  ['MoreOptions', 'native disclosure', 'Settings most people never change, behind one line'],
  ['WizardSteps, ChoiceTiles, WizardFooter', 'native', 'A rare job of a few steps'],
  ['ScrollNav', 'native', 'A row of links that scrolls sideways on a phone'],
  ['Empty, ErrorMessage', 'native', 'Nothing here yet, or something that failed'],
  ['photos, treatmentPhoto', 'house photographs', 'The only photographs a screen may use'],
] as const

const sections = [
  ['principles', 'Principles'],
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['space', 'Space and edges'],
  ['page-tops', 'Page tops'],
  ['components', 'Components'],
  ['voice', 'How SALEANE speaks'],
] as const

function channel(value: number) {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/**
 * Reads token values from the live stylesheet, so the page cannot drift from
 * the code. Colours are resolved through a probe element, because tokens built
 * with color-mix() only become a concrete colour once a property uses them.
 */
function toHex(computed: string) {
  const rgb = computed.match(/^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/)
  const srgb = computed.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/)
  const parts = rgb
    ? rgb.slice(1, 4).map(Number)
    : srgb
      ? srgb.slice(1, 4).map((v) => Number(v) * 255)
      : undefined
  if (!parts) return ''
  return `#${parts.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}
function readColours(names: readonly string[]) {
  const probe = document.createElement('span')
  document.body.append(probe)
  const resolved = Object.fromEntries(
    names.map((name) => {
      probe.style.color = `var(${name})`
      return [name, toHex(getComputedStyle(probe).color)]
    }),
  )
  probe.remove()
  return resolved
}
function readTokens(names: readonly string[]) {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
}

/** A table that becomes one block per row on a phone, each cell named by its column. */
function StackTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: readonly string[]
  rows: readonly (readonly string[])[]
}) {
  return (
    <table className="library-table library-stack">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((name) => (
            <th key={name} scope="col">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join('|')}>
            {row.map((cell, i) => (
              <td key={columns[i]} data-label={columns[i]}>
                {i === 0 ? <strong>{cell}</strong> : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DesignLanguage() {
  const allColours = [...new Set([...colours.map(([n]) => n), ...pairs.flat()])]
  const [{ hex, sizes, spacing, radii }] = useState(() => ({
    hex: readColours(allColours),
    sizes: readTokens(typeScale.map(([n]) => n)),
    spacing: readTokens(spaces),
    radii: readTokens(corners.map(([n]) => n)),
  }))
  const [period, setPeriod] = useState('7')
  const [view, setView] = useState('people')
  const [tab, setTab] = useState('services')
  const [time, setTime] = useState<number | null>(600)
  const [day, setDay] = useState('2026-10-07')
  const [date, setDate] = useState('2026-10-09')
  const [clock, setClock] = useState('10:30')
  const [kind, setKind] = useState<'skin' | 'hair' | null>('skin')
  const [modal, setModal] = useState(false)
  const [settled, setSettled] = useState(0)
  const [room, setRoom] = useState('treatment-1')
  const [reminders, setReminders] = useState(true)
  const [hideDone, setHideDone] = useState(false)
  const [arrivals, setArrivals] = useState(['Amelia Carter, 10:00', 'Theo Bennett, 11:30'])
  return (
    <div className="library">
      <PageHeader
        photo={{ src: photos.calmStudio, position: '88% center' }}
        eyebrow="SALEANE"
        title="Design language."
        description="How SALEANE looks and speaks, shown live from the code every screen is built from."
      />

      <nav className="library-contents" aria-label="On this page">
        <ol>
          {sections.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <section className="library-section" aria-labelledby="principles">
        <h2 id="principles">Principles</h2>
        <ol className="library-principles">
          <li>
            <strong>Hospitality before software.</strong> A warm off-white ground, the studio’s own
            two colours and a light serif set the tone of a calm, independent studio. Photographs
            belong to arrivals, empty pages and guest moments.
          </li>
          <li>
            <strong>Space goes to the work.</strong> The large greeting is kept for the pages people
            arrive at. Working pages use the compact top, so the calendar, clients and money come
            first.
          </li>
          <li>
            <strong>Room, not boxes.</strong> Space and hairlines separate things. A card never sits
            inside a card, and one page has one main button.
          </li>
          <li>
            <strong>Readable at a glance.</strong> Nothing renders below 12px. Every text pairing
            reaches WCAG 2.2 AA (4.5:1), and colour never carries meaning alone.
          </li>
          <li>
            <strong>One measure, one meaning.</strong> A figure shown in two places uses the same
            name and the same definition, with its period stated.
          </li>
          <li>
            <strong>Honest states.</strong> A queued message is not sent and a recorded payment is
            not charged. Loading, empty, unavailable and error states say what happens next.
          </li>
        </ol>
      </section>

      <section className="library-section" aria-labelledby="colour">
        <h2 id="colour">Colour</h2>
        <p className="library-lead">
          Semantic tokens in <code>src/design/tokens.css</code>. Each studio chooses its first and
          second colour in Settings; everything else is worked out from them. Components use these
          names, never raw colour values.
        </p>
        <div className="library-swatches">
          {colours.map(([name, label, use]) => (
            <figure key={name}>
              <span className="library-swatch" style={{ background: `var(${name})` }} />
              <figcaption>
                <strong>{label}</strong>
                <code>{name}</code>
                <small>
                  {hex[name]} · {use}
                </small>
              </figcaption>
            </figure>
          ))}
        </div>
        <h3>Text pairings</h3>
        <table className="library-table library-pairs">
          <caption className="sr-only">Contrast of text and background pairings</caption>
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Text on background</th>
              <th scope="col">Contrast</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([text, ground]) => {
              const ratio = hex[text] && hex[ground] ? contrast(hex[text], hex[ground]) : 0
              return (
                <tr key={text + ground}>
                  <td>
                    <span
                      className="library-pair"
                      style={{ color: `var(${text})`, background: `var(${ground})` }}
                    >
                      Aa 12:30
                    </span>
                  </td>
                  <td>
                    <code>{text}</code> on <code>{ground}</code>
                  </td>
                  <td>
                    {ratio ? `${ratio.toFixed(2)}:1` : '…'}{' '}
                    {ratio > 0 && (
                      <span className={ratio >= 4.5 ? 'library-pass' : 'library-fail'}>
                        {ratio >= 4.5 ? 'AA' : 'Below AA'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="library-section" aria-labelledby="type">
        <h2 id="type">Type</h2>
        <p className="library-lead">
          Two faces. Headings, names and greetings are set in Financier Display Light, shown here in
          Newsreader at weight 300, which stands in for it. Figtree carries everything read while
          working, and every number: 360 for body text, 460 for the menu and 560 for emphasis. Times
          and money use even, tabular figures.
        </p>
        <div className="library-faces">
          <figure>
            <span className="library-serif library-face-sample">Every visit, in its place.</span>
            <figcaption>
              <strong>Display serif</strong>
              <small>
                Financier Display Light, with Newsreader standing in · <code>--font-editorial</code>
              </small>
            </figcaption>
          </figure>
          <figure>
            <span className="library-face-sample library-face-figures">£1,100 · 09:30 · 46%</span>
            <figcaption>
              <strong>Figtree</strong>
              <small>
                Body text, menus, buttons, tables and figures · <code>--font-display</code>
              </small>
            </figcaption>
          </figure>
        </div>
        <div className="library-type">
          {typeScale.map(([name, label, use, family]) => (
            <div key={name}>
              <span
                className={
                  family === 'editorial'
                    ? 'library-serif'
                    : family === 'figure'
                      ? 'library-face-figures'
                      : ''
                }
                style={{ fontSize: `var(${name})` }}
              >
                {label}
              </span>
              <small>
                <code>{name}</code> · {sizes[name]} · {use}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="library-section" aria-labelledby="space">
        <h2 id="space">Space and edges</h2>
        <p className="library-lead">
          A 4px base. Cards have soft 20px corners, fields 12px, and buttons and tags are pills.
          People are round. Every target on a phone is at least 44px.
        </p>
        <div className="library-spaces">
          {spaces.map((name) => (
            <div key={name}>
              <span style={{ width: `var(${name})` }} />
              <code>{name}</code>
              <small>{spacing[name]}</small>
            </div>
          ))}
        </div>
        <h3>Corners</h3>
        <div className="library-corners">
          {corners.map(([name, use]) => (
            <figure key={name}>
              <span style={{ borderRadius: `var(${name})` }} />
              <figcaption>
                <code>{name}</code>
                <small>
                  {radii[name]} · {use}
                </small>
              </figcaption>
            </figure>
          ))}
        </div>
        <h3>No stripes on the left edge</h3>
        <p className="library-lead">
          Cards, notes, errors and visits never carry a coloured line or shadow down one side. Their
          tone comes from the surface colour and the words. The only left rules are the 1px
          hairlines between calendar columns, and a test in <code>src/design/edges.test.ts</code>{' '}
          keeps it that way.
        </p>
      </section>

      <section className="library-section" aria-labelledby="page-tops">
        <h2 id="page-tops">Page tops</h2>
        <p className="library-lead">
          Every staff page opens the same way, in this order: a small label naming the part of
          SALEANE, the serif title as a short human line, one line saying what the page is for, and
          the page’s actions, with one primary button. On a phone the actions sit under the words.
        </p>
        <StackTable
          caption="Which page top each kind of page uses"
          columns={['Kind of page', 'Its top', 'Pages']}
          rows={[
            [
              'A greeting',
              'The large serif welcome with a photograph',
              'Today, a professional’s day, a regional manager’s area',
            ],
            [
              'A place people arrive',
              'Compact, led by one photograph that fades into the words',
              'Clients, the waitlist, what guests tell you',
            ],
            [
              'A working tool or a form',
              'Compact, with no photograph',
              'Calendar, Inbox, Business pages, Money, Stock, Settings, the day sheet',
            ],
            [
              'A record or a guest page',
              'Its own frame, in the same order',
              'A client’s page, booking pages, a guest’s visit link',
            ],
          ]}
        />
        <div className="library-specimen">
          <h3>A greeting</h3>
          <div className="library-frame">
            <PageHeader
              headingLevel={2}
              variant="editorial"
              eyebrow="Tuesday 6 October"
              title="A good day begins here."
              description="Everything you need to give today your best."
              actions={<Button>New visit</Button>}
            />
          </div>
          <h3>A place people arrive</h3>
          <div className="library-frame">
            <PageHeader
              headingLevel={2}
              photo={{ src: photos.tea, position: 'center 58%' }}
              eyebrow="Waitlist"
              title="Who would take a time."
              description="When a time opens that suits someone, it appears beside their name."
              actions={
                <Button>
                  <Plus size={17} />
                  Add to the waitlist
                </Button>
              }
            />
          </div>
          <h3>A working tool</h3>
          <div className="library-frame">
            <PageHeader
              headingLevel={2}
              eyebrow="Business"
              title="What is on the shelf."
              description="Products you sell at the till and the ones you use in treatments."
              actions={
                <Button>
                  <Plus size={17} />
                  Add a product
                </Button>
              }
            />
          </div>
        </div>
      </section>

      <section className="library-section" aria-labelledby="components">
        <h2 id="components">Components</h2>
        <p className="library-lead">
          Imported from <code>src/design</code>. Interactive pieces are built on Radix (Dialog,
          Dropdown Menu, Tooltip, Toast, Select, Checkbox, Switch, Tabs, Toggle Group, Popover) and
          take their look from the tokens above. Movement comes from Motion, in one calm timing.
        </p>
        <StackTable
          caption="Every component in the library"
          columns={['Component', 'Built on', 'When to use it']}
          rows={components}
        />

        <div className="library-specimen">
          <h3>Button</h3>
          <div className="library-row">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button disabled>Disabled</Button>
          </div>
        </div>

        <div className="library-specimen">
          <h3>Segmented control</h3>
          <p>One option always stays selected; arrow keys move between them.</p>
          <div className="library-row">
            <SegmentedControl
              label="Example period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '28', label: 'Last 28 days' },
              ]}
            />
            <SegmentedControl
              label="Example view"
              appearance="pill"
              value={view}
              onChange={setView}
              options={[
                { value: 'people', label: 'People' },
                { value: 'list', label: 'List' },
              ]}
            />
          </div>
        </div>

        <div className="library-specimen">
          <h3>Tabs</h3>
          <p>
            For sections that replace each other in place. A long list, as in Settings, splits into
            named groups and becomes one select on a phone.
          </p>
          <Tabs
            label="Example sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'services', label: 'Treatments' },
              { value: 'team', label: 'Team' },
              { value: 'hours', label: 'Hours & closures' },
            ]}
          >
            <p className="library-panel">
              {tab === 'services'
                ? 'Treatments panel'
                : tab === 'team'
                  ? 'Team panel'
                  : 'Hours and closures panel'}
            </p>
          </Tabs>
        </div>

        <div className="library-specimen">
          <h3>Figures</h3>
          <p>
            Label, figure and a plain line, in one figure style everywhere. Headline money is in
            whole pounds; receipts and tables keep the pence. A popover explains how a figure is
            measured.
          </p>
          <div className="metrics-band library-metrics">
            <Metric label="Booked for today" value="£1,100" detail="Before discounts and tips" />
            <Metric
              label="Time booked"
              value="46%"
              detail="Today, of open professional hours"
              definition={<p>Booked treatment minutes divided by scheduled professional hours.</p>}
            />
          </div>
          <Stats>
            <Stat label="Waiting to be spent" value="£170" />
            <Stat label="Owed to the team" value="£369" detail="Before any deductions" />
            <Stat
              label="The visit"
              value="4.4 / 5"
              definition={<p>The average of every guest’s rating for their visit.</p>}
            />
          </Stats>
          <p>
            Inline definition{' '}
            <Definition label="Inline definition">
              <p>Use beside any figure whose meaning is not obvious from its label.</p>
            </Definition>
          </p>
        </div>

        <div className="library-specimen">
          <h3>Status and people</h3>
          <p>Words and a dot, never colour alone. Portraits are fictional; others get initials.</p>
          <div className="library-row">
            {['confirmed', 'arrived', 'completed', 'cancelled', 'no_show'].map((status) => (
              <Status key={status} status={status} />
            ))}
          </div>
          <div className="library-row library-row-gap">
            <Avatar identity="staff-maya" name="Maya Lewis" />
            <Avatar name="Sophia Reed" tone="blue" />
            <Avatar name="Theo Bennett" tone="sand" />
            <Avatar small name="Amelia Carter" tone="sage" />
          </div>
        </div>

        <div className="library-specimen">
          <h3>Choosing a day and a time</h3>
          <p>
            The strip shows a fortnight, each day saying whether it has space. Times are native
            radios; dates and times in forms are written out in the studio’s own way.
          </p>
          <DateStrip
            label="Example days"
            locale="en-GB"
            value={day}
            onChange={setDay}
            days={[
              { date: '2026-10-06', free: 0 },
              { date: '2026-10-07', free: 6 },
              { date: '2026-10-08', free: 2 },
              { date: '2026-10-09', free: 9 },
              { date: '2026-10-10', free: 4 },
            ]}
          />
          <TimeChoices
            label="Example times"
            value={time}
            onChange={setTime}
            times={[
              { value: 540, label: '09:00' },
              { value: 600, label: '10:00' },
              { value: 690, label: '11:30' },
            ]}
          />
          <div className="library-row library-row-gap">
            <div className="library-field">
              <span aria-hidden="true">Date</span>
              <DateField
                value={date}
                onChange={setDate}
                locale="en-GB"
                today="2026-10-06"
                aria-label="Example date"
              />
            </div>
            <div className="library-field">
              <span aria-hidden="true">Time</span>
              <TimeField
                value={clock}
                onChange={setClock}
                locale="en-GB"
                aria-label="Example time"
              />
            </div>
          </div>
        </div>

        <div className="library-specimen">
          <h3>A job of a few steps</h3>
          <p>
            For rare jobs only: moving in, setting up a studio, adding a location. One heading, one
            line and one way forward on each step.
          </p>
          <WizardSteps
            label="Example steps"
            steps={['Your studio', 'Treatments', 'Hours', 'Check']}
            current={2}
          />
          <ChoiceTiles
            label="Example kind of studio"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'skin', label: 'Skin and wellbeing' },
              { value: 'hair', label: 'Hair' },
            ]}
          />
        </div>

        <div className="library-specimen">
          <h3>Dialog</h3>
          <p>Focus stays inside, Escape closes it and focus returns to the button.</p>
          <Button variant="secondary" onClick={() => setModal(true)}>
            Open an example dialog
          </Button>
          <Modal
            open={modal}
            onClose={() => setModal(false)}
            title="An example dialog"
            description="Title, description and a close action above a scrolling body."
          >
            <p>Dialogs hold one decision. Close with Escape or the close button.</p>
          </Modal>
        </div>

        <div className="library-specimen">
          <h3>Menus and hints</h3>
          <p>
            A row with several actions shows the everyday one and keeps the rest under More. Arrow
            keys move through the menu, Escape closes it, and focus goes back to the button. A hint
            names an arrow or icon on hover and keyboard focus; the button keeps its own words for
            screen readers, because a phone has no hover.
          </p>
          <div className="library-row">
            <Button variant="quiet">Delivery</Button>
            <Menu
              label="More for the example product"
              trigger={
                <Button variant="quiet" aria-label="More for the example product">
                  More
                  <ChevronDown size={16} aria-hidden="true" />
                </Button>
              }
            >
              <MenuItem onSelect={() => notify('An example: nothing was recorded.')}>
                Used in treatments
              </MenuItem>
              <MenuItem onSelect={() => notify('An example: nothing was recorded.')}>
                Correct the count
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => notify('An example: nothing was changed.')}>
                Edit details
              </MenuItem>
            </Menu>
            <Tip label="Previous day">
              <button className="icon-button" aria-label="Previous day">
                <ChevronLeft size={18} />
              </button>
            </Tip>
            <Tip label="Next day">
              <button className="icon-button" aria-label="Next day">
                <ChevronRight size={18} />
              </button>
            </Tip>
          </div>
        </div>

        <div className="library-specimen">
          <h3>Choosing from a list, ticks and switches</h3>
          <p>
            Drop-downs open SALEANE’s own list on every phone and computer. A tick is for one thing
            in a list or form; a switch is for a setting that takes effect as a whole.
          </p>
          <div className="library-row library-row-gap">
            <div className="library-field">
              <span aria-hidden="true">Room</span>
              <Select
                aria-label="Example room"
                value={room}
                onChange={(event) => setRoom(event.target.value)}
              >
                <option value="treatment-1">Treatment room 1</option>
                <option value="treatment-2">Treatment room 2</option>
                <option value="nail-bar">The nail bar</option>
              </Select>
            </div>
            <label className="checkbox-label">
              <Checkbox
                checked={hideDone}
                onChange={(event) => setHideDone(event.target.checked)}
              />
              Hide finished visits
            </label>
            <label className="checkbox-label">
              <Switch
                checked={reminders}
                onChange={(event) => setReminders(event.target.checked)}
              />
              Send reminders
            </label>
          </div>
        </div>

        <div className="library-specimen">
          <h3>Notices</h3>
          <p>
            For something that happened where the person may not be looking, such as a pop-up that
            closed as it saved. It says what really happened (saved, recorded, queued) and never
            more. Where a saved line already sits beside the button, no notice is needed.
          </p>
          <Button
            variant="secondary"
            onClick={() => notify('Delivery of 6 recorded. 14 in stock.')}
          >
            Show an example notice
          </Button>
        </div>

        <div className="library-specimen">
          <h3>A list that moves</h3>
          <p>
            Rows already there simply appear. After that a new row settles in, a row that goes
            fades, and the rows around it slide into place instead of jumping.
          </p>
          <div className="library-row">
            <Button
              variant="secondary"
              onClick={() =>
                setArrivals((list) =>
                  list.length > 3 ? list.slice(1) : ['Sophia Reed, 09:30', ...list],
                )
              }
            >
              {arrivals.length > 3 ? 'Take the first away' : 'A visit arrives'}
            </Button>
          </div>
          <ul className="library-moving">
            <MovingList>
              {arrivals.map((arrival) => (
                <MovingRow as="li" key={arrival}>
                  {arrival}
                </MovingRow>
              ))}
            </MovingList>
          </ul>
        </div>

        <div className="library-specimen">
          <h3>Empty and error states</h3>
          <p>
            A small gap in a list says so in one line. A page with nothing in it yet opens with a
            welcome in place of its header: the words on warm stone, a house photograph fading into
            them, one line and one next step.
          </p>
          <Empty title="A little breathing room">No visits on this day.</Empty>
          <Empty
            photo={photos.tea}
            photoPosition="center 62%"
            eyebrow="Waitlist"
            title="Nobody is waiting yet."
            action={
              <Button>
                <Plus size={16} aria-hidden="true" /> Add to the waitlist
              </Button>
            }
          >
            Add a guest who wants a time that is full. When one opens that suits them, it appears
            here for you to offer.
          </Empty>
          <ErrorMessage error="Could not save your note. Your writing is still here; try again." />
        </div>

        <div className="library-specimen">
          <h3>Loading shapes</h3>
          <p>
            Soft shapes of what is coming, never a spinner or a blank space. They wait a moment, so
            a quick load never flickers, then breathe until the content arrives.
          </p>
          <LoadingShapes rows={3} label="An example of loading shapes" />
        </div>

        <div className="library-specimen">
          <h3>More options</h3>
          <p>Settings most people never change sit behind one quiet line that opens in place.</p>
          <MoreOptions label="More booking settings">
            <label className="checkbox-label">
              <Checkbox /> Ask online guests to pass a quick check before a time is held
            </label>
          </MoreOptions>
        </div>

        <div className="library-specimen">
          <h3>One way of moving</h3>
          <p>
            Dialogs, steps, saved lines and pages filling in all arrive the same way: a fade with a
            few pixels of settling, over <code>--motion-calm</code>. Add the class{' '}
            <code>settle</code> to anything that appears in place. Motion uses the same timing for
            panels, menus, the sidebar, the mark under a chosen tab, calendar views and lists. Pages
            loading, scrolling and typing never move. Reduced motion removes all of it.
          </p>
          <Button variant="secondary" onClick={() => setSettled((n) => n + 1)}>
            Show it again
          </Button>
          <p key={settled} className="settle library-settle">
            Saved. Your changes are in place.
          </p>
        </div>
      </section>

      <section className="library-section" aria-labelledby="voice">
        <h2 id="voice">How SALEANE speaks</h2>
        <p className="library-lead">
          For anyone writing words on SALEANE’s screens, in messages to guests or in Help. The full
          guide is <code>docs/HOW_SALEANE_SPEAKS.md</code>; every example here is from the app.
        </p>
        <ol className="library-principles">
          {voiceRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>

        <h3>The truth words</h3>
        <p className="library-lead">
          Each makes a promise about the real world, so each has one meaning. When the honest word
          is the smaller one, give the reason: “Email is not connected yet, so nothing was sent.”
        </p>
        <StackTable
          caption="When each truth word may be used"
          columns={['Word', 'Use it when', 'In the app']}
          rows={truthWords}
        />

        <h3>Words we use</h3>
        <StackTable
          caption="Words we use and words we avoid"
          columns={['We say', 'We avoid', 'In the app']}
          rows={wordChoices}
        />

        <h3>The team and guests</h3>
        <p className="library-lead">
          The same calm voice, different words. A guest never sees roles, test mode jargon or
          internal names.
        </p>
        <StackTable
          caption="The same moment for the team and for a guest"
          columns={['Moment', 'To the team', 'To a guest']}
          rows={audiences}
        />

        <div className="library-voice-pair">
          <div>
            <h3>Saying no</h3>
            <p className="library-lead">The reason in a few words, then who can help.</p>
            <ul className="library-quotes">
              {refusals.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>When something goes wrong</h3>
            <p className="library-lead">What did not happen, that nothing is lost, what next.</p>
            <ul className="library-quotes">
              {errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <h3>UK and US studios</h3>
        <p className="library-lead">
          Screens stay in British spelling everywhere. Dates, times and money follow the studio’s
          own country through <code>src/domain/format.ts</code>.
        </p>
        <StackTable
          caption="Dates, times and money in a UK and a US studio"
          columns={['Form', 'UK studio', 'US studio']}
          rows={regionalForms}
        />
      </section>
    </div>
  )
}

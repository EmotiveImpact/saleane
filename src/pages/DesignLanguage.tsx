import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Avatar,
  Button,
  Definition,
  Empty,
  ErrorMessage,
  LoadingShapes,
  Metric,
  Modal,
  MoreOptions,
  PageHeader,
  SegmentedControl,
  Stat,
  Stats,
  Status,
  Tabs,
  TimeChoices,
  photos,
} from '../design'
import '../design/library.css'

const colours = [
  ['--ink', 'Ink', 'Primary text, primary actions'],
  ['--ink-deep', 'Deep ink', 'Selected navigation, strongest structure'],
  ['--muted', 'Muted', 'Secondary text and metadata'],
  ['--paper', 'Paper', 'Work surfaces and fields'],
  ['--mineral', 'Mineral', 'Application ground'],
  ['--line', 'Line', 'Table and section rules'],
  ['--brand', 'First studio colour', 'Chosen by the studio. Buttons, selection, focus'],
  ['--rose', 'Second studio colour', 'Chosen by the studio. Now line, counts, ready to return'],
  ['--sage', 'Brand soft', 'Selection, attention panel, skin and wellbeing'],
  ['--blue', 'Mist', 'Body and skin context'],
  ['--sand', 'Sand', 'Hair and styling context'],
  ['--brass', 'Brass', 'Small warm accents only'],
  ['--focus', 'Focus', 'Keyboard focus outline'],
  ['--danger', 'Clay', 'Errors and destructive confirmation'],
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
  ['--text-display', 'Display', 'Editorial greetings on Today, booking and accounts', 'editorial'],
  ['--text-title-compact', 'Compact title', 'Working screen titles', 'editorial'],
  ['--text-title-m', 'Title', 'Panel and side-sheet headings', 'sans'],
  ['--text-title-s', 'Section', 'Section headings', 'sans'],
  ['--text-lead', 'Lead', 'Lead paragraphs and card names', 'sans'],
  ['--text-body', 'Body', 'Operational text, buttons, fields', 'sans'],
  ['--text-small', 'Small', 'Supporting text and table cells', 'sans'],
  ['--text-meta', 'Meta', 'Labels and secondary detail', 'sans'],
  ['--text-micro', 'Micro', 'The floor: statuses, timestamps, captions', 'sans'],
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

export function DesignLanguage() {
  const allColours = [...new Set([...colours.map(([n]) => n), ...pairs.flat()])]
  const [{ hex, sizes, spacing }] = useState(() => ({
    hex: readColours(allColours),
    sizes: readTokens(typeScale.map(([n]) => n)),
    spacing: readTokens(spaces),
  }))
  const [period, setPeriod] = useState('7')
  const [view, setView] = useState('people')
  const [tab, setTab] = useState('services')
  const [time, setTime] = useState<number | null>(600)
  const [modal, setModal] = useState(false)
  const [settled, setSettled] = useState(0)
  return (
    <div className="library">
      <PageHeader
        title="Design language"
        description="The tokens and components every SALEANE screen is built from, shown live from the code."
      />

      <section className="surface library-section" aria-labelledby="principles">
        <h2 id="principles">Principles</h2>
        <ol className="library-principles">
          <li>
            <strong>Hospitality before software.</strong> Warm off-white, the studio's own colours
            and a light serif set a calm studio tone. Photography belongs to guests and moments of
            arrival.
          </li>
          <li>
            <strong>Space goes to the work.</strong> Editorial headers greet on Today and booking;
            working screens use the compact header so the calendar, clients and money come first.
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
            not processed. Loading, empty, unavailable and error states say what happens next.
          </li>
        </ol>
      </section>

      <section className="surface library-section" aria-labelledby="colour">
        <h2 id="colour">Colour</h2>
        <p className="library-lead">
          Semantic tokens in <code>src/design/tokens.css</code>. Components use these names, never
          raw hex values.
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
        <table className="library-table">
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

      <section className="surface library-section" aria-labelledby="type">
        <h2 id="type">Type</h2>
        <p className="library-lead">
          Financier Display Light for headings, names and the greeting, with Newsreader as the free
          stand-in until the licence is bought. Figtree for everything read while working: 360 for
          body text, 460 for the menu and 560 for emphasis. Times and money use tabular figures.
        </p>
        <div className="library-type">
          {typeScale.map(([name, label, use, family]) => (
            <div key={name}>
              <span
                className={family === 'editorial' ? 'library-serif' : ''}
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

      <section className="surface library-section" aria-labelledby="space">
        <h2 id="space">Space and shape</h2>
        <p className="library-lead">
          A 4px base. Surfaces have 7px corners, fields and actions 5px, people are round. Touch
          targets aim for 44px.
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
      </section>

      <section className="surface library-section" aria-labelledby="components">
        <h2 id="components">Components</h2>
        <p className="library-lead">
          Imported from <code>src/design</code>. Interactive primitives are built on Radix (Dialog,
          Tabs, Toggle Group, Popover) and styled with these tokens.
        </p>

        <div className="library-specimen">
          <h3>Page header</h3>
          <p>
            Editorial for arrival; compact for working screens. Every staff page has a small
            eyebrow, a serif title, one line of description and its actions on the right. A page
            that opens a part of the studio can lead with a thin band of a house photograph.
          </p>
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
        </div>

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
          <p>Radix Toggle Group. One option always stays selected; arrow keys move between them.</p>
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
            Radix Tabs, for sections that replace each other in place. A long list, as in Settings,
            splits into named groups and becomes one select on a phone.
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
            Label, figure and plain detail, in one figure style everywhere. Headline money is in
            whole pounds; receipts and tables keep the pence. A Radix Popover explains how a figure
            is measured.
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
              definition={<p>The average of every guest's rating for their visit.</p>}
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
          <h3>Status</h3>
          <p>Text and a dot, never colour alone.</p>
          <div className="library-row">
            {['confirmed', 'arrived', 'completed', 'cancelled', 'no_show'].map((status) => (
              <Status key={status} status={status} />
            ))}
          </div>
        </div>

        <div className="library-specimen">
          <h3>Avatar</h3>
          <p>Fictional seed portraits, otherwise initials on a staff tone.</p>
          <div className="library-row">
            <Avatar identity="staff-maya" name="Maya Lewis" />
            <Avatar name="Sophia Reed" tone="blue" />
            <Avatar name="Theo Bennett" tone="sand" />
            <Avatar small name="Amelia Carter" tone="sage" />
          </div>
        </div>

        <div className="library-specimen">
          <h3>Time choices</h3>
          <p>Native radios: arrow keys select, one time at a time.</p>
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
        </div>

        <div className="library-specimen">
          <h3>Dialog</h3>
          <p>Radix Dialog: focus is trapped, Escape closes and focus returns to the trigger.</p>
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
          <h3>Empty and error states</h3>
          <p>
            A small gap in a list says so in one line. A page with nothing in it yet takes a house
            photograph, one line and one next step.
          </p>
          <Empty title="A little breathing room">No visits on this day.</Empty>
          <Empty
            photo={photos.tea}
            title="Nobody is waiting yet."
            action={
              <Button>
                <Plus size={16} aria-hidden="true" /> Add to the waitlist
              </Button>
            }
          >
            Add a guest who wants a time that is full, and a time that suits them appears here the
            moment one opens.
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
              <input type="checkbox" /> Ask online guests to pass a quick check before a time is
              held
            </label>
          </MoreOptions>
        </div>

        <div className="library-specimen">
          <h3>One way of moving</h3>
          <p>
            Dialogs, steps, saved lines and pages filling in all arrive the same way: a fade with a
            few pixels of settling, over <code>--motion-calm</code>. Add the class{' '}
            <code>settle</code> to anything that appears in place. Reduced motion removes it.
          </p>
          <Button variant="secondary" onClick={() => setSettled((n) => n + 1)}>
            Show it again
          </Button>
          <p key={settled} className="settle library-settle">
            Saved. Your changes are in place.
          </p>
        </div>
      </section>

      <section className="surface library-section" aria-labelledby="voice">
        <h2 id="voice">Voice</h2>
        <ul className="library-principles">
          <li>British English, calm and specific. No exclamation marks in the app.</li>
          <li>Editorial lines are short and warm; working copy says exactly what will happen.</li>
          <li>Never claim a payment was processed or a message was sent when it was recorded.</li>
          <li>Errors keep the person’s input and name the next step.</li>
        </ul>
      </section>
    </div>
  )
}

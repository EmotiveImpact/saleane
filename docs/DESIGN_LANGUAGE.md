# SALEANE design language

Library 0.4 · new look built 7 October 2026 (library 0.3 introduced 6 October 2026). This is the working reference for building SALEANE screens. It sits beside [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), which records the visual direction, its history and component contracts. When the two disagree on a value, the code in `src/design/` wins and both documents are corrected.

- **Tokens:** `src/design/tokens.css`
- **Components:** `src/design/` (import from `'../design'`)
- **Living library:** `/design-language` in the workspace (linked from the footer). It reads token values from the running stylesheet and computes contrast live, so it cannot drift from the code.

## Principles

1. **Hospitality before software.** A warm off-white ground, the studio's own two colours and a light serif set the tone of a calm, independent studio. Photography belongs to guests and moments of arrival, never to dense operational surfaces.
2. **Space goes to the work.** The editorial greeting is reserved for Today, guest booking and accounts. Working screens (Calendar, Clients, Inbox, Business, Money, Manage) use the compact header so the content starts near the top.
3. **Readable at a glance.** Nothing in the workspace renders below 12px, except 11px capital eyebrows and table headers, which carry wide tracking and never hold essential information alone. Every text and background pairing reaches WCAG 2.2 AA (4.5:1). Colour never carries meaning alone.
4. **One measure, one meaning.** A figure shown in more than one place has one name, one definition and a stated period.
5. **Honest states.** A queued message is not sent, a recorded payment is not processed. Loading, empty, unavailable and error states say what happens next and keep the person's input.

## Tokens

Components use semantic tokens. The raw `--palette-*` values exist so the semantic layer has something to point at; use them directly only inside the design library.

### Colour

| Token                          | Value                               | Use                                                  |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------- |
| `--brand`                      | `#5f8471` (sage) by default         | Studio's first colour: buttons, selection, focus     |
| `--rose`                       | `#c27286` (soft rose) by default    | Studio's second colour: now line, counts, return due |
| `--brand-soft` / `--brand-mid` | brand at 10% / 32% on warm white    | Quiet selected fills, free time, chart bars          |
| `--brand-ink` / `--rose-ink`   | brand 72% / rose 65% mixed with ink | Text in the studio colours (AA on white)             |
| `--ink`                        | `#2e2b33`                           | Primary text                                         |
| `--muted` / `--faint`          | `#6b6670` / `#9a949c`               | Secondary text; faint is for non-essential text only |
| `--paper`                      | `#ffffff`                           | Cards, work surfaces and fields                      |
| `--mineral` (page)             | `#faf8f5`                           | Application ground                                   |
| `--side` / `--stone`           | `#f4f1ec` / `#f3f0eb`               | Sidebar; quiet fills and initials avatars            |
| `--line` / `--line2`           | `#ebe5df` / `#ddd5ce`               | Rules; button and field borders                      |
| `--sage` (now brand soft)      | follows `--brand-soft`              | Selection, attention, skin and wellbeing             |
| `--blue` (mist), `--sand`      | `#f7eff1`, `#f3f0eb`                | Body and hair service contexts                       |
| `--focus`                      | follows `--brand`                   | 2px keyboard focus outline, 3px offset               |
| `--action` / `--action-hover`  | brand 88% / 76% mixed with ink      | Primary buttons, deepened so white text passes AA    |
| `--danger` / `--danger-soft`   | `#8c2e24` / `#fcf1ef`               | Errors and destructive confirmation                  |

**Studio colours.** Each studio picks a first and second colour in workspace settings. First: Sage, Heather, Slate, Teal, Clay or Rosewood. Second: Soft rose, Apricot, Lavender, Sky or Olive. Every preset was checked: white on `--action` and `--rose-ink` on white stay at 4.79:1 or above. The choice is saved in this browser only for now, so guests on another device see the house colours until studio settings are stored on the server.

Staff tones pair a background with the ink that reads on it: `--tone-sage-bg/ink`, `--tone-blue-bg/ink`, `--tone-sand-bg/ink`. All checked pairings are listed with live ratios on the library page.

Older one-off tints remain in `src/styles.css`. Replace them with tokens when a rule is next touched; do not add new raw hex values.

### Type

Financier Display Light (Klim) for headings, names, the greeting and the wordmark. Its licence is not bought yet, so the committed code uses the free Newsreader Variable at weight 300, then Georgia; Financier is only tried locally and its files never enter the repository. Figtree Variable for everything read while working: 360 for body text, 460 for the menu and 560 for emphasis (names in rows, buttons, totals). Body text is 15px with a line height of 1.5. Times and money use tabular figures, and big figures use Figtree 360 rather than the serif.

| Token                  | Size                     | Use                                   |
| ---------------------- | ------------------------ | ------------------------------------- |
| `--text-greeting`      | clamp(38px, 4vw, 52px)   | Today greeting (serif)                |
| `--text-display`       | clamp(34px, 3.4vw, 44px) | Page headings (serif)                 |
| `--text-title-compact` | 28px                     | Compact working-screen titles (serif) |
| `--text-title-m`       | 26px                     | Panel and side-sheet headings         |
| `--text-title-s`       | 19px                     | Section headings                      |
| `--text-lead`          | 17px                     | Lead paragraphs, card names           |
| `--text-body`          | 15px                     | Operational text, buttons, fields     |
| `--text-small`         | 14px                     | Supporting text, table cells          |
| `--text-meta`          | 13px                     | Labels, secondary detail              |
| `--text-micro`         | 12px                     | **The floor.** Statuses, timestamps   |
| `--text-eyebrow`       | 11px                     | Capital eyebrows and table headers    |
| `--text-stat`          | 34px                     | Big figures (Figtree 360)             |

Display sizes on guest booking and marketing panels may sit outside this scale.

### Space, shape, elevation

- Space: `--space-1` to `--space-10` on a 4px base (4, 8, 12, 16, 20, 24, 32, 40).
- Corners: `--radius` 7px for surfaces, `--radius-control` 5px for fields and actions, `--radius-inner` 3px inside grouped controls, `--radius-round` for people.
- Elevation: `--shadow-float` for popovers, `--shadow-dialog` for dialogs. Surfaces in the page use a line, not a shadow.
- No left-edge stripes. Cards, notes, errors and visits never carry a coloured border or inset shadow on one side; their tone comes from the surface colour and the words. The only left rules are the 1px `--line` dividers between calendar columns, and `src/design/edges.test.ts` enforces this.
- Touch: `--target` 44px. Motion: `--motion-quick` for hover and focus only; reduced motion removes transitions.

## Components

All are exported from `src/design/index.ts`. Interactive primitives use Radix, unstyled, and take their look from these tokens. Radix packages in use: Dialog, Tabs, Toggle Group, Popover. Add another Radix primitive when a pattern needs its keyboard and focus behaviour, not for appearance alone.

| Component               | Built on           | When to use                                                                                           |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `PageHeader`            | native             | Every page title. `variant="editorial"` for Today, booking, accounts; `compact` elsewhere             |
| `Button`                | native             | Actions. Primary, secondary, quiet, light. Name the action, not the control                           |
| `SegmentedControl`      | Radix Toggle Group | One choice between views of the same content: a period, a filter, a layout. Always keeps one selected |
| `Tabs`                  | Radix Tabs         | Sections that replace each other in place (Manage)                                                    |
| `Definition`            | Radix Popover      | How a figure is measured. Opens by tap, click or keyboard; never hover-only                           |
| `Metric`                | native             | Label, value, plain detail; optional `definition`. No decorative trend claims                         |
| `Status`                | native             | Visit state as text plus dot                                                                          |
| `Avatar`                | native             | Fictional seed portrait or initials on a staff tone; decorative beside a visible name                 |
| `TimeChoices`           | native radios      | Picking an appointment time; arrow keys select                                                        |
| `DateStrip`             | native radios      | Picking a day from the next fortnight, each showing how many times it has                             |
| `Modal`                 | Radix Dialog       | One decision or one record. Focus trapped, Escape closes, focus returns                               |
| `Empty`, `ErrorMessage` | native             | Empty and failed states with a next step                                                              |

Route links (main navigation, the Business sub-navigation) stay as links. They are not tabs, because each one changes the URL.

## Patterns

- **Page header.** Working screens: one serif line at 26px, one short description, actions on the right. No eyebrow, since the header breadcrumb already names the page.
- **Shared figures.** "Time booked" is booked service minutes over scheduled professional hours, less closures, on both Today (one day) and Business (the chosen period, with today's figure alongside). The wording lives in `src/components/definitions.ts`.
- **Client timeline.** One entry per visit, dated by when the visit happens. Its booking, moves, arrival, checkout, deposits and refunds appear as steps inside. Notes, consent and relationships stay as their own entries. Grouping is `groupTimeline` in `src/domain/timeline.ts`.
- **Narrow calendar.** Below 650px the grid becomes one swipeable column per professional, with free time written between visits and a summary row showing each person's free time. The list view remains available from the same toggle. Segments come from `staffDay` in `src/domain/selectors.ts`.

- **Long records.** Lists that grow with time (receipts, client history) show recent items first in slim rows, grouped by day where money is totalled, with a way to see earlier ones. Past visits fold to one line and open in place.
- **Figures on phones.** Below 650px, metric groups become one slim strip and their detail lines are hidden; the label and value stay.
- **Nothing lost on small screens.** When a column is hidden at a narrower width, its value moves under the row's name rather than disappearing.
- **Setting up.** A new owner's setup is a full page beside a house photograph, one job per screen, each saved on Continue so they can leave and pick up where they left off. Adding a location is a wizard in a `Modal` that saves only on its last step, because it adds a place guests can book and a monthly price. The welcome for someone joining a studio uses the same full page with three screens and a way to skip it. Lists that help a new studio along (the ready list, then the first weeks) sit on Today, tick themselves from what is done, and go once finished or hidden.
- **Plain words.** Say what is not connected yet in studio language ("Card payments are not connected yet"), never configuration names or internal codes.
- **Start where you are.** Free time on the calendar books there, and a dragged visit opens the move step at its new spot. Shortcuts fill in choices; the same checks and confirmation still decide.
- **Times in groups.** Long runs of times sit under Morning, Afternoon and Evening.

## Voice

British English, calm and specific, no exclamation marks in the workspace. Editorial lines are short and warm; working copy says exactly what will happen. Errors keep the person's input and name the next step. Never imply that a recorded payment was processed or a queued message was sent.

## Checking a change

Run `npm run check` and `npm run format:check`, then open `/design-language` and the changed screens at 1440px and 390px. The library's pairing table must show AA for every row. Automated contrast checks support, but do not replace, keyboard and screen-reader review.

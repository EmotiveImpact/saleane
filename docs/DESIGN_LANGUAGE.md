# SALEANE design language

Library 0.3 · introduced 6 October 2026. This is the working reference for building SALEANE screens. It sits beside [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), which records the visual direction, its history and component contracts. When the two disagree on a value, the code in `src/design/` wins and both documents are corrected.

- **Tokens:** `src/design/tokens.css`
- **Components:** `src/design/` (import from `'../design'`)
- **Living library:** `/design-language` in the workspace (linked from the footer). It reads token values from the running stylesheet and computes contrast live, so it cannot drift from the code.

## Principles

1. **Hospitality before software.** Ivory, sage and a high-contrast Bodoni serif set the tone of a calm, independent studio. Photography belongs to guests and moments of arrival, never to dense operational surfaces.
2. **Space goes to the work.** The editorial greeting is reserved for Today, guest booking and accounts. Working screens (Calendar, Clients, Inbox, Business, Money, Manage) use the compact header so the content starts near the top.
3. **Readable at a glance.** Nothing in the workspace renders below 12px. Every text and background pairing reaches WCAG 2.2 AA (4.5:1). Colour never carries meaning alone.
4. **One measure, one meaning.** A figure shown in more than one place has one name, one definition and a stated period.
5. **Honest states.** A queued message is not sent, a recorded payment is not processed. Loading, empty, unavailable and error states say what happens next and keep the person's input.

## Tokens

Components use semantic tokens. The raw `--palette-*` values exist so the semantic layer has something to point at; use them directly only inside the design library.

### Colour

| Token                         | Value                 | Use                                      |
| ----------------------------- | --------------------- | ---------------------------------------- |
| `--ink`                       | `#29392f`             | Primary text and primary actions         |
| `--ink-deep`                  | `#203329`             | Selected navigation, strongest structure |
| `--muted`                     | `#656b63`             | Secondary text and metadata              |
| `--paper`                     | `#ffffff`             | Work surfaces and fields                 |
| `--mineral`                   | `#faf9f6`             | Application ground                       |
| `--line` / `--line-strong`    | `#e2e2da` / `#d4d5cc` | Rules; stronger dividers and outlines    |
| `--field-line`                | `#b9c0b3`             | Form field borders                       |
| `--sage` / `--sage-soft`      | `#e9eee5` / `#f4f7f2` | Selection, attention, free time          |
| `--blue` (mist), `--sand`     | `#edf0ef`, `#f1ece3`  | Body and hair service contexts           |
| `--brass`                     | `#a89a7a`             | Small warm accents only                  |
| `--focus`                     | `#9a722e`             | Keyboard focus outline                   |
| `--action` / `--action-hover` | `#29392f` / `#395341` | Primary buttons                          |
| `--danger` / `--danger-soft`  | `#8c2e24` / `#fcf1ef` | Errors and destructive confirmation      |

Staff tones pair a background with the ink that reads on it: `--tone-sage-bg/ink`, `--tone-blue-bg/ink`, `--tone-sand-bg/ink`. All checked pairings are listed with live ratios on the library page.

Older one-off tints remain in `src/styles.css`. Replace them with tokens when a rule is next touched; do not add new raw hex values.

### Type

Bodoni Moda Variable for the wordmark and editorial moments. Source Sans 3 Variable for everything read while working. Times and money use tabular figures.

| Token                  | Size                     | Use                                   |
| ---------------------- | ------------------------ | ------------------------------------- |
| `--text-display`       | clamp(29px, 2.8vw, 38px) | Editorial greetings (serif)           |
| `--text-title-compact` | 26px                     | Compact working-screen titles (serif) |
| `--text-title-m`       | 24px                     | Panel and side-sheet headings         |
| `--text-title-s`       | 19px                     | Section headings                      |
| `--text-lead`          | 17px                     | Lead paragraphs, card names           |
| `--text-body`          | 15px                     | Operational text, buttons, fields     |
| `--text-small`         | 14px                     | Supporting text, table cells          |
| `--text-meta`          | 13px                     | Labels, secondary detail              |
| `--text-micro`         | 12px                     | **The floor.** Statuses, timestamps   |

Display sizes on guest booking and marketing panels may sit outside this scale.

### Space, shape, elevation

- Space: `--space-1` to `--space-10` on a 4px base (4, 8, 12, 16, 20, 24, 32, 40).
- Corners: `--radius` 7px for surfaces, `--radius-control` 5px for fields and actions, `--radius-inner` 3px inside grouped controls, `--radius-round` for people.
- Elevation: `--shadow-float` for popovers, `--shadow-dialog` for dialogs. Surfaces in the page use a line, not a shadow.
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
| `Modal`                 | Radix Dialog       | One decision or one record. Focus trapped, Escape closes, focus returns                               |
| `Empty`, `ErrorMessage` | native             | Empty and failed states with a next step                                                              |

Route links (main navigation, the Business sub-navigation) stay as links. They are not tabs, because each one changes the URL.

## Patterns

- **Page header.** Working screens: one serif line at 26px, one short description, actions on the right. No eyebrow, since the header breadcrumb already names the page.
- **Shared figures.** "Time booked" is booked service minutes over scheduled professional hours, less closures, on both Today (one day) and Business (the chosen period, with today's figure alongside). The wording lives in `src/components/definitions.ts`.
- **Client timeline.** One entry per visit, dated by when the visit happens. Its booking, moves, arrival, checkout, deposits and refunds appear as steps inside. Notes, consent and relationships stay as their own entries. Grouping is `groupTimeline` in `src/domain/timeline.ts`.
- **Narrow calendar.** Below 650px the grid becomes one swipeable column per professional, with free time written between visits and a summary row showing each person's free time. The list view remains available from the same toggle. Segments come from `staffDay` in `src/domain/selectors.ts`.

## Voice

British English, calm and specific, no exclamation marks in the workspace. Editorial lines are short and warm; working copy says exactly what will happen. Errors keep the person's input and name the next step. Never imply that a recorded payment was processed or a queued message was sent.

## Checking a change

Run `npm run check` and `npm run format:check`, then open `/design-language` and the changed screens at 1440px and 390px. The library's pairing table must show AA for every row. Automated contrast checks support, but do not replace, keyboard and screen-reader review.

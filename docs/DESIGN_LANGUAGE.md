# SALEANE design language

Library 0.6 · Radix and Motion added on 11 October 2026, brought up to date on 10 October 2026, quality bar added 9 October 2026 (new look built 7 October 2026, library 0.3 introduced 6 October 2026). This is the working reference for building SALEANE screens. It sits beside [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), which records the visual direction, its history and component contracts. When the two disagree on a value, the code in `src/design/` wins and both documents are corrected.

- **Tokens:** `src/design/tokens.css`
- **Components:** `src/design/` (import from `'../design'`)
- **Living library:** `/design-language` in the workspace (linked from the footer). It reads token values from the running stylesheet and computes contrast live, so it cannot drift from the code.
- **Words:** [HOW_SALEANE_SPEAKS.md](HOW_SALEANE_SPEAKS.md), shown in short on the living library.

## Principles

1. **Hospitality before software.** A warm off-white ground, the studio's own two colours and a light serif set the tone of a calm, independent studio. Photographs belong to arrivals, empty pages and guest moments, never to dense working surfaces.
2. **Space goes to the work.** The editorial greeting is reserved for the pages people arrive at (Today, a professional's day, a regional manager's area, guest booking and accounts). Every other page uses the compact top so the content starts near the top. See [Page tops](#page-tops).
3. **Room, not boxes.** Space and hairlines separate things. A card never sits inside a card, and each page or section has one main button.
4. **Readable at a glance.** Nothing in the workspace renders below 12px, except 11px capital eyebrows and table headers, which carry wide tracking and never hold essential information alone. Every text and background pairing reaches WCAG 2.2 AA (4.5:1). Colour never carries meaning alone.
5. **One measure, one meaning.** A figure shown in more than one place has one name, one definition and a stated period.
6. **Honest states.** A queued message is not sent, a recorded payment is not charged. Loading, empty, unavailable and error states say what happens next and keep the person's input.

## Decided since Radix and Motion

Edem asked on 11 October 2026 for the whole library to run on Radix and Motion. These are the decisions made since then, each written in full in the section linked.

1. **Radix and Motion, through the library only.** Every menu, hint, notice, drop-down, tick and switch is a Radix part, and lists, panels and chosen marks move with Motion. Screens reach both only through `src/design`. See [Components](#components).
2. **Movement answers a person.** Nothing moves while a page loads, scrolls or someone types, and nothing loops. Reduced motion, and tests, see every change at once. See [Where things move](#where-things-move).
3. **SALEANE's own controls.** Every drop-down is `Select` and every tick is `Checkbox`; a setting that takes effect as a whole is a `Switch`. Round choices and folds stay native, drawn to match. See [Components](#components).
4. **Hints are SALEANE's, never the browser's.** `Tip` replaces browser title text and never holds anything a person needs. See [Patterns](#patterns).
5. **One everyday action per row.** The rest go under one More menu named for the row, with Stock as the reference. See [Patterns](#patterns).
6. **Notices only where nothing else says it.** A corner notice confirms what saved out of view; where a saved line already sits beside the button, that line is enough. See [Patterns](#patterns).
7. **A calmer frame.** The line under SALEANE in the sidebar is gone and the items sit higher (Edem, 11 October). The sidebar folds to its icons, the studio's name and your own open menus, and the phone menu is a drawer from the left. See [The frame](#the-frame).
8. **Find a client from the keyboard.** "/" or Ctrl/Cmd K opens it from anywhere; arrow keys and Enter choose. See [The frame](#the-frame).
9. **44px on phones and touch screens.** Every target reaches `--target`, small marks through an invisible touch area. See [Space, shape, elevation](#space-shape-elevation).
10. **A new studio meets welcomes, not noughts.** See [Patterns](#patterns).
11. **What needs you comes first on a phone's Today.** See [Patterns](#patterns).
12. **Section rows above the eyebrow.** Money, Team, Business and Marketing put their row of sections above the page top, and Marketing uses the working tool top. See [Page tops](#page-tops).
13. **The assistant's name is written once.** "Ask" and the app's name, from `ASK_NAME`. See [Voice](#voice).
14. **A view switch never moves.** The calendar's Today, Week and Month switch keeps one spot at the far right in every view (Edem, 11 October). See [Patterns](#patterns).
15. **A top bar that never crowds, and a folded sidebar that opens easily.** From Edem's comments on the demo, 11 October. See [The frame](#the-frame).
16. **The booking page's footer says "Connected by SALEANE"** and nothing more. See [Voice](#voice).
17. **Where things live.** Money and Team have their own places in the sidebar, Business keeps how the studio is doing, Settings is four groups with Find a setting, and what is yours alone (your preferences, password, two-step sign-in and Face ID) is on You, from your name (Edem, "Build all", 11 October). The six moves from the finishing check came with it. See [The frame](#the-frame).

Still waiting for a yes, so not yet a rule: phone Today in tabs with a count on each.

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

Two faces only. Financier Display Light (Klim) is the decided face for headings, names, the greeting and the wordmark. Until its files are licensed for the repository, Newsreader Variable at weight 300 stands in for it (`--font-editorial`, then Georgia); Financier is only tried locally and its files never enter the repository. The in-app library names Financier and its stand-in but says nothing about buying it. Figtree Variable for everything read while working: 360 for body text, 460 for the menu and 560 for emphasis (names in rows, buttons, totals). Body text is 15px with a line height of 1.5. Times and money use tabular figures, and big figures use Figtree 360 rather than the serif.

| Token                  | Size                     | Use                                   |
| ---------------------- | ------------------------ | ------------------------------------- |
| `--text-greeting`      | clamp(38px, 4vw, 52px)   | Today greeting (serif)                |
| `--text-display`       | clamp(34px, 3.4vw, 44px) | Page titles on a computer (serif)     |
| `--text-title-compact` | 28px                     | Page titles shown inside the library  |
| `--text-title-m`       | 26px                     | Panels, side sheets, titles on phones |
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
- Corners: `--radius` 20px for cards and sections, `--radius-large` 24px for the greeting, `--radius-panel` 14px for panels inside a page, `--radius-control` 12px for fields, `--radius-inner` 8px for small marks inside a control, `--radius-pill` for buttons, tags and chips, `--radius-round` for people.
- Elevation: `--shadow-float` for popovers, `--shadow-dialog` for dialogs. Surfaces in the page use a line, not a shadow.
- No left-edge stripes. Cards, notes, errors and visits never carry a coloured border or inset shadow on one side; their tone comes from the surface colour and the words. The only left rules are the 1px `--line` dividers between calendar columns, and `src/design/edges.test.ts` enforces this.
- Touch: `--target` is 44px. On phones and touch screens (`(max-width: 650px), (pointer: coarse)`) every icon button, choice, filter chip and list item reaches it. A small mark (a tick, a choice inside a pill, a name in a list) keeps its drawn size and reaches 44px through an invisible `::after` area, so a thumb on its edge still lands. Links inside a sentence are the one exception, as WCAG allows. A computer with a mouse keeps its compact sizes, with the calendar's arrows at 40px.
- Motion: `--motion-quick` for hover and focus only; `--motion-calm` and `--ease-calm` for everything that arrives or leaves (see [Where things move](#where-things-move)). Reduced motion removes all of it.

## Components

All are exported from `src/design/index.ts`. Interactive primitives use Radix (the single `radix-ui` package), unstyled, and take their look from these tokens. Radix parts in use: Dialog, Dropdown Menu, Tooltip, Toast, Select, Checkbox, Switch, Tabs, Toggle Group, Popover. Screens import them only through `src/design`, never from `radix-ui` directly. Add another Radix part when a pattern needs its keyboard and focus behaviour, not for appearance alone. Movement comes from Motion (`motion/react`, formerly Framer Motion), also only through `src/design`; see [Where things move](#where-things-move).

| Component                         | Built on                     | When to use                                                                                                                     |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                      | native                       | Every staff page top. See [Page tops](#page-tops). `photo` for a page people arrive at                                          |
| `Button`                          | native                       | Actions. Primary, secondary, quiet, light. Name the action, not the control                                                     |
| `SegmentedControl`                | Radix Toggle Group, Motion   | One choice between views of the same content: a period, a filter, a layout. Always keeps one selected                           |
| `Tabs`                            | Radix Tabs, Motion           | Sections that replace each other in place (Manage)                                                                              |
| `Menu`, `MenuItem`, `MenuChoices` | Radix Dropdown Menu          | A few things to do from one button: the studio and your own name at the top, More on a row with several actions                 |
| `Tip`                             | Radix Tooltip                | A hint beside an arrow or icon whose meaning is not written on it. Hover and keyboard only, so it never holds anything needed   |
| `Select`                          | Radix Select                 | One choice from a list. Written like a `<select>`, with `<option>` and `<optgroup>`; forms still read a plain value             |
| `Checkbox`, `Switch`              | Radix Checkbox, Radix Switch | A tick for one thing in a list or form; a switch for a setting that takes effect as a whole ("Send reminders")                  |
| `Notices`, `notify`               | Radix Toast                  | A short corner notice for something that happened out of view. Says only what really happened. `Notices` sits once in the frame |
| `Definition`                      | Radix Popover                | How a figure is measured. Opens by tap, click or keyboard; never hover-only                                                     |
| `Metric`                          | native                       | Label, value, plain detail; optional `definition`. No decorative trend claims                                                   |
| `Stats`, `Stat`                   | native                       | A row of headline figures as a definition list, one figure style everywhere                                                     |
| `Status`                          | native                       | Visit state as text plus dot                                                                                                    |
| `Avatar`                          | native                       | Fictional seed portrait or initials on a staff tone; decorative beside a visible name                                           |
| `TimeChoices`                     | native radios                | Picking an appointment time; arrow keys select                                                                                  |
| `DateStrip`                       | native radios                | Picking a day from the next fortnight, each showing how many times it has                                                       |
| `DateField`                       | Radix Popover                | A date in a form, written out in the studio's own way, with a calendar to pick from                                             |
| `TimeField`                       | Radix Select                 | A time in a form, in steps, on the studio's clock                                                                               |
| `MovingList`, `MovingRow`         | Motion                       | A list that changes while someone looks at it (Today, Inbox, the waitlist). Rows there on arrival simply appear                 |
| `CalmMotion`, `ChosenMark`        | Motion                       | The one calm timing for everything inside the app, and the mark that slides under a chosen tab, period or view                  |
| `MoreOptions`                     | native disclosure            | Settings most people never change, behind one quiet line that opens in place                                                    |
| `WizardSteps` and kin             | native                       | A rare job of a few steps: `WizardSteps`, `ChoiceTiles`, `WizardFooter` and `useWizardStep`                                     |
| `ScrollNav`                       | native                       | A row of links that scrolls sideways on a phone, with a fade where there is more                                                |
| `PhotoStrip`                      | native                       | The photo band. Use it only through `PageHeader`'s `photo`, never on its own                                                    |
| `photos`                          | house photographs            | The only photographs a screen may use; `treatmentPhoto` picks one for a kind of treatment                                       |
| `Modal`                           | Radix Dialog, Motion         | One decision or one record. Focus trapped, Escape closes, focus returns (to the menu's button when a menu item opened it)       |
| `Empty`, `ErrorMessage`           | native                       | Empty and failed states with a next step                                                                                        |

No screen uses a native `<select>` or checkbox: drop-downs are `Select`, ticks are `Checkbox`, and Marketing's automatic emails are the one `Switch`. Round choices (`TimeChoices`, `DateStrip`, and radios in forms) stay native inputs, drawn as SALEANE's ink ring with a paper dot, because the browser's own arrow keys between them are what people expect. Folds (`details`) also stay native, so find in page still opens them, and open to their height in browsers that can.

`/design-language` shows menus and hints, the drop-down, ticks and switches, a notice and a list that moves, live.

Route links (main navigation, the Business sub-navigation) stay as links. They are not tabs, because each one changes the URL.

## Page tops

Every staff page opens the same way, through `PageHeader`, in this order:

1. **Eyebrow.** The small capitalised label naming the part of SALEANE the page belongs to: Calendar, Clients, Inbox, Waitlist, Business, Settings. A page that greets uses the date instead.
2. **Title.** The serif title, a short human line that usually ends with a full stop ("Relationships, remembered.", "What is on the shelf."). It does not repeat the eyebrow.
3. **One line.** What the page is for, in one or two short sentences.
4. **Actions.** On the right on a computer and under the words on a phone, with at most one primary button.

Which top a page uses:

| Kind of page             | Its top                                                | Pages                                                                                                   |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| A greeting               | `editorial`, with a photograph                         | Today (its own greeting panel), a professional's day, a regional manager's area                         |
| A place people arrive    | `compact` with `photo`: one band that fades into words | Clients, Waitlist, What guests tell you                                                                 |
| A working tool or a form | `compact`, no photograph                               | Calendar, Inbox, Messages to clients, every Business page, Marketing, Money, Stock, Settings, Day sheet |
| A record or a guest page | Its own frame, in the same order                       | A client's page, booking pages, a guest's visit link, account pages                                     |

Money, Team, Business and Marketing each have a row of sections; on each it sits above the eyebrow, so the page top that follows is the same on every section.

The photo band is one house photograph from `src/design/photos.ts`, above the eyebrow, running the width of the page and fading softly into the words with no frame. One per view: a page whose body already shows photographs (Business, the till's products) does not add a band. The same title shows on the version of the page a person without access sees, with the same eyebrow. `src/design/pageTops.test.ts` checks that every staff page uses `PageHeader` with an eyebrow, and that no page sets `PhotoStrip` down on its own.

## The frame

What stays around every staff page.

- **Sidebar.** SALEANE's wordmark with nothing beneath it, then the items: Today, Calendar, Clients, Waitlist, Inbox, Marketing, Money, Team, Business and Settings. Each shows only to the people it has something for; reception has no Marketing or Business. On a computer the fold button beside the wordmark narrows the sidebar to its icons and the page widens with it; folded, each icon shows its name as a hint. Folded, hovering the S swaps it for the open button in the same place, and a click on any empty part of the sidebar opens it in full. Each person's choice is kept in that browser.
- **Top bar.** The page's name on the left gives way, ending in an ellipsis, before the buttons on the right are ever covered. When the assistant has something to mention it shows a dot; the words are for screen readers only. Below 1200px the assistant button reads "Ask" with its icon, and search, help and your menu become icon buttons, each keeping its full name for screen readers. On a phone your avatar sits inside its touch target, away from the edge.
- **The two names at the top.** The studio's name opens the studio menu: switching studio (or sample), studio details and locations for an owner, the booking page and about this version. Your own name opens your menu: your preferences, and password, two-step and Face ID (both on You), your accounts and studios, help and signing out. Neither goes straight to Settings.
- **Phone menu.** A drawer from the left with the same items and counts as the sidebar, then the booking page and You, closing back the way it came.
- **Where things live.** One sidebar item per kind of work, so nobody hunts through tabs:
  - **Money**: Takings, Gift cards, Stock and Accounts. Everything paid, sold or counted.
  - **Team**: People (who does what, where they work, and who can sign in), Rota and Pay.
  - **Business**: how the studio is doing. Overview, Feedback, Client areas and How you compare, with Branch visits and Requests once there are several locations or sign-offs.
  - **Settings**: how the studio runs, in four groups (Studio; Treatments and payments; Guests; Studio account). On a computer a Find a setting box sits above the groups and narrows them by name or by the words people use ("VAT", "parking", "Google"); on a phone one Section picker holds them all. No section is longer than it needs to be: tax sits with payments, the booking switch and booking links with the booking page, and guest notes have their own section.
  - **You**: what is one person's own and never changes anyone else: their preferences, password, two-step sign-in and Face ID, and their accounts and studios. The owner's switch asking everyone to use two-step stays on Team.
  - Older addresses still land: `/business/money`, `/business/rota` and the rest move to their new places, and `?section=staff`, `preferences` and `diaries` open Team, You and Connected software.
- **Notices** sit once in the frame, in the corner.
- **Find a client.** "/" (when not typing) or Ctrl/Cmd K opens it from anywhere. Arrow keys move through the matches and Enter opens one.

## Patterns

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
- **View switches.** A view switch sits at the far right of its toolbar and holds the same spot in every view; controls that only appear in one view keep their space in the others, so nothing jumps when the view changes. On a phone it sits on its own row under the date. The calendar's Today, Week and Month switch is the reference.
- **Rows with several actions.** The everyday action stays on the row as a quiet button; the rest go under one More menu named for the row ("More for Calming Cleansing Balm"). Stock is the reference.
- **Hints.** An arrow or icon whose meaning is not written on it gets a `Tip`. It never holds anything a person must read to act, because a phone has no hover; the button keeps its own words or `aria-label`. Browser title text is not used for hints, since it shows late, only to a mouse and never on a phone. The email preview's frame keeps its `title`, which is its name for screen readers.
- **Notices.** Use `notify` when something was confirmed where the person may not be looking (a pop-up that closed as it saved). Where a saved line already sits beside the button, keep the line and send no notice. Stock is the reference: a delivery, a count, stock used and a move each say what was recorded.
- **A new studio.** Pages that would open on figures at nought or an empty grid (Business, Accounts, Client areas, Marketing's Audience, Stock, the Calendar before anyone is on the team) open with the `Empty` welcome, saying what will appear and, where it helps, the next step. Accounts keeps its Xero or QuickBooks set-up below the welcome, the Waitlist keeps the quiet-time price, and Audience keeps the words guests agree to. Today shows no figures until the first visit is booked. An owner who has not finished setting up is sent back to where they left off.
- **Today on a phone.** What needs someone comes before the day's list. A strip under the greeting names what is waiting (calls to return, calls the AI answered, patch tests to sort, reminders), and each item jumps to its card. It shows only on phones, and only when something waits.
- **Wizards.** A job with a few distinct steps runs in a `Modal` with `WizardSteps` along the top: one job per step, Continue held until the step is complete, Back always there, nothing saved until the last step, and that step saying in plain sentences what will happen. Each step opens at the top with its heading focused (`useWizardStep`). Moving in (`MovingIn.tsx`) is the reference.

## Where things move

Movement answers something a person did, so the eye can follow it. Motion (`motion/react`) moves lists, chosen marks and things that leave, wrapped once by `CalmMotion` so every animation takes `calm` timing; simpler arrivals use CSS on `--motion-calm` and `--ease-calm`. Both are the same calm timing.

| What                          | How it moves                                                                         | Where it lives                   |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------- |
| Sidebar folding to its icons  | The sidebar narrows and the page widens together                                     | `styles.css`                     |
| Phone menu                    | A drawer slides in from the left and back out                                        | `Modal` with `placement="start"` |
| Side panels and pop-ups       | Slide in a little and leave back the way they came, after focus has already moved on | `Modal`, `leaveGently`           |
| Menus, hints, drop-downs      | Fade in with a few pixels of settling, and leave a little quicker                    | `controls.css`                   |
| Notices                       | Arrive from the corner; swipe or close to clear                                      | `Notices`                        |
| Tabs, periods, calendar views | The chosen mark slides from the old choice to the new one                            | `ChosenMark`                     |
| A new calendar view or day    | Fades up in place of the last one                                                    | `Calendar.tsx`, `arriveGently`   |
| A visit dragged to a new time | Glides into its new place                                                            | `settleFrom`                     |
| Today, Inbox, the waitlist    | A new row settles in, a row that goes fades, the rest slide aside                    | `MovingList`, `MovingRow`        |
| Guest booking steps           | Slide forward and back                                                               | `useStepArrival`                 |
| Ticks and switches            | The tick settles in; the knob slides                                                 | `Checkbox`, `Switch`             |
| Folds                         | Open and close to their height, where the browser can                                | `controls.css`                   |

Everything is placed before the screen is drawn, so nothing flashes, and rows already there when a page opens simply appear.

Never: pages loading, scrolling, typing (including checkout), or anything that loops. `useMotionAllowed` is false for reduced motion and in tests, and then every change happens at once.

## Voice

The full guide is [How SALEANE speaks](HOW_SALEANE_SPEAKS.md); the living library shows its short form. In brief: plain British English, calm and specific, no exclamation marks and no em dashes. Say visit, treatment, SALEANE and Ask SALEANE. The assistant's name is "Ask" and the app's name, written once as `ASK_NAME` in `src/assistant/name.ts`; screens take it from there and never type it. The guest booking page's footer reads "Connected by SALEANE" and nothing more. Editorial lines are short and warm; working copy says exactly what will happen. A refusal names who can help, and an error keeps the person's input and names the next step. Use the truth words (saved, recorded, queued, sent, delivered, charged, test payment, test mode) only for what really happened: never imply that a recorded payment was charged or a queued message was sent.

## Quality bar

Every screen meets this bar before anyone is asked to merge it. It comes from the wizards (moving in, setting up a studio, adding a location), which feel calm and well made, and turns what they do into rules that also suit fast everyday screens. Not everything becomes a wizard: wizards stay for rare jobs of several steps. Everyday screens take the feeling, not the format, and busy screens such as the calendar keep all their information.

### What the wizards get right

- **One job at a time.** Each step has one heading, one plain sentence and only the fields that step needs.
- **One clear way forward.** One primary button, always in the same place, with Back as a quiet partner.
- **Room to breathe.** Wide margins, a short line length for reading, and nothing boxed inside another box.
- **A real photograph, framed with care.** It is large, runs to the edges of its panel and fades softly into the words. Only one at a time.
- **Plain, warm words** that say what will happen: "Nothing is saved until the last one."
- **Nothing to fear.** You always know where you are, and leaving part-way loses nothing.

### Rules for every screen

1. **One main job and one main button** per screen or section. Everything else is a secondary or quiet button. When two things compete for attention, one of them is in the wrong place.
2. **Extra options when asked for.** Everyday choices stay in view. Settings most people never change sit behind `MoreOptions`, and long lists behind "See all".
3. **Room, not boxes.** Space and hairlines separate things. A card never sits inside a card; a list inside a panel is rows with a line between them.
4. **One photograph per view, where it adds feeling:** arrivals, empty pages and guest moments. Never on dense working surfaces, never as decoration. Frame it the way the wizards do: large, running to the edges of its panel and fading softly into the words, never a small picture set down beside a paragraph.
5. **Lovely empty pages.** A page with nothing in it yet opens with a welcome in place of its header: `Empty` with the page's eyebrow, a photograph, one line and one next step. It hides the filters, tables and figures that would only show nothing or zero, and the header's own title, photograph and buttons, so the page has one heading and one way forward. It is a single calm page, not a wizard. A small gap inside a list stays a one-line `Empty` without a photograph.
6. **Calm loading.** `LoadingShapes` in the shape of what is coming. Never a spinner, a blank space or "Loading…" on its own.
7. **One way of moving.** Things arrive with `--motion-calm` and `--ease-calm`: dialogs open, side panels slide in a little, steps and saved lines use `settle`. Motion uses the same timing for panels, menus and lists; see [Where things move](#where-things-move). No bounces, no long slides, nothing loops except loading shapes. Pages loading, scrolling and typing never move. Reduced motion removes all of it.
8. **Phone first.** Check at 390px. Nothing scrolls sideways unless it is a strip made to scroll, every target is at least 44px, and the main button sits where a thumb reaches it: full width at the foot of a form, a step or an empty page.
9. **Warm, plain words.** Say what happens next in the studio's own language. Headings are short and human; errors keep what was typed and name the next step. British English, no exclamation marks, no em dashes.
10. **Honest and built from the library.** Tokens and components from `src/design`, no new raw colours, no left-edge stripes, every text pairing AA. A recorded payment is never "paid" and a queued message is never "sent".

### Checklist before asking for "merge"

Work through this at 1440px and 390px for every screen a change touches, and copy it into the pull request with each line ticked or explained.

- [ ] Each screen or section has one main job and one primary button.
- [ ] Rarely used options are tucked away (`MoreOptions`, "See all") rather than shown all at once.
- [ ] No card sits inside another card; lists use rows and hairlines.
- [ ] At most one photograph per view, only where it adds feeling, framed large and fading into the words rather than set down small.
- [ ] A page with nothing in it yet opens with the `Empty` welcome in place of its header: one heading, one line, one next step, and no table or figures at zero.
- [ ] Anything that loads shows `LoadingShapes`, never a spinner or a blank space.
- [ ] Motion uses `--motion-calm` (`settle` for things that appear in place), and the screen still works with reduced motion.
- [ ] At 390px: no sideways scroll, targets at least 44px, the main button within thumb reach.
- [ ] The words read like a calm person speaking: plain, warm, British English, saying what happens next.
- [ ] Built from `src/design` tokens and components; `npm run check` and `npm run format:check` pass.
- [ ] Before and after pictures of each changed screen go with the request to merge.

### Pieces for the bar

All exported from `src/design/index.ts` and shown live on `/design-language`.

| Piece                                        | Use                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Empty` with `photo`, `eyebrow` and `action` | A page with nothing in it yet, in place of its header: the words on warm stone with a house photograph fading into them, beside them on a computer and above them on a phone, and one next step. `photoPosition` keeps the subject in view |
| `Empty` without a photograph                 | A small gap inside a list or panel, in one line                                                                                                                                                                                            |
| `LoadingShapes`                              | `kind="page"` while a whole screen loads (used for every page as it first opens), `kind="list"` for a panel or list filling in                                                                                                             |
| `MoreOptions`                                | Settings most people never change, behind one quiet line that opens in place                                                                                                                                                               |
| `--motion-calm`, `--ease-calm`, `.settle`    | The one way things arrive. Dialogs and side panels already use it; add `settle` to a step, a saved line or new content in place                                                                                                            |

First applied on 9 October 2026 to Clients and the waitlist for a studio with nobody in them yet, to the waitlist's rows (one person per row, taking someone off as a quiet button), to the loading between pages and the change record, and to the page shown for a missing link.

## Checking a change

Run `npm run check` and `npm run format:check`, then open `/design-language` and the changed screens at 1440px and 390px and work through the quality bar checklist above. The library's pairing table must show AA for every row. Automated contrast checks support, but do not replace, keyboard and screen-reader review.

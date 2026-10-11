# LEFT-6E · One pattern for page tops, How SALEANE speaks and the design language page

Branch `left-s6words`, from `left-stage5` at 6d557e4. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass at 1440 and 390 px after merging the Stage 6 parts (steps at the end). No migration, no server change, no new command and no new image file.

## What it does

### One pattern for page tops

Every staff page now opens the same way, through `PageHeader`: an eyebrow naming the part of SALEANE (or the date on a page that greets), the serif title as a short human line, one line saying what the page is for, and the page's actions with one primary button. The pattern is written down in `docs/DESIGN_LANGUAGE.md` ("Page tops"), in the comment on `PageHeader`, and shown on the design language page with three live specimens.

Which top a page uses:

| Kind of page             | Its top                        | Pages                                                                                        |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- |
| A greeting               | `editorial`, with a photograph | Today (its own greeting panel, unchanged), a professional's day, a regional manager's area   |
| A place people arrive    | `compact` with the photo band  | Clients, Waitlist, What guests tell you (and the design language page itself)                |
| A working tool or a form | `compact`, no photograph       | Calendar, Inbox, Messages to clients, every Business page, Money, Stock, Settings, Day sheet |
| A record or a guest page | its own frame, unchanged       | A client's page, booking pages, a guest's visit link, account and setup pages                |

Changes page by page:

- **Calendar** (top only, as the brief asked; the grid is untouched): eyebrow "Calendar", title "Every visit, in its place.", line "People, rooms and time, working together." The photo band under the header is gone, because the calendar is the densest working surface.
- **Stock**: the photo band under the header is gone (a working tool, and the till's products carry their own photographs).
- **Clients**: the band moves from a loose `PhotoStrip` into the header's `photo`, and the page gains its missing line: "Everyone who comes to the studio, what they love and when they are due back."
- **How you compare** and **Gift cards and vouchers**: eyebrow "Business" (both had none).
- **Messages to clients**: title ends with a full stop like every other page title.
- **Day sheet**: eyebrow "Printable copy". The title keeps "Day sheet · Tuesday 6 October", so the printed page and screen readers still name the sheet and its date.
- **What guests tell you**: the photo band (end of day, warm), as a page of guest moments.
- **A professional's day** and **a regional manager's area**: the photo band above their greeting (towels for the professional, the studio front for the regional manager), so the three greetings all arrive with a photograph. The area greeting gains its missing line: "How each of your locations is doing, and what needs a look."

The **photo band** itself is restyled in `src/design/design.css` (moved there from `src/styles.css`, where it was set down as a framed strip): no border, taller (120 to 168 px on a computer, 104 px on a phone), running the width of the page and fading softly into the words below with a mask, as the quality bar asks. It only ever appears through `PageHeader`'s `photo`. Only house photographs from `src/design/photos.ts` are used.

### How SALEANE speaks

`docs/HOW_SALEANE_SPEAKS.md`, built from the app's own copy (every example is a real line from the app unless marked as one to avoid): the short version; team versus guest words; words we use and avoid with real examples; the truth words (saved, recorded, queued, sent, delivered, charged or paid, test payment, test mode, settled in test mode, sample studio) and when each may be used; saying no; describing an error and the next step; empty pages; patterns to leave out, including "this is not X, this is Y"; numbers, dates, times and money in UK and US studios (checked against `src/domain/format.ts` and `Intl` output); punctuation; and a checklist. It mentions only that Ask SALEANE and the receptionist follow the same words; the assistant's own tone is left to its thread.

Its short form is shown on the design language page from `src/design/voice.ts`: the rules, the truth words table, words we use, the same moment for the team and for a guest, saying no beside when something goes wrong, and UK against US forms.

A Help guide, **Write the way SALEANE speaks** (Messages and AI, for everyone at the desk), points to it, found by "how should I word a message", "tone of voice" or "writing style guide".

### The design language page

`/design-language` and `docs/DESIGN_LANGUAGE.md` now match the app:

- **Type**: Figtree for body text and every number; Financier Display Light named as the heading face with Newsreader standing in for it. The page does not mention buying it. A two-face specimen and the type scale (now with the greeting and figure sizes) read live from the tokens.
- **Colour**: the swatches follow `src/design/tokens.css` as it is now (ground, side, stone, action, first colour soft and so on), with the live AA pairing table unchanged.
- **Space and edges**: the corners are corrected (they still said 7 px and 5 px; the tokens say 20 px cards, 12 px fields and pill buttons) and read live; the rule against left-edge stripes has its own short section.
- **Page tops**: the new section above.
- **Components**: a table of every component in `src/design` now, and live specimens for the ones missing before: `DateStrip`, `DateField`, `TimeField`, `WizardSteps` and `ChoiceTiles`.
- **How SALEANE speaks**: the new section above.
- **Look**: sections are no longer boxed cards (so a specimen frame is never a card inside a card): they are separated by space and a hairline, with serif section titles, a row of contents links at the top (44 px targets) and the photo band. Long tables become one block per row on a phone, each cell named by its column.

`docs/DESIGN_LANGUAGE.md` loses the old note that working screens have no eyebrow (it contradicted the code), points to the voice guide, lists the new components and gains the "Page tops" section. `docs/DESIGN_SYSTEM.md` no longer describes Bodoni Moda and Source Sans as current; they are kept as one line of history.

## Who sees what

Nothing here changes who can do or see anything. Every page keeps its own permission checks; the version of a page shown to someone without access keeps the same title and eyebrow. The design language page is reachable from the workspace footer for every workspace role, as before. The Help guide is for the owner, managers, general managers and reception, the people who write to guests; practitioners and regional managers do not see it.

## Tests

- `src/design/pageTops.test.ts` (new):
  - every page file in `src/pages` is either a staff page that uses `PageHeader` or listed as having its own frame, so a new page must make that choice;
  - every `PageHeader` on a staff page has an eyebrow;
  - no page sets `PhotoStrip` down on its own, and exactly the arrival pages (Clients, Waitlist, What guests tell you, a professional's day, a regional manager's area, the design language page) carry the photo band;
  - the voice data on the design language page has no em dash, en dash or exclamation mark, no American spellings, and no avoided words outside the rules and the avoid column;
  - every example quoted on the design language page is still word for word in the app's code (pages, components, domain and server), so the page cannot quote a line that has been changed.
- `src/design/design.test.tsx`: the living library renders its title, each of its seven sections with a contents link to it, the "stands in for it" type note, no mention of Bodoni, Source Sans or buying a licence, and the truth words and page tops tables.
- `src/domain/help.test.ts`: the new guide is found by three phrasings, offered on the design language page, and not offered to a practitioner. The existing checks for dashes, American spellings, "appointment" and "customer", whole lines and real screens all pass for it.
- `src/pages/News.test.tsx`: the heading name follows the full stop.

Results on this branch:

- `npm run lint`: clean. `npx tsc -b`: clean. `npm run format:check`: clean.
- Front end: 189 files, 1,650 tests passed (one test, the offline day sheet's heading, failed on the first run because the day sheet title had dropped the words "Day sheet"; the title was put back and that file passes).
- Server: 67 files passed and 1 skipped, 535 tests passed and 2 skipped (no server change).
- After the last change, the full front-end run again: 189 files, 1,650 tests passed. `npm run build` passes.

## Quality bar

Checked by reading the code and CSS at both widths; the lead's browser pass confirms it.

- [x] One main job and one primary button: each page top keeps at most one primary button; the design language page has none of its own (its buttons are specimens).
- [x] Rarely used options tucked away: no new options were added. `MoreOptions` is not on this base, so none is used.
- [x] No card inside a card: the design language page's sections are no longer cards, so its specimen frames sit one level deep; lists use rows and hairlines.
- [x] At most one photograph per view, framed large and fading into the words: the band now has no frame, runs the page width and fades into the heading; working tools lost theirs; Business and Stock rely on photographs in their body instead.
- [ ] Empty welcome in place of the header: not part of this change. The richer `Empty` (with photograph, eyebrow and action) is not on this base; pages keep their existing empty states.
- [ ] `LoadingShapes`: not on this base and not touched here.
- [x] Motion: nothing new moves. The band is still.
- [x] At 390 px: the band is 104 px, the header stacks its actions under the words (existing CSS), contents links are 44 px tall and wrap, tables become stacked blocks, and the two-column type and voice blocks become one column. Nothing is wider than the page.
- [x] Words: plain British English, no em dashes, no exclamation marks; the voice guide's own data is tested for it.
- [x] Built from `src/design` tokens and components. The only literal colour added is `#000` inside the band's mask gradient, which is an alpha mask and never painted.
- [ ] Before and after pictures: for the lead's browser pass.

## Decisions where the brief left a choice

- **Which pages carry the photo band.** Clients, Waitlist and What guests tell you (places people arrive), plus the three greetings. Calendar and Stock lost theirs as dense working tools. Business keeps its photographs in the body, so it has no band. Gift cards, Inbox and Settings stay without one as working pages.
- **The band sits above the eyebrow**, as `PageHeader` already drew it on Waitlist; Calendar, Clients and Stock had drawn it in three different places.
- **The day sheet's eyebrow is "Printable copy"**, not the date, so the date stays in the title where a printed page and a screen reader need it (the principle that an eyebrow never holds essential information alone).
- **The quality bar is not copied into the design language page**: `docs/DESIGN_LANGUAGE.md` on this base has no quality bar section, and PR #83 brings one with `LoadingShapes` and `MoreOptions`. When it lands, its section belongs beside "Page tops".
- **Calendar's import line was reflowed by Prettier** when `PhotoStrip` and `photos` left it. If the calendar grid part also touches the imports, the merge is a one-line choice.

## For the browser pass (1440 px and 390 px)

1. `/calendar`: the eyebrow "Calendar", the new title and line, no photograph, the grid starting close under the header.
2. `/clients`: the photo band above the eyebrow, fading into it, and the new line under the title.
3. `/waitlist` and `/business/feedback` (as the owner): the band, fading into the words.
4. `/business/stock`: no band; the totals start under the header.
5. `/business/compare` and `/business/gift-cards`: the eyebrow "Business".
6. `/inbox/news` in a studio with a message (the title ends with a full stop) and `/day-sheet` (eyebrow "Printable copy", then print preview).
7. A professional's day (`/practice/...`, signed in as a practitioner) and a regional manager's area (`/area/...`): the band above the greeting; on a phone, open a visit and check the band hides with the day heading.
8. `/design-language`: the band, the contents links (each jumps to its section), the two type faces, the corners, the page tops specimens, the component table and the new specimens (pick a day, a date and a time), and How SALEANE speaks. At 390 px the tables become stacked blocks with no sideways scroll.
9. Help, search "tone of voice": the guide opens with Go there to the design language page.

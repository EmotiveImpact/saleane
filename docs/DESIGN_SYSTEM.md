# SALEANE design system

Foundation 0.2 · custom tokens and components. The reference implementation is `src/styles.css`; accessible dialog behaviour comes from Radix. There is no shadcn theme or UXio integration.

## Source and direction status

The original generated three-column visual board was opened and visually inspected in the source conversation on 6 October. The user rejected the first new studies and explicitly asked us to follow that original, including imagery. The rejected studies are preserved under `design-studies/archive/rejected-2026-10-06/`; they are not recommendations. [Revised studies](VISUAL_DIRECTIONS.md) follow the recovered visual reference. This does not imply final brand approval.

## Character and reference composition

The original board pairs a widely tracked, high-contrast serif SALEANE wordmark with small, functional sans-serif text. Quiet Luxury has a light ivory/stone sidebar, a warm white workspace, compact metrics, fine appointment rules, circular portraits and a subtle sage attention panel with forest-green actions. Modern Editorial keeps that left-sidebar composition with cooler white/charcoal contrast. After Dark uses near-black/brown, warm gold, candles and dark marble.

The reference photographs matter: sunlit plaster, linen, stone, ceramics and olive branches carry the guest brand. The working app now follows the warm expression. Photography belongs in guest booking and a small studio preview; the operational agenda keeps its space for appointments. Generated fictional portraits help identify a small set of seed people; new records keep initials. No real client photos are supplied or inferred.

Weighted and established means dependable proportions, alignment, restrained hierarchy and legible work surfaces. It does not require a heavy dark navigation rail or oversized sans-serif headings. Preserve the source board's quiet scale as the product becomes more capable.

## Name and wordmark

**Canonical spelling: SALEANE. No accent.** Use Saleane in prose and SALEANE in the wordmark. Keep spelling identical in search, URLs, accessibility labels and future legal/product records. An accent introduces a spelling ambiguity across UK and US typing and recall. This is a product decision inherited from the conversation, not legal name clearance.

The current wordmark uses **Bodoni Moda Variable, weight 500, tracking 0.12em**, as an openly licensed implementation of the original high-contrast serif direction. It is a reasoned type choice, not a claim to identify the exact generated font. Page greetings and guest headings use Bodoni at restrained weights. The original image is a reference, not a proprietary font file or production logo master.

**Source Sans 3 Variable** carries navigation, forms, tables, money and metadata. Functional figures retain tabular numerals and ordinary spacing. The previous compact Manrope mark belongs to the archived foundation history. Fonts are served locally; supplied OFL notices are included. See [third-party and generated-asset provenance](../THIRD_PARTY_NOTICES.md).

No historical lunar or linguistic etymology has been established. Do not invent meaning for a glyph. Pronunciation and trademark/domain clearance remain separate decisions; past domain availability is not current ownership evidence. The source phrase “everything is under control” guides clarity, structure and honest failure states.

The Atelier House AH mark is a fictional guest-brand demonstration. It is not another Saleane logo.

## Tokens

| Token        | Value     | Use                                       |
| ------------ | --------- | ----------------------------------------- |
| `--ink`      | `#29392f` | Primary text and forest-green actions     |
| `--ink-deep` | `#203329` | Deeper structural ink                     |
| `--paper`    | `#ffffff` | Work surfaces and fields                  |
| `--mineral`  | `#faf9f6` | Application ground                        |
| `--line`     | `#e2e2da` | Table and section structure               |
| `--muted`    | `#656b63` | Readable secondary text                   |
| `--brass`    | `#a89a7a` | Limited warm orientation accents          |
| `--sage`     | `#e9eee5` | Skin/wellbeing staff and calendar context |
| `--blue`     | `#edf0ef` | Body/skin context                         |
| `--sand`     | `#f1ece3` | Hair/styling context                      |

Type: 11–13px metadata; 14–17px operational text; 19–24px section headings; 29–38px page headings. Public booking display type can be larger. Use tabular numbers for times and money. Maximum body-copy line length is generally 65–80 characters.

Spacing uses a 4px base with 8, 12, 16, 20, 24, 32 and 40px steps. Surfaces use 7px corners; fields/actions use 4–5px; people avatars are circular. Avoid identical decorative cards for every fact: daily metrics are compact bordered cells, the agenda is a continuous surface, and the attention panel uses quiet sage contrast.

## Component contracts

| Component           | Contract                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`            | Native button, explicit action name, primary/secondary/quiet/light treatment, visible focus, disabled state                               |
| `Modal`             | Radix focus trap/inert background; title and description; Escape closes; return focus to initiating control; scrollable within viewport   |
| `Avatar`            | Fictional seed portraits or initials and staff tone; decorative because adjacent visible text names the person                            |
| `Status`            | Text and dot; colour never carries the status alone; agenda buttons include state in their accessible name                                |
| `Metric`            | Label, formatted value and definition; no decorative trend claim                                                                          |
| `Agenda`            | Native visit buttons with client, service, time and status; one appointment record across all screens                                     |
| `BookingDialog`     | Qualified staff, suitable resource, future date, available slot; revalidate on save; successful confirmation only after persisted command |
| `AppointmentDialog` | Guarded moves/cancel/missed and arrival → checkout → receipt → rebook; booked snapshots and deposit math; explicit simulation labels      |
| `TimeChoices`       | Native labelled radios; arrow-key selection, visible focus, one selected time; fresh availability and validation on save                  |
| `ErrorMessage`      | Assertive accessible error, plain corrective action; no success on failed save                                                            |

Calendar uses labelled appointment buttons in visual lanes, not a falsely labelled ARIA grid. The agenda alternative provides a straightforward keyboard and mobile reading order. Future drag/reschedule must have an equivalent non-drag command.

The 0.2.2 side panel keeps its title, visit date and close action above a separate scrolling body. Changing steps focuses the heading and resets body scrolling. Calendar selections have a clear outline. A saved move follows both the date and any active professional filter; cancellation/missed history remains reachable after the active launcher disappears. Closing then focuses the main workspace when that launcher is no longer connected. Native radio times support moving without dragging. On narrow phones the client identity and booking action occupy separate grid rows; cancelled/missed history shows its status text.

A read-only inspection of Caleane's calendar panel and `WorkspaceUI` informed contained scrolling, explicit selection and labelled controls. Only these interaction patterns were adapted: SALEANE retains the inspected original wordmark, palette, imagery and spatial identity. No Caleane assets, dependencies or source components were imported.

## State and interaction

Every visible action works. There are no empty navigation destinations for later features. Selecting a market remounts the route and closes route-level flows to avoid mixing workspace records. Search resolves actual clients; chart values have an HTML table and CSV export.

Note confirmation lives in the initiating button (`Add to timeline` → `Added`). Error and unavailable states explain the next action. A storage failure prevents a claimed saved change. Reset requires an explicit, reversible demo-data decision; export precedes reset as an available control.

Motion answers actions only: short hover/focus and navigation transitions. Reduced-motion preferences remove those transitions. No automatic background animation.

## Responsive and accessibility acceptance

- Desktop rail at 236px; mobile navigation opens from a named control. The selected route remains evident.
- Below 650px the calendar uses the agenda. Directory scroll/column reduction stays within its surface.
- Forms have visible labels; consent is independently optional; public progress identifies the current step.
- Public booking works at 390px and the application has a 320px minimum layout.
- Touch actions aim for 44px; WCAG 2.2 AA is the production target, not a certification earned by these checks.
- Verify focus order, modal trapping/restoration, Escape, contrast, zoom, reduced motion and screen-reader announcements. Automated rules alone cannot certify accessibility.

## Deliberate limits

The revised implementation follows the inspected original board but is not a pixel reproduction. The original image bytes could not be exported; the visible source was inspected directly. New generated photographs are separate assets with recorded provenance. User task testing, brand clearance, assistive-technology testing and forced-colour validation remain release work.

## Target interaction refinements

Keep the client timeline central and the operator navigation compact. The implemented appointment flow uses a right-side preview with progressive actions; on phones it uses a full-height sheet. Today separates needs attention, opportunities and completed work, with source receipts for the latter. Business owns charts and reconciliation.

Compare directions with the same tasks, values and failure states. Judge readability, scan speed, focus, source comprehension and guest trust as well as appearance. Quiet Luxury keeps warmth without decorative spa clichés; Modern Editorial keeps strong hierarchy without finance-dashboard clutter; After Dark belongs to optional guest/marketing surfaces. Photography should not compete with calendars, money or dense operational tables.

## Local V1 application extension

Keep the original reference as visual authority: ivory surfaces, light navigation, Bodoni Moda wordmark/editorial headings, functional Source Sans, sage/forest actions and generated fictional studio photography. No accent is introduced and no new brand direction replaces the approved foundation.

Accounts use a photographic welcome panel and a quiet form. Business uses a compact Overview/Money/Manage subnavigation rather than adding every administration surface to the main sidebar. Manage separates capability from account access. Money surfaces provenance next to the receipt. Inbox makes unsent status explicit. Imports use a reviewable table before any record is written.

Loading, disabled, empty and error states are part of the component contract. All mutations await authority, preserve entered data when rejected, and communicate uncertain saves without inventing success. Time choices retain a keyboard path; slot suggestions now use 15-minute increments. Responsive verification is recorded in the candidate evidence rather than inferred from CSS.

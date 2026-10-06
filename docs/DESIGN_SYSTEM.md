# SALEANE design system

Foundation 0.2 · custom tokens and components. The reference implementation is `src/styles.css`; accessible dialog behaviour comes from Radix. There is no shadcn theme or UXio integration.

## Character

Weighted, established and resilient, with the warmth of a good practitioner. The application is a place of work: a substantial slate-blue navigation rail anchors the environment, white operational surfaces hold the information, and mineral-grey ground separates them. Small brass details identify orientation; service colour helps read the calendar.

Spend visual emphasis on the operational promise, not decoration. Today is a working brief with a linked agenda and a source-based invitation to review a return visit. Business is a distinct reporting view. The guest experience belongs to Atelier House in the demo, with a quiet SALEANE attribution.

## Name and wordmark

**Canonical spelling: SALEANE. No accent.** Use Saleane in prose and SALEANE in the wordmark. Keep spelling identical in search, URLs, accessibility labels and future legal/product records. An accent introduces a spelling ambiguity across UK and US typing and recall. This is a product decision inherited from the conversation, not legal name clearance.

The prototype wordmark uses **Manrope Variable at weight 800**, compact tracking (-0.065em) and a firm baseline. Its repeated A forms, broad geometric structure and closely held letters provide a substantial silhouette without a beauty-industry script. The letters themselves remain unmodified. A future custom drawn mark may refine the A/L/E rhythm, provided the spelling and legibility survive.

**Source Sans 3 Variable** carries operational text. Its UI-oriented proportions distinguish small metadata and long client details without competing with the mark. Manrope handles headings and monetary totals. This pairing is deliberately practical; no licensed commercial typeface is assumed. Both fonts are served locally from pinned Fontsource dependencies. Unmodified fonts and licence notices ship with the app; see [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).

The Atelier House AH mark is a fictional guest-brand demonstration. It is not another Saleane logo.

## Tokens

| Token        | Value     | Use                                         |
| ------------ | --------- | ------------------------------------------- |
| `--ink`      | `#263b49` | Navigation mass, primary text and actions   |
| `--ink-deep` | `#20323e` | Deeper structural ink                       |
| `--paper`    | `#ffffff` | Work surfaces and fields                    |
| `--mineral`  | `#f2f5f6` | Application ground                          |
| `--line`     | `#dce3e6` | Table and section structure                 |
| `--muted`    | `#5b6c77` | Readable secondary text                     |
| `--brass`    | `#cfb98f` | Active rail and limited orientation accents |
| `--sage`     | `#e7eeea` | Skin/wellbeing staff and calendar context   |
| `--blue`     | `#e7eef4` | Body/skin context                           |
| `--sand`     | `#f1ece3` | Hair/styling context                        |

Type: 11–13px metadata; 14–17px operational text; 19–24px section headings; 30–42px page headings. Public booking display type can be larger. Use tabular numbers for times and money. Maximum body-copy line length is generally 65–80 characters.

Spacing uses a 4px base with 8, 12, 16, 20, 24, 32 and 40px steps. Surfaces use 7px corners; fields/actions use 4–5px; people avatars are circular. Avoid identical decorative cards for every fact: daily metrics share one ruled band, the agenda is a continuous surface, and the attention panel has distinct ink mass.

## Component contracts

| Component           | Contract                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`            | Native button, explicit action name, primary/secondary/quiet/light treatment, visible focus, disabled state                               |
| `Modal`             | Radix focus trap/inert background; title and description; Escape closes; return focus to initiating control; scrollable within viewport   |
| `Avatar`            | Initials and staff tone; decorative because adjacent visible text names the person                                                        |
| `Status`            | Text and dot; colour never carries the status alone; agenda buttons include state in their accessible name                                |
| `Metric`            | Label, formatted value and definition; no decorative trend claim                                                                          |
| `Agenda`            | Native visit buttons with client, service, time and status; one appointment record across all screens                                     |
| `BookingDialog`     | Qualified staff, suitable resource, future date, available slot; revalidate on save; successful confirmation only after persisted command |
| `AppointmentDialog` | Guarded arrival → checkout → receipt → rebook; price snapshot and deposit math; explicit simulation labels                                |
| `ErrorMessage`      | Assertive accessible error, plain corrective action; no success on failed save                                                            |

Calendar uses labelled appointment buttons in visual lanes, not a falsely labelled ARIA grid. The agenda alternative provides a straightforward keyboard and mobile reading order. Future drag/reschedule must have an equivalent non-drag command.

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

The present treatment is a reviewable identity foundation. No original v0.1 visual image was recovered, so this is not described as a pixel-faithful recreation of an unseen concept. User research, brand clearance, assistive-technology testing, a fuller token API and light/dark/forced-colour validation remain release work. Preserve the weighted structure while refining those details.

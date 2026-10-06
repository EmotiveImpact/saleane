# SALEANE visual direction: following the original board

**6 October 2026 · Revision after user rejection · No final direction is approved.**

The user rejected the earlier visual studies. Their recommendation is withdrawn. The files and evidence are retained only in [the rejected archive](../design-studies/archive/rejected-2026-10-06/README.md).

The governing reference is the original `saleane-visual-directions.png` generated in **Evaluate Saleane Name**. The parent agent recovered and directly inspected its full-resolution ChatGPT preview. This visual agent could not access that browser account or export the image, so the revision follows the parent’s verified observations; it does not claim a separate inspection or an exact pixel reconstruction.

## What the reference requires

- An elegant, widely spaced, high-contrast serif **SALEANE** wordmark, without an accent, and serif greetings.
- A warm **light** left sidebar for Quiet Luxury; a white/light sidebar with the same spatial model for Modern Editorial.
- A pale warm canvas, three compact KPI cards, an agenda occupying roughly two-thirds of the working area and a subdued sage “Saleane noticed” panel beside it.
- Small photographic portraits and restrained black outline icons.
- Forest-green primary actions in Quiet Luxury, black actions in Modern Editorial.
- Photographic beauty-studio imagery: cream linens, olive branches, sunlight and travertine, especially in the guest booking experience.
- Warm brown, champagne, candles and marble for After Dark, kept as a guest expression rather than a default operator workspace.

The rejected espresso navigation rail, horizontal navigation redesign, heavy sans-serif identity and abstract geometric guest artwork have been replaced. The three studies now share the source’s visual language rather than competing with it.

## View the revised studies

The Vite development server serves these links at port 5173. The production build also includes `design-studies/index.html`; use the equivalent path on the production preview port after a build.

- [A · Quiet Luxury: Today](http://127.0.0.1:5173/design-studies/index.html?direction=quiet-luxury&screen=today).
- [A · Client relationship](http://127.0.0.1:5173/design-studies/index.html?direction=quiet-luxury&screen=client).
- [A · Checkout](http://127.0.0.1:5173/design-studies/index.html?direction=quiet-luxury&screen=checkout).
- [A · Photographic booking](http://127.0.0.1:5173/design-studies/index.html?direction=quiet-luxury&screen=booking).
- [B · Modern Editorial: Today](http://127.0.0.1:5173/design-studies/index.html?direction=modern-editorial&screen=today).
- [C · After Dark: guest booking](http://127.0.0.1:5173/design-studies/index.html?direction=after-dark&screen=booking).

Use the same fictional appointment and client to compare A and B. Open Amelia’s appointment, inspect the relationship, continue to checkout, choose a tip and rebook. Booking can be opened from the sidebar or studio photograph. C keeps the guest surface. The top direction controls belong to the review tool, not the proposed product navigation.

## Typography and form

**Bodoni Moda Variable** supplies the high-contrast serif wordmark and page headings. Its delicate hairlines, stronger vertical strokes and wider wordmark tracking follow the recovered reference. **Source Sans 3** supplies appointment details, controls, labels and numbers. Operational numbers remain sans-serif for rapid reading.

The canonical spelling remains **SALEANE**, without an accent. The wordmark is an unmodified type treatment with reviewed spacing, not a claimed custom-drawn logo or legal clearance. Both fonts are served locally, with their OFL notices in the study assets. No commercial font licence is assumed.

The sidebar remains light and stable. A and B keep the same places for navigation, studio identity, agenda, attention panel and client context. The controlled difference is material and contrast: warmer ivory/sage/forest in A; clearer white/charcoal in B. C changes the guest atmosphere through the evening photograph and warm gold controls.

## Palette

| Role              | A · Quiet Luxury           | B · Modern Editorial    | C · After Dark       |
| ----------------- | -------------------------- | ----------------------- | -------------------- |
| Ground            | `#FAF9F5` warm pale canvas | `#FBFBF9` almost white  | `#27221C` warm brown |
| Surface           | `#FFFEFA`                  | `#FFFFFF`               | `#302920`            |
| Sidebar           | `#F2F0E9`                  | `#F6F6F3`               | Guest surface only   |
| Primary text      | `#302F29`                  | `#282825`               | `#EDE6D8`            |
| Primary action    | `#334B3E` forest           | `#242522` charcoal      | `#D5C19C` champagne  |
| Attention surface | `#E6EAE0` sage             | `#EFEBE6` muted neutral | Guest surface only   |

## Imagery and provenance

The new warm and evening studio photographs are AI-generated assets created for this project, not photos of a real studio or a claim to have extracted the original image’s source photography. The warm photograph uses cream treatment linens, travertine, olive branches and natural sunlight. The evening photograph carries the candlelit brown/gold expression.

The contact sheet in `design-studies/assets/fictional-client-portraits.png` contains four AI-generated fictional people. It is cropped into circular avatars through CSS. These portraits are visual fixtures attached to fictional records; they must not be reused as an inference about an actual client’s appearance or identity.

[Asset provenance and portrait prompt](../design-studies/ASSET_PROVENANCE.md) record the generation method and paths. No stock-photo licence or real customer permission is implied. Photographs are served by the application’s `/images/` route, so use the Vite server or built preview rather than opening the HTML directly as a local file.

## Interaction and boundaries

These are inspectable, session-only studies. They use fictional records and demonstrate appointment preview → relationship → checkout → rebook → intelligence, plus guest review/confirmation. UK and USA controls change currency and clock conventions. A reload resets study state.

The appointment preview uses a small right-side panel with a named native dialog, Escape and focus return. Checkout preserves the visible deposit and gratuity calculation, and rebooking records the chosen study time in the client timeline. Inbox explains a reserved product area instead of showing invented messages or completed automations. Intelligence figures are labelled visual fixtures, not a live report.

The running React application is separate and retains its own connected state and release boundaries. A successful visual-study action does not prove server behaviour, payment collection, consented delivery or production readiness.

## Review position

There is **no preferred-direction recommendation** in this revision. The previous recommendation was rejected. The immediate test is whether these screens now follow the original image’s serif identity, light structure, photography, calm density and placement of key elements.

A final selection remains with the user. After that selection, refine the chosen visual language inside the real application rather than maintaining three competing app themes.

## Verification

Current screenshots and browser checks use the `reference-` prefix under [design-studies/evidence](../design-studies/evidence/). Earlier screenshots and their passing functional checks belong only to the rejected archive and are not evidence that the user accepted their appearance.

Automated accessibility checks supplement visual inspection and keyboard testing. They do not establish WCAG certification or replace task testing with people.

The revised studies passed **39 screen/direction/viewport combinations** at 1440px, 390px and 320px with zero horizontal overflow, zero violations in the selected axe WCAG A/AA tags and no JavaScript page errors or failed local asset responses. The focused UK checkout, chosen-time rebooking, Escape focus return and mobile US guest confirmation also passed. See [the current browser receipt](../design-studies/evidence/reference-browser-checks.json).

Rendered examples:

- [Quiet Luxury Today](../design-studies/evidence/reference-quiet-luxury-today-desktop.png), [client](../design-studies/evidence/reference-quiet-luxury-client.png) and [checkout](../design-studies/evidence/reference-quiet-luxury-checkout.png).
- [Quiet Luxury photographic booking](../design-studies/evidence/reference-quiet-luxury-booking-desktop.png) and [phone booking](../design-studies/evidence/reference-quiet-luxury-booking-mobile.png).
- [Modern Editorial Today](../design-studies/evidence/reference-modern-editorial-today-desktop.png).
- [After Dark booking](../design-studies/evidence/reference-after-dark-booking-desktop.png) and [phone booking](../design-studies/evidence/reference-after-dark-booking-mobile.png).

The same session captured the separate, built React application at 1440px and 390px: [Today desktop](evidence/reference-app-today-desktop.png), [Today phone](evidence/reference-app-today-mobile.png), [booking desktop](evidence/reference-app-booking-desktop.png), and [booking phone](evidence/reference-app-booking-mobile.png). These four captures had no document overflow and their studio photographs loaded successfully. They are visual evidence of the built app, not a claim that the study and app are identical.

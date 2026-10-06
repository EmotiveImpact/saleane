# saleane

SALEANE is a connected foundation for the operating system of modern beauty, spa and wellness businesses in the UK and USA. The canonical spelling has no accent.

**Version 0.2.2 is an interactive browser-local demo.** Bookings, deposits, payments, reports and relationship suggestions use fictional data. There is no production backend, authentication, payment or messaging provider, AI model, or deployment. Use fictional details only.

## Run locally

Use Node 22.12 or newer (supported LTS recommended) and npm. Dependencies are pinned by `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the local address shown by Vite. The demo day is **6 October 2026**. Appointments and reports deliberately stay anchored to that day; this is not a real-time booking service.

```sh
npm run lint
npm test
npm run build
npm run preview
```

## Try the connected journeys

1. On Today, open Amelia’s visit, continue to checkout, record a simulated payment and rebook. Her timeline and business figures update from those records.
2. Use Calendar to navigate dates, filter professionals and switch grid/agenda. Move an upcoming appointment with its booked price, duration and deposit intact. Cancel or record a missed visit through explicit review; both stay in day history and the client timeline. Booking and moves reject staff/room conflicts and include turnaround time.
3. Open Clients, search Amelia, add an ordinary fictional note and follow her referral connection to Olivia. Add a new client with an explicit referrer.
4. Open Your booking page and complete service → professional/time → details → review. The booking appears in the operator calendar and client directory.
5. Open Business, switch 7/28 days, inspect exact chart values and download a CSV.
6. Open Workspace settings to switch between separate UK/GBP and US/USD fixtures, export saved demo data or explicitly reset one workspace.

Browser-local changes persist under versioned workspace keys. An unreadable snapshot is preserved and writes are paused; a stale tab is asked to reload. This is a prototype recovery mechanism, not server-grade concurrency or secure storage.

## Product source of truth

- [Recovered context and decision record](docs/PROJECT_CONTEXT.md)
- [UX architecture and screen contracts](docs/UX_ARCHITECTURE.md)
- [Visual reference and revised studies](docs/VISUAL_DIRECTIONS.md)
- [Build-grade PRD](docs/PRD.md)
- [Vision](docs/VISION.md)
- [Version roadmap](docs/ROADMAP.md)
- [Architecture and durable domain](docs/ARCHITECTURE.md)
- [Design system and wordmark](docs/DESIGN_SYSTEM.md)
- [Research and provenance](docs/RESEARCH.md)
- [Current verification evidence](docs/evidence/VERIFICATION_0.2.2.md)
- [Foundation verification evidence](docs/evidence/VERIFICATION.md)
- [Changelog](CHANGELOG.md)

The original README is preserved above and byte-for-byte in `docs/archive/INITIAL_README.md`. The full visible source conversation, original PRD preview and generated visual board were inspected. The PRD transcription is archived; original ZIP/workbook/image bytes remain unavailable. See project context for provenance.

The repository is private. Review changes on the feature branch/PR; no automatic merge or deployment is configured.

## Visual reference

The working app follows the original generated board’s warm ivory, serif identity, light navigation and sage/forest accents, with generated fictional studio imagery. Open `/design-studies/index.html` for the revised Quiet Luxury, Modern Editorial and After Dark comparison. The earlier rejected studies are explicitly archived; they are not the recommended direction.

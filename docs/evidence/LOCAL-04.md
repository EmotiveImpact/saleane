# LOCAL-04 evidence: schedule administration continuity

Recorded 6 October 2026 on branch `claude/project-thread-lszoe0-schedule`, based on main at `21eb319`. Local only; no deployment, no live services.

## What changed

- `src/domain/schedule.ts` (new): `isUpcoming`, `scheduleConflict`, `affectedVisits`, the pure `scheduleImpact(state, command, now)` preview, `assertSchedulePreserved(before, after, now)` (the refusal that names visits) and `scheduleChanges` (history entries in plain words with structured before/after).
- `src/domain/operatingCommands.ts`: hours, closure, remove-closure, staff and resource commands snapshot the schedule first, refuse only visits the change newly strands, then append history entries. Editing a professional without hours now means "follows the venue hours" (previously an omitted field silently kept old hours, and no screen could set them).
- `src/domain/operations.ts`: optional `operations.scheduleHistory` (at most 500 entries, oldest dropped). `src/domain/model.ts` `parseState` rejects duplicate history IDs, entries whose before/after shape does not match their kind, and professional or room entries whose record is missing.
- `src/domain/commands.ts`: one-line addition so `dispatch` stamps the signed-in actor on new history entries, as it already does for messages, stock and refunds.
- `src/pages/Manage.tsx`, `src/components/ScheduleImpact.tsx`, `src/components/management.css`: affected-visits preview for opening hours, time away, the professional editor (including new own working hours) and the room editor, with save held while any visit is affected; Schedule history list under Hours & closures.
- `src/pages/Calendar.tsx`: `?appointment=` opens that visit, so preview links land on it.

## Automated checks

`npm run check` passed: ESLint (0 warnings), 169 frontend/domain/store tests, 64 server tests, strict TypeScript, application, server and backup builds. `npm run format:check` passed.

New tests:

- `src/domain/schedule.test.ts` (18): named refusal with no state or history change; visits never moved; six-visit ordering with "and 1 more"; pre-existing misfit does not block an unrelated change; buffer boundary (closing at 11:15 accepted for a 10:00 visit of 60 + 15 minutes, 11:10 refused as turnaround, 10:55 refused as treatment; closure from 11:15 accepted, 11:10 refused); staff-specific break refuses only that professional's visit; own hours and qualification removal; room continuity (archiving or changing the kind of an occupied room refused and named; another room archives and is recorded); past day, finished-today and cancelled visits not counted; DST on Europe/London 28 March 2027 and 25 October 2026 and America/New_York 14 March 2027 and 1 November 2026, each checked 5 minutes before and after the visit's turnaround ends (a wrong UTC offset fails one side); history wording, actor, time and structured values for hours, closures added and removed, own hours, archive and restore; no entry for a rename; 500 limit and older records without history; parse rejection of orphaned, misshapen and duplicate entries; historical terms unchanged after service duration/turnaround/price/deposit and hours edits.
- `server/schedule.test.ts` (4), through `POST /api/workspaces/:id/commands` without changing `server/routes/workspace.ts`: a stranding change returns 422 naming Amelia and leaves the record, history, audit and receipts untouched; an accepted change records "Ada Owner" and one audit row; a stale revision returns 409 "This workspace changed. Reload before saving." and racing edits on one revision give one 200 and one 409 with one history entry each; reception and practitioner get 403, another studio's owner gets 404, and the practitioner's own read never contains schedule history.
- `src/components/interaction.test.tsx`: the closure test now expects the named, linked preview and a held save instead of a server error; a new test previews Tuesday closing, clears it, saves Friday hours and sees the history entry.

## Browser check

Chromium (Playwright, `/opt/pw-browsers`) against the built server on `127.0.0.1:5187` with a throwaway database, using a fictional sample studio registered through the API. Observed:

- Hours & closures showed "No schedule changes recorded yet".
- Unticking Tuesday showed "These 10 upcoming visits would be affected", first link "Tue, 6 Oct 09:30, Amelia with Maya Lewis", Save opening hours disabled; ticking it again cleared the preview.
- Friday closing at 17:00 saved; history showed "Opening hours changed: Friday 09:00 to 18:00 became 09:00 to 17:00." by Ada Owner.
- A Maya Lewis lunch break at 11:00 to 11:30 named Noor's 11:00 visit and held the save; moving it to 16:30 to 17:00 cleared the preview, saved, and was listed in history.
- A preview link opened the calendar with that visit's panel open.
- Maya's own hours starting 12:00 on Tuesday previewed 2 affected visits.
- At 390px there was no horizontal scroll.

Screenshots: `schedule-impact-desktop.png`, `schedule-history-desktop.png`, `schedule-impact-mobile.png`.

## Not checked or known gaps

- Safari, Firefox and assistive technology were not tested. The preview uses `role="status"`; screen-reader announcement wording was not sampled.
- Date text differs slightly between runtimes ("Tue, 6 Oct" in Chromium, "Tue 6 Oct" in Node), because each uses its own locale data. Server refusals use the server's.
- The preview is computed on the device with the current clock and revision. The server repeats the check inside the save, so a visit booked by someone else in between is still refused there, by name.
- History is in the studio record, not a separate audit table, so it is part of backups and restores like other operating records, and only the latest 500 changes are kept. The existing `audit_events` row per command remains.
- Service catalogue edits (duration, price) are not recorded in schedule history; booked terms are protected separately and tested.
- Venue time zone changes keep the existing rule (refused while any confirmed or arrived visit exists) and are not part of this history.
- Staff hours editing is new UI; it was exercised in Chromium for the preview only, not saved and re-opened in the browser (saving is covered by domain tests).

# LEFT-4C · General managers changing their own team's days, time off and rooms

Built 10 October 2026 in a worktree, on the Stage 3 branch at `7684b33`. Everything below was checked with domain, component and server tests. Then seen in a browser on 10 October 2026, at 1440 and 390 px, after the four Stage 4 parts were put together; what was seen and fixed is under Seen in a browser.

## What it does

- **One rule for "their own team"**, written once in `src/domain/team.ts` and used by the screens, the server's checks and what a general manager reads:
  - Someone is on a location's team in a week when their usual weekly hours have them working there on a day of that week. Someone the rota sends there from elsewhere is on the team for that date only. Nobody archived is.
  - A person's day belongs to a location when the change on the rota for that day has them there (a day off belongs where they usually work that day), or, with no change, when they usually work there that day or do not usually work that day at all.
  - A general manager changes a day only when the person is on their team that day and the day belongs to their location before and after the change. So they never send someone elsewhere, never take a day from another location, and never touch a day another location plans.
  - Time off is theirs to add, change or cancel when the person is on their team on every day it covers, and none of those days is another location's (planned there, or usually worked there).
  - Rooms and chairs are theirs when they are at their location and stay there.
- **Rota (Business, then Rota)** for a general manager shows their own team for the week: the people who usually work at their location, and anyone the rota sends there that week. Their days at the location open the same day dialog an owner has (different hours, extra day, not working, back to usual), with the location fixed and named ("At Islington.") instead of a choice. A day another location plans shows only where ("Marylebone, London", "Planned there"), with no times, and cannot be opened. "Change the whole week" copies last week's changes at their location only and clears only their team's changes still to come there.
- **Time off** for a general manager: Add time off offers only their team; a stretch that touches another location's day says why before saving ("Nia works at another location on Thursday 15 October. Time off that covers a day at another location is for the owner or a manager.") and Save stays off. Beside time off they may change are Change and Cancel.
- **Changing time off is new for everyone.** The new `time-off-change` command keeps the earlier record, cancelled and naming the one that replaced it (`changedTo`), and adds a new record naming the one it came from (`changedFrom`). The Time away list shows the newer record once, with "changed by Gia General (was Mon 12 Oct to Wed 14 Oct)"; other records now say who added them. The change record says "Changed time off" with the first day, last day and kind before and after.
- **Rooms (Settings, then Spaces & equipment)** for a general manager list only the rooms and chairs at their location. They can add, rename, change resting time or room for two, and archive them. The form names their location instead of offering a choice.
- **Who changed what names them.** Every day, time off and room change carries the signed-in person's name, as Stage 3 already did for the owner: "Changed for this day by Gia General.", "added by", "changed by", "cancelled by", and the owner's change record.
- **Today and Business** for a general manager: Team today shows the people whose day today is at their location. Time booked on Today is their location's. On Business, Time booked for all locations or another location says "Not shown" (their screen has no other location's team or hours to work it out from).
- **Help**: a new guide for general managers, "Run your location's team and rooms"; the rota, one-day and rooms guides now include general managers and say what they cannot do; "Who can do what" says what a general manager now looks after; a new step explains changing time off.

## Who can do what

| Role             | Days on the rota                                                       | Copy and clear a week                           | Time off: add, change, cancel              | Rooms and chairs                              | Usual weekly hours, opening hours, closures, holiday allowances |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| Owner, manager   | Anyone, anywhere                                                       | The whole studio                                | Anyone                                     | Anywhere, including moving between locations  | Yes                                                             |
| General manager  | Their team's days at their location only; never sends anyone elsewhere | Their location's days only (the server insists) | Their team, on days at their location only | At their location only; moving one is refused | No (read only), as before                                       |
| Reception        | Sees the rota                                                          | No                                              | No                                         | No                                            | No                                                              |
| Practitioner     | Their own days on their own page, as before                            | No                                              | No                                         | No                                            | No                                                              |
| Regional manager | Their area view has no rota                                            | No                                              | No                                         | No                                            | No                                                              |

## Server

- **Permissions.** Two new permissions: `rota` (the four rota commands, `time-off`, `cancel-time-off` and `time-off-change`) and `rooms` (`resource`). Both are added to `GENERAL_ACTIONS`, and nothing else is: opening hours, closures and holiday allowances stay on `hours`, and treatments and the team's records stay on `catalogue`, neither of which a general manager has. Reception is refused both new permissions explicitly. A test pins the whole `GENERAL_ACTIONS` list.
- **Before a change** (`branchRefusal` in `src/domain/branch.ts`, with `org.locationId`): `rota-day` and `rota-day-usual` by `rotaDayRefusal`; `rota-week-copy` and `rota-week-clear` must name the general manager's own location (a command without one is refused, never read as the whole studio); `time-off` by `timeOffRefusal`; `cancel-time-off` and `time-off-change` by the record's own days and, for a change, the new days as well; `resource` by `roomRefusal`.
- **After a change** (`branchChangeRefusal`, which now also runs `teamChangeRefusal` after every general manager command): every rota day, stretch of time off and room the change touched must have been theirs before and be theirs after. This catches anything the checks before did not foresee.
- **What a general manager reads** (`branchView`, through `teamView` in `team.ts`), also used now for Ask SALEANE's answers to a general manager (`server/routes/assistant.ts` passed the whole studio before):
  - Their own team (usual days at the location): whole, with time off and holiday allowance, which belong to the person. Weekdays they usually work elsewhere keep the place only, with the times replaced by the whole day. Changes on the rota at another location are left out, or, on a day that would otherwise be this location's or a day off, kept as where only (no times, no note).
  - Someone the rota sends there: their changes at the location, time off touching those days, and which weekdays they work elsewhere, without times.
  - Everyone else: only the name, job title and diary colour the visits and records show, marked archived, with no hours, treatments, changed days, time off or allowance. Rooms elsewhere: the name and type only, archived.
  - Every rule reads the same on this view as on the whole record; a test compares them for every person, day and command over two weeks, at both locations.
- **No migration.** Everything is in the studio record. `parseState` checks that changed time off links to a record of the same person and that the earlier one is cancelled.

## Tests

- `src/domain/team.test.ts` (15): the team rule (usual days, sent for one day, archived); a general manager changes, adds, takes off and puts back their team's days at their location; is refused sending someone elsewhere, a day the other location plans, someone not on the team, and the other half of a two-location person's week, while the other location's general manager has that half; changes the hours of someone sent to them but cannot take the day from their usual location; copies and clears a week for their location only (with and without the location named); the screen preview gives the same refusals; time off added, changed (both records, actors, change record detail) and cancelled; time off touching another location's day or someone else refused, including the sample's changed holiday; changed time off ledger rules ("Nothing has changed.", overlap with itself allowed, already changed, broken links); rooms added, renamed, archived, refused at or to another location; the after-change check for each kind; the view carries no other location's team, hours, time off or rooms and still passes `parseState`; someone sent from elsewhere is kept for those days only; every rule reads the same on the view; permissions widened by `rota` and `rooms` only.
- `src/pages/RotaGeneral.test.tsx` (6): a general manager's Rota shows only their team, other locations' days as where only and no times, holiday figures for their team and no allowance button; changing a day names their location and sends no other; copying a week sends their location and leaves out the main location's changes; Add time off offers only their team; changing time off and its "changed by" line; Settings rooms list and add at their location only; Team today shows only their location's people.
- `server/branchTeam.test.ts` (6, through the real command route with a general manager invited for Islington): the payload carries no other location's team, hours, time off, allowances, changed days, rooms or notes; a day changed at their location succeeds and names them, a day elsewhere, a send elsewhere and someone else are refused with nothing saved; week copy and clear refused without their location or with another, and limited to their days with it; time off added, changed, cancelled, refused across a main location day and for someone at the main location, with the owner's change record naming Gia; rooms added and archived at Islington, refused at the main location, moving or changing a main location room; usual weekly hours, opening hours, closures and allowances still refused.
- Updated: `src/domain/rota.test.ts` (the rota permission is now `rota`, and a general manager at Maya's location may change her day there), `server/rota.test.ts` (the general manager left the "everyone else is refused" list; the new server file covers them), `src/domain/help.test.ts` (search checks for the new guide, the rota guides and rooms by role).

## Checks

- `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build`: pass.
- Front end: 153 files, 1,359 tests passed (base 151 and 1,338).
- Server: 57 files passed and 1 skipped, 439 tests passed and 2 skipped (base 433 passed, the same 2 skipped).
- Run with `DB_PATH` pointing at a fresh file under the worktree's `.claude-tmp/`.

## Decisions

- **Usual weekly hours stay with the owner and managers.** I judged it not safe for a general manager now: a person's weekly pattern is close to their contract and pay, a two-location person's week spans both locations, and another Stage 4 part is changing how dated moves between locations read usual hours. One-day changes, extra days and copying a week cover everyday planning. Their Settings Team list shows their own team, read only.
- **Opening hours** belong to the owner: they decide when guests can book every location, and changing them can strand visits anywhere.
- **Closures** are studio-wide in the record (no location), so a closure from one location would close every location. They stay with the owner and managers.
- **Holiday allowances** are a person's yearly entitlement, set by the owner or a manager. A general manager sees their team's holiday figures without the Allowance button.
- **Someone sent from elsewhere** is on the team for that day: the general manager can change their hours there, but cannot give them the day off or put the day back to usual when that would change a day they usually work elsewhere. An extra day there on a day they do not usually work can be put back.
- **Time off belongs to the person**, so a team member's own time off and allowance are kept whole in the view (including days away from another location they also work at). The general manager can change only time off that falls wholly on their location's days.
- **Refusals say "another location"** rather than naming it, so the server's words never depend on records the general manager cannot read, and the screen and server always agree. The screen still names where, from what the view holds.
- **Visits stay group-wide**, as V5 decided, so a general manager can still help any client. That is why other locations' people and rooms are kept as archived names in the view rather than removed.
- **Week copy and clear for a general manager must name the location**; the server refuses one without it rather than adding it, so a command can never fall back to the whole studio.
- **Changing time off** is a new command rather than cancel and add, so the change keeps one history and one line in the change record.
- **The sample studio** has one location, as before. Sophia's holiday in the sample was changed by the owner (the earlier record, 19 to 22 October, is kept cancelled), so the new "changed by" line has something to show. A second location is added in the browser pass in a few steps (below); adding one to the sample would have changed every sample screen and test.

## Limits and notes

- **Not changed here, noted for later.** A general manager's day sheet (`server/routes/daysheet.ts`) still lists visits across the group with each professional's name, as V5 decided for visits; it carries no hours or time off. A general manager's Calendar showing all locations, or another location, shows the visits there under archived names, and a shared team member's availability there is drawn from whole days, not their real times. Pay rates were already removed; rentals still name every renter with amounts set to zero (in `pay.ts`, which this part leaves alone).
- If a two-location person's weekly hours do not overlap a location's opening hours on some weekday (an unusual record), the general manager's screen treats that weekday as worked there while the server does not, so the screen refuses what the server would allow. It never allows what the server refuses.
- When the rota holds more changes than its limit, saving any change lets the oldest ended ones go, whoever saves it and wherever they were (Stage 3). A general manager's save can therefore let go of another location's oldest ended changes; it never touches a change still in force.
- Someone whose usual week moves to a location in the future (the dated moves another Stage 4 part is building) joins that location's view from the week they start there, as the view is worked out for today's week.

## Quality bar

- **One main job and one primary button.** Rota keeps one primary button, Add time off. In Time away, Change is secondary and Cancel is quiet. The day and week dialogs keep their single primary (Save this day, Copy 1 day). Settings rooms keeps Add resource.
- **Rarely used options tucked away.** The week tools stay in the existing "Change the whole week" fold, a native `<details>` (`MoreOptions` is not on this base).
- **No card inside a card.** Time away rows are hairline rows; a day at another location is a plain dashed cell like the rota's other quiet days, with no stripe.
- **Photographs.** None added; these are working screens.
- **Empty pages.** A general manager with nobody at their location yet sees "Nobody usually works at Islington yet." under the empty week; the page itself is never empty.
- **Loading.** `LoadingShapes` is not on this base; nothing new loads separately.
- **Motion.** `--motion-calm` is not on this base; no new motion.
- **390 px.** The rota keeps its own sideways scroll strip with the fading edge; the new cells wrap long location names. Change and Cancel wrap within the row's controls. Buttons are the library's, at least 44 px. Seen at 390 px in the browser pass.
- **Words.** Plain British English, no dashes, saying what happens and who to ask: "You plan days at Islington only. Ask the owner or a manager to send Nia to another location."
- **Built from the library.** Tokens and components from `src/design` only; no new colours.
- **Before and after pictures** at 1440 and 390 px: [Stage 4, before and after](https://claude.ai/artifact/2aV9ypAGeL5gAN5YBnnphg).

## Seen in a browser

At 1440 and 390 px, signed in as Gia (general manager at Islington), then as the owner:

- Gia's rota shows her team only: Nia, and Maya from the week of 12 October when she moves to Islington. Days at Marylebone read "Planned there". Nia's Wednesday changed to Not working and saved. An extra Saturday for Maya asks for a sign-off first, as the sample owner's rules say, and was sent. Time off for Nia from 12 to 15 October is refused before saving because Thursday is a Marylebone day; 12 to 14 October saved and shows "added by Gia Hart". Settings, Spaces shows Islington's room with Add resource and Edit, and says moving one is for the owner or a manager.
- The owner sees Gia's changes on the whole rota and her request in Requests.
- Found and fixed:
  - The team view fix under LEFT-4B: someone moving to Islington now shows on Gia's rota from the week they arrive.
  - Settings, Team described a general manager without their team's rota, time off, rooms or messages to clients. It now does (`AccessPanel.tsx`).

## Browser steps for the lead

Followed on 10 October 2026, with Islington as the second location; what was seen is under Seen in a browser.

The sample studio's day is Tuesday 6 October 2026.

1. As the owner of a sample studio: Settings, Locations, Add location: Islington, any address. Settings, Team, Add professional: "Nia", Skin, tick a facial, set her own hours with Monday to Wednesday at Islington and Thursday to Saturday at Marylebone, London. (Optionally add an Islington room in Spaces & equipment.)
2. Settings, Team, Who can sign in, Invite someone: a general manager for Islington. Open the link in a private window and sign up as Gia.
3. As Gia, Business, Rota: only Nia is shown. Monday to Wednesday open the day dialog ("At Islington."); Thursday to Saturday show "Marylebone, London, Planned there" and cannot be opened. Change Wednesday 7 October to not working; the owner later sees "Changed for this day by" with her name.
4. Next week, Change the whole week, Copy last week's changes: only Nia's Islington day is listed.
5. Add time off for Nia, Monday 12 to Wednesday 14 October: saved. Try Monday 12 to Thursday 15: the reason shows and Save stays off. Change the saved time off to Monday 12 to Tuesday 13: the list says "changed by Gia" with the earlier days. Cancel it.
6. Settings, Spaces & equipment: only Islington's rooms; Add resource names Islington with no choice; rename and archive one.
7. Today: Team today shows Nia on her Islington days only. Business with all locations: Time booked says "Not shown".
8. As the owner: Rota shows everyone and Gia's changes; Settings, Who changed what lists Gia's rota and time off changes; Time away shows Sophia's sample holiday "changed by Owner (was Mon 19 Oct to Thu 22 Oct)".
9. At 1440 and 390 px: the Rota with a day at another location, the day dialog, the time off dialog with a refusal, Time away with Change and Cancel, Settings rooms as Gia.

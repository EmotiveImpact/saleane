# LEFT-6B · Two-step sign-in for everyone, and a switch to require it

Branch `left-s6twostep`, from `left-stage5` at 6d557e4. Built and tested locally. **It has not been seen in a browser yet**: the lead runs the browser pass at 1440 and 390 px once the Stage 6 parts are put together (steps at the end). No migration: the studio's choice lives in the studio record.

## What it does

- **Everyone with an account can protect it.** The account page (`/account`, where a practitioner's and a regional manager's SALEANE wordmark leads) now has the Two-step sign-in fold under the list of studios, for every role: set it up, see how many recovery codes are left, make new ones and turn it off. Settings, Team keeps the same fold for the studio team. Before, practitioners and regional managers could only turn it on during the welcome after joining. The fold now says "Recommended for everyone on the team." rather than "for owners and managers".
- **The owner's switch, "Ask everyone to use two-step sign-in"**, at the foot of Settings, Team, just after the owner's own Two-step sign-in fold, with an On or Off badge and plain words: "When this is on, anyone in Fernleaf Rooms who has not set up two-step sign-in is asked to do it straight after signing in, and cannot open the studio until they have. People you invite are asked as they join. Your booking page, guests' visit links and partner keys work as before." The button is "Ask everyone to use it" or "Stop asking everyone" (secondary: the main job of Team stays inviting people). While the owner's own two-step sign-in is off, the button waits, with "Turn on two-step sign-in for yourself first, just above."
- **Who has it on.** Each row of the team list now says "Two-step sign-in on" or "No two-step sign-in yet", and the switch reads "1 of 3 people have it on. Not yet: Maya Lind and Theo Hart." or "Everyone in Fernleaf Rooms has two-step sign-in on." Nothing secret reaches the page: the team list carries only a yes or no per person, as before.
- **Protect your account.** While the switch is on, anyone in that studio without two-step sign-in who signs in, opens the studio, or is already working in it when the owner switches it on, is shown "Protect your account" in place of every studio page, the account page and the practitioner and area pages: the studio's name, "Fernleaf Rooms asks everyone to use two-step sign-in. Once it is set up, signing in asks for a code from your phone as well as your password, and Fernleaf Rooms opens straight away.", and the usual set-up (QR code or key, the six numbers, ten recovery codes to save) with one main button. "I have saved them" opens the studio: the practitioner's day, the regional manager's area or the studio's Today. "Choose another studio" appears for someone in more than one studio, and "Sign out" is always there. The studio's saved day sheet leaves the tab when the hold begins. Guest pages (visit links, booking, news stop, test payments, pricing, password and confirmation links) are never replaced.
- **The welcome after joining** says, when the studio asks, "Your sign-in opens guests' private details. Fernleaf Rooms asks everyone to use two-step sign-in, so set it up now before you open the studio." and makes "Set up two-step sign-in" the main button, with Open the studio stepping back to secondary. Skipping the welcome leads to Protect your account. Without the switch the welcome is as before, now pointing to the account page as well as Settings.
- **The account page** marks such a studio "Asks you to set up two-step sign-in first" for someone without it.
- **Turning it off yourself** in a studio that asks warns first: "Fernleaf Rooms asks everyone to use two-step sign-in, so you will be asked to set it up again before you can open it. To move to a new phone, turn it off here and set it up again straight away." It is allowed, so a lost or replaced phone never locks anyone out for good; they are held at once until it is set up again. That includes the owner, who then cannot switch the studio's rule off until they have set it up again.
- **Who changed what** records each switch under Sign-in and access: "Changed whether everyone must use two-step sign-in", with "two-step sign-in for everyone no became yes".
- **Help**: "Turn on two-step sign-in" is now for everyone, including practitioners and regional managers (it says where each finds it, and what happens when a studio asks), and is offered on the account page. A new owner guide, "Ask everyone to use two-step sign-in", is found by "require two factor for everyone" or "make the whole team use 2fa".

## Who can do what

| Role                                                                        | Own two-step sign-in            | Change the switch      | Held while it is on and theirs is off |
| --------------------------------------------------------------------------- | ------------------------------- | ---------------------- | ------------------------------------- |
| Owner                                                                       | Account page and Settings, Team | Yes, once theirs is on | Yes (after turning their own off)     |
| Manager                                                                     | Account page and Settings, Team | No                     | Yes                                   |
| General manager                                                             | Account page and Settings, Team | No                     | Yes                                   |
| Reception                                                                   | Account page and Settings, Team | No                     | Yes                                   |
| Practitioner                                                                | Account page (and the welcome)  | No                     | Yes                                   |
| Regional manager                                                            | Account page (and the welcome)  | No                     | Yes                                   |
| Access key, diary link, guest link, booking page, Google, ChatGPT or Claude | Not a person signing in         | No                     | Never                                 |

## Server

- **The choice** is `operations.twoStep: { forEveryone }` in the studio record (`src/domain/twoStepRule.ts`), set by a new owner-only command, `two-step-rule`. `can` lists it with the owner's own settings; it is not in `GENERAL_ACTIONS`, and `practitionerRefusal` and `areaRefusal` refuse it as they refuse everything not on their lists. Asking for what is already set changes nothing and records nothing.
- **The owner first.** `server/twoStepRule.ts` listens to every saved change (`onPersist`, inside the change's transaction) and refuses switching it on unless the person saving has two-step sign-in on (409, "Turn on two-step sign-in for yourself first, then ask everyone to use it."). An access key's change has no account, so it can never switch it on. Switching off needs nothing extra.
- **The hold** is in `orgFor` (`server/context.ts`), which every studio route uses: straight after finding the person's membership, if the studio asks and their account has no two-step sign-in, it refuses with 403 `{error: "Fernleaf Rooms asks everyone to use two-step sign-in. Set it up to open the studio.", code: "two_step_required"}`. It comes before the practitioner, regional and general manager checks, so every refusal a held person meets carries the code. Product photos, which skip `orgFor` for speed, read the switch and go through `orgFor` when it is on. `/api/group` (brands together) leaves out a studio that holds the owner rather than failing.
- **Open while held**: `/api/session` (which now names each such studio with `twoStepRequired: true`), the sign-in, password and confirmation routes, `/api/auth/two-step/*` and sign-out. None reads the studio record.
- **Every way in leads to the step.** The hold belongs to the account and the studio, not the session, so signing in by password, by a reset link, by changing a password or by registering from an invitation all give a session that is held. Accepting an invitation passes `joining` to `orgFor` so the membership is made and the invitation used, then the new member is held. Turning their own two-step sign-in off holds them again at once. Switching the rule off releases everyone at once.
- **Two studios**: someone in a studio that asks and one that does not is held only by the first.
- The existing two-step security is untouched: codes are checked on the server, recovery codes are single use, attempts are rate limited and nothing secret reaches the front end after set-up.
- `server/README.md`: a paragraph under Two-step sign-in.

## Front end

- `src/state/api.ts`: `ApiError` keeps a refusal's `code`; a `two_step_required` refusal from a studio route tells `onTwoStepHold` listeners which studio. `src/state/StoreProvider.tsx` keeps it as `hold` (cleared on signing out or by another person signing in, and by `releaseHold`) and forgets that studio's saved day sheet. `src/App.tsx` shows `ProtectAccount` while there is a hold, on every page but guest and public ones.
- `src/pages/ProtectAccount.tsx` and `protectAccount.css`: the page, in the account page's layout with one photograph (window light) and the words "Guests trust you with their details."
- `src/components/TwoStepSettings.tsx`: `plain` (unfolded, for Protect your account), `lead` (its set-up button stays the main one inside the welcome), `onDone` (after the codes are saved) and the studio-asks wording.
- `src/components/TwoStepForEveryone.tsx`: the owner's switch. `src/components/AccessPanel.tsx`: row wording and the switch. `src/pages/Account.tsx`: the fold, the held-studio note and the welcome's `required`.
- `src/pages/TeamWelcome.tsx` (belongs to the welcome thread; changed only as far as needed): a `required` prop that changes the last screen's sentence, hides "You can also turn it on later" and makes setting up the main button. Its existing sentence for the not-required case now also names the account page.

## Tests

- `server/twoStepRule.test.ts` (13): only the owner changes it, refused for manager, reception, practitioner, regional and general manager even with their own two-step on; **the owner must have it on first** and the record is unchanged when refused; asking twice records nothing; the change record keeps both switches with before and after; **every role without it is held** on the studio record, saving, the day sheet, the change record and diary links, with the exact message and code, while `/api/session` still answers, and **setting it up releases them in the same session**; product photos held; a held person can sign out; switching off releases; **two studios, held only by the one that asks**, and saving in the other still works; **invitations** accepted by a new account and by an existing one, both used and recorded, then held; **password sign-in, a reset link and a password change** each give a held session; turning your own off holds you again, including the owner, who cannot switch the rule off until set up again; **access keys and the booking page keep working** while every person is held; brands together leaves out a held studio; the team list says who has it on and carries nothing secret.
- `src/domain/twoStepRule.test.ts` (7): off by default, on and off, kept through a reload; no change when already set; owner only for all six roles and both refusal functions; the schema takes only a yes or no; the change detail; the held message; name lists.
- `src/state/twoStepHold.test.tsx` (2): the code from a studio route tells the app which studio (and nothing else does); the store keeps the hold, releases it and forgets it on signing out.
- `src/components/TwoStepForEveryone.test.tsx` (3): counts and names who has not yet, one button, the saved note; waits for the owner's own; stops asking and shows a refusal in its own words.
- `src/pages/ProtectAccount.test.tsx` (4): names the studio, one main button, focus on the heading, sign out; opens the studio and only then lets the hold go; a practitioner goes back to their day; choosing another studio.
- `src/pages/TeamWelcome.test.tsx`: one updated sentence, and a new test for the required wording and the main button.
- `src/domain/help.test.ts`: searches for both guides, by role, and the guide on the account page.

## Checks

From the worktree root:

- `npx tsc -b`: passes.
- `npm run lint`: passes.
- `npm run format:check`: passes.
- `npm test` with `DB_PATH` on a fresh file under `.claude-tmp/`: front end 192 files, 1,662 tests passed (base 188 and 1,645); server 68 files passed and 1 skipped, 548 passed and 2 skipped (base 535 passed).
- `npm run build`: passes.

## Decisions

- **No migration.** The choice is a yes or no on the studio record, like the other owner settings, and travels with backups and restores.
- **Turning your own off stays allowed** in a studio that asks, with a warning, because it is also how someone moves to a new phone; they are held at once until it is set up again.
- **The hold is checked first in `orgFor`**, before the role checks, so a held regional manager on any route is told about two-step sign-in rather than about their area.
- **The switch sits at the foot of Settings, Team**, after the owner's own fold, as a secondary button, because inviting people stays the main job of that page and the switch is rarely changed.
- **Diary links** (calendar feeds a person made for their own visits) are read by calendar apps with their own link, like access keys, so they are not held. The person can stop a link from Settings once they are back in.
- **Help requests** sent from Protect your account are not offered; a held person can sign out or set it up.
- **Sample studios** need nothing new to show it: the switch, the counts and the rows work in any sample studio, and the sample's owner switches it on once their own two-step sign-in is on. It is left off in the sample so nobody is held on opening one.
- **`LoadingShapes`, `MoreOptions` and `--motion-calm` are not on this base**, so none is imported; Protect your account carries the `settle` class, which the welcome already uses, so it arrives calmly once the calm motion is in the library.

## Quality bar

Checked by reading the markup and styles; the lead's browser pass confirms at 1440 and 390 px.

- One main job and one primary button: Protect your account has one (Set up two-step sign-in, then Turn on, then I have saved them, or Open the studio); the switch is secondary on Team; the welcome's last screen keeps one primary.
- Rarely used options tucked away: the switch is at the foot of Team; the person's own two-step sign-in stays in its fold on Team and the account page.
- No card inside a card: the switch is a section with a hairline inside the Team panel, not a card; Protect your account is the account page's layout.
- One photograph per view, framed like the account page: Protect your account uses the window light photograph in the account page's story panel.
- Empty pages: not applicable.
- Loading: no new loading state; the page arrives through the app's existing lazy loading.
- Motion: `settle` on Protect your account, inert until the calm motion lands; reduced motion is unaffected.
- At 390 px: the account layout stacks; on Protect your account the main buttons are full width (`protectAccount.css`); quiet buttons stack in the footer; every control is an existing button or field at the 44 px target.
- Words: plain British English, no em dashes, saying what happens next.
- Built from `src/design` and existing classes (`Button`, `ErrorMessage`, `access-two-step-state`, `ops-help`); no new colours.
- Before and after pictures: for the lead's browser pass.

## For the browser pass

1. Sign in as the owner of a studio of your own with a manager and a practitioner (invite them from Settings, Team). On Team, each row says whether two-step sign-in is on, and at the foot "Ask everyone to use two-step sign-in" waits for the owner's own.
2. Turn on the owner's two-step sign-in in the fold above, then choose Ask everyone to use it. The badge says On and the count names who has not yet. Settings, Who changed what, Sign-in and access shows the change.
3. In another browser, sign in as the manager: Protect your account appears at once. Set it up; I have saved them opens Today. Repeat as the practitioner: their day opens.
4. Invite someone new and join from the link: the welcome's last screen says it is needed, with Set up two-step sign-in as the main button.
5. As someone in two studios, check the other studio still opens and Choose another studio leads to it.
6. Check the account page's Two-step sign-in fold as a practitioner and as a regional manager, at 390 px too.
7. Choose Stop asking everyone and check a held person can open the studio again.

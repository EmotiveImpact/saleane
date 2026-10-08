# V5 · General managers who run one location: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A sample studio (main location Marylebone) was given two more locations, Islington and Leeds, a room at Islington and a facialist, Nia Fictional, who works there every day. All names are fictional. Nothing was deployed.

## What was exercised

- **Inviting (owner):** under Settings, Team, Workspace access, "General manager" appears as an access choice once the studio has more than one location, with "Runs" offering Marylebone, Islington and Leeds. The help text explains what a general manager can and cannot do. An invitation for Islington was created.
- **Joining:** after "Join studio" the new account opened Today in the studio workspace. The sidebar says "General manager · Islington".
- **Their location first:** the calendar and Business opened with Islington chosen (other locations remain one choice away). Business shows Overview, Money, Stock, Rota, Gift cards, Feedback, Branch visits and Requests; Pay and Accounts are not offered, and opening `/business/pay` returns to Business.
- **Branch visits and requests:** "Start a visit" offered Islington only and there is no Checklists button. "Ask for a sign-off" offered Islington only; "New till drawer" for £120 was sent and showed "Waiting on the owner, because its location is in no region." There is no Regional limit button and no Decide button.
- **Refused elsewhere:** cancelling a Marylebone visit through the studio's command route answered 403 "That visit is at another location."
- **Settings:** the studio's settings are shown with their save buttons switched off.
- **Phone (390px):** no sideways scrolling.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the owner's invitation form, Today, Calendar, Business, Requests or Settings as a general manager. No console errors beyond the usual 401 before signing in.

The full sweep (`scripts/qualify.mjs`) still covers 159 pages with 0 axe violations; the only console errors are the three known 401s on the demo account page.

Screenshots: [invitation](V5-GENERAL-invite.png), [calendar on their location](V5-GENERAL-calendar.png), [on a phone](V5-GENERAL-390.png).

## Automated checks

- `src/domain/branch.test.ts`: which actions a general manager may use at all; visits, stock (no location means the main one) and requests at another location are refused, including inside a batch, while a client note is not; a change that moves a visit into or out of their location is caught after it is made; their record has no pay rates and only their own location's branch visits.
- `server/branch.test.ts`: an invitation needs an open location; the read is the studio record with their location, no pay rates and no other location's branch visits, and the team page is refused; booking without a location puts the visit at theirs, booking or cancelling at the main location is refused, a move to someone at another location leaves the visit where it was, and their own visit can be cancelled; client notes and stock at their location are allowed, stock at the main location, the regional limit, regions, adding a location and deciding requests are refused; a request at their location is raised, one at the main location is refused; changing their location moves their view, and closing it shuts them out.
- `server/database.test.ts`: migration 21 keeps every membership and invitation, and a general manager must name a location while no other role may.

## How it is kept safe

- The role is `general`, separate from `manager`. Its permissions are a fixed list (`GENERAL_ACTIONS`), so anything new stays shut to it until added.
- Every change is checked on the server before it runs (`branchRefusal`: the visit, sale, order, stock shelf, branch visit or request must be at their location) and after (`branchChangeRefusal`: no visit added or changed anywhere else). Card payments, card refunds and guest links check the visit's location too.
- The read is built on the server (`branchView`): the team's pay rates and other locations' branch visits and requests never reach them.

## Limits

- A general manager sees the whole studio's diary and clients, as the desk does, so they can help a guest who visits another location; they cannot change visits there.
- They cannot yet change their own team's hours, time off or rooms; the owner or a manager does that.
- One location per general manager.

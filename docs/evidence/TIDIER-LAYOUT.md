# NEXT-19 · A tidier SALEANE: Money, Team, a shorter Settings and You

Recorded 11 October 2026 on a local build (Chromium, 127.0.0.1:5173). Two studios were used: the browser demo (Atelier House, 6 October 2026) and a new local studio, Fernleaf Rooms, signed in as its owner. The "before" pictures come from main at `f14f560`; the "after" ones from this branch.

The plan, with real before and after screens, was shown to Edem on 11 October 2026 (https://claude.ai/artifact/9m5UBFGhbuECBrchuaqjNH), and Edem chose "Build all". The six moves from the finishing check are part of it. The rules are in [DESIGN_LANGUAGE.md](../DESIGN_LANGUAGE.md#the-frame).

## What moved

| Before                                                                    | After                                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Sidebar of 8: no Money or Team                                            | Sidebar of 10: Money and Team after Marketing                                                        |
| Business with 11 tabs                                                     | Business with 4 to 6: Overview, Feedback, Client areas, How you compare, and Branch visits, Requests |
| Money, Gift cards, Stock, Accounts under Business                         | Money: Takings, Gift cards, Stock, Accounts                                                          |
| Team in Settings; Rota and Pay under Business                             | Team: People, Rota, Pay                                                                              |
| Settings: 21 sections in 5 groups                                         | Settings: 19 sections in 4 groups, with Find a setting on a computer                                 |
| Studio details about 4,131px tall (tax, booking links, guest notes, AI)   | Studio details about 1,165px: the studio's name, address, contact details and time zone              |
| Your preferences in Settings; your password, two-step and Face ID in Team | You, from your name: preferences, signing in, your accounts and studios                              |
| "Messages to clients" button in Inbox                                     | Gone; Marketing has it                                                                               |
| Visit emails' look offered a birthday email                               | Visit emails only; the birthday email is in Marketing, Automatic                                     |
| Quiet-time price in Settings, Messages                                    | On the Waitlist, beside the guests it may go to                                                      |
| Design language and Refresh records in every studio's footer              | Design language in the demo only; Refresh records gone                                               |
| "Switching over"                                                          | "Moving in"                                                                                          |

Older addresses still land in the new places: `/business/money`, `/business/gift-cards`, `/business/stock`, `/business/accounts`, `/business/rota` and `/business/pay`, and `/settings?section=staff`, `preferences` and `diaries`. Reception has no Business (nothing in it is theirs) and lands on Money.

## Tests

- `src/components/interaction.test.tsx`: the desk opens Money (Takings, Gift cards, Stock) and Team (People, Rota) from the sidebar with no Business; pages kept for owners and managers send the desk to Money or Team; an owner gets Takings, Gift cards, Stock, Accounts and People, Rota, Pay; the old Business addresses open their new pages; Settings has four groups with Payments & tax; Find a setting narrows the list by "VAT", "parking" and "google" and says when nothing matches; `?section=staff`, `preferences` and `diaries` open Team, You and Connected software; tax is under Payments & tax and the online booking switch under Booking page & colours, not Studio details; You shows preferences and, in the demo, where signing in will be; the desk opens You at signing in from "Password, two-step and Face ID".
- `src/domain/help.test.ts`: every guide's "Go there" is a real route or Settings section, now read from the multi-line section list; Money's guides show on `/money`; diaries show with Connected software. A new guide, "Open or close online booking", points at Booking page & colours.
- `src/components/TwoStepForEveryone.test.tsx`: the owner's switch on Team links to Password, two-step and Face ID on You.
- `src/components/quietOffersApp.test.tsx`, `EmailPreview.test.tsx`, `StaffMove.test.tsx`, `GetReady.test.tsx`, `HelpPanel.test.tsx`, `qualityBar.test.tsx`, `PlanCards.test.tsx`, `TeamWelcome.test.tsx`, `ask.test.ts` and `pageTops.test.ts` follow the moves.

## Browser journey

1. Demo, 1440px and 390px: Money, Gift cards, Stock, Accounts, Team, Rota, Pay, Business, Settings (Studio details, Booking page & colours, Payments & tax, Messages to guests, Before and after a visit, Connected software, Moving in), You, Waitlist and Inbox. Every page has one heading, nothing scrolls sideways, no card sits inside a card and no panel has two primary buttons.
2. Find a setting: "tax" leaves Payments & tax; "zebra" says Nothing matches “zebra”.
3. Fernleaf Rooms, signed in as its owner: your name opens Your preferences (`/you`), Password, two-step and Face ID (`/you#signing-in`), Your accounts and studios, Help and Sign out. You shows Your preferences, Signing in (Change your password, Two-step sign-in, Face ID and fingerprint) and Your accounts and studios. Team shows The people behind every visit and Who can sign in, with Ask everyone to use two-step sign-in linking to You. The phone menu lists the ten items, Your booking page and You.

## Not covered

Safari and Firefox were not checked. At 390px a few page-top buttons ("Sell a gift card", "Add a product", "Add time off", "Download for payroll", "Export report", "Add to the waitlist", "Write a draft") measure 42px tall, and Business's small "How it is measured" marks 22px; both were the same on main and are not changed here. On a phone Settings keeps its one Section picker; Find a setting is on computers only.

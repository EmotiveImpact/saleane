# NEXT-18 · The polish pass: Radix and Motion

Recorded 11 October 2026 on a local build (Chromium, 127.0.0.1:5173). Two studios were used: the browser demo (Atelier House, 6 October 2026) and a new local studio, Fernleaf Rooms in Islington, created through Create an account with no visits, clients or team. The "before" pictures and clips come from the polish base at `0bd51ac` (main with #84, #83, #76, #81, Face ID, Marketing and #103 merged in) on the same database; the "after" ones from this branch before #104 was merged in, which changes no screen in them.

Before and after, on a computer and a phone, with short clips of what moves: https://claude.ai/artifact/1q3R6ZAg86KFYyFEPANF3h

The rules are in [DESIGN_LANGUAGE.md](../DESIGN_LANGUAGE.md#components) (components and the Radix parts) and [Where things move](../DESIGN_LANGUAGE.md#where-things-move).

## Tests

- `src/design/controls.test.tsx` (9 tests): `Select` opens its own list with the current choice ticked and its groups named, hands back the value chosen and keeps focus on the field; a form reads its plain value through FormData, an empty choice included. A tick is a checkbox and a switch is heard as a switch, each read by a form. A `Menu` opens by keyboard, lists its items, closes on Escape with focus back on its button, and a pop-up opened from an item returns focus to the menu's button when it closes. A `Tip` names an icon button on keyboard focus without replacing its own label, and shows nothing when switched off. `notify` puts its words in the named Notices region with a Dismiss button. `MovingList` rows are plain elements, shown at once, when motion is not allowed.
- `src/design/qualityBar.test.tsx` (16 tests, 8 new): a new studio's Business, Accounts, Client areas, Marketing Audience and Calendar each open with one welcome heading and no figures; an owner with setup unfinished is sent to it; a manager sees Add your team; the sample studio keeps its figures.
- `src/components/WaitingStrip.test.tsx` (new): on phone Today, every chip in the Needs you strip links to its card, and the strip comes before The day ahead.
- `src/pages/Stock.test.tsx`: each row shows Delivery and a More menu named for the product; Correct the count opens from the menu with its field focused and focus returns to More when it closes; a delivery shows its corner notice.
- About 15 existing tests changed only how they reach a choice: drop-downs and menus open asynchronously, so they open the list (`src/test/choices.ts`) and use `findByRole`.

## Browser journey

1. Sidebar. The two-line strapline under SALEANE is gone and the items start higher, leaving room for one or two more. The fold button beside SALEANE narrows it to its icons, each with a hint, and the page widens with it; the choice is kept in that browser.
2. Your name opens a Radix menu (your preferences and help) instead of going to Settings, and the studio's name opens the studio menu.
3. Find a client: "/" opened it on the calendar and Ctrl K in Settings; typing "am", the down arrow and Enter opened the second match's client page.
4. Drop-downs open SALEANE's list with a tick beside the current choice; on the calendar's professionals filter the arrow keys and Enter chose another person (clip in the before and after page).
5. Hide completed on Today was ticked with the Space bar. Settings' ticks and round choices are drawn in SALEANE's colours.
6. Hints: "Next day" on the calendar arrow on hover, "Next week" on the rota arrow on keyboard focus, and "09:30 to 10:30, Florence Lindqvist, Deep Restore Massage with Maya Lewis" on a visit in the week view.
7. Stock: each row keeps Delivery and puts Used in treatments, Correct the count, Move (with several locations) and Edit details under More. Recording a delivery of 6 showed "Delivery of 6 recorded for Calming Cleansing Balm. 12 in stock." in the corner.
8. Movement, in clips: a visit's side panel slides in and back out the way it came; Today, Week and Month swap with the chosen mark sliding and the view fading up; Hide completed fades finished visits and slides the rest up; the phone menu is a drawer from the left. With motion allowed, opening a side panel ran 10 animations; with reduced motion asked for, none ran.
9. New studio: Business, Accounts, Client areas, Marketing's Audience and the Calendar open with a photograph, one line and the next step (Set up step by step while setup is unfinished). Today shows no figures until the first visit. On a phone, Business went from about 3,680px of figures at nought to one welcome.
10. Phone Today: the Needs you strip (2 calls to return, 1 call the AI answered, 2 patch tests to sort) sits under the greeting; before, Needs you started about 2,500px down.
11. Touch, at 390px with a touch screen: on Today, Calendar, Stock, Settings, Inbox, Waitlist, Clients, Marketing and Business every button, link, tab, choice, tick and field measured at least 44px one way and 24px the other, counting the larger touch area some small marks take. The exceptions are links inside a line of text (client names in Stock's history, See rent on Business), which the inline rule allows. Three found on the way were fixed: the calendar's grid and list switch (40px), ticks (34px) and the names in Needs you (21px tall).
12. `/design-language` shows menus and hints, the drop-down, ticks and switches, a notice and a list that moves, live.

No console errors or page errors on any of these pages.

## Not covered

Safari and Firefox were not checked. Round choices and folds stay native, drawn to match, so their keyboard behaviour is the browser's own. The moves from the finishing check (grouping Business's tabs, a "You" section for your own sign-in settings, and the rest) are not part of this pass; they wait for the owner's yes.

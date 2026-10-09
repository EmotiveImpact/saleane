# V5 · Automatic checks across locations: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. A UK sample studio was registered with a second location, Islington, both in a London region with a regional manager. All names are fictional. Nothing was deployed and no one was contacted.

## What was exercised

- **Owner, Business, "The whole business":** a new "Needs a look" block lists what the automatic checks find. With the sample's starter checklist and no visit yet at the new location it read "Islington is due a branch visit. Not visited yet."
- **Automatic checks (owner only):** the dialog lists four checks, each with a short explanation, an "On" box and its number: takings fall (20% by default), short of target (10%, from the 7th of the month), branch visit due (30 days, only once there is a checklist) and request waiting (3 days). Turning off "Branch visit due" and saving says "Automatic checks saved." and the block then reads "The automatic checks found nothing that needs a look today."
- **Regional manager:** their page shows the same "Needs a look" block for their region's locations only. Branch visits due stay in their morning summary, now after the owner's chosen number of days.
- **Phone (390px) and accessibility:** no sideways scrolling; axe (WCAG 2.2 A/AA) finds nothing on the owner page, the dialog or the regional manager's page; the only console message is the expected 401 before the regional manager signs in.

Screenshots: [the alerts](V5-CHECKS-alerts.png), [the dialog](V5-CHECKS-editor.png).

## Automated checks

`src/domain/groupChecks.test.ts` covers: a location's week down by the chosen share named with its figures, one just under left out, a tighter setting naming both and the check switched off; the month-end estimate short of a target named from the 7th and not before; branch visits due only once a checklist exists, cleared by a visit and due again 30 days later; a request waiting four days named with who it waits for, not on day one, and a regional manager's view holding only their own region's alerts; only the owner may change the checks, numbers outside the allowed range refused, and unchosen checks keeping their defaults.

## Limits

- The checks are worked out each time the page is read, from the business's own records. Nothing is changed, sent or decided automatically, and no one is notified outside the app; a daily email or text of these waits for a live email and text provider.
- They cover locations of one studio. Several brands keep their own checks.

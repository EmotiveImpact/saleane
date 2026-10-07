# V1.5 · Waitlist: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a signed-in sample studio. All names are fictional.

## What was exercised

- **Waitlist page (owner, 1280px and 390px):** three sample clients waiting, each with the earliest three times that suit them read live from the diary (Charlotte: facial with Maya, afternoons or evenings; Emily: massage with anyone, mornings; Jamie: cut with Theo, any time).
- **Write an offer:** choosing one of Charlotte's times and "Write an offer" shows "The offer is waiting in the Inbox for you to approve. Nothing has been sent." The draft appears in the Inbox and the card notes the offer.
- **Book it for them:** choosing one of Emily's times and "Book it for them" books the visit, takes her off the list (3 cards to 2) and the page counts 1 time filled from the list in the last 30 days, with its value.
- **Add to the waitlist:** Amelia added for evenings from the page's form; her card shows "Nothing free yet that suits" when no evening fits.
- **Client page:** Charlotte's page has a Waitlist panel with her request, its times and the offer written.
- **Guest (390px):** a guest booked online for 13 October opened their private visit link, ticked "Anyone is fine" and Afternoons and chose "Tell me if something sooner comes up". The page then reads "If an earlier time opens with anyone in the afternoon, Journey Studio will be in touch. Your visit stays as it is until you say yes." The desk's page showed the request as "Asked online", with "would like to come in sooner". "Leave the waitlist" took it off again.
- No console errors throughout. The full sweep (`scripts/qualify.mjs`, now including the Waitlist page) reports 105 pages with zero axe violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [waitlist page](V15-WAITLIST-page.png), [offer written](V15-WAITLIST-offer.png), [page at 390px](V15-WAITLIST-390.png), [client panel](V15-WAITLIST-client.png), [guest asks](V15-WAITLIST-guest-ask.png), [guest on the list](V15-WAITLIST-guest-joined.png).

## Automated checks

`src/domain/waitlist.test.ts` covers: the seeded entries passing the ledger check, with every opening inside the window, with the chosen professional and at the chosen times of day; adding once (a retry changes nothing, a second request for the same service is refused) and refusing a window in the past, longer than 90 days, a professional who does not offer the service or an unknown client; booking an opening closing the request and counting its value, another client unable to fill it and a filled request unable to fill again; an offer becoming an Inbox draft that is never sent, and a time that is not free refused; removal keeping the request and reason; a guest joining, changing their answer (replacing rather than adding), leaving, and no staff role able to act for them; a guest's later visit moved earlier rather than a second visit booked; a cancelled visit ending the guest's request; entries from another studio or for an unknown client rejected; the client export, its preview, the erasure review and the retention register. `server/waitlist.test.ts` covers the guest link end to end (join, retry saves nothing, change, leave, a repeated leave saving nothing), a visit too soon, malformed requests, an unknown link, staff refused the guest command, reception adding and booking from the list and a practitioner refused. `server/guestExtras.test.ts` confirms the guest view gains only their own waitlist choice.

## Limits

- SALEANE never contacts anyone from the waitlist by itself. An offer is a draft the team approves in the Inbox; with no provider connected, approved messages wait unsent.
- An offer does not hold the time; the first to answer gets it, and the desk books or moves the visit.
- Openings are searched across the whole requested window (at most 90 days) on a 15-minute grid, and the earliest three are shown. For a guest with a visit, times are checked with the length and room their visit was booked with.
- Removing a request is a status change with a reason; nothing is deleted. Requests are kept 90 days after their dates end, then wait for an owner or manager to approve deletion or keep them longer.
- Safari and Firefox were not checked.

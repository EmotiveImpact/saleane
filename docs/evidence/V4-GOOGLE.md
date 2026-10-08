# V4 · Book with Google: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. All names are fictional. SALEANE is not a Google booking partner, so Google cannot call this server and nothing was sent to Google.

## What was built

- **SALEANE's side of Google's booking server.** Google's Actions Center calls a partner's server to check a time, book it, look a booking up, list a guest's bookings and cancel. The calls built are HealthCheck, BatchAvailabilityLookup (the one Google uses for new integrations), CheckAvailability, CreateBooking, UpdateBooking (cancelling only), GetBookingStatus and ListBookings under `/api/partners/google/v3/`. They are off unless the server is started with `SALEANE_GOOGLE_BOOKING=test` and partner credentials (`GOOGLE_BOOKING_USERNAME`, `GOOGLE_BOOKING_PASSWORD`), and every call must carry them. Test mode answers only on this computer (a loopback address), so it can never be pointed at Google's sandbox with a real studio's diary. Google's sandbox needs its own mode with practice studios, built during partner onboarding.
- **The three feeds Google reads:** the studio, its treatments (with the localised treatment name Google requires) and the full price a guest pays, and free times for each professional over the next 30 days, all from the studio record. Only the owner can see them, and they are empty unless the studio is offered.
- **The owner's choice:** Settings › Studio details › Book with Google, owner only. A sample studio never sees it and cannot turn it on.
- Field names follow Google's published booking server and feed references as read on 8 October 2026. They must be checked with Google's own test tools during partner onboarding. Changing a booking's time is not built; the guest can cancel and book again.

## Rules it keeps

- A Google booking goes through the same `book` command as the studio's booking page, with the source "online" and the channel "google", so it lands in the diary with the usual confirmation and shows where it came from.
- The same request sent twice books once (Google's idempotency token is kept per studio). A time already taken comes back as "slot unavailable", and a guest's list holds only their own visits still to come, never cancelled or past ones.
- A guest can cancel until the visit starts, the same as with their own booking link. After that Google is told it is outside the cancellation window.
- Treatments that need a deposit are left out of the feeds and refused if asked for, because no payment is taken through Google. They stay on the studio's own booking page.

## What was exercised in the browser

- A studio of its own with one treatment and one professional. "Offer my studio for booking on Google" was ticked and saved, and was still on when the record was read back. The panel then said Google would show 1 treatment and 960 free times over the next 30 days, and no visits booked through Google yet.
- With no partner credentials the panel says plainly that SALEANE is not a Google booking partner yet, so Google cannot send bookings.
- A sample studio does not show the panel.
- axe (WCAG 2.2 A/AA) finds nothing on the panel. No console errors. The full sweep stays at 147 pages with no violations.

Screenshot: [the owner's panel](V4-GOOGLE-panel.png).

## Automated checks

`server/googleBooking.test.ts` covers: the calls are off unless the server is started for them and refuse wrong credentials; only studios whose owner chose it are offered, never a sample studio; the feeds come from the studio record and only the owner can read them; test mode refuses to answer from a public address; several times are checked at once; a free time books once per request, into the diary, and is refused to a second request; booking status, a guest's list of visits still to come, and cancelling until the visit starts, then refusing after it starts; and treatments that need a deposit are neither offered nor bookable.

## Instagram book button

Guests already book from Instagram through the studio's Instagram link in Share your booking page, which marks those bookings as coming from Instagram. Meta's own "Book" button on a profile needs Meta to approve SALEANE as a partner, so it is not built.

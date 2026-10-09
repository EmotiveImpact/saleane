# Set up your studio, and add a location

Built locally on 9 October 2026 at the owner's request ("ok do that"). Nothing is deployed, nothing is charged and no message is sent.

## What was checked

- Domain tests: `src/domain/setup.test.ts` (saving each setup screen together, refusing all of it when one change fails, never moving the owner back, readiness, owner only; opening a location with its rooms, team days, new people and menu, refusing closed days, unknown people, duplicate names and unknown treatments, keeping house rules and booked visits), `src/domain/setupScreens.test.ts` (an empty studio taken through all eight screens to taking bookings, each screen's plain-words problem, coming back to change or remove saved treatments, deposits and tax), `src/domain/locationOpening.test.ts` (the starting menu and rooms, the one saved change, each screen's problem, core treatments and the price band, booked visits shown before saving).
- Server tests: `server/setup.test.ts` (the owner saves a screen and the server remembers where they reached; a manager is refused even for a change they could make in Settings; a change outside setup is refused; only the owner opens a location).
- Screen tests: `src/pages/StudioSetup.test.tsx`, `src/components/LocationOpening.test.tsx`, `src/components/GetReady.test.tsx` and `src/pages/Account.test.tsx` (a new studio of their own opens on the setup screens; a sample studio opens on Today).
- Browser, Chromium at 1280 × 900 and 390 × 844 against the local server on 127.0.0.1:5173 with a fresh database: a new owner signed up, went through every screen, left at Team with "Finish later", came back from Today with "Pick up where you left off", finished and opened for bookings. In a sample studio, the owner added Islington with its own hours, one treatment left off and one priced differently, the two suggested rooms, Theo on his day off and a new stylist on Fridays. Choosing Maya's Thursday listed the 30 sample visits it would strand and held Continue. No horizontal scrolling at 390 pixels.

## Before and after

Before, a new owner landed on Today with a list of eight links into Settings.

![Before: the ready list on Today](SETUP-01-before-today.jpg)

After, they land on "Set up your studio": one job per screen beside a house photograph, saved on Continue.

![Where guests find you](SETUP-02-studio.jpg)
![What you offer, with common treatments to add in one tap](SETUP-03-treatments.jpg)
![Who does what](SETUP-04-team.jpg)
![Leaving part-way: Today offers to pick up where they left off](SETUP-05-pick-up-on-today.jpg)
![Colours shown live on the page and a sketch of the booking page](SETUP-06-look.jpg)
![Deposits, missed visit fee and VAT, with card payments in test mode](SETUP-07-deposits.jpg)
![Ready for bookings](SETUP-08-open.jpg)
![On a phone](SETUP-09-phone-390.jpg)

Before, "Add location" was a single form for the name, address and hours; rooms, people's days and prices were set afterwards in three other places.

![Before: the add location form](LOCATION-01-before.jpg)

After, six short steps, saved together at the end.

![Treatments here, at the house price unless changed](LOCATION-02-treatments.jpg)
![Rooms and chairs, suggested from its menu](LOCATION-03-rooms.jpg)
![Who works there, with booked days marked](LOCATION-04-team.jpg)
![Check and add, with the price per location](LOCATION-05-check.jpg)
![Added](LOCATION-06-added.jpg)
![On a phone](LOCATION-07-phone-390.jpg)

## The first weeks, and a welcome for the team

Added on 9 October 2026 after the owner said yes to both. Checked in `src/domain/firstWeeks.test.ts` (each step ticks itself from the record, the sign-in and the team list; starting fresh, working alone and the usual reminders count as answers; the eight weeks start with the first visit booked here, not with visits brought across), `src/domain/welcome.test.ts` (three lines and three places for every role, in plain words, naming the location or region), `src/components/GetReady.test.tsx` (the list follows once the studio is ready, the links, never saying a message or payment went out, a manager seeing five steps, hiding, sample studios) and `src/pages/TeamWelcome.test.tsx` and `src/pages/Account.test.tsx` (a practitioner joining from an invitation reads the three screens, then opens their own day; skipping; where a manager can turn on two-step sign-in later).

In Chromium against the local server, the owner who had just opened Linden Studio saw "Your first weeks" on Today, answered "I am starting fresh", and invited Priya Shah as a practitioner, which ticked "Invite your team". Priya joined from the link in a separate browser, went through the welcome, opened the two-step setup from it, and landed on her own day. No horizontal scrolling at 390 pixels.

Before, Today had nothing after the ready list was done.

![Before: Today once the studio was ready](WEEKS-01-before-today.jpg)

After, "Your first weeks" follows, and each step ticks itself.

![Your first weeks on Today](WEEKS-02-today.jpg)
![Two steps done: starting fresh, and Priya invited](WEEKS-03-ticking.jpg)
![On a phone](WEEKS-04-phone-390.jpg)

Before, someone joining landed straight on their day (a practitioner's is shown; it is still where the welcome ends).

![Before: straight to the practitioner's day](WELCOME-01-before-day.jpg)

After, three short screens first.

![Welcome to the studio, and what you can do](WELCOME-02-hello.jpg)
![The three places you will use most](WELCOME-03-your-day.jpg)
![Keep your sign-in safe, with two-step sign-in](WELCOME-04-sign-in.jpg)
![On a phone](WELCOME-05-phone-390.jpg)

## Limits

- Prices for a location are said, not charged: charging studios is NEXT-02, owned by the build thread. The last screen says "Nothing is charged in this test version", or that a sample studio is never charged.
- The setup screens use the existing house photographs. `docs/setup-photo-prompts.md` holds a prompt for each screen if the owner wants a fresh set.
- Setup asks for everyone to work the studio's opening hours to begin with; each person's own days stay in Settings under Team. Inviting the team to sign in also stays in Settings.
- A location's photograph, its own colours and moving existing rooms into it stay in Settings.
- The first weeks list remembers "I am starting fresh", "I work on my own", "The usual ones are right" and hiding in this browser only, like the ready list. Whether the team has been invited is read from the owner's team list, so managers do not see that step.
- The welcome shows once, when someone joins from an invitation. It is not shown again on later sign-ins or to people who joined before it existed.

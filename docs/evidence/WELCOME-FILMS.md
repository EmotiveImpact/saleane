# A welcome as SALEANE opens: evidence

Recorded 13 October 2026 in Chromium (Playwright) against the development server on 127.0.0.1:5173, at 1440 × 900 and 390 × 844, in the fictional demo and with a fresh local account and studio ("Atelier Maren", fictional). Nothing was deployed. The owner approved the five films in the mockup on 11 October 2026 (mark D, name only; birthday sparks five seconds at most) and asked for them to be built on 13 October.

## What was exercised in the browser

- **The very first sign in, signed in.** A new account opened its new studio from the account page. The doors film played ("SALEANE welcomes Atelier Maren", then "Atelier Maren, come on in" and "We'll set up your studio together, one screen at a time.") and faded into Today. Reloading straight away played nothing. Same on the phone ([phone](WELCOME-FILMS-first-signed-in-390.jpg)).
- **The opening screen.** With the studio's records held back for 2.5 seconds, the reload showed the ivory opening screen with the name and its line ([phone](WELCOME-FILMS-opening-screen-390.jpg)).
- **The first open of the day, in the demo.** A fresh browser opened Today and the morning film played: the room inside the letters, then "Good morning", "Twelve visits today. Next is Ava at 11:00, Lymphatic Massage." from the sample diary ([laptop](WELCOME-FILMS-morning-1440.jpg)). It left by itself after about five and a half seconds; a reload a moment later played nothing.
- **Coming back later.** With "last in view" set to two hours earlier, opening again played "Welcome back" with who is next ([phone](WELCOME-FILMS-back-390.jpg)). A click skipped it at once.
- **Closing up and the birthday,** watched from Your preferences ([closing up](WELCOME-FILMS-evening-1440.jpg), [birthday](WELCOME-FILMS-birthday-1440.jpg)). Watched in the morning, closing up is shown as it will look when the day's last visit ends (17:00 in the sample). The birthday counted the sample's finished visits in the last twelve months (370) and its sparks carried on over Today, then faded.
- **Turning it off.** "Open straight to the studio" in Your preferences stopped it playing on the next open. Skipping by key is covered by the tests below.
- **Reduced motion.** With reduced motion the finished frame faded up (the `data-still` film) and nothing moved.
- **Both shapes.** Words at the foot on a phone with Skip at the top right; words at the left on a computer with Skip at the bottom right. The big SALEANE fits inside the screen at 320, 390, 768 and 1440 px, and a studio's name on the doors breaks only between words.
- **A clash found and fixed.** The team welcome already used a `welcome-mark` class, which drew a stray circle in the signed-in film. The film's classes now start `film-` under one `welcome-film` root.
- **Console:** no page errors in either journey.

## Automated checks

- `src/domain/welcomeScene.test.ts`: the first open of the day plays once, nothing within the hour, "welcome back" from 60 minutes away and a new first open the next day; the doors only while an account or studio is under seven days old and never twice; closing up only after the last visit has ended and not before 16:00, once a day, and never on a day with nothing booked; the birthday on the day or within six days after, once a year, across the new year and for 29 February; the words count today's visits without cancelled ones, name who is next and their treatment, call the day "all looked after" only when every visit is finished, open the doors for a new studio or a new member, count the birthday year's finished visits only, and never use an em dash.
- `src/components/Welcome.test.tsx`: nothing plays without a browser that can say how it feels about motion; the first open plays once and is remembered, with the greeting read once to screen readers and the film itself hidden from them; nobody who turned it off sees it; Skip, a tap and any key all start it leaving at once.
- `server/app.test.ts`: the session carries when the account and the studio were made.

## Full run

After bringing in main at c27e9f8, `npm run check` passed: 234 app test files (2,031 tests) and 77 server test files (650 passed, 2 skipped), with lint, types and build clean. `npm run format:check` passed.

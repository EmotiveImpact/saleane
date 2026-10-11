# LEFT-6F: dragging visits on a tablet

Stage 6 of the left-out work, item 6. Built locally on 10 October 2026, nothing deployed.

## What was wrong

Moving a visit by dragging had only ever been tried with a mouse. Followed on a tablet in a browser (Chromium with real touch events, 1024 × 768 landscape and 820 × 1180 portrait, Linden Studio, Hana Mori's visit on Tuesday 13 October at 09:30):

- A visit could be dragged with a finger, and the move dialog opened with the new time, so the basic journey worked.
- But a swipe that began on a visit moved the visit instead of scrolling the day. On a busy day, where visits cover most of the grid, scrolling the calendar with a finger kept proposing moves nobody meant.

## What changed

- With a finger, a visit is picked up only after it is held for about a third of a second. It lifts slightly (with no motion when reduced motion is on) and then slides as before. A finger that moves before then is a swipe, and the page scrolls (`src/pages/Calendar.tsx`, `src/styles.css`).
- Once a visit is held, the page stops scrolling so the finger moves the visit and not the day.
- A long press no longer opens the browser's menu or text selection over a visit.
- On touch screens the hint reads "Hold an upcoming visit, then slide it to move it, or tap a free space to book."
- A mouse or pen works exactly as before: the visit moves at once.
- Every move still goes through the move dialog, which checks the time and asks to confirm.

## Seen in a browser

- 1024 × 768: a quick upward swipe starting on Hana's visit scrolled the page by 247 px and opened nothing.
- 1024 × 768: holding the visit, then sliding down, showed "Move to 11:00" and opened Move visit with 11:00 chosen.
- 820 × 1180: a tap on the visit opened it, as before.

## Tests

`src/pages/calendarTouch.test.tsx`: a swipe never picks a visit up; a hold lifts it; a cancelled touch puts it down with no dialog; a mouse never waits for a hold.

## Not covered

A real iPad or Android tablet; Safari's touch handling was not available here.

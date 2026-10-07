# Lumane

The assistant engine behind "Ask Saleane". It is kept separate from SALEANE so other apps can
use it, and it will move to its own repository with numbered releases when a second app does.

Lumane owns the parts that are the same for every app:

- **Skills.** An app describes what the assistant may do. `read` skills answer from the app's
  records. `action` skills only propose a change; the app carries it out after a person approves.
- **Tap to approve.** Proposals carry a plain summary and expire after 30 minutes. `decide`
  returns the effect only when approved and still fresh.
- **Allowances.** Monthly amounts for typed requests, talking time and guest chats, a per-person
  hourly limit, a daily spend ceiling and a maximum talking session. The allowance is checked
  before every request, so a refused request never reaches the AI supplier.
- **The brain.** A small interface so the AI supplier can be swapped. Only the test-mode
  `scriptedBrain` ships today; it sends nothing and costs nothing.
- **Audit.** Every skill use is recorded with who asked and what happened.

Rules: nothing in this folder imports from the app that uses it, and nothing here knows about
salons, bookings or money.

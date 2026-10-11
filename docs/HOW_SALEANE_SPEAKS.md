# How SALEANE speaks

Written 10 October 2026 for Stage 6. This guide is for anyone writing words that appear in SALEANE: on the team's screens, in messages to guests, on the booking pages and in Help. It is built from what the app already says well, so every example below is real copy from the app unless it is marked as one to avoid. A shorter version sits on the design language page (`/design-language`, the Voice section), and [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) points here.

Ask SALEANE and the AI receptionist follow the same words: visit, treatment, the truth words and the money and date rules below. How the assistant itself sounds is set in its own instructions, not here.

## The short version

1. Plain British English. Short sentences, calm and specific.
2. Say **visit**, not appointment. Say **treatment**, not service. Say **client** to the team and **you** to a guest.
3. Write **SALEANE** in capitals, and **Ask SALEANE** for the assistant.
4. No em dashes anywhere, and as few en dashes as possible. Use a full stop, a comma, a colon or the word "to".
5. Never say a thing happened when it did not. A recorded payment is not charged and a queued message is not sent.
6. When you say no, say why in a few words and who can help.
7. When something fails, say what failed, that their typing is safe, and what to do next.
8. No exclamation marks.

## Who we are talking to

The team and guests hear the same calm voice, but not the same words.

| To the team                                                     | To a guest                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| "client", "guest" for someone at the desk, the person's name    | "you", "your visit"                                            |
| Names the role that can help: "Ask the owner or a manager."     | Names the studio: "the studio would keep your £25.00 deposit." |
| Can mention test mode, sample studios and what is not connected | Says only what it means for them: "no money was taken."        |
| Exact: "Only a visit still to come can be moved."               | Warm and exact: "Your visit is cancelled."                     |
| "Could not save the client. Your entries are still here."       | "We couldn’t open this visit." (the studio speaking)           |

A guest never sees internal names: no roles, no "command", no "server", no "sandbox", no error codes. A team member never sees configuration names either: "Card payments are not connected yet", never the name of a setting or a variable.

Headings can be warm on pages people arrive at ("A good day begins here.", "Relationships, remembered.", "Find your moment.") and plain on pages where people work ("What is on the shelf.", "For your accountant."). A heading is a short line, usually ending with a full stop.

## Words we use and words we avoid

| We say                        | We avoid                                     | From the app                                                   |
| ----------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| visit                         | appointment, booking slot                    | "Only a visit still to come can be cancelled."                 |
| treatment                     | service, product (for treatments)            | "Add a treatment in Settings first."                           |
| client (team), you (guest)    | customer, user, contact                      | "Add a client before reserving their visit."                   |
| the team, professional        | staff member, resource, employee             | "Any available professional"                                   |
| room or chair, space          | resource                                     | "Rooms and chairs stay at their location."                     |
| location                      | branch (except Branch visits), site, tenant  | "That client’s visits are at another location."                |
| sample studio                 | sandbox, demo tenant                         | "Nothing leaves this sample studio."                           |
| test mode                     | mocked, stubbed, dummy                       | "Card payments are in test mode, so no money moves."           |
| not connected yet             | not configured, disabled, unavailable (bare) | "Email is not connected yet, so nothing was sent."             |
| recorded, queued, saved       | processed, completed, done (for money)       | "Receipt saved. The payment was recorded by hand."             |
| sign-off                      | approval workflow, ticket                    | "Ask for a sign-off on a refund"                               |
| give back                     | reverse, refund transaction                  | "Sent for a sign-off. Nothing has been given back yet."        |
| SALEANE, Ask SALEANE          | Saleane on screen, Saléane, the system, AI   | "Ask SALEANE could not answer. Try again."                     |
| colour, centre, organise      | color, center, organize (on screens)         | "Colours & booking page"                                       |
| about, at, from, to           | approx., @, ~, en dash ranges                | "Queued to go out between 09:00 and 19:00."                    |
| one plain verb on each button | OK, Submit, Click here                       | "Add to the waitlist", "Save message settings", "Stop sharing" |

## The truth words

These words make a promise about the real world, so each has one meaning. Use the one that matches what actually happened, and add the reason when the honest word is the smaller one.

| Word                     | Use it when                                                                            | From the app                                                          |
| ------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **saved**                | SALEANE has stored it. Nothing outside the studio happened.                            | "Answer saved. Nothing leaves this sample studio."                    |
| **recorded**             | A person tells SALEANE something happened elsewhere: cash, an outside card, a no-show. | "A receipt for money recorded by hand; no card company was involved." |
| **queued**               | A message is waiting to go. Say when it will go, or why it will not.                   | "Approved. Queued to go out between 09:00 and 19:00."                 |
| **sent**                 | Only when the email or text provider accepted it.                                      | Never for a queued or test message.                                   |
| **delivered**            | Only when the provider confirms it arrived.                                            | "A message is called delivered only when the provider confirms it."   |
| **charged**, **paid**    | Only when the card provider confirmed the money moved.                                 | "Not charged: the studio became read only."                           |
| **test payment**         | A card payment in test mode. Always say no money moved.                                | "Paid with a test card. Test mode: no money moved."                   |
| **test mode**            | A connection runs without its provider. Say what that means for this action.           | "Approved. Queued in test mode, not sent."                            |
| **settled in test mode** | A SALEANE plan bill in test mode. Never "paid".                                        | "SALEANE bill TEST-000001 settled in test mode"                       |
| **sample studio**        | The fictional studios. They never charge cards or send anything.                       | "A sample studio, so nothing was queued or sent."                     |

Two habits follow from this:

- **Say the smaller truth first, then the reason.** "Email is not connected yet, so nothing was sent." "It was a test payment, so no money was taken."
- **Never round up.** A message that might go later is "Queued", not "On its way". A deposit in a sample studio is "Deposit simulated. No real payment taken." In a sample studio the button itself says so: "Make a £25.00 test payment", "Confirm demo booking".

## Saying no

Say what cannot happen and the reason in one short sentence, then who can help. Do not apologise for a rule, and do not explain the whole permission system.

- "Only the owner can invite staff."
- "That changes the whole business. Ask the owner or a manager."
- "Rooms and chairs stay at their location. Ask the owner or a manager to move one."
- "Maya is not on the team at Islington. Ask the owner or a manager to change their day."
- "Only a draft can be approved."

To a guest, no is gentler and always offers the way forward: "Choose another time to carry on; your details are kept."

## When something goes wrong

Three parts, in this order: what did not happen, that nothing they typed is lost, and the next step.

- "Could not save the client. Your entries are still here; try again."
- "Could not save your note. Your writing is still here; try again."
- "No gift card here has that code. Check it and try again."
- "Payments are being checked with the card service after SALEANE was restored from a backup. Try again in a few minutes."
- "Confirmation is uncertain. Check this booking before choosing another time."

Never blame the person ("You entered an invalid code"), never show a code or a stack of technical words, and keep what they typed on screen.

## Empty pages and quiet moments

An empty page is a welcome, not a failure. Say what will be here and the next step.

- "Nothing is booked today yet. Open time is ready for whoever comes next."
- "When a time opens that suits them, it shows here. Nobody is contacted until you choose to."
- "Six short steps. Nothing is saved until the last one."

## Patterns to leave out

- **"This is not X, this is Y."** It sounds like an advert and makes the reader do work. Say the Y. Avoid: "This isn’t just a calendar, it’s the heartbeat of your studio." Write: "Every visit, in its place."
- **Rhetorical questions and hype.** Avoid "Ready to grow?", "Supercharge", "Seamless", "Effortless", "Magic".
- **Exclamation marks**, including in success messages. "Saved." is enough.
- **Em dashes and en dash ranges.** Avoid a dash between two times or two days. Write "09:00 to 17:00" and "Monday to Friday".
- **"Please" on every line.** Use it when asking a guest for something, not on buttons.
- **Shouting.** Capitals only for SALEANE, STOP and START, and the small eyebrow labels, which are capitalised by style, not typed in capitals.

## Numbers, dates, times and money

SALEANE writes these through `src/domain/format.ts`, so a studio's own locale decides the form. Write new words around those helpers rather than typing a format by hand.

|             | UK studio (`en-GB`) | US studio (`en-US`)  |
| ----------- | ------------------- | -------------------- |
| A day       | Tuesday 6 October   | Tuesday, October 6   |
| With a year | 14 October 2026     | October 14, 2026     |
| A time      | 09:30, 14:00        | 09:30 AM, 02:00 PM   |
| A range     | 09:00 to 19:00      | 09:00 AM to 07:00 PM |
| Money       | £85.50, £1,100      | $85.50, $1,100       |
| A phone     | 07700 900123        | (212) 555-0100       |
| An area     | postcode            | ZIP code             |

- **Money is exact.** Receipts, tables and anything to be paid keep the pence (£85.50). Headline figures may be whole pounds (£1,100) with a line saying what they cover: "Before discounts and tips".
- **Say the period.** "Today, of open professional hours", "over the last 28 days", "for the month from Friday 6 November".
- **Times are on the studio's clock.** When it matters, say so: "between 09:00 and 19:00 on the studio’s clock".
- **Numbers in sentences.** Words for one to nine when it reads better ("Six short steps"), figures for counts that change and anything with a unit ("5 days left", "50 minutes").
- **Spelling stays British** on every screen, for UK and US studios alike. The words that name things in a country follow that country: postcode or ZIP code, the gift card's legal length, phone examples. Ask SALEANE answers a US studio in American spelling.

## Punctuation and small things

- One idea per sentence. Two short sentences beat one long one with a semicolon, except for the error pattern above.
- Use the curly apostrophe (’) in new words where you can, as most screens do.
- A list of three takes "and" with no comma before it: "receipts, recorded funds and the deposits".
- Buttons start with a verb and say exactly what happens: "Approve and send", "Download for payroll", "Ask for a sign-off".
- A button that is working says so in a few words with an ellipsis: "Saving…", "Cancelling…".
- Help steps use the labels on screen word for word, and every line ends with punctuation.

## Checking your words

Before a change is merged, read the new words aloud. Then check:

- [ ] Visit, treatment, client, SALEANE and Ask SALEANE are used, and the words to avoid are not.
- [ ] No em dash, no en dash range and no exclamation mark.
- [ ] Every truth word matches what really happened, with the reason when nothing moved or was sent.
- [ ] A refusal names who can help; an error keeps the person's typing and names the next step.
- [ ] Guest words carry no roles, no test-mode jargon beyond "no money was taken", and no internal names.
- [ ] Dates, times and money come from the format helpers, so a US studio reads its own forms.

The help tests already refuse dashes, "color", "center", "appointment" and "customer" in Help guides (`src/domain/help.test.ts`).

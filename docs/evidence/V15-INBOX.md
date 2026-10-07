# V1.5 · The inbox: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. Two signed-in studios were used: a sample studio (London) and a studio of its own with providers in test mode. All names are fictional and nothing was sent.

## What was exercised

- **Conversations (sample studio):** the Inbox lists three conversations, newest first: an unknown number (+44 7700 900999) asking about Saturday, Ellie Brooks's text asking to come half an hour later on Thursday, and Amelia Carter's emailed thank-you. The first two carry "New reply"; the "New replies" filter counts 2. The banner says "Nothing leaves this sample studio."
- **Reading:** opening Ellie's conversation shows her text with where it came from and when, and records it as read by the signed-in owner.
- **Writing back:** "Write to Ellie", Send by Text (no subject line for a text), "Start from a saved reply" › Moving a visit fills the message, with a character count. In a sample studio the button reads "Approve and queue" and the result says "Approved and queued. Sending is not connected in this sample, so nothing was sent." The message sits on the right of the conversation with the same words.
- **Noting a reply:** "Note a reply", by phone, "Rang back: Friday at 11 is better." shows as "Noted by Ada Owner · by phone".
- **An unknown number:** the conversation offers "This is [client]" and "Match to this client". Matching it to Grace Chen moves the conversation to her.
- **Saved replies:** Settings › Messages lists the three sample saved replies with Edit and Remove for the owner.
- **A studio of its own, test mode:** the banner says "Test mode: nothing is sent." A text written for a new client and approved with "Approve and send" says "Approved. Test mode records it as it would be sent. Nothing was sent." After the outbox ran, the conversation shows the message as "Test mode, not sent · text".
- **On a phone (390px):** the list opens one conversation at a time with a way back, and the page does not scroll sideways.
- No console errors. axe (WCAG 2.2 A/AA) finds nothing on the inbox, the writing window, Settings, the phone view and the test-mode studio. The full sweep (`scripts/qualify.mjs`) reports 141 pages with zero violations.

Screenshots: [a conversation](V15-INBOX-conversation.png), [writing a text from a saved reply](V15-INBOX-write.png), [matching an unknown number](V15-INBOX-match.png), [test mode](V15-INBOX-testmode.png), [on a phone](V15-INBOX-phone.png) and [saved replies](V15-INBOX-saved.png).

## Automated checks

`src/domain/inbox.test.ts` covers: a reply from the text line kept with the guest whose number it is, unread, and kept once when the provider sends it again; a reply from an unknown address kept on its own and later matched to a client together with its other replies; a reply noted by the desk, read already, and health details refused; replies marked read with who read them; one conversation per guest with unread replies and drafts counted, and an approved message shown once with what the outbox did; an approved message planned once for the outbox by the channel chosen; messages queued before this change, or approved long ago, never planned; email news by text refused, and approval refused when there is nowhere to send; saved replies with names kept apart and only owners and managers changing them; replies in the client's export and approved messages kept when erasure is reviewed; and a reply naming a missing client refused.

`server/inbox.test.ts` covers, through the server: an approved message sent once by text and listed against its message; email news not sent once the guest stopped it; a reply from the text line and one from the email address kept, once, with a forged one refused and an unknown studio ignored; and the Twilio signature and Postmark secret checks for replies.

## Limits

- Replies come in only once the studio connects Twilio (its texts) or Postmark inbound (its email). Neither has been run against a real account; both are written to each provider's published webhooks. In test mode no reply arrives on its own, so the sample studio's replies are examples.
- Sending uses the providers already used for reminders, in test mode by default. Nothing was sent.
- A guest who texts STOP is blocked by Twilio itself; SALEANE shows the refusal on the next text but does not yet change the client's text setting.
- A reply is matched to a client only when exactly one client has that address or number.
- Health words are refused in notes and saved replies, as for forms. A guest's own reply is kept as they wrote it.
- Pictures sent with a text or email are not kept.
- Nothing is deleted automatically. Safari and Firefox were not checked.

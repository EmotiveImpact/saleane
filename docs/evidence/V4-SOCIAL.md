# V4 · Instagram, Facebook and WhatsApp messages: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, started with `SALEANE_SOCIAL=test` and a local app secret and verify token. All names are fictional. SALEANE is not approved by Meta, so Meta cannot send messages to this server and nothing was sent to Instagram, Facebook or WhatsApp.

## What was built

- **Meta's webhook** at `/api/hooks/meta`. Meta checks the address with the verify token (a GET with `hub.mode`, `hub.verify_token` and `hub.challenge`), then posts each message signed with the app secret (`X-Hub-Signature-256`). Unsigned or wrongly signed posts are refused. It reads Instagram (`object: instagram`) and Facebook Page (`object: page`) messages from `entry[].messaging[]`, and WhatsApp (`object: whatsapp_business_account`) messages from `entry[].changes[].value.messages[]` with the sender's name from `contacts`. The studio's own echoes and anything that is not a guest's message are left out. Field names follow Meta's Messenger Platform, Instagram Messaging and WhatsApp Cloud API webhook references as read on 8 October 2026.
- **The studio's accounts:** Settings › Studio details › Instagram, Facebook and WhatsApp, owner only. While SALEANE waits for Meta's approval the owner types each account's id; signing in with Meta replaces that once approved. An account can belong to one studio only. A message to an account no studio has connected is ignored.
- **The Inbox:** messages arrive in the guest's conversation. A WhatsApp number is matched to its client; Instagram and Facebook give only an id, so those are matched by hand and the answers move with them.
- **Answers:** the team answers in the conversation, on the app the guest wrote on, within a day of the guest's last message there (Meta's standard messaging window). Answers are kept in the studio record with who wrote them, and go through the outbox once from the studio's own account. Each message and answer records the studio account the guest wrote to, because Instagram and Facebook give each sender an id that belongs to that account; an answer goes only from that account, and messages to another account never extend its day. The outbox checks again just before sending: a sample studio, a disconnected or changed account or a closed window means it is not sent, and the reason is shown.
- Off unless the server is started with `SALEANE_SOCIAL=test`, `META_APP_SECRET` and `META_VERIFY_TOKEN`. Test mode sends nothing: answers are recorded as "Test mode, not sent". Sending for real needs Meta's app review and each studio signing in with Meta, which are not built. Template messages for WhatsApp outside the day are not built.
- The AI receptionist does not answer these apps yet.

## What was exercised in the browser

- A studio of its own with one client, Rosa Field. In Settings the owner connected an Instagram account and a WhatsApp number; each said it was connected, and Facebook stayed open to connect. axe (WCAG 2.2 A/AA) finds nothing on the panel. A second run with the same Instagram id from another studio was refused as connected to another studio.
- A signed Instagram message ("Hi! Do you have anything for a facial this Saturday?") and a signed WhatsApp message from +44 7700 900456 were posted to the webhook. In the Inbox the Instagram one shows as "Someone on Instagram, not matched to a client yet", and the WhatsApp one went straight to Rosa Field's conversation as "WhatsApp message from +44 7700 900456".
- "Answer on Instagram" said Instagram allows answers for about 24 more hours. "Send on Instagram" saved the answer; after the next send it shows "Answered on Instagram by Ada Owner · Test mode, not sent", and the outbox lists it as an Instagram message to the sender's id. axe finds nothing on either conversation. No console errors.
- A sample studio does not show the panel.

Screenshots: [the Inbox](V4-SOCIAL-inbox.png) and [the settings panel](V4-SOCIAL-settings.png).

## Automated checks

`server/social.test.ts` covers: the webhook is off unless the server is started for it, and answers Meta's check only with the right verify token; only correctly signed messages are read, only for a connected account, once, and never the studio's echoes; a WhatsApp number is matched to its client with the name WhatsApp gives; an account belongs to one studio only and never a sample studio; an answer goes on the app the guest wrote on through the outbox from the studio's account, marks their messages read, moves to the client when matched later, and is refused a day after their last message; an answer is not sent once the day has ended or the account was disconnected before it could go; an answer goes only from the account the guest wrote to, and that account's day is not reopened by messages to another; and health words are refused.

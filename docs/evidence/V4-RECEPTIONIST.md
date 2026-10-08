# V4 · AI receptionist: evidence

Recorded 8 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a sample studio. All names are fictional. The receptionist ran in test mode: no AI supplier was called, nothing was charged and nothing left the computer.

## What was exercised

- **Settings › Colours & booking page › AI receptionist (owner):** the panel explains that the chat always says it is an AI and never books, cancels or takes a payment on its own. "Show the AI receptionist on the booking page" was ticked and saved. Reception staff cannot change it; owners and managers can.
- **The booking page on a phone (390px):** "Ask a question" opens the chat. Its first words say the guest is chatting with an AI receptionist, not a person, and that it never asks about health.
- **Answers:** "When are you open?" lists the studio's hours by day. "Any times for a facial on Thursday?" lists twelve free times for Thursday 8 October and how many more there are.
- **Offering a time:** "Book 09:00 please" offers "Skin Renewal Facial, Thursday 8 October at 09:00" with "Choose this time" and says nothing is booked until the guest confirms. Tapping it closes the chat and opens step 2 with the treatment, date and 09:00 already chosen. The guest then holds the time and confirms through the page's own steps.
- **A message for the team:** "Can someone call me about a group booking?" asks for a name and an email or phone number. "I'm Rosa Field, 07700 900456" prepares the message; nothing reaches the studio until "Send to the team" is tapped. The Inbox then shows it as "Left with the AI receptionist · answer on 07700 900456", from +447700900456, ready to be matched to a client.
- **Accessibility:** axe (WCAG 2.2 A/AA) finds nothing on the settings panel, the open chat, the offered time or the Inbox. No console errors.

Screenshot: [the chat on a phone](V4-RECEPTIONIST-chat.png).

## Automated checks

`src/assistant/receptionist.test.ts` covers: saying it is an AI; prices with the full price; opening hours; free times and offering one only as a time to finish booking; refusing a time that is not free; asking for contact details before preparing a message; refusing health questions; offering no messages when the studio turned them off; and reading dates and times as guests write them, including dates that do not exist.

`server/receptionist.test.ts` covers: the chat is off until an owner or manager turns it on; an offered time comes back only to the visitor it was offered to, once; one chat counts once against the monthly allowance however many messages it takes; a message reaches the inbox only when the guest sends it, with a local number kept with its country code; unknown fields are refused; and no messages are offered when the studio turned them off.

## Answering texts (stage 2)

Recorded 8 October 2026 in the same way with a studio of its own.

- **Settings:** a third box, "Also answer texts to your text line", is saved and kept after a reload. axe finds nothing on the panel.
- **A link with a time in it:** `/book/<studio>?service=…&staff=any&date=2026-10-15&start=600` opens "Find your moment." with 15 October and 10:00 chosen; "Hold this time" holds it and moves on to the guest's details. A link whose time is no longer free says that 23:00 "is no longer free. Choose another time." with the hold button off. A link naming a treatment the studio does not offer opens the first step as usual. axe finds nothing; no console errors.
- **Texts themselves** were exercised in automated tests only, because the text line needs a Twilio account, which is not set up.

`server/receptionistText.test.ts` covers: no answer until the studio also chooses texts; every answer starting "Linden Studio AI receptionist:"; one answer for a text the provider sends again, including one kept but not answered the first time; answers in the client conversation a number was matched to by hand; an answer queued in the outbox for the guest's number and the matched client, sent once and shown as accepted only when the provider accepted it; a free time offered as a booking link for that time, with the whole exchange counting as one chat and a new chat after an hour's quiet; a guest who asks for a person told the team will text back; no answer once someone from the studio has texted that guest in the last hour; and an answer not sent when texts are turned off before it goes out.

## Moving or cancelling a visit (stage 6)

Recorded 8 October 2026 in Chromium (Playwright) against the built app with a studio of its own, its WhatsApp number connected in test mode (`SALEANE_SOCIAL=test`) and the receptionist answering those messages.

- **WhatsApp from the number on a booking:** Rosa Field, booked for a Restorative facial with Maya Lind on Sunday 11 October at 10:00, wrote "Can I move my appointment please?" from her number. The Inbox shows, in her conversation, "AI receptionist · WhatsApp · Test mode, not sent" with "Here is the private link for your Restorative facial with Maya Lind, Sunday 11 October at 10:00: [private link to manage the visit] You can move or cancel it there. Please keep it to yourself." The link itself is not shown or stored; the outbox makes it only as the answer goes. axe finds nothing; no console errors.
- **The booking page chat on a phone:** "I need to cancel my booking" is answered "I cannot change a visit in this chat. Please use the link in your booking confirmation, or ask me to pass a message to the team." axe finds nothing.

Screenshot: [the answer in the Inbox](V4-RECEPTIONIST-change.png).

`server/receptionistText.test.ts` also covers: a text from another number is told to use the confirmation link and is not told whether a visit exists; a text from the number on the booking gets that visit's link, kept as a placeholder in the outbox and made only as it goes; the link sent opens that visit on the guest's page and appears nowhere in the outbox; with two visits coming, the receptionist lists them, and "2" sends the second; and nothing is sent once the number on the client's record has changed. `src/assistant/receptionist.test.ts` covers: the booking page chat changes no visit, and a known guest is offered only their own coming visit.

## Limits

- Test mode only. The answers come from a rule-based stand-in that reads the studio's own records; no AI supplier is connected, so it understands simple questions only.
- Web chat and texts only. Texts need the studio's text line (Twilio) connected, which no studio has yet. Voice calls, Book with Google, an Instagram book button and Instagram, WhatsApp and Facebook messages are later V4 stages. Voice waits for an OpenAI key.
- It never moves or cancels a visit itself. It sends a guest the private link to their own visit, and only to the phone number on that booking, by text or WhatsApp; the guest moves or cancels it there. Instagram, Facebook and the booking page chat cannot prove who is writing, so they get no link.
- By text it steps back for an hour once someone from the studio has texted the guest, and an answer that could not go out within 15 minutes is not sent at all.
- Each chat counts towards the studio's 200 guest chats a month. When the allowance is used up, the guest is told the chat is resting and can still book on the page.
- Offers are kept in the server's memory for 30 minutes and are lost if the server restarts; the guest just asks again.

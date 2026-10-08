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

## Limits

- Test mode only. The answers come from a rule-based stand-in that reads the studio's own records; no AI supplier is connected, so it understands simple questions only.
- Web chat and texts only. Texts need the studio's text line (Twilio) connected, which no studio has yet. Voice calls, Book with Google, an Instagram book button and Instagram, WhatsApp and Facebook messages are later V4 stages. Voice waits for an OpenAI key.
- It does not move or cancel visits yet; the guest's private link does that.
- By text it steps back for an hour once someone from the studio has texted the guest, and an answer that could not go out within 15 minutes is not sent at all.
- Each chat counts towards the studio's 200 guest chats a month. When the allowance is used up, the guest is told the chat is resting and can still book on the page.
- Offers are kept in the server's memory for 30 minutes and are lost if the server restarts; the guest just asks again.

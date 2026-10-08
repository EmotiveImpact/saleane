# V4 · AI receptionist on the booking page: evidence

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

## Limits

- Test mode only. The answers come from a rule-based stand-in that reads the studio's own records; no AI supplier is connected, so it understands simple questions only.
- Web chat only. Texts, voice calls, Book with Google, an Instagram book button and Instagram, WhatsApp and Facebook messages are later V4 stages. Voice waits for an OpenAI key.
- It does not move or cancel visits yet; the guest's private link does that.
- Each chat counts towards the studio's 200 guest chats a month. When the allowance is used up, the guest is told the chat is resting and can still book on the page.
- Offers are kept in the server's memory for 30 minutes and are lost if the server restarts; the guest just asks again.

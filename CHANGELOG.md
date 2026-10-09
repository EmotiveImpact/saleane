# Changelog

Released entries describe observed implementation. An explicitly in-progress entry records work awaiting verification, not a shipped capability. Product versions are separate from stored-state schema versions.

## 2026-10-09 · Moving in, stage 1: clients from any system

**Status: built locally on 9 October 2026, awaiting the owner's "merge"; nothing deployed.** [Evidence](docs/evidence/MOVING-01.md).

The owner said yes to the five moving-in answers. Stage 1 brings the client list across from Fresha, Phorest, Timely, Treatwell, Booksy and any other system.

- Clients, Import clients, and Settings, Switching over, Clients, open "Move your clients in", four short steps with one job each: the old system (large tiles, the UK five first), its files (download help for that system, then as many CSV or Excel files as they come), a check (any question first, then who is ready, already here or needing a look), and bringing them across (what will happen in plain sentences, one tick, one button). Back and Continue stay at the bottom of the window, Continue waits until a step is complete, each step starts at the top with its heading read out, and going back asks for the tick again.
- SALEANE recognises the system and report from the columns, skips title and totals rows, reads Excel dates, and matches columns by meaning, checking each against what is inside. Only an unsure column becomes a question, with examples.
- Clients come across with notes, birthdays (month and day), postcode area, other phone numbers and international mobiles. The same person in several rows or files is combined; anyone already in SALEANE is left exactly as they are.
- Email marketing comes across only when the old file records that the client agreed. The consent record keeps the old system's own words as evidence with source "previous system", and the client page and privacy file show it. Anything else starts off.
- A moved-in client may have a phone number and no email. Guest booking and new clients at the desk still need an email.
- Long lists are saved in parts the server accepts; a dropped connection keeps the files and says how many came across.
- Visit, gift card, package and payment files are recognised and named, not saved; the screen says a later step brings them across. The older one-file client import is replaced by this screen.

## 2026-10-09 · Two-step sign-in (NEXT-04)

**Status: built locally on 9 October 2026; nothing deployed and no email sent.** [Evidence](docs/evidence/NEXT-04-TWO-STEP.md).

- Settings, Team, Who can sign in has "Two-step sign-in". Scan the QR code with any authenticator app (or type the key), enter the code it shows, and save ten recovery codes, which are shown once. Turning it on signs out everywhere else.
- Signing in then asks for the six-digit code after the password, or a recovery code for a lost phone. Nobody is signed in until the code is right; five wrong codes or five minutes means starting again, and a code never works twice.
- A password reset from the email still asks for the code before signing in, so an inbox alone is not enough.
- Turning it off or making new recovery codes needs the password. A password reset or change ends any sign-in still waiting for its code, and restoring a backup retires its recovery codes, since one may have been used since. Each change, and each recovery code used, is emailed to the account (recorded as not sent while email is in test mode).
- The owner sees who has it on beside each person in Who can sign in, and nothing about their keys or codes.
- Practitioners and regional managers have no Settings page, so they cannot turn it on yet, and a studio cannot yet require it.
- Migration 24 adds the key, the recovery codes, the sign-in step and the set-up in progress, and lets account emails carry sign-in notices. QR codes are drawn in the browser with `qrcode-generator`.

## 2026-10-09 · Forgotten password and email confirmation (NEXT-03)

**Status: built locally on 9 October 2026; nothing deployed and no email sent.** [Evidence](docs/evidence/NEXT-03-ACCOUNT-LINKS.md).

- The sign-in page has "Forgotten your password?". It gives the same answer whether or not the address has an account. The link works once, for an hour; choosing a new password signs out every other device and signs in here.
- A new account gets a link to confirm its email, and works fully in the meantime. Until it is confirmed, the studios page asks for it and can send a fresh link. Earlier links keep working until one is used, as emails can arrive out of order.
- Email is still in test mode, so the page says plainly that nothing was sent and the link is written in the server log. The link is written there only when SALEANE runs for this computer alone; on any other address it is never written, and the page says nothing was sent. Each account email is recorded with what really happened (`test`, `accepted`, `failed` or `unknown`), never as sent when it was not. The record is made before the page answers, as not known yet, so a server stopped mid-send still has it.
- The link's code sits after a `#` in the address, so it never reaches a server log. No inbox gets more than five links of one kind in an hour, the answer comes back before the email is sent (so its timing gives nothing away), and two requests with the same link cannot both use it.
- Restoring a backup retires every open link, so a link from before the restore never works after it.
- Migration 23 adds the link and email records and the account's confirmed date.
- The roadmap records the owner's yes to the price (£49 / $59 a month for each location, with the AI allowance and add-ons) and to the five moving-in answers.

## 2026-10-09 · Whole app review and fixes

**Status: built locally on 9 October 2026 and merged (#72); nothing deployed.** [Evidence](docs/evidence/APP-REVIEW-2026-10-09.md).

A fresh review of the whole app listed 48 things to fix or improve, and the owner said yes to all of them, including that a regional manager's own requests go to the owner and that only owners and managers remove a saved card. Messages, card payments, AI and maps stay in test mode: nothing is sent or charged.

Things that were broken:

- Moving a visit to someone working at another location now works from the desk and from an approved Ask SALEANE plan (1).
- Guests and the desk can type a local mobile number ("07700 900456", "(212) 555-0142") or one with a country code. It is kept as an international number, nonsense gets a plain message, and a typo never costs the held time (2).
- A real studio's booking page shows each treatment's deposit and the cancellation rule before booking, and offers to pay the deposit on the confirmation (3).
- The confirmation offers "View my visit", "Add to calendar" and "Copy link", and repeats the full summary with the address and "Before you arrive". A wrong address shows "This booking page isn't available" (4).
- Opening SALEANE in a new tab takes someone signed in to their own studio (the last one used, or their only one), a practitioner to their day and a regional manager to their area. Someone signed out still sees the fictional demo (5).
- No day before the studio's today can be chosen or suggested on the booking page (6).
- The studio and each location can have a phone number and email for guests. The booking page, the confirmation and the guest's visit page show them, with directions (7).
- A general manager of a closed location is refused on every route, not only the studio read (8).
- Messages from the booking page chat are never matched to a client by what the visitor typed; they wait in the Inbox for the team (9).
- Restoring a backup no longer brings back access keys, connections, social accounts or unsent messages; each waits for the owner or the team (10).
- A regional manager is greeted by their own first name, not the region's (11).
- A mistyped, cut-off or replaced guest link says "This link has expired or been replaced. Ask the studio for a new one." (12).
- The front desk can open Money, Stock, Rota and Gift cards, and Business opens on Money for them (13).
- The team access panel has room to breathe and labelled password fields (14).
- The Business tabs stay on one row that scrolls on a phone (15).

Rough edges:

- The AI receptionist and Book with Google quote each location's own price, "From £95" where prices differ, and only what is offered there. The receptionist names the deposit the booking page asks for (16).
- A time the receptionist offers opens the booking steps at the location where it is (17).
- The receptionist answers opening hours, parts of the day, parking and directions, says plainly when it cannot answer, and each time it lists is a button (18).
- A newly added Instagram, Facebook or WhatsApp account waits until the owner confirms it is theirs, and once one studio has confirmed an account no other studio can add it (19).
- A regional manager's own requests go to the owner, and the Requests page says why (20).
- Only the owner and managers, or a general manager for a client of their location, can remove a saved card (21).
- Gift cards, packages and memberships record the location that sold them, with a "Sold at" choice when there are several, and count in that location's figures (22).
- Chair and room rent counts on the studio's own day, not the UTC day (23).
- Every date is chosen from SALEANE's own month calendar and written the studio's way ("Tue 6 Oct 2026"), on staff pages, the booking page and the guest's visit page. Times are 24-hour in the UK and 12-hour in the US (24).
- Internal words such as "Local V1 candidate", "release candidate", "sandbox", "workspace", "provenance" and "processor settlement evidence" are replaced with plain ones, and saving messages say plainly when someone else saved a change just now (25).
- Screens say SALEANE (including Ask SALEANE), visit and treatment. Accountant exports keep "Services", the word their software expects (26).
- The sample studio is busy and agrees with itself. Its clock stands at 10:45, so finished, current and coming visits match the time; about three hundred fictional regulars fill September and October; it closes on Sundays and each person has two days off a week; about three in five visits book the next one; feedback comes only from guests about their own visits; and Pay agrees with Business (27).
- A new studio opens Monday to Saturday, 09:00 to 18:00, with online booking off until the owner switches it on (28).
- Owners and managers of a studio still setting up see "Get your studio ready" on Today: opening hours, treatments, the team, rooms or chairs, VAT or sales tax, deposits and cancellation, the phone and email guests see, and online booking. Each step links to its place in Settings and ticks itself once set (29).
- The join page names the studio, the role and its location or region, fills in the invited email and explains an expired link. Practitioners and regional managers can sign out from their own pages (30).
- After a test card payment the guest is told plainly that it was a test and no money was taken, on the payment page, the booking page and their visit page (31).
- The price page marks text reminders, saved cards and card readers as arriving once a card or text account is connected, and its logo stays on the price page (32).

Polish:

- Today's right-hand column holds a compact "Needs you" stack and "Your team today". What SALEANE noticed and one special, with "See all", sit side by side under the day ahead, so Today on the sample studio is less than half as long as it was (33).
- Every staff page has the same header (34), and headline figures share one style in whole pounds or dollars (35).
- Gift cards look like real cards, and regional wording stays hidden until a studio has regions (36).
- Settings is grouped under five headings with one way of saving (37).
- Small layout slips are fixed across staff pages (38), and every control is at least 40px to tap on a phone (39).

Bigger improvements:

- Guests can move their own visit from their private link: the same treatment and location, with the same professional or anyone qualified, up to 24 hours before, comparing the old and new time before confirming. The page offers "Book again" after a cancellation and wears the studio's colours and photograph (40).
- One booking summary runs through every step of the booking page and becomes the receipt (41).
- A day strip shows each day as "Closed", "Full" or how many times are free, with "First available", times grouped into morning, afternoon and evening, and "Hold it again" when a hold runs out (42).
- The visit panel covers a visit in every state: the treatment photo, what to remember, their last visit and the next actions. "Message" opens an unsent draft in the Inbox (43).
- Stock, the visit panel and staff page headers carry photographs, and stock rows show the count with a level bar and "Running low" in words (44).
- Each Inbox conversation ends in a reply box with saved replies and a choice of email or text. Replies wait as drafts for approval (45).
- The calendar week is one timeline with visits at the same time side by side, the month on a phone shows how many visits each day has, and Ask SALEANE offers a follow-up question for each thing it mentions.

Behind the scenes:

- Pages load when they are first opened, so the app's main script is half its old size (845 kB to 414 kB) and a first visit downloads about a quarter less. The small client portraits went from a 2.3 MB picture to a 31 kB one (46).
- The project notes for future helpers say what is merged, how merging works and the new rules (47).
- Each change inside a combined change is checked on its own, outgoing connections treat NAT64 addresses as private, and three unused bits of code are gone (48).

## 2026-10-09 · Roadmap · What's left before release

**Status: documentation only; nothing built or deployed.**

- The roadmap now lists everything left before release, grouped by what each item waits on: the owner's word, outside accounts or live sources, things still to build (NEXT-01 to NEXT-12 in the build queue), and the steps to release 1.0.
- V3's row records what is built locally, a V5.5 row holds the ideas agreed to come after real studios, and hosting is shown as parked and undecided.

## 2026-10-09 · V1.5 · Passing an unanswered waitlist offer on

**Status: built locally on 9 October 2026 and merged (#71); nothing deployed.** [Evidence](docs/evidence/V15-WAITLIST.md#passing-an-unanswered-offer-on).

- The Waitlist page has a "Not answered yet" panel. It lists offers approved at least 2 hours ago with no reply from the client since, where the time is still free and someone else waiting could take it.
- "Offer it to" the next person (the longest waiting whose request suits that time) writes a new offer that waits in the Inbox for approval, like any other. Nothing is sent by itself, and the first offer is not withdrawn: the first to answer gets the time.
- A time already passed on, booked, or no longer free leaves the panel. Approving a message is not the same as sending it; with no provider connected, approved offers still wait unsent.

## 2026-10-09 · V5 · Automatic checks

**Status: built locally on 9 October 2026 and merged (#70); nothing deployed.** [Evidence](docs/evidence/V5-CHECKS.md).

- The whole business view has a "Needs a look" list, filled by checks that run by themselves across every location: a location's week down by 20% or more, a month-end estimate 10% or more short of its target (from the 7th), a branch visit due after 30 days (once there is a checklist), and a request waiting 3 days or more.
- The owner turns each check on or off and sets its number under "Automatic checks". Regional managers see the same list for their own locations, and their morning summary uses the owner's number of days for branch visits.
- The checks change nothing and contact no one.

## 2026-10-09 · V5 · Partner access

**Status: built locally on 9 October 2026 and merged (#69); nothing deployed.** [Evidence](docs/evidence/V5-PARTNERS.md).

- An access key can now be kept to one location, for a partner that works with one branch. It reads only that location's visits, plus the treatments and team, and stops if the location closes.
- A key can stop working after a chosen day, up to a year ahead.
- A new "Takings by day" permission lets an accountant's software read the same daily lines as the accountant's export, with no names or receipts.
- Still read only. No real partner has been connected.

## 2026-10-09 · V5 · Branch map

**Status: built locally on 9 October 2026 and merged (#68); nothing deployed.** [Evidence](docs/evidence/V5-BRANCH-MAP.md).

- The whole business view has a map of every location. Each pin is sized by what it took over the last 28 days and coloured by whether that is up, level or down on the 28 days before, with the best and the one that needs a look named.
- A regional manager sees the same map with only their own region's locations.
- Places come from a map service, which is not connected, so only sample studios show the map. A real studio sees a short note and the same figures in the list, and a location the map cannot place is named under it.

## 2026-10-09 · V5 · How you compare

**Status: built locally on 9 October 2026 and merged (#67); nothing deployed.** [Evidence](docs/evidence/V5-COMPARE.md).

- Business has a new "How you compare" page for owners and managers. The owner chooses to share anonymously; only a studio that shares can compare.
- Four figures are compared with similar studios in the same market over the last 90 days: the average treatment sale, visits rebooked before leaving, clients who came more than once, and missed appointments. Each shows where most studios sit, the middle studio, and whether this studio is ahead of most, typical or behind.
- Nothing is shown until at least ten other owners share (one owner's studios count once, and never in their own comparison), other studios' figures are only shown as rounded ranges, no other studio's name is ever shown, sample studios are only compared with samples, and stopping sharing takes the studio out of every comparison at once.

## 2026-10-09 · V5 · Month-end estimate and the week in brief

**Status: built locally on 9 October 2026 and merged (#66); nothing deployed.** [Evidence](docs/evidence/V5-GROUP.md#month-end-estimate-and-the-week-in-brief-9-october-2026).

- The whole business view now estimates where the month could end: what is already taken, plus the larger of what is booked and the recent daily pace over the days left. It says it is an estimate, not money taken, and whether the business is on course for its target when every location has one. Each location, and each location on a regional manager's page, shows its own estimate.
- "The week in brief" sums up the last seven days against the seven before: takings from completed visits, how many visits, how many clients came for the first time, and the location with the best week when one is clearly ahead.

## 2026-10-09 · V5 · Several brands, one owner

**Status: built locally on 9 October 2026 and merged (#65); nothing deployed.** [Evidence](docs/evidence/V5-BRANDS.md).

- When someone owns two or more studios, "Your studios" now has "Your brands together" underneath: each brand's last 28 days, the change on the 28 before, how many visits were rebooked, this month's takings and what is booked but not yet taken, and how many clients it has, with an Open button.
- A few plain lines add the brands up. Pounds and dollars are never added together, and sample studios are never added to real ones. The brand clearly ahead is named, and a brand is said to need a look only when its takings fell. Sample studios are only ranked when there is no real brand, because they run on a fixed demonstration day.
- Each brand keeps its own clients, team and money. The overview shows totals only, and studios where the person is a manager or on the desk are left out.

## 2026-10-09 · V5 · The client map

**Status: built locally on 9 October 2026 and merged (#64); nothing deployed.** [Evidence](docs/evidence/V5-MAP.md).

- Client areas now has a map above the list. Each named area is a circle sized by clients or by treatment sales, with every location pinned and rings at one and three miles.
- Choosing a circle or an area in the list shows its clients, visits, sales and the change on the period before. With nothing chosen, a short summary says where most clients come from, which area is growing fastest and how many come from within a mile.
- The page can count the past year or the past 90 days.
- Only areas with three or more clients appear, and no one is ever placed on the map. A real studio's map appears once a map service is connected; until then the list shows every area, and sample studios show a sample map without streets.

## 2026-10-09 · V5 · Shared brand rules

**Status: built locally on 9 October 2026 and merged (#63); nothing deployed.** [Evidence](docs/evidence/V5-BRAND.md).

- The studio's colours are now kept with the studio, not in one browser, so every location, every device and the guest booking page show the same colours. Owners and managers choose them as before.
- Settings, Locations has "House rules for every location", set by the owner: how far a location's price may differ from the house price (any, the same everywhere, or within 5% to 25%), and core treatments that stay on every location's menu.
- A treatment saved against the rules is refused with the reason, and its form says what the rules ask. Treatments already out of line are listed under "Not yet in line" and are never changed automatically.

## 2026-10-08 · V5 · Where clients come from

**Status: built locally on 8 October 2026 and merged (#62); nothing deployed.** [Evidence](docs/evidence/V5-AREAS.md).

- A client's page has a Postcode area panel (ZIP area in the US). The desk, managers and the owner record the first half of a postcode, such as N1, or the first three digits of a ZIP code. A full postcode typed in is cut to its first half before it is saved, and the client's timeline notes the change. Practitioners cannot record it.
- Business has a Client areas tab for owners, managers and general managers: clients with a visit in the past year or one booked, grouped by area, with each area's share, and filtered by location when there is more than one. A general manager sees their own location's.
- An area with fewer than three clients is counted under "Other areas", so no one person can be picked out, and clients with no area are counted as such. Nobody is shown on a map; a drawn map would need an outside map service, which is not connected.
- The postcode area is included when a client asks for a copy of their record.

## 2026-10-08 · V5 · General managers who run one location

**Status: built locally on 8 October 2026 and merged (#61); nothing deployed.** [Evidence](docs/evidence/V5-GENERAL.md).

- Once a studio has more than one location, the owner can invite a general manager for one of them, or change someone's access to it, under Settings, Team.
- A general manager works as a manager at their location: its diary, check-ins and takings, card payments and refunds, stock and orders, branch visits and requests for a sign-off, and the clients they look after. The calendar, Business and Stock open on their location, and the sidebar names it.
- They change nothing at other locations and nothing that affects the whole business, such as treatments, prices, the team, hours, settings, checklists or the regional limit, and they do not see the team's pay rates or other locations' branch visits and requests.
- If their location closes they see nothing until the owner updates their access. Stored access needs a database step (migration 21) that keeps every existing member and invitation.

## 2026-10-08 · V5 · Requests that pass up to the right person

**Status: built locally on 8 October 2026 and merged (#60); nothing deployed.** [Evidence](docs/evidence/V5-APPROVALS.md).

- Business has a Requests tab for owners and managers. Anyone there can ask for a sign-off at a location: spending (with the cost) or something else, with a reason.
- A request goes to the regional manager of the location's region. It passes up to the owner when it costs more than a regional manager may approve, when the location is in no region, or when the region has no regional manager, and the request says which.
- The owner sets the regional limit (£500 or $500 to start) and can decide any request. Managers raise requests but do not decide them.
- A regional manager raises and decides requests at their own locations from their own page, and their morning summary says how many are waiting for them. Requests already over their limit show who they are waiting on, without a button.
- A decision is final and kept with who made it, when and any word back. The desk and practitioners do not receive requests. Approving a request records the decision only; no money moves.

## 2026-10-08 · V5 · Regional managers who see only their own region

**Status: built locally on 8 October 2026 and merged (#59); nothing deployed.** [Evidence](docs/evidence/V5-REGIONAL.md).

- The owner can invite a regional manager for one region, or change someone's access to it, under Settings, Team.
- A regional manager opens their own page: a greeting, their region's figures by location, how many visits each has booked today, a short morning summary (what is waiting to be put right and which locations are due a branch visit), and their region's branch visits.
- They can record a branch visit and mark a line put right, at their own locations only. They never receive clients, diaries, staff, prices, payments, settings or other locations, and every other part of SALEANE refuses them.
- If their region is removed or emptied they see nothing until the owner updates their access. Stored access needs a database step (migration 20) that keeps every existing member and invitation.

## 2026-10-08 · V5 · Branch visit checklists

**Status: built locally on 8 October 2026 and merged (#58); nothing deployed.** [Evidence](docs/evidence/V5-BRANCH-VISITS.md).

- Business has a Branch visits tab for owners and managers. A visit is recorded on a phone against a checklist: each line is answered yes, no or not checked, with a note.
- Every line answered no stays on "To put right" until someone marks it done, with who and when.
- Each location shows when it was last visited and how it went, and past visits are kept exactly as they were answered, even after a checklist changes. The whole-business view shows each location's last visit.
- Checklists are kept and can be put away, never deleted. Sample studios start with one checklist and one visit. The desk and practitioners do not receive any of it.

## 2026-10-08 · V5 · The whole business at a glance

**Status: built locally on 8 October 2026 and merged (#57); nothing deployed.** [Evidence](docs/evidence/V5-GROUP.md).

- With more than one location, Business opens with "The whole business": every location's completed takings over the last 28 days against the 28 before, the change, rebooking, and this month against its target, with what is booked but not yet taken shown apart.
- A short summary in plain words names the totals, the location doing best and the one that needs a look, and the month so far.
- The owner can group locations into regions, each location in one region, and set each location a monthly target. Regions show their own totals.

## 2026-10-08 · V4 · The AI receptionist helps a guest move or cancel

**Status: built locally on 8 October 2026 and merged (#56); nothing deployed, no AI supplier or text line connected and nothing sent.** [Evidence](docs/evidence/V4-RECEPTIONIST.md#moving-or-cancelling-a-visit-stage-6).

- A guest who texts or sends a WhatsApp message from the phone number on their booking, asking to move or cancel, is sent the private link to that visit. They move or cancel it there under the studio's usual rules. With more than one visit coming, the receptionist lists them and asks which.
- The link goes only back to that same number. Someone writing from another number, on Instagram or Facebook, or in the booking page chat, is told to use the link in their booking confirmation or text from the number on the booking, and is never told whether a visit exists.
- The link is made only as the answer goes out and is never stored. If the number on the client's record changes, or the visit is cancelled or has started, before it goes, nothing is sent.

## 2026-10-08 · V4 · AI receptionist on Instagram, Facebook and WhatsApp

**Status: built locally on 8 October 2026 and merged (#55); nothing deployed, no AI supplier connected, SALEANE is not approved by Meta yet and nothing is sent.** [Evidence](docs/evidence/V4-SOCIAL.md#the-ai-receptionist-on-these-apps).

- The AI receptionist can also answer messages to the studio's Instagram, Facebook and WhatsApp, when the studio ticks "Also answer messages to your Instagram, Facebook and WhatsApp". It is off unless chosen.
- It answers in the same app, from the account the guest wrote to, and every answer starts with the studio's name and "AI receptionist". A free time is offered as a link to the booking page with that time chosen; the guest still confirms it there.
- It steps back for an hour once someone from the team answers that guest, and a guest who asks for a person is told the team will reply there. On texts it now says the same.

## 2026-10-08 · V4 · Instagram, Facebook and WhatsApp messages in the Inbox

**Status: built locally on 8 October 2026 and merged (#54); nothing deployed, SALEANE is not approved by Meta yet and nothing is sent to Instagram, Facebook or WhatsApp.** [Evidence](docs/evidence/V4-SOCIAL.md).

- The owner can connect the studio's Instagram account, Facebook Page and WhatsApp Business number in Settings › Studio details. Each account can belong to one studio only, and a sample studio never connects.
- Guests' messages to those accounts arrive in the Inbox beside their emails and texts. A WhatsApp number is matched to its client, with the name WhatsApp gives. Instagram and Facebook give only an id, so the team matches those by hand, and the conversation then moves to the client.
- The team answers in the conversation, on the app the guest wrote on. The apps allow answers only within a day of the guest's last message, so the box says how long is left and closes after that. Health words are refused.
- Answers go through the outbox once. In test mode they are recorded as they would go and marked "Test mode, not sent". An answer goes only from the account the guest wrote to, and is not sent if that account was disconnected or changed, or the day ended, before it could go.
- Only messages signed with SALEANE's Meta app secret are read, and the same message sent twice is kept once.
- Clients' answers are included in their privacy export and their deletion review.

## 2026-10-08 · V4 · Book with Google

**Status: built locally on 8 October 2026 and merged (#53); nothing deployed, SALEANE is not a Google partner yet and nothing is sent to Google.** [Evidence](docs/evidence/V4-GOOGLE.md).

- The owner can tick "Offer my studio for booking on Google" in Settings › Studio details. It is off unless chosen, and a sample studio is never offered.
- SALEANE can now answer Google's booking calls: check a time, book it, look it up, list a guest's visits and cancel. A Google booking takes the same path as the studio's own booking page, so it lands in the diary with the usual confirmation and a "Google" source.
- Test mode answers only on this computer, so it can never book into a real studio's diary. The same time is never booked twice, even when Google sends a request again. A guest can cancel on Google until the visit starts, the same as with their own booking link.
- Treatments that need a deposit are not offered on Google, because Google takes no payment here; they stay on the studio's own booking page.
- The owner sees how many treatments and free times Google would show and how many visits came through Google. The Instagram book button is the studio's existing Instagram booking link.
- A tick box among other settings now sits beside its words instead of above them.

## 2026-10-08 · V4 · AI receptionist answers texts

**Status: built locally on 8 October 2026 and merged (#52); nothing deployed, no AI supplier or text line connected and no text sent.** [Evidence](docs/evidence/V4-RECEPTIONIST.md#answering-texts-stage-2).

- The AI receptionist can also answer texts to the studio's text line, when the studio ticks "Also answer texts to your text line". It is off unless chosen.
- Each answer starts with the studio's name and "AI receptionist", so a guest always knows it is an AI. Answers go out through the same outbox as reminders, once, and show in the guest's Inbox conversation with what became of them. Nothing is called sent until the text provider accepts it.
- A free time is offered as a link that opens the booking page with that time already chosen. The guest still holds and confirms it. If the time has gone, the page says so.
- A guest who asks for a person is told the team will text back; their message is already in the Inbox. The receptionist steps back for an hour once someone from the studio has texted that guest.
- A text conversation counts as one chat while messages are less than an hour apart.

## 2026-10-08 · V4 · AI receptionist on the booking page

**Status: built locally on 8 October 2026 and merged (#51); nothing deployed, no AI supplier connected and nothing sent outside the computer.** [Evidence](docs/evidence/V4-RECEPTIONIST.md).

- A studio can show an AI receptionist on its booking page (Settings › Colours & booking page, owners and managers). It is off until turned on.
- Guests tap "Ask a question" and can ask about treatments, prices, opening hours and free times. The chat always says it is an AI, never asks about health and never shares anything about other guests.
- It can offer a free time. Tapping "Choose this time" fills in the booking steps, and the guest holds and confirms the visit as usual. It never books, moves, cancels or takes a payment by itself.
- When it cannot help, it can prepare a message for the team with the guest's name and an email or phone number. The message reaches the Inbox only when the guest taps "Send to the team". The studio can turn this off.
- One chat counts once towards the studio's 200 guest chats a month. It runs in test mode with a simple stand-in, so it costs nothing and understands simple questions only.

## 2026-10-08 · V5 · Access keys for other software

**Status: built locally on 8 October 2026 and merged (#50); nothing deployed.** [Evidence](docs/evidence/V5-ACCESS.md). [Guide](docs/CONNECTIONS.md#reading-from-saleane).

- Settings › Connected software has a new Access keys panel for the owner. A key lets other software (an accountant's tool, the studio's own reports) read visits, clients or treatments and the team, whichever the owner ticks.
- A key can never change anything. It is shown once, kept only as a hash, shows when it was last used, and stops working the moment it is revoked.
- Sample studios cannot make keys.

## 2026-10-08 · V5 · Connected software

**Status: built locally on 8 October 2026 and merged (#49); nothing deployed and nothing sent outside the computer.** [Evidence](docs/evidence/V5-CONNECTIONS.md). [Guide for the receiving end](docs/CONNECTIONS.md).

- Settings has a new Connected software section for the owner. It tells other software (a Zapier hook, the studio's own system) when a visit is booked, moved, cancelled, checked out or missed, or a new client is added. The owner chooses the events for each connection.
- Guest names, email and phone go only to a connection the owner chose to share them with.
- Each event is signed with a secret shown once. Busy or silent receivers are tried again up to five times; a refusal is not. "What was sent" lists every delivery and what became of it.
- One connection can be turned off, or all of them at once. Anything still waiting is then not sent. A removed connection keeps its log.
- Test mode is the default: events are signed and logged as they would be sent, and nothing leaves the computer. Sample studios cannot connect software.

## 2026-10-08 · V1.5 · The inbox

**Status: built locally on 8 October 2026 and merged (#48); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-INBOX.md).

- The Inbox now shows one conversation per guest: what the studio wrote, what went out on its own (confirmations, reminders and the rest) and what the guest wrote back. Filters show new replies and drafts to approve.
- Guests' replies to the studio's text line or email address arrive in the right conversation once those lines are connected. A reply from an address or number nobody has can be matched to a client. The desk can note a reply given by phone or in person. Opening a conversation marks its replies read, with who read them.
- A message can be written for email or text, started from a saved reply, and approved in the same step. In a studio of its own, an approved message goes out once through the same outbox as reminders, and the conversation shows what became of it. In test mode nothing is sent and it says so. Sample studios never send. Messages approved before this change stay queued and unsent.
- Settings › Messages has saved replies, looked after by owners and managers.
- Guests' replies are in their data export, text export and erasure review. Messages approved for sending are kept when erasure is reviewed, because they may have gone out.

## 2026-10-07 · V2 · Several locations

**Status: built locally on 7 October 2026 and merged (#39); nothing deployed.**

- Settings has a new Locations section. The owner adds further locations with a name, address, an optional "before you arrive" note and, if different, their own opening hours. A location can be closed for good; its history stays.
- Each room or chair belongs to one location, and each person works at one location on a given day, set on their weekly hours under Team.
- When a studio has more than one location, guests choose where they would like to come first, on both the live booking page and the demo one. Only places where someone does the chosen treatment are offered, and only the people who work there that day are shown. Reminders, the guest's own visit page, the day sheet and the practitioner's day name the visit's location and address.
- The calendar has an "All locations" filter, booking from the desk or through Ask Saleane only offers times at the place the person is working that day, and Today shows where each person is.
- Changing hours, rooms or someone's location is checked against booked visits first: a visit that would end up at a closed location, in a room at another location, or with someone working elsewhere is listed and the change is refused.
- A visit can move to another location. It keeps its booked price, and the timeline says where it moved from and to.
- Stock is kept per location. Stock can be filtered by location, stock can be moved between locations, and deliveries, counts, walk-in sales and supplier orders each say where. Products sold with a visit come off that location's shelf, and the ledger checks every move balances.
- A treatment can cost more or less at another location, or be left off a location's menu. Guests see the price where they are coming, and a list where prices differ says "From".
- Business figures, including time booked, can be filtered by location.
- Each location has its own booking link that opens with it chosen.
- A waitlist request can be for one location, and the schedule history records rooms and people moving between locations.
- A booking link the AI receptionist texts a guest opens at the location where the professional works that day.
- Texts name the location, imported visits go to the location where the professional works that day, and the calendar showing every location spans all their opening hours.
- A studio with one location works exactly as before.

## 2026-10-07 · V1.5 · Consultations

**Status: built locally on 7 October 2026 and merged (#47); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-CONSULT.md).

- A client's page has a new Consultations panel. The desk notes the date, who held it, the treatments talked about, what the guest would like, what was agreed and any price given. Health details are refused, as they are for guest forms.
- Each update is kept as a new version, with who saved it. Earlier versions stay readable.
- "Book from this" opens the booking window for that guest and treatment. The visit keeps the version agreed, and its window shows the plan, what they wanted and the price given, with a note if the consultation has changed since.
- The practitioner's own day shows what was agreed for their visit. The client's data export, text export and erasure review include every version.

## 2026-10-07 · V1.5 · Versioned consent for email news

**Status: built locally on 7 October 2026 and merged (#46); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-CONSENT.md).

- Settings › Messages to guests has a new panel for the studio's own words asking about email news. Each change is kept as a numbered version; SALEANE's standard words are version 1.
- The booking page shows the studio's current words beside the optional box. Every time a guest's email permission is given or stopped (booking online, at the desk, editing the client, or from the guest's own link) SALEANE keeps a record of the words agreed to, where, when and who.
- Guests can stop email news from their private visit link. Any email news already queued for them is held back. Visit updates carry on.
- A client's page lists their history under Communication preference, and their data export includes each record with the words.
- On a phone, the "come in sooner" boxes on the guest's page now sit beside their labels instead of above them.

## 2026-10-07 · V1.5 · Guest forms before a visit

**Status: built locally on 7 October 2026 and merged (#45); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-FORMS.md).

- Settings has a new Guest forms section. Owners and managers set up short forms for some or all services, asked before every visit or once per guest: short or longer answers, yes or no, pick one, and something to agree to by typing a name. The sample studio has one for haircuts.
- Forms are for everyday questions. A form that asks about health (allergies, pregnancy, medication, medical conditions and similar) is refused; those wait for the separate clinical part of SALEANE.
- Guests fill them in from their private visit link. Confirmations and reminders mention a form that is still waiting. Answers show on the visit for the desk and on the practitioner's own day (without the typed name), and on the client's timeline, data export and erasure review.
- Changing a form's wording makes a new version. Every answer keeps the version it was given against, and answers cannot be changed or replaced once sent.

## 2026-10-07 · V1.5 · Booking from a missed call

**Status: built locally on 7 October 2026 and merged (#43); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-CALLBOOK.md).

- Each call on Today's Missed calls list has a Book button. It opens the booking window for that caller: a client matched by their number is already chosen, and anyone else can be found by number or added as a new client while booking, with their number filled in.
- Booking takes the call off the list, counts as calling back, links the call to the visit and notes it on the visit's timeline. The client's data export shows which visit a call led to. The panel says how many calls this week became a booked visit.

## 2026-10-07 · V1.5 · Neutral review requests and room resting time

**Status: built locally on 7 October 2026 and merged (#42); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-REVIEWS.md).

- A studio can add its public review page (Settings › Studio details). After a completed visit, every guest's private page invites them, in the same words, to leave a public review, and the feedback email gains one line with the link. It never asks for a good review and is never held back because of a private rating. Only https addresses are accepted.
- A room or chair can rest for 10 to 120 minutes after each visit (Settings › Spaces & equipment), for airing, cooling or a deep clean. New bookings and moves leave it empty for that long before and after each visit and use another free room instead; the professional stays free. Visits already booked stay as they are.

## 2026-10-07 · V1.5 · Missed-call text-back and "I've arrived"

**Status: built locally on 7 October 2026 and merged (#41); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-ARRIVALS.md).

- Today has a Missed calls panel for the desk: calls nobody could answer, newest first, matched to a client by their number, with how many times they rang, a Call link and "Called back" to take them off the list. Reception can write a call down by typing the number as people say it (07700 900123 or +44 7700 900123). Practitioners do not see it.
- If the studio switches it on (Settings › Messages to guests, off by default), a missed caller gets one text within 15 minutes: sorry we missed you, we will call back, and the booking link. At most one a day per number, never after someone has called back, and never to a client who asked for no texts. With no provider configured it stays in test mode.
- A studio whose phone line runs through Twilio can point its call-ended callback at SALEANE, so unanswered calls are written down on their own. Each callback is checked against Twilio's signature. This has not been tried with a real Twilio account.
- Calls matched to a client are in their data export and erasure review. Nothing on the list is removed automatically.
- On the day of a visit, from half an hour before, a guest's private link shows "I've arrived". Tapping it tells the desk: Today, the calendar, the visit and the practitioner's own day show "Says they're here" until the desk welcomes them. Moving the visit clears it. Today and the calendar look for changes like these every 30 seconds while they are on screen, so nobody needs to reload.

## 2026-10-07 · V1.5 · Birthday and "we miss you"

**Status: built locally on 7 October 2026 and merged (#40); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-BIRTHDAY.md).

- Each client page has a Birthday panel: month and day only, never the year. Recording or removing it goes on the client's timeline. Owners, managers and reception can change it; practitioners never see it.
- A guest who agreed to hear from the studio and shared their birthday gets one birthday email on the day, in the daytime on the studio's clock, with a gentle link to book (or none, if they already have a visit booked). 29 February birthdays get theirs on the 28th in other years.
- A guest who agreed gets one "we miss you" email once they have gone three months without a visit (the studio can choose two, three, four or six), and never while a due back email could still be on its way. It only goes in the month after the gap is reached, so switching it on does not email every long-lapsed guest at once. Anything booked stops it, including just before it goes.
- Both are email only, say why the guest is hearing and how to stop, treat records with the same email as one guest, and can each be turned off in Settings › Messages to guests. With no provider configured they stay in test mode.
- Birthdays are in the client's data export.

## 2026-10-07 · V1.5 · Due back and aftercare

**Status: built locally on 7 October 2026 and merged (#38); nothing deployed and no message sent.** [Evidence](docs/evidence/V15-DUEBACK.md).

- Each treatment can carry aftercare advice (Settings › Studio details, "Before and after a visit"). Half an hour after checkout the guest gets it by email, once, up to two days later. The sample facial and Gloss & Tone have some.
- A treatment can say when guests are usually back, in weeks (Settings › Services, "Usually back after"). Gloss & Tone in the sample studio is six weeks.
- A guest who agreed to hear from the studio gets one "time for your next visit?" email from three days before that date until two weeks after, in the daytime on the studio's clock, with a link to the booking page (or a request to get in touch when online booking is off). It does not go if they have anything booked, have had a later visit, or said no under any record with the same email. It is checked again just before it goes, so a booking made meanwhile stops it. The email says why they are getting it and how to stop.
- Both are email only, follow the studio's and the client's email choices, and can each be turned off in Settings › Messages to guests. With no provider configured they stay in test mode.
- The due back list on Today follows each treatment's own return time, with four weeks as before when none is set.

## 2026-10-07 · V3 · Smart insights, first pass

**Status: built locally on 7 October 2026 and merged (#32); nothing deployed, sent or changed automatically.** Every insight is worked out from the studio's own records by fixed rules that can be explained; no AI service is involved.

- Today's "Saleane noticed" panel now gives a short brief: visits and hours booked against a usual day of the same weekday over the last four weeks, and (for owners and managers) yesterday's takings against usual.
- It points out what looks unusual against the studio's own recent weeks: a quiet day tomorrow, more cancellations or missed visits than usual, takings down on the week (owners and managers only), a client with two missed visits who is booked today or tomorrow, and low stock (owners and managers only). A studio without enough history sees nothing rather than a false alarm.
- "Drifting away" lists clients who have gone longer than their own usual gap without booking (five weeks when there are too few visits to tell), longest overdue first, each with an open time today or tomorrow with their usual professional and treatment. Two clients are never offered the same person at overlapping times. The offer opens the usual booking dialog for the desk to confirm.
- Ask Saleane answers "give me my morning brief", "anything unusual?" and "who is drifting away?" from the same rules.
- Filling quiet gaps: next to each open-time offer, "Prepare an invitation" shows a short, friendly message naming the time. The owner reads it and chooses "Save as unsent draft" or "Not now"; a saved invitation waits in the Inbox for approval like any other draft, only for clients who allow marketing messages, and nothing is sent.
- Staff targets, first step: Business shows each professional's rebooking rate (completed visits where the next visit was booked at checkout) beside the studio's overall rate.
- Specials, the assistant manager (owners and managers): Today suggests specials from the time of year (Diwali, Christmas parties, Mother's Day, Eid, prom and wedding season and more), long bank-holiday weekends, school holidays, the weather and local events. Each shows its dates, the reason, how much open time there is for it and a starting idea. "Plan this special" only records it: nothing is sent and no prices change. Planned specials then show how their days compared with the same length of time before, and Ask Saleane answers "any specials we should run?", "plan the Diwali special" (for approval) and "did our specials work?". Every source is in test mode: the calendar and the GOV.UK bank holiday list are bundled copies, and school dates, weather and events are sample data behind adapters a live feed can replace.
- A manager's day in Ask Saleane: "who's my 10 o'clock?" answers with the guest, what to know before they arrive and who is next; "book Jamie with Maya for a facial on Thursday afternoon" lists open times, and with a time prepares the booking for approval (price and any deposit shown); "cancel Nina Patel" prepares the cancellation and says whether the studio's fee policy would allow a fee, which is never charged automatically; "Theo is off sick today" plans the whole day for one approval (each upcoming visit moved to someone free at the same time who does the treatment, guests nobody can see asked to pick a new day, a short note to every guest saved unsent, and the rest of Theo's day closed so nobody books him); "how did we do today?" closes the day with takings against a usual day, rebooking, who left without a next visit and a first look at tomorrow; "how was the week?" compares the last seven days with the four weeks before and explains the quietest day from the record. A one-approval plan is applied together or not at all, can only move, cancel, close time and save unsent drafts, and every change in it is checked against the person's role.
- Ask Saleane speaks first and remembers the conversation: opening it shows what it noticed (a waitlist client who could take a time free today or tomorrow, today's reminders, anything unusual), each with a one-tap follow-up, and the header button shows a small dot when there is something to mention. Short follow-ups such as "and tomorrow?" or "and after her?" are understood from the last few lines. "Anyone on the waitlist?" lists who is waiting with their first free time, and "offer Emily Wednesday at 9am" prepares the offer for approval, saved to the Inbox unsent. Reminders: "remind me on Friday to call the supplier" prepares one for approval, it appears in the morning brief and on Today that day, and the desk can add and tick off reminders on Today. Nothing is sent by any of these.

## 2026-10-07 · V1.5 · Patch tests

**Status: built locally on 7 October 2026 and merged (#36); nothing deployed and no message sent.** A salon record and a reminder, not a clinical record. [Evidence](docs/evidence/V15-PATCH.md).

- A treatment can be marked as needing a patch test, such as a colour (Settings › Services). The sample studio has a new Gloss & Tone colour service with three visits later in the week.
- Each client page has a Patch tests panel: what was tested, when, by whom, where it was placed and, once the skin is checked, clear or a reaction with what was seen. A test can be called clear only once the studio's waiting time has passed; a reaction can be recorded straight away. Tests are kept side by side and never deleted.
- Each colour visit shows where the guest stands: clear, result to record, test too close to the visit, test needed, or a reaction. Owners and managers set how many hours before the visit a test must be done (48 by default) and how long a clear one counts (6 months by default).
- A recorded reaction stops the guest being welcomed for that treatment until a later clear test is recorded. Nothing else is blocked.
- Today shows booked treatments in the next two weeks whose patch test is not in order.
- A guest booked for such a treatment with no test that counts gets one message asking them to arrange a test, up to two weeks before and only while there is still time. It follows their usual email and text choices and the studio can turn it off. It is checked again just before it goes, so a test recorded meanwhile stops it. With no provider configured it stays in test mode.
- Practitioners see the patch test status of their own visits and can record a test they did, and its result, for their own clients only.
- The booking page tells guests which treatments need a patch test and how far ahead.
- Patch tests are in the client's data export and listed as kept in the erasure review.

## 2026-10-07 · V2 · Accountant exports

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed. Nothing is sent to Xero or QuickBooks.**

- Business has a new Accounts page for owners and managers. For this month or last month it shows the takings, tax, tips and money given back, day by day, with three spreadsheets for the accountant: money in and out, sales by receipt, and a tax summary. Demo and test payments are marked as such.
- The owner chooses Xero or QuickBooks and fills in the account codes the accountant gives them. "Prepare" turns each day with takings into a balanced journal in that software's own format, shows a preview, and keeps a record of the batch with who prepared it. It is marked test mode and nothing is sent.
- Spreadsheet cells that start with a formula sign are kept as plain text.

## 2026-10-07 · V2 · Reordering from suppliers

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed. SALEANE never sends an order to a supplier.**

- Stock has a new "Orders from suppliers" section. Owners and managers keep a list of suppliers, and each product can name its supplier and how many are usually ordered.
- When products run low, the section suggests an order for each supplier with the usual quantity, leaving out anything already on order. "Prepare order" fills in the order, shows it in plain words to paste into an email or read out, and records it once the studio confirms it has placed it.
- When a delivery arrives, the desk says how many of each product came and they go on the shelf against the order. An order can be cancelled; received and cancelled orders stay on record with who closed them.
- The ledger checks that each delivery matches what the order says arrived.

## 2026-10-07 · V2 · Chair and room rent

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed. SALEANE records rent paid to the studio and collects nothing.**

- Pay has a new section for self-employed people who rent a chair or room. Owners and managers set up a rental (who, chair or room, which one, the rent, weekly or monthly, from which day) and end it when it stops. Ended rentals and their payments stay on record.
- Rent is due at the start of each week or month. Monthly rent keeps the same day, moving to the last day in shorter months. The section shows the latest periods as paid or owed and the total still owed.
- Rent paid in cash, by bank transfer or on the studio's own card terminal is recorded against its period, with a reference for transfers and card payments. More than was due cannot be recorded, nor rent that is not yet due.
- Someone renting earns no commission on those days. Reception is not sent rent or commission records.

## 2026-10-07 · V2 · Rota, holidays and time off

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed.**

- Business has a new Rota page. It shows the week for each person from their usual hours, how many visits they have each day, and who is on holiday, off sick or away. Owners, managers and reception can see it.
- Owners and managers add time off for whole days (holiday, sick or away, with an optional note) and can cancel it. Cancelled time off stays on record with who cancelled it.
- Nobody can be booked while they are away, online or at the desk, and the time counts as unavailable in Business figures.
- Time off is refused while it would leave a booked visit stranded. The form lists those visits before saving, so the desk moves them first; nothing is moved or cancelled automatically.
- Each person can have a yearly holiday allowance. The page shows the working days of holiday booked this year and how many are left, and a holiday over New Year counts each day in its own year.

## 2026-10-07 · V2 · Commission and tips per person

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed. SALEANE works out what each person has earned and pays nobody.**

- Business has a new Pay page for owners and managers. For this month or last month it shows each person's visits, commission on services and on products, tips and what they are owed, with a line-by-line breakdown and a spreadsheet download for payroll.
- Commission is counted without tax and after discounts. Tips go in full to the person who did the visit. Money given back comes off in the month it is given back, in proportion to what the receipt was for and at the rate it was earned on; the tip stays with the person.
- The owner can change two pay settings from a chosen date, with earlier settings kept. Money given back can come off the commission (the default) or be paid by the studio. Tips can go to the person who did the job (the default) or into a shared pot, split equally to the penny between everyone who did a visit that day, week or month. The studio never keeps any of the tips, in line with UK and US tips law.
- Only the owner sets rates. Each change starts on a chosen date and earlier rates are kept, so past months keep their figures unless the new date reaches back into them. Managers can see the rates; reception is never sent them.
- A walk-in product sale can name who sold it, and that person earns the product commission.
- The spreadsheet guards against names that would run as formulas.

## 2026-10-07 · V2 · Walk-in product sales and returns

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed and no money moved.**

- Stock has a "Sold without a visit" section for someone who pops in for a product. The desk picks products and how many, can link a client, and records how it was paid: cash or the studio's own card terminal (a reference is required for the terminal). SALEANE records the sale and does not take the money. Each sale gets its own receipt number (SC-1, SC-2 and so on) and takes the products out of stock on that receipt.
- Owners and managers can give money back on a walk-in sale and say how many of each product went back on the shelf. A refund on a visit receipt with products can now put them back too. Stock shows these as "Brought back" against the refund.
- Money lists walk-in sales among the day's receipts, the till count includes their cash, Business counts them in products sold and tax, and the client's data export lists products bought without a visit.
- The ledger checks that every walk-in sale matches the stock that left, that no more comes back than was sold, and that refunds never exceed what was paid.

## 2026-10-07 · V2 · Stock and products at the till

**Status: built locally on 7 October 2026 and merged (#31); nothing deployed and no card charged outside test mode.**

- Business has a new Stock page. Owners and managers add products, mark the ones only used in treatments, and record deliveries, use in treatments and shelf counts. Each change is kept with who made it; nothing is deleted. Reception can see what is in stock but not change it.
- The page shows what is on the shelf, what is running low against each product's reorder level, products sold in the last 30 days and, for owners and managers, the stock's value at cost.
- At checkout the desk can add products to the visit. Each is priced at its catalogue price with the studio's current tax, must be in stock, and leaves stock on the same receipt. The receipt keeps the name and price as sold, so a later price change never rewrites it. Plans and discounts cover the service only; the guest pays for products.
- Card payments through SALEANE (saved card or reader) include the products and the server prices them again before charging. A repeated checkout takes stock once.
- Business shows products sold beside service revenue, kept apart from it. Receipts in Money, the client timeline and the client's data export list the products.
- The ledger checks that every receipt's products match the stock that left, line by line.

## 2026-10-07 · Calendar: Today, Week and Month

**Status: merged on Edem's word on 7 October 2026; nothing deployed.** Look and navigation only; booking, moving and checkout are unchanged.

- Calendar still lands on today. A Today, Week and Month switch at the top replaces the separate Today button and the week icon, and the arrows step a day, a week or a month to match. Today shows as chosen only while today is on screen, so it always takes you back.
- The new month view shows every day of the month with how full it is, how many visits it holds and its first three visits. Tapping a day, or "more", opens that day's timeline; tapping a visit opens its details. On phones each day shows its number and how full it is.
- The grid and list choice for a day now shows only on the day view, and the day's cancelled and missed visits list shows only there too.

## 2026-10-07 · The guest booking page, redesigned

**Status: merged on Edem's word on 7 October 2026; nothing deployed.** Look and layout only; booking rules, holds, prices and deposits are unchanged.

- On computers and tablets the studio photograph now fills the left side from the top of the page and holds still while the guest scrolls, all the way to the bottom. Before, it stopped short and slid away at the end of the page.
- The welcome ("Care, considered.", a short line and the studio's location) sits where the photograph softens into a feathered, edgeless blur at its foot, so it reads clearly on any image with no box or hard edge. The studio's name sits in a matching soft fade at the top. The leaf icon is gone.
- On phones the photograph opens the page with the welcome card on it; from the second step only the studio's name stays at the top.
- The studio's team now see a separate dark preview bar above the page, with "See it as a guest" and "Back to workspace" (and the demo market). "See it as a guest" shows the page exactly as a guest sees it, with only a small "Leave guest view" button in the corner. Guests never see the bar; on the real guest page it appears only to someone signed in to the studio. The honest note about simulated bookings stays for everyone.
- Choosing a treatment now starts with the kinds of treatment (for example Skin, Body, Hair), each with a photograph and how many treatments it holds; picking one shows just those treatments, with a way back to all kinds. A search box above searches every treatment by name, kind and description. Nothing is chosen until the guest picks, so the Continue bar appears only then. A studio with a single kind of treatment goes straight to its list, as before.
- The demo booking page now uses the demo studio's own name instead of always "Atelier House".

## 2026-10-07 · Browser demo

**Status: merged (#21, refreshed in #37 and #44); nothing deployed. The demo link is a private claude.ai page.**

- `npm run demo:build` writes one HTML file that runs the real app and server code inside a browser tab, with two fictional sample studios and the owner already signed in.
- The London studio runs as a real studio in test mode, so a guest can pay a deposit on the test payment page and messages appear in the Inbox. It starts on today's date without the sample's payment history. New York stays a sample studio.
- Each studio starts with two sample plans, a five-visit package and a monthly membership, each already held by one client, so the plan screens and the plan choice at checkout have something to show.
- Each studio also starts with eight private sample ratings from recent visits, so Business > Feedback shows averages, a split by professional and guests' notes.
- The Ask Saleane button works in the demo in test mode: it answers from the studio's own records, and an invitation it prepares is saved as an unsent draft only after approval.
- The house photographs travel inside the demo file, so the new booking page and the photos across the app show as they do in the real app.
- The waitlist works in the demo with the three sample clients waiting; booking a suggested time for one of them fills it straight away.
- Gift cards work in the demo. London's two sample cards show as paid in cash, because a real studio cannot hold simulated card payments.
- Booking confirmations and reminders appear in test mode for the demo's studios. Nothing is sent or charged. The real app still never sends from sample studios.
- The London studio has the AI receptionist switched on, so the booking page shows "Ask a question". Connected software and access keys work in test mode; the demo never looks up an address or sends anything.
- Each demo build keeps its own saved copy of the sample studios, so a refreshed demo always opens on the newest sample data.
- Changes stay in that browser. Passwords use a simple stand-in there, so the demo is for showing, never for real data.
- Checked in Chromium at desktop and phone width: Today, Calendar, Clients, Inbox, Business, Settings, a full guest booking, the guest manage page and a checkout receipt. Not checked in Safari or Firefox.

> > > > > > > origin/main

## 2026-10-07 · V1.5 · Gift cards and vouchers

**Status: built locally on 7 October 2026 and merged (#34); nothing deployed and no money taken.** SALEANE records gift card payments and refunds; it does not take or return money itself. [Evidence](docs/evidence/V15-GIFT.md).

- A new Gift cards page under Business (owners, managers and reception) sells gift cards for an amount, or vouchers for a treatment at its price on the day. Each gets a 12-character code that is easy to read out, and the page shows the card as the guest would see it, ready to print. Cards last two years in the UK and five in the US, up to and including the anniversary.
- At checkout the desk types a code, in any case and with or without dashes, and chooses how much to take from the card, up to what it holds and what is due after any deposit or plan. The guest pays the rest as usual, including by card through SALEANE when the studio takes cards (a saved card or a card reader is charged only the rest, and the gift card's share is held while that payment is under way, so it cannot be spent or cancelled elsewhere). The receipt, the receipt in Money and the client's timeline show what the card paid and what is left on it; a package or membership's share now shows on the Money receipt too.
- Money paid for a card is held until it pays for a visit, so it counts as takings only then. Cash taken for cards, and cash returned when one is cancelled, is counted in the till.
- Owners and managers can give an expired card more time, keeping the earlier date in its history, or cancel a card with an optional recorded refund up to what is left. Nothing is deleted.
- Cards bought by a client are in their data export, its preview and the erasure review, and the studio export counts them.
- Fix: ending a package or membership with money returned in the sample studio asked for a reference the sample screen does not show. A demo refund is now given its own reference, as gift cards are.
- Test fix: one offline day sheet test saved a sheet dated 6 October 2026 and began failing once that sheet's real expiry passed. It now uses a time just ahead of the clock.

## 2026-10-07 · V1.5 · Waitlist

**Status: built locally on 7 October 2026 and merged (#30); nothing deployed and no message sent.** The waitlist never contacts anyone by itself: an offer is an Inbox draft the team approves.

- A new Waitlist page (in the main menu, for owners, managers and reception) lists everyone waiting, longest first, with the earliest three times that suit each person read live from the diary, so a cancellation shows at once as a time someone could take. It counts how many times were filled from the list in the last 30 days and what those visits were worth.
- Choosing a time offers two things: book it for them (or, for a guest who already has a later visit, move that visit earlier), or write an offer. An offer becomes a draft in the Inbox saying the time is not held and the first to answer gets it.
- The desk adds someone from the page or the client's page: the service, a professional or anyone, a window of dates (up to 90 days), mornings, afternoons or evenings, and a note. One open request per client and service.
- A guest with an upcoming visit can ask from their private visit link to come in sooner, choosing whether anyone will do and which times suit. They can change or withdraw it, and their visit stays as it is until they agree to a move. Cancelling the visit ends the request.
- Taking someone off the list keeps the request with a reason. Requests are in the client's data export, its preview and the erasure review, and are kept 90 days after their dates end, then wait for an owner or manager to approve deletion or keep them longer; nothing is deleted automatically.

## 2026-10-07 · Sidebar tidy and a booking page spacing fix

- The sidebar line "A considered way to run a remarkable business." now sits directly under the SALEANE name at the top of the sidebar instead of at the foot. Phones use the navigation menu, which never carried the line.
- The "Your booking page" link in the sidebar and the phone menu no longer has an arrow. It opens in the same tab, so no meaning is lost.
- On phones, the real guest booking page showed its welcome as "Care,considered." and "just for you.Thoughtful" because the hidden line breaks had no space beside them. Both now read with a space.

## 2026-10-07 · A smoother booking page and the house photographs

Look and flow only; booking rules, holds, prices and deposits are unchanged.

- On phones and narrow screens, the studio photo greets guests on the first step only; later steps open straight on the task, and each step starts at the top of the page.
- Times show one part of the day at a time (Morning, Afternoon, Evening, each with its count), opening on the part that holds the chosen time or else the earliest. The staff booking dialogs still show the full day.
- On phones, the bar with the treatment, price and Continue button stays at the bottom of the screen while the guest scrolls.
- The chosen time and chosen day use the studio's own colour instead of black, here and in the staff app.
- The owner's 12 chosen house photographs (AI-generated, fictional rooms and details, from the photo set in #15) are in the app, matching the prototype: the sunlit treatment room in the Today greeting, a cup of tea on "Saleane noticed", a calm studio strip on Calendar, window light above Clients, the studio entrance on the booking pages, and on Business a "Your booking page" card (reception and one photo per treatment) beside a "Closing up" card in late-afternoon light that counts today's visits still to check out from real records. Empty pages ("No clients found", page not found) carry stacked towels. The manicure photo is ready for nail treatments; the demo studios have none yet.
- The demo booking page offers "Anyone available" first when more than one professional does the treatment, combining their times; the visit goes to the first professional free at the chosen time. The real guest page already offered "No preference · first available".

## 2026-10-07 · Lumane · Assistant engine and first Ask Saleane skills

**Status: built locally on 7 October 2026 and merged (#29); no real AI connected yet.** Everything runs with a test-mode brain that recognises a few plain questions and answers from the studio record, so nothing is sent to an AI supplier and nothing costs money. Talking (voice), guest chat and the ChatGPT and Claude connection come later.

- Lumane is a separate engine in `lumane/`, built so other products can reuse it. A test makes sure it never imports anything from SALEANE.
- Skills are either read skills, which answer from the studio's own records, or action skills, which only propose a change. A proposal does nothing until a person approves it, and it expires after 30 minutes.
- Every request is checked against the studio's monthly allowance (typed requests, talking time, guest chats), a per-person hourly limit and a daily spending ceiling before any AI is called. When a limit is reached the AI is simply not called; there is no silent cheaper fallback. A new month starts from zero.
- Each question has a cap on how many steps the AI can take, and every answer, proposal and refusal is written to an audit trail.
- The first Ask Saleane skills cover the day overview, finding a client, a client brief, who is due back, takings and low stock (owners and managers only), money owed and plans running low. Drafting a message and moving a visit are proposals: a draft stays unsent until someone sends it from the Inbox, a move checks the diary for clashes, and marketing drafts are refused without consent.
- Practitioners get no Ask Saleane skills yet; theirs will be built on `PractitionerView` so they never see a whole studio.
- An "Ask Saleane" button in the header opens a side panel for owners, managers and reception. It answers what is on today or tomorrow, who is due back, takings, money owed, plans running low, low stock and a brief on a client, and can prepare an invitation for a client to come back. The invitation appears as a suggestion with Approve and Not now; approving saves it as an unsent draft in the Inbox through the same checks as any desk change. The panel shows how many of the month's 300 questions are used.
- Voices are kept apart from the brain. SALEANE has one default voice; a studio can choose the voice guests hear, and each person can choose their own for talking to the assistant. Guests always hear the studio's voice. The shortlist is a set of candidates for the side-by-side trial of OpenAI and ElevenLabs; no voice is connected yet.
- Signed in, the server answers and keeps each studio's monthly use in the database (schema version 7), so the allowance holds across restarts. Suggestions stay on the server for 30 minutes, only the person who asked can approve them, and each is decided once; suggesting, approving and declining are recorded in the audit log. In the browser demo the panel works the same way against the demo record.

## 2026-10-07 · V1.5 · Private client feedback and ratings

**Status: built locally on 7 October 2026 and merged (#28); nothing deployed and no message sent.** The feedback request joins the message outbox like any other message; with no provider connected it waits there unsent.

- After checkout, a guest with an email address is queued one private "How was your visit?" message, two hours later (never more than two days after checkout, and never once the visit is a week old). Studios can turn it off in Settings, Messages.
- The guest's private visit link shows a short form once the visit is complete: stars for the visit and for the person who looked after them, and an optional comment. One answer per visit; sending the same answer twice lands once, and an answer cannot be changed afterwards. The guest sees a thank-you with their own ratings, never anyone else's.
- Business has a new Feedback page for owners and managers only, with the number of visits rated, the average for visits and for the team, each professional's average and the latest answers with comments, over 30 days, 90 days or all time.
- A practitioner's day shows only their own average. New ratings join it in groups of at least three different guests, so a change in the average reflects a group, not one guest. As with any average, a group in which every guest gave the same score (all fives, say) shows that score. Reception and practitioners never receive individual answers.
- Feedback is private and never published. Public reviews remain a separate, neutral request to the studio's Google page. A client's data export (and its preview) and erasure review include the feedback they gave. Feedback is kept for 2 years after it was given, then waits for an owner or manager to approve deletion or keep it longer; nothing is deleted automatically.

## 2026-10-07 · V1.5 · Packages and memberships

**Status: built locally on 7 October 2026 and merged (#27); nothing deployed.** Plan payments are recorded by the desk (cash or the studio's own card terminal); paying for a plan by card through SALEANE and automatic monthly renewal come in a later stage.

- Settings has a new "Packages & memberships" section. A package is a number of visits bought at one price and used within a set number of months. A membership is paid each month and can include visits each month, a discount on other visits, or both. Changing a plan affects future sales only: each client keeps the terms they bought, and a plan is taken off sale rather than deleted.
- On a client's page the desk can sell a plan, take a membership's monthly payment and see what is left. Only owners and managers can end a plan; any money returned is capped at what was paid and not yet used (for a membership, only the current paid month), recorded with a reference that cannot be reused, and never processed by SALEANE.
- At checkout a plan that covers the visit is offered first. It pays its share of the plan's price (the last visit takes what is left, so a package uses exactly its price), the difference from the list price shows as the plan saving, and the guest pays only any tip. A membership's discount is offered on other visits for the desk to apply.
- Money has a Plans tab showing what was taken for plans and the package visits paid for but not yet used. A covered visit counts its share as that day's takings; plan money stays apart until used. Cash taken or returned for plans is part of the till count.
- A lapsed membership covers nothing until paid; paying again restarts it from the current month without charging the missed months. Unused visits in a month do not roll over.
- Plans, their payments, visits used and refunds appear in the client's data export. Practitioners see none of it.

## 2026-10-07 · 1.0 readiness ledger

**Status: merged into main on 7 October 2026 (#26), documentation only; the version stays 1.0.0-rc.1.**

- [docs/V1_READINESS.md](docs/V1_READINESS.md) checks each 1.0 release gate against the evidence here: every V1 daily job works locally, and what remains needs a pilot studio, provider accounts, hosting or the owner's release approval.

## 2026-10-07 · PILOT-04 · One clear published price

**Status: merged into main on 7 October 2026 (#25); nothing deployed and no billing connected.** The figure shown, £49 / $59 a month per studio, is the recommended price awaiting the owner's confirmation.

- A new public page at /pricing shows one monthly price per studio, for the United Kingdom (plus VAT) or the United States (plus any sales tax), guessed from the browser's language and switchable.
- It lists everything included, with no feature held back for a dearer plan, and three promises: no commission on a studio's clients, no locked tiers and no fee to leave.
- Costs outside SALEANE are named plainly: the payment provider's card fee and text messages, each passed on with nothing added. Emails are included.
- The sign-in page links to it. The price lives in one place, so changing it changes the page and its tests together.

## 2026-10-07 · PILOT-03 · Switching over from another system

**Status: merged into main on 7 October 2026 (#24); nothing deployed.** No data from a real studio was used.

- Settings has a new "Switching over" section that walks a studio across in four steps: clients, services, upcoming visits and balances. Each step reads a CSV file exported from the old system, shows every row as ready, already here or to fix (with the reason), and adds up the totals so the owner can check them against the old system's own report before anything is saved.
- Services arrive with their length, price, deposit, category and who gives them. A name already in SALEANE is left alone.
- Upcoming visits keep the price the guest was quoted, as the full amount with any tax inside it, and any deposit they already paid. They are matched to clients by email, even when the old system spells a name differently (a new guest is added once, however many visits they bring), and each must fit the team's hours, time away and the rooms and chairs free, without clashing with another visit. Past times are refused. The old system already confirmed them, so SALEANE sends no new confirmation; reminders follow the studio's settings, including for a visit brought across after its reminder time has opened.
- A deposit paid to the old system is recorded as "Paid before switching" with the old reference. It is taken off the bill at checkout like any deposit, never counted in the till, and can never be chosen as a payment method at the desk.
- Credit a client holds, or money they owe, is kept as a carried-over balance on the client's page and in a new Money tab. SALEANE does not take it off a bill by itself; the desk applies it and closes it with a note, and it stays on record. Client data exports include it.
- "What has come across" lists every import, client imports included, with who did it, how many records, the money involved and how many visits or balances are still open.
- Only owners and managers can bring records across; the desk can close a balance. Practitioners see none of it.

## 2026-10-07 · PILOT-02 · Saved cards, card payments and deposits

**Status: merged into main on 7 October 2026 (#23); test mode, nothing deployed and nothing charged.** No payment provider has been chosen.

- A guest can pay their deposit from the private link to their visit, and save a card for later visits when the studio offers it. The card is typed on the payment provider's own page; SALEANE never sees or stores the number. Guests see the studio's terms, word for word, before they save a card, and those terms are kept with the card.
- At checkout, "Card through SALEANE" charges the client's saved card or sends the amount to a card reader. The visit is checked out only when the provider confirms the payment, and a repeated click or a dropped connection cannot charge twice.
- Settings has a new "Payments" section: let guests save a card, and a missed visit and late cancellation fee of up to 25%, 50% or 100% of the booked price. A fee applies only to a missed visit or one cancelled less than 24 hours ahead, comes off any deposit, and is always charged by a person.
- A visit shows the client's saved card, a deposit still owed, the fee the policy allows, and any card payment that needs a look. A client's profile shows the saved card, what they agreed to, and a way to remove it.
- Money can refund a card receipt, a card deposit (once the visit is cancelled) or a fee back to the card, through the provider.
- If money is taken for a visit that changed meanwhile (for example cancelled while the guest was paying), it is not forced onto the record: it is listed as "Taken, needs review" with what happened.
- Card payments can no longer be typed in as ordinary records; they enter only from the provider.
- Test mode is the default: a clearly labelled test payment page and a test card reader let the desk and guests rehearse every step, and no money moves. A Stripe adapter (hosted card pages, saved cards, card readers, refunds and signed webhooks) is written and tested against simulated answers, ready for when an account exists. Sample studios never take card payments.

## 2026-10-07 · PILOT-01 · Appointment messages

**Status: merged into main on 7 October 2026 (#22); test mode, nothing deployed and nothing sent.** No email or text provider has been chosen.

- Real studios now confirm each booking, tell the guest about a new time or a cancellation, and send a reminder before the visit, by email and text. Each message carries its own private link to view, add to calendar or cancel the visit.
- Settings has a new "Messages to guests" section: confirmations on or off, reminders on or off, when the reminder goes (2 hours, the day before or two days before), and email and text on or off. Owners and managers can change it.
- A client's profile has "Appointment emails" and "Appointment texts" switches, separate from marketing. Changing them is recorded on the client's timeline.
- The Inbox and each client profile list what was sent for them, with honest labels: "Test mode, not sent", "With the provider, no receipt yet", "Delivered" (only on a provider receipt), "Not delivered", "Unclear, check before resending" and "Not sent". Owners and managers can send a failed or unclear message again.
- Test mode is the default and sends nothing. Postmark (email) and Twilio (texts) adapters are written and tested against simulated answers, ready for when accounts exist. Sample studios never send.
- Texts go only to numbers saved with a country code. Messages never include marketing.

## 2026-10-07 · Merged · Booked prices keep their tax

**Status: merged into main on 7 October 2026; nothing deployed or charged.**

- Each new visit stores the studio's tax setting at the moment it is booked, and checkout uses it. A guest pays the all-in price they were shown, even if the studio changes its tax setting before the visit (owner decision, 7 October 2026).
- Visits booked before this change keep following the studio's current setting.
- A time held on the public booking page also remembers the tax setting. If the studio changes it before the guest confirms, the guest is asked to choose the time again, as already happens when the price changes.
- The checkout panel now says "Tax follows the setting in place when this visit was booked."

## 2026-10-07 · Merged · A full Settings page

**Status: merged into main on 7 October 2026; not deployed.** Layout and navigation only; studio records save exactly as before.

- Settings is now a page in the main menu instead of a small pop-up. Sections sit down the side: Your preferences, Studio details, Colours & booking page, Services, Team, Spaces & equipment, Hours & closures, Data & privacy and This workspace.
- "Manage studio" under Business has moved into Settings; old links to it open Settings. Reception, who could not see Business, now land on Settings.
- Your preferences holds the Inbox layout: "Two columns, like email" (the default) or "List with a side panel", chosen per person and kept in this browser. The switch on the Inbox page is gone.
- The studio card, your name in the top bar, "About this version" and "Open recovery controls" each open the matching Settings section. The address names the section, so a link can open it directly.
- Accessibility fixes for regressions the new look brought in, found by the WCAG 2.2 A/AA sweep (`scripts/qualify.mjs`), which is back to zero violations across 63 page checks:
  - Today: completed visits are now quieted by a softer text colour rather than fading the whole row, so they keep enough contrast.
  - Calendar: free gaps shorter than a comfortable tap (24px) are no longer separate buttons; they are booked from New appointment. On phones, free-time buttons are named by what they show, with the person's name for screen readers.
  - Inbox: the empty-view heading sits at the right level. Money: receipt rows are named by what they show.
  - Clients and Inbox: the search pill shows a clear focus ring for keyboard users.
  - The sweep no longer opens the old Settings pop-up, which this change removes; the Settings page is covered by the page checks.

## 2026-10-07 · Merged · Small extras

**Status: built and checked locally; nothing deployed, nothing sent or charged.**

- Business page: "Who comes back" with new-client return, returning clients, lapsed clients and rebooking per professional, each with its definition.
- Money page: end-of-day till count against the cash on record. It records only; it does not bank, move or reconcile money. Refunds now record whether they went back as cash or by card or bank, so the till balances with mixed payments.
- Booking pages: one all-in price sentence per treatment, a "before you arrive" card, and add to calendar on the confirmation and the guest manage page.
- Manage studio: arrival and preparation notes, and shareable booking links for Google and Instagram that record where a guest came from.
- Practitioners: a phone-first day with "Next up" and "Before you begin". Evidence: [EXTRAS](docs/evidence/EXTRAS.md).

## 2026-10-07 · Merged · Retention decisions recorded

**Status: decisions recorded; nothing is deleted.**

- The owner decided the privacy rules and retention periods (contacts and notes 2 years after the last visit, marketing consent until withdrawn plus 2 years, unsent messages 90 days, money records 6 years UK and 7 years US, staff 6 years after leaving, audit log 6 years, backups 35 days). See [PRIVACY.md](docs/PRIVACY.md).
- Nothing is deleted automatically. A record that reaches the end of its period waits for an owner or manager, who either approves deleting it or keeps it longer by months or years (years by default); no deletion step is built yet.
- The Manage page shows the periods under "How long records are kept", and the erasure review wording now reflects the decisions.

## 2026-10-07 · Merged · The new look: fonts, studio colours and a Clients directory for hundreds

**Status: merged into main on 7 October 2026 with the design tightening pass below; not deployed.** Look and wording only; bookings, money and messages behave as before.

- New type: Figtree for all working text (360 body, 460 menu, 560 emphasis) and a light serif for headings and names. Financier Display Light is the chosen heading font, but its licence is not bought, so the committed code uses the free Newsreader at 300, then Georgia. Bodoni Moda, Source Sans 3 and Manrope are removed.
- A warm off-white ground, a warm sidebar, white cards with 20px corners, pill buttons and a sticky, translucent top bar. No dark panels: the Business insight card is now light.
- Studio colours: owners and managers pick a first and second colour in workspace settings (six and five presets, sage and soft rose by default). Buttons, selection, focus, the now line, counts and tags follow them. Every preset keeps white button text and coloured text at WCAG AA. **The choice is saved in this browser only** until studio settings are stored on the server.
- Today opens with a greeting card ("Good morning, …", how many guests are in today and who is in the studio now) beside a light studio photograph. Completed visits fade and a rose line marks the current time in the agenda.
- Clients is a directory built for hundreds: counts for All, Ready to return, New this month, Booked this week and Email marketing on; search by name, phone or email (a UK number typed with its leading 0 still matches); sort by most recent visit, name, visits or spend; 25 per page with "Showing 1 to 25 of N". Checked with 412 fictional clients brought in through Import clients. The query is shaped so the server can answer it page by page once clients live in Postgres.
- A client's page opens with their portrait, "Client since …, usually every N weeks", their next visit (or "Book next visit"), four figures, and a year of visits as dots.
- The Inbox menu item shows a rose count of drafts waiting for approval.
- The Inbox opens in two columns, like email: the queue on the left (All, To approve, Queued, Not sent, and search) and the chosen message on the right, with that client's earlier queued messages above it and the draft in a dashed outline with "Approve and queue" and "Edit". A View switch offers "List with side panel" instead, and each person's choice is remembered in this browser. On a phone the list comes first, then the message with an "All messages" link back. Nothing is labelled sent: queued messages read "Queued, not sent", because texting and email are not connected.
- Lighter, sunlit photographs in JPEG (242 KB and 48 KB) replace the larger PNG on the workspace, sign-in and booking pages.
- The design library page now resolves colours mixed with `color-mix()` before measuring contrast, and lists the studio colours.
- Tests: four new directory tests (paging 412 clients, search, agreement with Today's "ready to return", sorting). One Inbox test covers the remembered view.

## 2026-10-07 · Merged · Design tightening pass and faster flows

**Status: merged into main on 7 October 2026; not deployed.** Look and wording only; bookings, money and messages behave as before.

- Fixed the Money and Inbox section switches, which had lost their styling in the design library pass and showed as plain grey buttons.
- Money receipts are grouped by day with a day total and slim rows, five days at a time with "Show earlier receipts". Internal record codes are no longer shown.
- A client's past visits fold to one line (date, service, person, amount) and open to show what happened. Today's and upcoming visits stay open.
- On phones, the figures at the top of Today, Clients, Business, Money and Inbox sit in one slim strip.
- Slimmer rows on Today, the calendar list and Clients. Every detail is kept: where a column is hidden on a smaller screen, the professional, status, spend and next visit now appear under the name. The whole client row opens the client, and "Ready to return" shows as a label.
- Panel and section titles all use the editorial serif.
- One "Find a client" field in the top bar instead of two controls.
- Plain studio language for services that are not connected yet, the bot check setting and held-back messages.
- The sign-in welcome sits on a softer wash so it reads clearly over the photograph.

Second pass, for speed at the desk and for guests (same draft). Bookings still pass the same availability checks; nothing is sent or charged.

- Click any free space on the calendar to book there, with the professional, day and nearest time that fits already chosen. On phones the free times in each person's column do the same.
- A "now" line marks the current time on today's calendar.
- Drag an upcoming visit to another time or professional on the computer calendar. It opens the move step with the new spot chosen, so the usual checks and the Save button still decide.
- A week view shows seven days side by side; choosing a day opens it.
- The booking form finds a client by typing a name, email or phone. Once chosen, their "Good to remember" note and last visit appear. Services show their length and price.
- Rebooking after checkout offers "In 4, 6 or 8 weeks", led by the client's usual gap between visits when there is one, and keeps their usual time when it is free.
- Times are grouped into morning, afternoon and evening everywhere times are chosen.
- The demo booking page shows the next fortnight with how many times each day has, and a "Next available" shortcut when a day is full. The live booking page offers "Try" the next day when a day is full.
- Checkout reads in order: service, deposit, discount, tip, payment, total. A custom tip sits behind "Other".
- Search is titled "Search clients", matches phone numbers and shows each person's next visit.

## 2026-10-07 · Merged · Competitive position in the plan

**Status: documentation only; no product behaviour changes.**

- Roadmap gains a Competitive position section from the Mindbody comparison: memberships and packages lead V1.5, a narrow consented missed-call text-back joins V1.5 ahead of the V4 concierge, no marketplace stays a firm rule, and booking from Google search or Instagram is listed as an idea to validate.
- The same section records the one-line promise, the four moments (before, during, checkout, after), the cancellation-to-filled-slot workflow, focused navigation and the pilot test of less effort, fewer mistakes and better continuity.
- Vision states the no-marketplace rule plainly and adds a short "Where SALEANE competes" section.

## 2026-10-06 · Merged · LOCAL-05 qualification pass

**Status: merged into main on 6 October 2026; not deployed.** Chromium only; Safari, Firefox and screen readers are still to be run.

- Visit rows, calendar visits and demo booking services now take their spoken name from their visible text, so voice control matches what is on screen (WCAG 2.5.3). "Find a client" and the operator button keep their names on phones. The measure popover is named, notices sit in labelled sections and the sign-in page has one `h1`.
- Record validation no longer scans whole lists for every link. At 5,074 visits a read fell from 322 ms to 105 ms (p95) and a booking from 966 ms to 297 ms; a 30,074-visit studio now completes (read 568 ms, booking 1.7 s).
- `scripts/qualify.mjs` repeats the accessibility, reflow and keyboard sweep; `server/measure.test.ts` (with `MEASURE=1`) repeats the load and restore measurements. See `docs/evidence/LOCAL-05.md`.

## 2026-10-06 · Merged · Read-only offline day sheet (OFF-01)

**Status: merged into main on 6 October 2026; not deployed.**

- New `GET /api/workspaces/:id/day-sheet`, built by `src/domain/daySheet.ts`. Desk and management roles get today's studio visits with time, service, professional, room, status, client name and phone. A practitioner gets only their own visits and no phone numbers. No email, money, notes, exports or marketing lists. The sheet shows when it was synced and expires at closing time (at most 12 hours).
- The sheet is kept for the current tab only (session storage), and cleared on sign-out, studio change, expiry and changed access.
- When SALEANE cannot be reached, the saved sheet replaces the workspace with a clear offline notice and every change is paused. Reconnecting checks the session and role and replaces the sheet before changes resume.
- `/day-sheet` is a printable paper fallback, linked from Today and the practitioner day. The browser demo builds the sheet locally and offers a preview of the offline view.
- Not enabled, pending a threat review: keeping the sheet beyond the tab, a service worker and a device policy. Offline revocation is not instantaneous.

## 2026-10-06 · Merged · LOCAL-04 schedule administration continuity

**Status: merged into main on 6 October 2026; not deployed.** No schema migration: the history lives in the studio record as an optional, bounded list, so older records load unchanged. Live services stay unconfigured.

- A change to opening hours, a professional's own hours, time away (including a break for one professional), or archiving a professional or room is refused while it would strand an upcoming visit. The refusal now names each visit (date, time, client first name and professional) and why it no longer fits, instead of a generic conflict. Visits are never moved or cancelled for you.
- Manage shows the same check before saving: "These N upcoming visits would be affected", each linked to that visit in the calendar, and holds the save until they are moved or cancelled. Visits that already did not fit before the change, past days and visits already finished today do not block it.
- New Schedule history in Manage, Hours & closures: who changed what and when, in plain words, with the structured before and after kept in the record (latest 500 changes). A refused or stale (409) save records nothing.
- Professionals can have their own working hours in the team editor, or follow the venue's hours. Booked duration, turnaround, price and deposit stay with each visit when the service or hours change.
- Verified with lint, format check, strict TypeScript, builds and 233 tests (169 frontend/domain/store, 64 server), plus a Chromium pass on the built server. See `docs/evidence/LOCAL-04.md`.

## 2026-10-06 · Merged · Privacy and data lifecycle (LOCAL-03)

**Status: merged into main on 6 October 2026; not deployed.** No schema migration. Scope, roles and retention are defaults awaiting the owner's decision with an adviser.

- Owners and managers can preview, then download, a copy of one client's data (JSON plus a readable summary) from the client page. It holds their profile, consent, visits, receipts, payments, refunds, timeline and unsent messages with their real status; other clients appear only as a connection type, and credentials, sessions, invitations, holds, internal ids and the audit log stay out. Reception and practitioners get 403 from the server.
- The owner can preview and download a whole-studio export in Manage studio → Data & privacy, with team names, emails and roles but no password hashes, tokens, holds or other studios.
- Each download and each erasure request is written to the audit log by action and record id only, and listed as the privacy record.
- An erasure review shows what a decided policy could remove and what must be kept, with reasons. Recording a request deletes nothing. Email marketing can be withdrawn through the existing consent command.
- Added a proposed retention register in [PRIVACY.md](docs/PRIVACY.md). Evidence: [LOCAL-03](docs/evidence/LOCAL-03.md).

## 2026-10-07 · Merged · LOCAL-02 guest manage and cancel

**Status: merged into main on 7 October 2026; not deployed.** Schema migration 3 adds `guest_links`. Live services stay unconfigured; nothing is emailed or refunded automatically.

- A confirmed online booking returns a private link (`/manage#…`) shown on the confirmation page, labelled as not sent. The desk can create a new link for any upcoming visit from the appointment panel, which stops every earlier link, or stop all links.
- A link is a random token stored only as a hash, scoped to one visit in one studio. It expires 120 days after issue or seven days after the visit starts, whichever is sooner, and every failure returns the same message. The token lives in the address fragment, so it is not sent in server requests' paths or Referer headers. Restoring a backup revokes all links.
- The guest sees the treatment, time, professional's first name, status and any deposit recorded. No contact details, notes or other visits.
- The guest can cancel while the visit is still upcoming. The user chose a 24-hour cutoff: cancelling earlier flags a paid deposit for refund, later keeps it. The guest sees which applies before confirming, and the server refuses if the terms changed in between. No refund payment is created; the studio records any refund in Money. The cancellation event says who cancelled and what happened to the deposit.
- A replayed booking confirmation issues a fresh link and stops the earlier one. Rescheduling by the desk shows the new time on the same link.
- Verified with lint, format check, strict TypeScript, builds and 218 tests (153 frontend/domain/store, 65 server, after merging the design pass), plus a Chromium journey. See `docs/evidence/LOCAL-02.md`.

## 2026-10-06 · Merged · Editable "Good to remember"

**Status: merged into main on 6 October 2026; not deployed.**

- Owners, managers and reception can edit a client's "Good to remember" preferences in place on the client page, through the existing `client-edit` command, which records a "Client details updated" event. Practitioners still read preferences but cannot change them. Previously no screen could set preferences, so real studios always showed the empty state, and its wording pointed at the note form, which never changed this panel.

## 2026-10-06 · Merged · Design language library and design pass

**Status: merged into main on 6 October 2026; not deployed.**

- Added the SALEANE design language library: tokens in `src/design/tokens.css` (palette, semantic colour, type scale with a 12px floor, spacing, shape, elevation), components exported from `src/design/`, a living library page at `/design-language` that reads tokens and checks contrast live, and [DESIGN_LANGUAGE.md](docs/DESIGN_LANGUAGE.md).
- Brought in unstyled Radix Tabs, Toggle Group and Popover alongside Dialog. Manage sections are now tabs; reporting period, client segments, timeline filters and calendar view use one segmented control; metric definitions open in a popover.
- Working screens (Calendar, Clients, Inbox, Business, Money, Manage) use a compact serif header; Today keeps the editorial greeting.
- Raised all workspace text to at least 12px (statuses and turnaround labels were 9px) and fixed the measured contrast failures: completed status on tinted cards and upcoming booking steps.
- Today and Business now show one measure, "Time booked", with a shared definition and the period stated; Business also shows today's figure.
- The client timeline shows each visit once, ordered by when it happens, with its booking, arrival, checkout and money inside.
- On phones the calendar shows a swipeable column per professional with free time written between visits.
- Removed the coloured stripes on the left edge of calendar visits, phone calendar visits, errors, deposit reviews, preference notes, timeline money rows and visit steps. Tone now comes from the surface colour alone, and a test fails if a left-edge stripe is added again.

## 2026-10-06 · Merged · Public booking hold protection

**Status: merged into main on 6 October 2026; not deployed.** Schema migration 2 adds a `visitor` column to `booking_holds`. Live services stay unconfigured.

- Holds still lapse after five minutes. One visitor now keeps at most two unbooked holds per studio: a new hold replaces their oldest, and the booking page hands back its previous hold when a guest picks again.
- Hold creation has its own limits per address (six a minute, thirty an hour) on top of the existing public write limit.
- A studio-wide cap (the larger of 8 or three per active professional) stops many addresses together from holding the whole calendar. Booked and expired holds free their place.
- Optional Cloudflare Turnstile bot check, off by default, switched on in Manage under business details. It needs `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` on the server; without them the setting is refused. Tokens are verified server side before any write and fail closed if Cloudflare cannot be reached.
- Verified with lint, format check, strict TypeScript, builds and 198 tests (138 frontend/domain/store, 60 server), plus a Chromium pass on the built server. See `docs/evidence/HOLD-PROTECTION.md`.

## 2026-10-06 · Merged · LOCAL-01 assigned-practitioner access

**Status: merged into main on 6 October 2026; not deployed.** No schema migration (the membership and invitation tables already carried `staff_id`); live services stay unconfigured.

- A practitioner invitation must name one active professional, and no two team members can work as the same professional. The owner chooses the professional when inviting or changing someone's role in Manage.
- A practitioner's workspace read returns a separate practitioner record from `server/projections.ts`, never the studio record: their own visits from two weeks back to four weeks ahead (service, room, time, status) and, for clients in those visits only, a name, preferences and the latest 20 relationship notes. No email, phone, consent, prices, deposits, receipts, payments, other professionals' diaries, catalogue or settings.
- Practitioners may only welcome a client to their own visit and add a note for a client they serve. The server checks this after the role permission and before the request receipt, so a reused key cannot widen scope. Team, audit, invitations and message sending stay refused.
- Role changes and removal take effect on the next request, including replayed receipts.
- Practitioners sign in to a new "Your day" screen at `/practice/:studio` with its own retry journal. The studio workspace refuses a practitioner record rather than filling gaps.
- Verified with lint, format check, strict TypeScript, builds and 182 tests (137 frontend/domain/store, 45 server), plus a Chromium journey: invitation, sign-up, own day, welcome, note, owner sees the note, desktop and 390px. See `docs/evidence/LOCAL-01.md`.

## 2026-10-06 · Merged · Server groundwork for practitioner access

**Status: merged into main on 6 October 2026; not deployed.** No API contract, schema or behaviour change.

- `server/app.ts` (about 1,050 lines) is split into request checks and dispatch (`app.ts`), shared authority helpers (`context.ts`), HTTP utilities (`http.ts`) and three route modules (`routes/auth.ts`, `routes/workspace.ts`, `routes/public.ts`). The moved code is otherwise unchanged.
- `database.ts` runs numbered, forward-only migrations. Each step commits with its version record, a failed step rolls back to the last good version, and a database written by an unknown version is refused. Backup validation follows the same version list.
- `projections.ts` is the single place a signed-in workspace record leaves the server, for both workspace reads and command responses. Practitioners are still refused; LOCAL-01 adds their assigned-visit view there.
- Verified with lint, format check, strict TypeScript, builds and 172 tests (133 frontend/domain/store, 39 server including new migration and projection tests).

## 2026-10-06 · Merged · Version 1 hardening

**Status: merged into main on 6 October 2026; not deployed.** Small fixes from the version 1 codebase review; no visual redesign, schema change or live service.

- One checkout calculation (`src/domain/money.ts`) now produces both the checkout preview and the recorded receipt, so the two cannot drift.
- Typed amounts convert to minor units by string parsing. More than two decimals is rejected with a clear message instead of being rounded silently. Tip presets now stay selected for prices whose percentage has a part penny (for example 15% of £85.50).
- Short money display keeps two decimals when an amount has pence or cents (£85.50, not £85.5).
- A committed remote save is shown as saved even if clearing its retry key from tab storage fails.
- Availability reuses one time-zone formatter per zone. A no-preference availability check on the demo studio fell from about 62 ms to about 8.5 ms in a local measurement.
- Malformed percent-encoding in an API path returns 400 rather than a generic 500.
- CI now runs `npm run format:check`, matching the project rules.
- Verified with lint, format check, 166 tests (133 frontend/domain/store, 33 server) and builds, plus Chromium runs of demo checkout (tip presets, three-decimal rejection, receipt) and a Manage service price edit.

## 2026-10-06 · Consolidation and AI handoff

- Added `CLAUDE.md`, a detailed continuation handoff and an ordered RC2 → RC3 → provider qualification → pilot → stable 1.0 roadmap with acceptance criteria. Live services remain unconfigured.
- Reconciled the superseded server draft through a history-only merge preserving the verified Node/SQLite tree; retained the experimental branch for reference.
- Fixed browser-demo reset revision reuse reported in PR review. Reset advances beyond the persisted/current revision; two regression tests cover stale-tab rejection after a reset plus write, and explicit recovery of unreadable demo data.
- The user authorised consolidation into main. This entry is not a deployment or stable 1.0 claim; see the consolidation evidence for check results.

## 1.0.0-rc.1 — 2026-10-06 · Local operating application

**Status: local release candidate, not stable production 1.0.** The user selected local-first development with live services unconfigured. Existing browser demos, records, history and the original visual direction remain preserved.

### Added and connected

- Local accounts, studios, owner/manager/reception memberships, manual invitation links, sessions, password change and tenant-scoped SQLite authority. Practitioner logins are rejected until scoped projections exist.
- One combined UI/API host; asynchronous commands, revision conflicts, scoped idempotency receipts, durable privacy-preserving retry keys, attributed audit and workspace-transition guards.
- Manage surfaces for identity, services, qualification, rooms/chairs, weekly opening hours, closures and explicit tax configuration. Local venue clocks, 15-minute suggestions, DST/elapsed-time guards and no-preference allocation.
- Public studio booking with limited catalogue responses, temporary exact-room reservations, release/expiry and atomic confirmation shared with desk availability.
- Manual cash/external-card checkout, discounts/tax, deposits, receipts and externally completed refund recording with explicit acknowledgement/reference. No processor success is fabricated.
- Editable purpose-aware drafts and local unsent queue; bounded client CSV validation/preview/import with source, duplicate handling and no inferred consent.
- Consistent backup/verification and fresh-path restore with session/invitation/hold revocation. Original browser demo remains available alongside the local account workspace.
- Original ivory/sage/serif photographic system extended into accounts, Manage, Money and Inbox; route splitting and dynamic studio/operator identity. Product contract revision 0.4 and local V1 domain/runbook/evidence documentation.

### Verification and boundaries

156 tests passed (123 frontend/domain/store, 33 server/recovery), with lint, strict TypeScript and application/server/tool builds. Browser verification exercised fresh setup, guest/desk booking, arrival, explicit fictional manual checkout, receipt-linked rebooking, derived reporting, unsent drafts and reviewed CSV import; targeted 320px and desktop checks passed. A built-CLI backup/verify/restore drill passed while preserving the active source database. See [candidate evidence](docs/evidence/VERIFICATION_1.0.0-rc.1.md).

Live services, production data, provider reconciliation, assigned-practitioner projections, verified guest management, comprehensive privacy/accessibility and pilot acceptance remain unqualified. Node SQLite experimental and Vite config-loader advisories are recorded. No merge, deployment, message or real payment occurred. Remote CI is a separate review gate.

## 0.2.2 — 2026-10-06 · Appointment changes and calendar continuity

### Changed

- Added confirmed-appointment rescheduling through the existing side panel. Preserve appointment/client/origin IDs, booked duration, turnaround, price and deposit history; revalidate professional and room availability and append old/new allocation history. Conflicts must leave the original visit untouched.
- Added cancellation and operator-recorded missed visits with reasons and retained timeline history. Recorded deposits stay in the ledger for review; no refund, cancellation fee, new sale or message is simulated by these actions.
- Extended calendar date navigation, visibly identify the selected appointment and expose cancelled/missed history separately from active allocation. Terminal successors must not inflate rebooking reporting.
- Kept the appointment heading and close action visible while its body scrolls. Use native radio choices for reschedule times, retaining keyboard operation and return focus when the original appointment leaves the active agenda.
- Corrected the phone client-header grid so identity and actions remain readable, and removed the duplicate empty-day message on phones.
- Adapted inspected Caleane component behavior to SALEANE's existing serif, ivory and sage identity. This does not select a new visual direction.

### Verification and boundaries

**Status: locally verified.** Final `npm run check` passed with zero lint warnings, 72 tests across three files, TypeScript and the combined Vite application/studies build. Tests include the staff-filter move regression. In-app browser checks on an isolated localhost origin exercised UK rescheduling with keyboard radio arrows, cancellation/history and Escape focus fallback, phone missed-visit history, and the linked client timeline. All six routes were checked at measured 320px and 1440px widths with no document overflow or broken rendered images. See [0.2.2 verification](docs/evidence/VERIFICATION_0.2.2.md).

Screenshots were inspected inline. Browser capture crops fixed panels over scrolled underlying pages, so no accurate archived 0.2.2 panel-screenshot claim is made. This is targeted browser evidence, not full accessibility certification. CI on the pushed commit remains unverified here; main and deployment are unchanged.

The app remains a fictional browser-local prototype. Missed attendance is manually recorded against the fixed demo day; the current date guard does not establish that a same-day visit's scheduled time has passed. Production requires authoritative venue time, authenticated actor, policy and audit enforcement. Holds, real refunds/fees, notifications, production authentication and shared database authority remain outside this increment. No merge or deployment is implied.

## 0.2.1 — 2026-10-06 · Source context and original visual direction

### Changed

- Re-read the full visible original conversation, original PRD preview and generated visual board. Added a source/decision ledger and preserved the PRD transcription without claiming unavailable ZIP/workbook bytes were imported.
- Expanded the product contract to revision 0.3, Research v0.2, vision, roadmap and architecture. Added UX architecture with 38 screen contracts, connected journeys, exception states and future feature disposition. Historical pricing ideas remain hypotheses; competitor prices retain source/billing qualifications.
- After the user rejected the first new visual studies, archived them explicitly and rebuilt around the original image: widely tracked serif SALEANE, warm light navigation, quiet operational hierarchy, sage attention surfaces and forest-green actions.
- Added locally bundled Bodoni Moda with OFL notice, generated fictional studio photography and four seed-identity portraits. Branded booking now carries the studio imagery; dates, money and forms retain functional sans-serif text.
- Appointment → checkout → receipt uses a compact right-side panel on desktop and a full-height sheet on phones. Step headings receive focus; Escape restores the initiating control. Other dialogs remain centred.
- Added the revised three-direction study as a production build entry. Studies remain design experiments; the working application owns the connected domain behaviour.

### Verification and boundaries

Local lint, 41 tests and the application build passed. Browser checks covered all six routes at actual 320px and 1440px widths, with no page overflow or broken rendered image elements; visual review also covered mobile booking, appointment and checkout. Detailed evidence and subsequent study/build results are in [the revision verification record](docs/evidence/VERIFICATION_0.2.1.md).

The app remains a browser-local fictional prototype. Reschedule/cancellation, no-preference allocation, production database/authentication, real payments/messages, offline snapshots and Clinical remain specified or future work. The separate server-authority draft is preserved but unverified and not shipped here. No merge or deployment is part of this revision.

## 0.2.0 — 2026-10-06 · Connected foundation

### Added

- Vite + React + TypeScript application with a reproducible lockfile, strict types, lint, Vitest and CI checks.
- Custom Saleane visual tokens/components; locally bundled Manrope and Source Sans 3; Radix headless dialogs; responsive operator and guest layouts.
- Today operating brief, daily professional calendar and agenda, client directory/search/segments, linked relationship timeline and explicit referrals.
- Branded service/time/details/review booking journey feeding the same local calendar and relationships.
- Staff qualification and shared-resource conflict checks, including turnaround time; immutable booked service snapshots.
- Simulated deposit, arrival, checkout with optional tip, retry-safe receipt and linked rebooking commands.
- Business reporting derived from completed service sales; 7/28-day periods, exact chart-data table, tips separately and CSV export.
- Separate fictional UK/GBP and US/USD workspaces with locale/venue clock conventions; versioned browser persistence, preserved-byte recovery, export/reset and sequential stale-tab protection.
- Build-grade PRD, vision, roadmap, architecture, design system, source-backed research and verification ledger.

### Preserved / corrected

- Retained initial Git history and original README text; archived an exact README copy.
- Changed repository visibility from public to private to match the requested source-of-truth boundary.
- Retained canonical SALEANE spelling without an accent. Documented wordmark rationale and font licensing.

### Verification

The current check results, rendered journey evidence, screenshots and limitations are in [docs/evidence/VERIFICATION.md](docs/evidence/VERIFICATION.md). CI status must be checked on the pushed commit; local checks alone do not prove hosted or production acceptance.

### Boundaries

This is a fictional browser-local prototype. No production database/authentication, provider payment or messaging, AI model, clinical capability, inventory, commission/payroll, real tax/refund engine or deployment is included. Fixed demo date is 6 October 2026. The old cloud v0.1 ZIP and assets were referenced but not recovered/imported. Local revision checks are not atomic server concurrency.

## 0.1 — Historical cloud discovery (referenced; not a Git release)

The source conversation reported a research/document pack and clickable HTML prototype in temporary cloud storage. Available product decisions inform 0.2. No unseen files or historical test results are represented as imported or reverified.

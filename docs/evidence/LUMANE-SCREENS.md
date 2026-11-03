# LUMANE's screen parts and installer: evidence

Recorded 11 October 2026 on top of `main` after the LUMANE hardening (#118), in Chromium (Playwright) against the built app (`npm run build`, served on 127.0.0.1:5173) with a fresh local database and a sample studio, the AI in test mode and no Anthropic or OpenAI key set. All names are fictional, and the two apps the installer is tried on, Caleane and Tally, are pretend. Nothing was deployed.

This is stage 2 of the pathways plan and the installer, which the owner approved on 11 October 2026 ("build stage 2 and installer") from the [screens preview](https://claude.ai/artifact/Q7wDYvBgtVTypaQjgcXA88).

## Ask SALEANE looks as it did

SALEANE's Ask panel is now built from LUMANE's parts, dressed in SALEANE's own buttons and stylesheet. The same steps were walked on `main` and on this change one after the other, each with a fresh studio: open the panel, ask "Who's my 2pm?", ask "Remind me to call Amelia tomorrow", approve it, ask "Remind me to call Isabel on Friday" and choose Not now, at 1440 and 390 pixels wide, and again as a studio that can talk (the talk button and voice choice shown).

- [Before and after at 1440 pixels](LUMANE-SCREENS-ask-before-after-1440.jpg) and [at 390 pixels](LUMANE-SCREENS-ask-before-after-390.jpg): main on the left, this change on the right.
- Compared pixel by pixel, the ten pairs differ by 26 to 419 pixels out of 330,000 (phone) or 1.3 million (desktop). Almost all are on the usage line, where the letters of "3 of 300 questions used this month." now sit in one run of text instead of several and so are spaced a fraction of a pixel differently; the rest are the smoothing of a few pixels at the edge of the small sparkle beside "SALEANE". Nothing moved, and nothing is visible to the eye.
- One difference was found and put right during the comparison: the parts at first scrolled the conversation to its end when the panel opened, and did not keep the newest line in view when Approve turned into "Done". Both now behave exactly as before.
- No errors in the console on either build.
- To click through: [Ask SALEANE side by side](https://claude.ai/artifact/HmDG2ViHQEcVo6y7VPLnSN), with all five moments at both widths and the differing pixels marked.

## The parts in two other apps

`lumane/react/panel.test.tsx` uses the parts in two pretend apps with no SALEANE inside them:

- **Tally** (invoices) takes LUMANE's whole panel in the default look: a starter question, an answer with three invoices to chase, Approve, "Done. Saved.", and the usage line moving from 41 to 42 of 300. Talking counts down from 5:00 and hangs up. With plain parts, the panel carries no look at all.
- **Caleane** (a calendar) builds its own panel from the parts, with its own buttons (`cal-btn`) and class names, and approves a moved design review. No default look is applied.

## The install page

Built into one file with `npm run lumane:page` and opened in Chromium at 1440 and 390 pixels:

- [The page at 1440 pixels](LUMANE-SCREENS-install-page-1440.jpg), with the five questions on the left and the live preview of Ask Caleane on the right after "Move the design review to Friday at 2pm". [At 390 pixels](LUMANE-SCREENS-install-page-390.jpg) the preview follows the questions. No sideways scrolling at either width.
- Approve in the preview says "Done. In the app, this is saved now.", since nothing real changes there.
- [The default look in plum, round and dark](LUMANE-SCREENS-default-look-dark.jpg), chosen with its four choices.
- Choosing a fifth pathway and "More", then Write the pack: the page wrote the real `src/lumane.pack.ts`, checked it with `packProblems` ("Checked it: no problems found.") and gave the answers to paste after `/lumane:install` ([written](LUMANE-SCREENS-pack-written.jpg)). It does not claim to have opened a pull request: the coding agent does that.
- To try: [Install LUMANE](https://claude.ai/artifact/7uYTP44M4HSS5ugHMU4Jb2), the same built page.
- Tally, which has no design of its own, is offered the default look first. Typing "Ask Tally" as the name shows "The name goes without “Ask”: LUMANE adds it, so this would be “Ask Ask Tally”." and Write the pack cannot be pressed.

## The coding agent's installer

`/lumane:install` is a Claude Code plugin in `lumane/install/plugin`, listed by the repository's own marketplace file (`.claude-plugin/marketplace.json`). `claude plugin validate ./lumane/install/plugin --strict` and `claude plugin validate ./` both pass. Its instructions ask the same five questions as the page (a test reads them from both), in two rounds because a coding agent's question tool takes four at a time, and keep the rules that never bend: a draft pull request only, never merged or deployed, no keys, and changes that only prepare. `pack-template.md` shows the agent exactly the pack and check this installer writes, and a test keeps it identical to `examples/caleane.pack.ts`.

After a review on 13 October 2026, three things were put right, each with a test. The agent copies into an app only what runs there: every test file and the installer's own page, pretend apps and plugin are left out, and a test walks what is left and finds it imports only React and Zod and reaches nothing left out. The agent offers an app's own design only when it found one, and splits the pathways so no question has more than four options. The install page now hands over the default look's four choices (`Look: default (colour #3949AB; font …; corners soft; scheme dark)`), and the agent builds from them, so what was previewed is what gets built.

The installer has not yet been run by a coding agent on a real second app; that needs one.

## Automated checks

`npm run check` passed: lint, strict TypeScript, the application, server and backup builds, 2,104 application tests and 650 server tests (2 skipped, as before), after bringing in main on 13 October 2026. `npm run format:check` passed.

- `lumane/react/parts.test.tsx`: the approval card shows done only once saved, answers once however fast the taps (a double tap and a Not now while saving reach the app once), goes back to waiting when saving fails and saves on the second try, never shows a Not now as done, and puts its behaviour on the app's own button while keeping the app's class and click. The question box asks the trimmed question and empties, never asks an empty one or while busy, and can be held by the app. The conversation says "You asked" or "You said", keeps the newest line in view on new lines and when a card changes, and not on opening. The talk bar counts down ("Talking · 4:05 left") without interrupting, and Stop and Talk cannot be pressed twice. The usage line and its near and reached states. The default look's colours read clearly on the page and on a waiting change's tint, in light and dark, and a grey that would not read is named.
- `lumane/react/panel.test.tsx`: the two pretend apps above.
- `lumane/install/install.test.ts`: the five questions are the same on the page and in the coding agent; recommended answers make a pack with no problems for both pretend apps; wrong answers are named plainly; the answers survive the trip from the page to the agent; the spending limits match SALEANE's plans for the starter and larger amounts; the written pack is the example file, is the same pack the page checks, and refuses plainly on a pathway not yet connected; a pathway name no AI supplier accepts is caught; the plugin is named so it runs as `/lumane:install`.
- `lumane/install/page/page.test.tsx`: the page opens on the recommended answers in Caleane's colours, the preview follows each choice, an example is answered and its change waits for approval, the pack is written and checked and handed to the coding agent, a pack that is not ready cannot be written, and Tally is offered the default look.
- `lumane/engine.test.ts`: nothing in LUMANE, its parts or its installer imports from SALEANE.
- `src/components/askSaleaneLive.test.tsx`, `askSaleaneTalk.test.tsx`, `askSaleane.test.tsx` and `ReceptionistChat.test.tsx` pass unchanged, including an approval whose answer never came and one the server no longer has.

## Not yet done

- **The installer has not been tried on a real second app.** The page and the plugin are tested with pretend apps; the first real install will show what the instructions miss.
- **Connecting the server is described, not generated.** Step 7 of `/lumane:install` points the agent at SALEANE's own server routes as the worked example; each app's server is different.
- **The guest chat on the booking page is not on the parts yet.** It works as before; moving it is a small follow-up.
- **Open source:** the parts and the pack format could be released under Apache 2.0 once they work in a second real app and the LUMANE name check is done.

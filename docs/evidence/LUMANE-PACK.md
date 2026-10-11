# LUMANE's pack: evidence

Recorded 11 October 2026 in Chromium (Playwright) against the development server (`npm run dev`, 127.0.0.1:5173) in the sample studio, with the AI in test mode and no Anthropic or OpenAI key set. All names are fictional. Nothing was deployed.

This is stage 1 of the LUMANE pathways plan: the engine takes the host app's name, pathways and kinds of use from one checked pack. It changes nothing the assistant may do.

## What was exercised

- **Before and after on real screens:** the same four screens were captured on `main` and on this branch with identical settings (fonts loaded, network settled), and compared pixel by pixel.
  - The Ask SALEANE panel on Today, after typing "Who is in today?": identical. It answers "12 visits on Tuesday 6 October" with each guest, treatment and professional, as before.
  - Settings, AI and voice, scrolled to How your AI speaks: identical.
  - Today at phone width (390px): identical, with no sideways scrolling.
  - The price page: the only change is the three lines that said "Ask Saleane", which now say "Ask SALEANE" like every other screen ([side by side](LUMANE-PACK-price-page.png)).
- **The name everywhere:** on this branch, Plan and billing shows "Ask SALEANE" twice, the change history once, AI and voice four times and the price page three times. "Ask Saleane" appears on none of them.
- **The Ask panel:** [the answer on this branch](LUMANE-PACK-ask-panel.jpg).
- **Console:** no errors across the journey.

## Automated checks

- `lumane/pack.test.ts` installs LUMANE in a pretend calendar app called Caleane, with no SALEANE code in it. It shows that:
  - Caleane is called "Ask Caleane".
  - Its answers go through its own pathways, with its own instructions first and LUMANE's rules after them.
  - Someone who may not edit is never offered the pathway that prepares an event.
  - It counts two kinds of use LUMANE has never heard of, and refuses a question once its questions are used up, before anything reaches the AI.
- The same file checks LUMANE's own rules: they always come last, they stand alone when an app gives none, and they name no business.
- It also checks the pack itself. Each of these comes back as a plain sentence, and a pack that is not ready stops the app as it starts:
  - a missing name, or one that already says "Ask";
  - a kind of use the pack does not name;
  - an audience with nowhere to meet the assistant;
  - a pathway an AI supplier would refuse, or two with the same name;
  - a default voice that is not on the list.
- `src/assistant/pack.test.ts` checks SALEANE's own pack:
  - it is ready, and names the assistant Ask SALEANE;
  - the team gets Ask SALEANE's pathways and guests get the receptionist's;
  - it counts typed questions, talking time and guest chats, with the labels the usage meter shows;
  - a typed question answered through the pack counts as a typed question.
- `lumane/engine.test.ts` and `lumane/live.test.ts` check that LUMANE's rules reach every request and every talk.
- `PlanBilling.test.tsx` and `Pricing.test.tsx` expect "Ask SALEANE".
- `npm run check` passes: lint, every test (1,262 app and 433 server), the type check and the builds.

## Limits

- Proven in test mode only. No request has gone to Claude or OpenAI with the new rules, because no keys are set.
- Stage 2 is not built: screen parts with no fixed look, which any design system can dress, and a default look taken from the host app's own colours and fonts.
- The installer is not built. A preview of its install screen comes first, for the owner's yes.
- Usage already stored is read as before, with a missing kind counted as 0, so there is no migration.
- When PR #103 merges, its phone minutes should be named in SALEANE's pack rather than added to LUMANE.

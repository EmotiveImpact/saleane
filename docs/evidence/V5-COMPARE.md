# V5 · How you compare: evidence

Recorded 9 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database. One UK sample studio and five more UK sample studios were registered. All names are fictional. Nothing was deployed and no figures left this computer.

## What was exercised

- **Not sharing:** Business, "How you compare" reads "This studio does not share. Only studios that share can compare." It lists what would leave the studio (four figures: the average treatment sale and three percentages) and what never does (names, clients, team, receipts, totals or how busy you are).
- **Sharing, too few others:** after "Share anonymously" the page reads "This studio shares anonymously since Tue, 6 Oct." and "Not enough similar studios share yet. A comparison appears once at least 5 do."
- **Five others sharing:** each of the four measures shows the studio's own figure, where most similar studios sit and the middle studio, a tag (Ahead of most, Typical, Behind most) and a small scale. The sample studios all share one fictional record, so each reads "Typical", for example "You: £91. Most similar studios: £91."
- **Phone (390px) and accessibility:** no sideways scrolling; axe (WCAG 2.2 A/AA) finds nothing with sharing off, on, or with the comparison shown; no console errors.

Screenshots: [the page](V5-COMPARE-page.png), [on a phone](V5-COMPARE-390.png).

## Automated checks

`src/domain/benchmark.test.ts` covers: a studio reduced to four rates and averages, or left out with too few visits; nothing shown with fewer than five others; ahead, typical and behind, with fewer missed appointments counted as better; and the labels. `server/benchmark.test.ts` covers: no comparison until the studio shares; four others sharing is too few and returns nothing about them; five shows the comparison; nothing in the response names or counts another studio; a studio that stops sharing drops out at once; US studios never compared with UK ones, and samples never with real studios; only the owner turns sharing on or off; managers read it and the desk is refused.

## Limits

- The measures are taken over the last 90 days from each studio's own records, and a studio needs at least 20 completed visits in that time to count. There is no grouping by size or kind of studio yet, only by market and sample or real.
- With exactly five others, the middle figure is one of those studios' own figures. It is never linked to a name, and stopping sharing removes a studio at once, but an owner should know this before sharing. An anonymisation review is still needed before this is offered to real studios.
- Each comparison reads every sharing studio's record on request, which is fine on one computer and would need a stored summary at scale.

# V1.5 · Gift cards and vouchers: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database and a signed-in sample studio. All names are fictional and every payment is simulated.

## What was exercised

- **Gift cards page (owner, 1280px and 390px):** Business › Gift cards shows the two sample cards (a £75 gift card bought by Olivia James for her sister, and a Skin Renewal Facial voucher worth £95), with what is waiting to be spent, what has been spent at visits and what was sold in total.
- **Sell:** "Sell a gift card" with an amount of £60, a buyer's name, who it is for and a message records a demo payment and shows the card as the guest would see it, with its 12-character code and last day (two years less a day in the UK), ready to read out or print.
- **Spend at checkout:** on Amelia's £95 facial with a £25 deposit, the code typed in lower case with spaces is accepted, the card offers its full £60, and the balance to collect drops to £10. The receipt shows "Paid by gift card" with the code, and the card then reads "Used up" with the visit and receipt in its history.
- **Give more time:** the owner moves the voucher's last day six months later; the history keeps the earlier date and who changed it.
- **Cancel:** the owner cancels the £75 card, returning £75 by demo card; the card reads "Cancelled · £0.00 left" with the refund and reason in its history. A used-up card offers no actions.
- No console errors throughout. The full sweep (`scripts/qualify.mjs`, now including the Gift cards page) reports 111 pages with zero axe violations, no sideways scroll and no missing focus; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [gift cards page](V15-GIFT-page.png), [selling](V15-GIFT-sell.png), [card ready](V15-GIFT-ready.png), [code applied at checkout](V15-GIFT-checkout.png), [receipt](V15-GIFT-receipt.png), [receipt in Money](V15-GIFT-money-receipt.png), [history](V15-GIFT-history.png), [cancelled with refund](V15-GIFT-cancelled.png), [page at 390px](V15-GIFT-390.png).

## Automated checks

`src/domain/giftCards.test.ts` covers: selling a gift card with a valid code that lasts two years in the UK and five in the US; a voucher taking its treatment's price on the day it is sold; refusing a voucher with no treatment and a card with no amount; codes that differ and are found when typed loosely; part of a visit paid by a card with the rest paid as usual; refusing more than the card holds or more than is due; an expired card refused until a manager gives more time; cancelling with a refund no larger than what is left, and a demo reference given in the sample studio; cash sold and returned counted in the till; a receipt refund unable to return the part a card paid; the front desk able to sell while only owners and managers extend or cancel; the seller's name on the card; a ledger where a card and its receipt disagree rejected; and cards in the buyer's own data export. The server suite (`npm test`) still passes with sample cards in every new sample studio.

## Limits

- When the studio takes cards through SALEANE, a saved card or card reader is charged only what the gift card leaves (`server/payments.test.ts`, test provider only). Cards are sold and spent at the desk. Guests cannot buy one online yet; that needs a card provider, which stays in test mode.
- A card can pay for any visit. A voucher names a treatment and holds its price on the day it was sold, so if the price rises the guest pays the difference.
- Money on a card counts as takings only when it pays for a visit. A refund on a receipt returns only what was paid at the desk, not the card's share, and the card's share does not go back onto the card.
- SALEANE records payments and refunds for cards; it does not take or return money itself.
- Nothing is deleted. A card ends by being used up, expiring or being cancelled, and its history stays.
- Safari and Firefox were not checked.

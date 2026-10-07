# V2 · Walk-in product sales and returns: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All names and amounts are fictional.

## What was exercised

- **Selling without a visit:** on Business, Stock, "Sell without a visit" with two Daily Mineral SPF 30 (£28 each) for Grace Chen, paid by demo cash. The dialog showed £56.00 to collect. Saving recorded receipt SC-2 with the note that no money moved in the demo.
- **Giving money back:** "Give money back" on SC-2, £28 back with one SPF put back on the shelf, a reference and a reason. The dialog says up to £56.00 can be given back.
- **Stock afterwards:** Daily Mineral SPF 30 at 10 on the shelf (12 delivered, 1 sold with a visit, 2 sold at the counter, 1 brought back). Recent changes shows "Sold" against SC-2 and "Brought back" against the refund.
- **Money:** the day's receipts include "Products without a visit · Daily Mineral SPF 30 · Simulated cash · SC-2", £56.00 with £28.00 refunded.
- No console errors on any of the above.

Screenshots: [sell](V2-WALKIN-sell.png), [give money back](V2-WALKIN-return.png), [Stock after](V2-WALKIN-stock.png), [Money](V2-WALKIN-money.png).

## Automated checks

`src/domain/retail.test.ts` adds: a walk-in sale taking stock, counting in the till and in Business, and appearing on the client timeline and in their data export; refusing a card through SALEANE, an empty basket and more than is in stock; reception selling without a visit but not giving money back; a walk-in refund putting a product back once even when repeated, and refusing more back than was sold or more money than was paid; a visit refund putting products back; the ledger rejecting a returned product that is not tied to a real refund.

## Limits

- Walk-in sales are paid outside SALEANE (cash or the studio's own terminal); SALEANE cannot charge a card for them yet.
- A card refund made through SALEANE does not yet put products back on the shelf; an owner or manager corrects the count.
- The privacy erasure review does not list walk-in sales yet.
- No discounts on products. One location.
- Safari and Firefox were not checked.

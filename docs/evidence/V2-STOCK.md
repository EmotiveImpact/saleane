# V2 · Stock and products at the till: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All names and amounts are fictional.

## What was exercised

- **Business, Stock:** the demo shelf of seven products (five for sale, two only used in treatments) with what is in stock, reorder levels, value at cost and the September delivery, use in treatments and two earlier sales in Recent changes. Enzyme Peel shows as running low.
- **Correcting a count:** Calming Cleansing Balm counted at 8 against 10 on record. The form says "This records 2 fewer than the records show"; saving moved the count to 8 and its value at cost to £96.00.
- **Adding a product:** the form for name, sold at the till or not, price, cost, reorder level and code.
- **Checkout:** Amelia Carter's facial (£95, £25 deposit) with a Hydrating Serum (£48) added: £118.00 to collect, and the receipt lists the serum. In an earlier run with two serums and a Cleansing Balm the total was £198.00 (95 + 96 + 32 − 25); the quantity buttons stop at what is in stock. Stock then showed each product down by what was sold, marked "Sold" against the receipt number with Amelia's name.
- The Stock page at 390px: totals two by two, no sideways scroll.
- No console errors on any of the above. The full sweep (`scripts/qualify.mjs`, now including Stock) reports 105 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [Stock](V2-STOCK-page.png), [count](V2-STOCK-count.png), [add a product](V2-STOCK-add.png), [checkout](V2-STOCK-checkout.png), [receipt](V2-STOCK-receipt.png), [Stock at 390px](V2-STOCK-390.png).

## Automated checks

`src/domain/retail.test.ts` covers: products on the receipt and out of stock against it; service revenue unchanged and product takings separate; cash for the day including products; a repeated checkout taking stock once; the receipt keeping the price after a catalogue change; refusing more than is in stock, treatment-only products, archived products and the same product twice, leaving the visit and stock untouched; included VAT on products from today's tax setting; US sales tax added on top; a plan paying for the visit while the guest pays for products; the ledger rejecting a receipt whose products do not match the stock that left, a changed subtotal and a stray stock sale; both demo studios consistent; stock figures, reorder flags and value at cost; units and takings per product; the Business figure; reception selling but not changing stock; the seller named on the stock record; products in the client's export. `server/payments.test.ts` charges a saved card for a visit with products, refuses more than is in stock before charging, and takes the stock out once.

## Limits

- One location. Stock per location comes with several locations.
- Products are sold with a visit. Selling to someone who walks in without a visit, and returning a product to stock with its refund, come next. Until then a refund on a receipt with products does not put them back on the shelf; an owner or manager corrects the count.
- No discounts on products yet.
- Purchase orders and suppliers are not tracked; a delivery is recorded as a count and a note.
- Safari and Firefox were not checked.

## With gift cards (added 7 October 2026, after merging gift cards from main)

In the browser demo studio, Amelia Carter's £95 facial (£25 deposit already recorded) had a £32 Calming Cleansing Balm added and gift card SAGE-9P3T-XW5C applied for £95. The checkout showed £7.00 to collect. The receipt listed the facial, the balm, the deposit, "Paid by gift card SAGE-9P3T-XW5C −£95.00" and £7.00 collected. A gift card can pay for products as well as the visit. `src/domain/giftCards.test.ts` checks that a card pays exactly the £127 for a visit and product, and refuses a penny more. Screenshot: [products and a gift card](V2-STOCK-giftcard.png).

The card checkout's products column is now database migration 9, because gift cards took 8.

# V2 · Reordering from suppliers: evidence

Recorded 7 October 2026 in Chromium (Playwright) against the built app (`npm run build && npm start`) with a fresh local database, in the browser demo studio (Atelier House, London). All suppliers, names and numbers are fictional; the phone number is in a range reserved for drama.

## What was exercised

- **Business, Stock, Orders from suppliers:** Studio Pro Wholesale is suggested for Enzyme Peel (1 left, order 2). PO-1 for 6 Restorative Hair Masks is on order from 2 October, so the hair mask is not suggested again. Two suppliers are listed with their contact details.
- **Preparing an order:** "Prepare order" filled in 2 Enzyme Peels and showed the order in words ("Order PO-2 from Atelier House, For Studio Pro Wholesale, 2 × Enzyme Peel, professional size (ENZYME-PEEL)"). With "I have placed this order with the supplier" ticked, it was recorded: "Order PO-2 recorded as placed. Say when it arrives."
- **Copying an order:** "Copy" put PO-1 on the clipboard in the same words.
- **A delivery:** "It arrived" on PO-1 with 5 of the 6 hair masks. The page said "Order PO-1 arrived. 5 items are on the shelf." and the hair mask went from 7 to 12 in stock.
- Stock at 390px has no sideways scroll. No console errors on any of the above.
- The full sweep (`scripts/qualify.mjs`) reports 117 pages with zero violations and no sideways scroll; the only console errors are the expected 401s on the signed-out demo account page.

Screenshots: [orders section](V2-ORDERS-panel.png), [preparing an order](V2-ORDERS-prepare.png), [a delivery](V2-ORDERS-arrived.png), [Stock afterwards](V2-ORDERS-stock.png).

## Automated checks

`src/domain/purchasing.test.ts`: suggestions by supplier with the usual quantity; recording an order, no longer suggesting it, its words, receiving part of it once with who did it; cancelling without touching stock and not twice; refusing an unknown supplier, a duplicate supplier name, a delivery of nothing and a delivery of a product not ordered; only owners and managers ordering; both demo studios having an open order; the ledger rejecting a delivery that does not match what arrived and a product naming a missing supplier.

## Limits

- SALEANE does not email or send orders. The studio places them and records them here.
- An order is received once. A late second box goes on a new order or as a plain delivery.
- Order costs and supplier invoices are not tracked; stock value still uses each product's cost price.
- One location.
- Safari and Firefox were not checked.

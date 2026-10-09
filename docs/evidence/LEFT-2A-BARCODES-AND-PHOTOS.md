# LEFT-2A · Barcodes, scanning and product photos

Built 9 October 2026 in a worktree, on top of main at `016f3ca`. Everything below was checked with unit, component and server tests, then in a browser (see Seen in a browser).

## What it does

- **Barcodes.** Each product can have one optional barcode, set in the product form. EAN-13, EAN-8 and UPC-A are checked by their check digit, with a plain message when it is wrong ("EAN-13 barcodes end in a check digit. For this one it should be 0, not 1. Check the number on the product."). Any other code of 4 to 40 letters and digits is accepted as it is. Codes are kept in one normal form (spaces removed, capitals), and a 12-digit UPC-A finds the same product as the 13-digit EAN with a leading 0. The product command on the server refuses a barcode another product holds and names it: "Hydrating Serum already has barcode 2000000000022. Each barcode belongs to one product." The studio record is also checked as a whole, so two products can never share one.
- **Scanning with a USB or Bluetooth scanner.** One shared hook (`src/components/barcodeScan.ts`) recognises a scanner by its burst: at least 4 characters, each no more than 50 ms after the last, ending in Enter. Slower typing and its Enter are left alone. A burst that lands in another field is taken back out of that field, and its Enter never presses a button or sends a form. The newest screen on view takes the scan, and a screen under an open dialog waits.
- **Where scanning works.** Each place shows a "Scan or type a barcode" field, so a code can also be typed by hand:
  - Checkout at a visit and Sell without a visit: a scan adds the product, or one more of it ("Added Hydrating Serum.", "One more Hydrating Serum: 2 on this receipt."). A product that is out of stock gets the till's own words ("Olive Oil Soap is out of stock. Record the delivery in Stock first."), and one only used in treatments is named ("Massage Oil, 1 litre is used in treatments, so it is not sold at the till.").
  - Stock: a scan finds the product. Owners and managers have it opened in the product form; everyone else has it shown and highlighted in the list with its count.
  - Product form: a scan anywhere in the form puts the code in its Barcode field.
  - Delivery, Used, Count and Move: each scan of that product adds one ("2 counted."). Another product is named: "That is Hydrating Serum. This is for Calming Cleansing Balm."
  - Supplier order, new order: a scan puts the product on the order, or one more.
  - Supplier order arrived: the first scan starts from zero every count still showing the amount ordered (a count changed by hand stays), then each scan adds one. A product not on the order is named.
- **An unknown code** says "No product has barcode 5012345678900." Owners and managers also get "Add it to a product": they choose one of the products without a barcode and save it there, or go on to add a new product with that barcode already filled in.
- **Scanning with the camera.** Where the browser has `BarcodeDetector` and a camera, a "Scan with camera" button appears beside the field. Nothing appears where it is not supported. The camera is asked for only when the button is pressed, uses the rear camera, shows a calm framed view, and stops the moment a code is read or the view is closed.
- **Product photos.** The product form takes a photo from the device, or straight from the camera on a phone or tablet. The browser turns it the right way up, shrinks it to 800 pixels on the longer side and compresses it (WebP, or JPEG where WebP is not possible) to under 300 KB. The server reads what the bytes really are (JPEG, PNG or WebP only, never SVG), refuses anything over 400 KB or over 2000 pixels on a side, checks the person may edit products, and keeps it in the new `images` table. The product keeps the photo's id. A photo can be replaced or removed, and that is saved with the product.
- **Where photos show.** The product tile shows the photo, cropped square with soft corners and loaded lazily, or the product's letter until it has one. It is used in the Stock list, the product picker and lines at checkout, and Sell without a visit. Photos are small thumbnails that identify the product, never decoration.

## Who can do what

| Role             | Scan to find or add                                                                                                                                                                  | Add a code to a product                 | Add or change a photo | See photos                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| Owner, manager   | Everywhere above                                                                                                                                                                     | Yes                                     | Yes                   | Yes                                                                  |
| Reception        | Checkout, Sell without a visit, and Stock (a scan finds and highlights the product). Their role records no deliveries, counts or supplier orders, so those have no scanning for them | No                                      | No                    | Yes                                                                  |
| General manager  | Checkout, Sell without a visit, Stock (find), Delivery, Used, Count, Move and supplier orders, at their own location as today                                                        | No (products are studio-wide, as today) | No                    | Yes, while their location is open                                    |
| Practitioner     | No checkout or stock recording; on Stock, where their view shows products, a scan only finds one                                                                                     | No                                      | No                    | No: the server refuses, and the tile keeps the letter without asking |
| Regional manager | Their area view has no product screens                                                                                                                                               | No                                      | No                    | No (refused by the server)                                           |
| Guest            | Never                                                                                                                                                                                | No                                      | No                    | No                                                                   |

## Server

- Migration **30**: `images` (id, organisation, kind, content type, bytes, width, height, created time, created by), each bounded by CHECK constraints, and an index by studio and time.
- `POST /api/workspaces/:orgId/images`: session, request token and the studio's own address as on every write; a body of `image/jpeg`, `image/png` or `image/webp` only, read up to 400 KB; the route's own rate limit of 30 a minute. Photos added but never kept on a product are cleared away after a day, and a studio keeps at most 1000.
- `GET /api/workspaces/:orgId/images/:imageId`: signed-in members of that studio with a studio role only (owner, manager, reception, general manager whose location is open). The photo is looked up by id and studio together, so another studio's id is "not found". Headers: the stored content type, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=31536000, immutable` (a new photo always gets a new id), a `sandbox` content security policy and `Cross-Origin-Resource-Policy: same-origin`. Photo reads have their own rate allowance so a page of thumbnails never uses up the one for saving work.
- A product command naming a new photo is refused unless the photo is this studio's own ("That photo could not be found. Add it again.").
- The page's content security policy already allows `img-src 'self' data:`, so no change was needed. Backups copy the `images` table with everything else; a test restores one and reads the photo back.

## Tests

- `src/domain/barcode.test.ts` (15): check digits for EAN-13, EAN-8 and UPC-A; kinds; the wrong-digit message; length and character refusals; normal form; UPC-A and EAN-13 as one code; the product command storing the normal form, refusing a duplicate by name (also across UPC-A and EAN-13, and "(no longer stocked)" for an archived holder), keeping or clearing its own code; the studio record refusing a shared code; the sample barcodes.
- `src/components/barcodeScan.test.tsx` (12): a fast burst ending in Enter is a scan, slow typing is not, Enter must come at scanner speed, at least 4 characters, only the burst after someone was typing, Shift for capitals, held keys, shortcuts, input methods and arrow keys break a burst; on a screen the field it landed in is put back, a scanner's Enter does not send a form, slow typing and its Enter reach the form as before, a `data-scan-field` handles its own code, and the newest screen takes the scan unless hidden under a dialog.
- `src/components/ScanField.test.tsx` (8, whole app in the browser sample): **scanning adds a product at a walk-in sale**, and one more on a second scan; after an unknown code the next scan replaces it in the field rather than running on from it; a scan while another field has focus adds the product and leaves that field as it was, and the sale is then recorded; unknown code, wrong check digit and a treatment-only product, each in plain words; on Stock a scan opens the product; in the product form a scan fills the barcode, keeps the name as typed and opens the fold; each scan in a count adds one and another product is refused; a supplier order counts each scan from zero and names a product not on the order.
- `src/components/CameraScan.test.tsx` (5): no button without `BarcodeDetector`; the camera is asked for only on press, with the rear camera, and stops once a code is read; it stops when the view is closed; a refused camera is explained; photos are shrunk to 800 pixels and never enlarged.
- `server/images.test.ts` (13): JPEG, PNG and WebP read from their bytes, SVG, GIF, HTML and truncated files refused; owner upload and the served headers; type decided by the first bytes (SVG sent as PNG or JPEG refused, a JPEG sent as PNG stored as JPEG); over 400 KB (also with a false length) and over 2000 pixels refused, exactly 400 KB accepted, an empty body refused; request token and address; managers may add, reception may only view, practitioners neither; general managers view but cannot add; another studio's photo is "not found" to read and refused to attach; unused photos cleared after a day; barcode duplicates, wrong digits and the normal form through the command route; reception cannot change a barcode; backup and restore keep the photo.

## Checks

- `npm run lint`, `npx tsc -b`, `npm run format:check` and `npm run build`: pass.
- Server suite: 327 passed, 2 skipped (unchanged skips).
- Front-end suite: 993 passed on the final run, after every change here. On earlier runs, while other builds loaded the machine (load average about 9), one or two untouched tests failed on timing: `dateFields.test.tsx` (staff hours), `interaction.test.tsx` (client note) and `remote.test.tsx` (stale revision). Each passed when run again on its own, and none touches products or scanning. They were not rerun on a separate clean checkout of main, because this worktree is isolated.
- The scanning tests hold the keyboard clock still during a burst, so a busy machine cannot slow a test scanner down; the slow-typing test uses real time.
- Stage 2 joined together with Stage 1, after the browser pass and its fixes: lint, types, format and build pass; front end 135 files, 1,188 tests passed; server 53 files, 401 passed and 2 skipped.

## Decisions

- **A scanner can type anywhere on a screen.** The burst is recognised wherever focus is, and the field it landed in is put back. Fields meant for scanning (the scan field, the product form's Barcode field and the gift card code at checkout) handle their own Enter instead, so a scanned voucher code still goes into the gift card field.
- **Till Count is the cash drawer**, so "stock counts" means the Count dialog on Stock. Receipts, printing, the cash drawer, refunds, memberships, guest pages, messages and the client page are untouched.
- **No product CSV export or import exists**, and the accountant exports show products only as totals, so neither needed a barcode.
- **Sample barcodes** are fictional in-store codes in the GS1 range starting 20, which is never a real product's: 2000000000015 (balm), 0022 (serum), 0039 (SPF), 0046 (hair mask), 0053 (body oil), 0060 (massage oil), 0077 (enzyme peel).
- **The browser demo** answers SALEANE's addresses inside the page, so it now passes a photo's bytes to the in-page server and shows photos from what it returns (`window.saleaneDemoImage`). The browser-only sample keeps letter tiles and has no photo field.
- **General managers** cannot edit products (products are studio-wide), so they cannot add codes or photos, as before.

## Quality bar

- **One main job and one primary button.** Every scan field's button (Add, Find, Add one) is secondary; the dialogs keep their own single primary (Record the sale, Save, Put it on the shelf). "Save the barcode" under an unknown code is secondary too, so it never competes with the sale.
- **Rarely used options tucked away.** The product form's Barcode, Code or SKU, Supplier and Usually order sit in a fold, "Barcode, code and supplier", whose line shows what they hold. It opens by itself when a scan arrives or a save is refused. `MoreOptions` is not on main yet (PR #83), so this is a native `<details>` styled like the password fold in Settings; it can move to `MoreOptions` when that merges.
- **No card inside a card.** The scan field, its notes and "Add it to a product" use space and a hairline; the earlier boxed panel was removed. The photo field in the product form has no box.
- **Photographs.** Product photos are not atmospheric photographs: they are small, consistent square thumbnails (36 to 44 pixels in lists, 80 in the product form to judge the crop) that identify the product. No new house photograph was added.
- **Empty pages.** No new page can be empty: the scan fields sit inside existing panels and dialogs.
- **Loading.** `LoadingShapes` is not on main yet. A photo shows the product's letter on its tile colour until it loads, never a blank. The camera view says "Starting the camera…" inside its frame, and the photo field says "Preparing the photo…" then "Adding the photo…" beside the tile while Save waits. These can move to `LoadingShapes` after PR #83.
- **Motion.** `--motion-calm` is not on main yet, so this change adds no new motion: the found row's tint and the camera view appear without a transition, and scrolling to a found row is instant with reduced motion.
- **390 px.** The scan row wraps, with the field on its own line and the buttons sharing the next at full width; buttons and fields are at least 44 px, links in scan notes become 44 px targets on phones, long codes wrap instead of scrolling sideways, and the photo field stacks the tile above full-width buttons. Dialog primary buttons stay at their foot, where they were. Seen in a browser: Stock, Settings and Money are 390 px wide with nothing scrolling sideways, and Sell without a visit wraps as described.
- **Words.** Plain British English with no exclamation marks and no dashes, saying what happens next: "Photo ready. Save the product to keep it." Errors keep what was typed.
- **Built from the library.** Tokens and components from `src/design` only (Button, Modal), no new raw colours except the white frame and dimmed surround of the camera view over live video, no left-edge stripes (the edges test passes), and nothing claims a payment or a message.
- **Before and after pictures**: taken in a browser at 1440 and 390 px (see Seen in a browser).

## Limits and notes

- **Migration number.** This part was built as 28. Main took 26 to 28 and Stage 1 took 29 while it waited, so it is 30, after them, and the migrations run 1 to 31 without a gap again. A local database that ran this part as 28 must be started afresh.
- Photos are cached privately by the browser for a year (each new photo has a new id). After signing out, someone using the same browser profile could still open a cached photo if they knew its address. Product photos are not personal data, so this was accepted.
- In the browser demo, photos are saved with the demo database in the browser's local storage, which holds a few megabytes, so after about ten photos the demo stops saving between visits (it keeps working until the tab closes). The demo was not built here (its dependencies are not installed); `demo/server.ts` was type-checked on its own.
- Camera scanning depends on `BarcodeDetector`, which Chrome on Android and Safari on recent iPhones and iPads offer and most desktop browsers do not.

## Seen in a browser

Checked on 9 October 2026 in Chromium against the local server, signed up as a new owner with the sample studio, at 1440 px and 390 px, with scans sent as above. Before and after pictures are on the Stage 2 before and after page.

- Stock: a scan with focus on the page opens "Edit Hydrating Serum"; the list shows each barcode.
- Add a product: a scan with focus in Name keeps the name, opens the fold and fills the barcode. A 1 MB photo became "Photo ready. Save the product to keep it." and the saved product shows it in the list; after its first delivery it sells like any other.
- Sell without a visit: two scans of the serum, one of the new product, a treatment-only product refused in words, an unknown code offered "Add it to a product"; the sale recorded and its receipt printed on the test printer.
- Count: three scans read "3 counted."; another product's scan was refused by name.
- Checkout at a visit: a scan added Calming Cleansing Balm to the visit's products.
- 390 px: the scan rows wrap with nothing scrolling sideways (page width 390 on Stock, Settings and Money).

Found and fixed in this pass:

- After an unknown code, the next scan ran on from the code left in the field. The code now stays selected, so the next scan or typing replaces it.
- A product only used in treatments was refused as "Choose products that are on sale here.", which did not say which product the code was. It is now named.
- A scan typed while the page or a side panel's heading held focus drew a focus ring round it, because a scanner is a keyboard. Those two never take Tab and hold focus only to keep a reader's place, so they no longer show the ring.

## Browser steps for the lead

Simulate a scanner by sending each key with its own time stamp, a few milliseconds apart, as the operating system does for a real scanner. Playwright's `keyboard.type` is not a scanner: in the development server its keys land about 100 ms apart whatever `delay` says, so SALEANE rightly treats them as typing. With the Chrome DevTools Protocol:

```ts
const cdp = await page.context().newCDPSession(page)
let time = Date.now() / 1000
for (const key of [...'2000000000022', 'Enter']) {
  const enter = key === 'Enter'
  const base = { key, code: enter ? 'Enter' : `Digit${key}`, timestamp: (time += 0.008) }
  await cdp.send('Input.dispatchKeyEvent', {
    ...base,
    type: 'keyDown',
    text: enter ? '\r' : key,
    windowsVirtualKeyCode: enter ? 13 : key.charCodeAt(0),
  })
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
}
```

Typing the same at a person's pace (100 ms or more between keys) must not be treated as a scan.

1. Stock (owner, sample studio): the list shows "barcode 2000000000022" under Hydrating Serum. Scan 2000000000022 with focus on the page: "Edit Hydrating Serum" opens. Open "Barcode, code and supplier" to see the code.
2. Stock as reception: the same scan highlights the serum's row and says how many are in stock.
3. Add a product: type a name, scan 5012345678900 with focus in the name: the name stays, the fold opens with the barcode. Choose a photo (any JPEG over 1 MB): "Photo ready. Save the product to keep it."; save; the tile shows the photo in the list. Replace it, then remove it.
4. Sell without a visit: scan 2000000000022 twice ("One more Hydrating Serum: 2 on this receipt."), scan 2000000000060 (treatment only: "Massage Oil, 1 litre is used in treatments, so it is not sold at the till."), scan 5012345678900 ("No product has barcode 5012345678900." with "Add it to a product"), then record the sale.
5. Checkout at a visit: scan 2000000000015; type a gift card code in its field and press Enter, which still applies the code.
6. Count on Calming Cleansing Balm: scan 2000000000015 three times ("3 counted."), scan 2000000000022 (refused by name), Save.
7. Order PO-1 arrived: scan 2000000000046 twice: the count reads 2.
8. Phone (390 px, or a real phone): the scan rows wrap with nothing scrolling sideways; on a phone with `BarcodeDetector`, "Scan with camera" appears, asks for the camera only when pressed, reads a printed EAN-13 and turns the camera off.
9. Signed in to a second studio, open the first studio's photo address: 404. As a practitioner, product tiles show letters and no photo requests are made.
10. Back up and restore the local database, then confirm the photo still shows. In the browser demo, add a photo and see it in the list.

Screens to capture before and after, at 1440 and 390 px: the Stock list with barcodes and a photo; the product form with the photo and the open fold; Sell without a visit after two scans; checkout products after a scan; the Count dialog after scans; order arrival after scans; an unknown code with "Add it to a product"; the camera view on a phone.

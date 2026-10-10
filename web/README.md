# SALEANE website

The public homepage a salon or studio owner lands on. It is plain HTML and CSS with no build step, separate from the app in `src/`.

- `index.html` is the page, `styles.css` its look and `site.js` its two switches (studio or guest screen, UK or US prices). `images/` holds the house photographs, copied from `public/images/library` and resized to WebP.
- Fonts load from Google Fonts: Newsreader for headings, standing in for Financier Display Light, and Figtree for text.
- Open `index.html` in a browser to see it. Nothing here is deployed; hosting is parked.
- Prices and the 14-day trial match `src/domain/pricing.ts`: £49 a month per location covering five people who take bookings, then £9 each; Plus £39; phone receptionist £79. The US Plus ($49) and phone ($99) prices are placeholders until they are set in `pricing.ts`.

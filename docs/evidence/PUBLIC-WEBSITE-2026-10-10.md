# Public editorial website

**10 October 2026 · Review PR, not a live launch**

The public route at / now presents SALEANE as the operating system for independent beauty, spa and wellness studios, using the uploaded ISO Meet screenshot for **layout direction** rather than its content, logo, photography or marketplace claims.

The website uses **existing committed studio photographs** under public/images/library/, locally served Figtree and Newsreader, and the established warm ivory, forest green, sage, stone and dusty rose design language. No remote stock photographs or additional packages are required.

## Real paths

- Public site: /
- Sample studio: /today (subject to the established session/landing rules)
- Local account and studio setup: /account
- Real published pricing: /pricing
- Design reference library: /design-language

The site deliberately has no fake waitlist or username reservation. The pricing card mirrors the current UK £49 / US $59 per location plan and labels the local private review and unconfigured live providers. Examples inside the decorative UI are explicitly illustrative fictional details, not claims of real bookings or transactions.

## Review checklist

- Desktop layout: header, split hero and image selector, three benefit cards, practitioner chips, product previews, editorial story, pricing/FAQs, final CTA and footer.
- Mobile layout: collapsible nav, stacked hero/cards, readable floating panels, touch targets and absence of sideways overflow.
- Keyboard: skip link, navigation, photo controls, toggles, FAQ details and footer links.
- Screen readers: labelled selectors, meaningful photographic alt text, decorative imagery ignored.
- Check: npm run check, npm run format:check; then browser check the home route at 1440 px, 768 px, 390 px and 320 px.

**Verification state:** Source code and component tests prepared for repository CI. The original application's dependency checkout is unavailable in this execution container; this report does not claim a local full-suite or browser pass. Check CI and Vercel separately before merge. **No deployment, provider or server changes.**

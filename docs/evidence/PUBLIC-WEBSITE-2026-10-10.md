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

**Verification state:** GitHub Actions completed a full lint/format/test/build run on the formatted site code and Chromium rendering reviews on desktop and mobile. Review final-head CI and interactive journeys before merge. **No deployment, provider or server changes.**

## Observed verification, 10 October 2026

- **CI:** the normal GitHub Saleane checks workflow passed lint, format, frontend/server tests and TypeScript/application/server builds on formatted website commit a02bde0, run [38026216415](https://github.com/EmotiveImpact/saleane/actions/runs/38026216415). Final-head CI should still be checked before merge.
- **Browser rendering:** [38026357808](https://github.com/EmotiveImpact/saleane/actions/runs/38026357808) successfully built the Vite site and captured Chromium at 1440 x 1000 and 390 x 900. Full-page captures at 1440 x 5800 and 390 x 7600 succeeded in [38026458029](https://github.com/EmotiveImpact/saleane/actions/runs/38026458029), with downloadable screenshot artifacts. Screenshots were inspected: photography loads, layout stacks correctly on mobile and major sections retain hierarchy. This is rendering evidence, not full interactive or accessibility validation.
- **Next:** check final-head CI, test keyboard interactions and the account/sample-studio navigation in a browser, review 320px layout before publishing. No live deployment has occurred.

# Browser demo

A single HTML file that runs the whole of SALEANE inside one browser tab, for sharing a click-through
without hosting anything. It uses the real app (`src/`) and the real server code (`server/app.ts`).
Small stand-ins in `shims/` replace the Node pieces the server needs: SQLite comes from sql.js (pure
JavaScript), and `/api/*` requests are answered in the page instead of over the network.

```sh
npm run demo:build   # writes demo/dist/saleane-demo.html
```

What it does:

- Opens signed in as the owner of two fictional studios. London runs as a real studio in test mode
  (card payments, deposits and messages, nothing charged or sent), moved to today's date and without
  the sample's payment history. New York stays a sample studio with simulated payments.
- Adds a sample package and membership to each studio, each held by one client.
- Adds eight sample ratings from recent completed visits to each studio, for Business > Feedback.
- Keeps whole-page moves, such as to the test payment page and back, inside the demo page.
- Saves changes in that browser only. "Start the demo again" in the Demo note clears them.
- Lets the sample studios produce test-mode confirmations and reminders (never sent), which the real
  server skips for samples, so the Inbox and client pages show them.
- Rewrites links the server writes, such as a guest's manage link, to point into the demo page.

What it is not:

- Not a deployment, and not secure: passwords use a simple SHA-256 stand-in instead of scrypt.
- Use fictional details only. Nothing is emailed or charged, exactly as in the local build.

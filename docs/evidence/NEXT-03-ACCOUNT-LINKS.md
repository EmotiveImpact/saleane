# NEXT-03 · Forgotten password and email confirmation

Recorded 9 October 2026 on a local build (Chromium, 127.0.0.1:5173, empty studio, email in test mode). Nothing was sent; the links were read from the server log.

## Server tests (`server/accountMail.test.ts`, 16 tests, and the restore test in `server/backup.test.ts`)

- The forgot answer is identical for an address with and without an account, and only the real account gets an email.
- Test-mode emails are recorded as `test`; a provider refusal is recorded as `failed`.
- A reset link sets the new password, signs out the old session (401 afterwards), refuses the old password, and fails the second time.
- A reset link fails after an hour, after a newer link is made, and after the account email changes. Short passwords and made-up links are refused.
- Registration sends a confirmation link; the session reports `emailConfirmed` false, then true after the link; the link works once.
- Resend retires the earlier link and sends nothing once confirmed. A password reset also confirms the address. A confirmation link fails after seven days.
- The forgot answer arrives while the email service is still holding the email.
- On a server whose address is not this computer, the answer says the link is not in the log (`linkInLog: false`).
- Six requests in an hour send five emails, with the same answer each time; an hour later another goes. A sixth confirmation link in an hour is refused with a plain message.
- Two requests with the same reset link at once: exactly one succeeds.
- Restoring a backup retires the open confirmation link.

## Browser journey

1. Signed in after creating an account, the studios page asks to confirm the address. "Send a new link" says email is not connected, nothing was sent, and the link is in the server log.
2. Opening that link in another browser shows "Your email is confirmed."; opening it again says it has already been used. The reminder is gone after a reload.
3. Signed out, "Forgotten your password?" shows the email form, then the honest not-sent note.
4. The reset link refuses two different passwords with a plain message, then saves, signs in and says other devices were signed out. The first browser's session then answers 401.
5. At 390 px wide the reset page has no sideways scroll.

axe (WCAG 2.2 AA tags) found nothing on the reminder, confirmed, forgot and reset screens. The only console errors were the expected 400 for the reused link and the 401 session check while signed out.

## Not covered

No real email provider was used, so delivery, spam placement and the email's appearance in a mail app are unverified. Safari and Firefox were not checked.

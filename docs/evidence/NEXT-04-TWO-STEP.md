# NEXT-04 · Two-step sign-in

Recorded 9 October 2026 on a local build (Chromium, 127.0.0.1:5173, empty studio, email in test mode). Codes were worked out by the test script from the key shown on the page, as an authenticator app would.

## Server tests (`server/twoStep.test.ts`, 14 tests)

- Codes match the six published RFC 6238 SHA-1 examples (as six digits), and the key survives base32 both ways.
- A code is accepted one step either side of now, never two steps out, and never for a step already used.
- Turning on needs a right code; it returns ten distinct recovery codes, stored only as hashes, and the session then reports when it was turned on and how many codes are left. The inbox is told.
- Turning on signs out another session and keeps this one. A key left more than half an hour is refused.
- The owner's team list says who has it on and holds nothing about keys or codes.
- After the password, no cookie is set until the code is right; the same code cannot open a second session; a used sign-in step cannot be reused.
- Five wrong codes, or five minutes, end the sign-in step (410).
- A recovery code works once, typed in capitals with a space, and the inbox is told.
- A password reset from the email saves the new password, signs everyone out and still asks for the code; a sign-in started with the old password and waiting for its code can no longer finish. A password change does the same.
- Restoring a backup retires the recovery codes it brings back (`server/backup.test.ts`).
- Turning off needs the right password and a right code; new recovery codes need the password, and the old ones stop working.

## Browser journey

1. Settings, Team: "Set up two-step sign-in" shows the QR code and the key. The QR code from the screenshot decodes (OpenCV) to `otpauth://totp/SALEANE%3Aada%40example.invalid?secret=…&issuer=SALEANE&algorithm=SHA1&digits=6&period=30`, matching the key on the page.
2. A wrong code gives a plain message; the right one shows ten recovery codes with copy and download. The owner's row then says "Two-step sign-in on".
3. In a second browser, the password leads to "One more step." with the focus in the code field; a wrong code is refused, the next code signs in and opens Today.
4. At 390 px wide, "Lost your phone? Use a recovery code" takes a code typed in capitals and signs in. No sideways scroll.
5. Back in Settings, nine codes are left; turning off with the password and a recovery code works, and the owner's row no longer says it is on.

axe (WCAG 2.2 AA tags) found nothing on the set-up, recovery codes, on, and code screens. Console errors were only the expected 400s for the deliberately wrong codes and 401 session checks while signed out.

## Not covered

A real phone and authenticator app were not used; the QR code was checked by decoding the screenshot. Safari and Firefox were not checked. Practitioners and regional managers cannot turn it on yet, and a studio cannot require it.

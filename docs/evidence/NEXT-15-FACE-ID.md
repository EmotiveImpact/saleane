# NEXT-15: signing in with Face ID or a fingerprint

**Status: built locally on 10 October 2026. Walked in Chromium with its stand-in authenticator; not tried on a real phone, in Safari or in Firefox.**

## What it does

Settings, Team, Face ID and fingerprint lists the devices that can sign in as the person, and adds the phone or computer they are on. Adding asks for a name (suggested from the device: iPhone, Mac, Windows computer and so on), the password, and a code from the authenticator app or a recovery code when two-step sign-in is on. The device then checks the face, fingerprint or screen lock and makes a passkey. The sign-in page offers Sign in with Face ID or fingerprint below the password, and browsers that can also offer the passkey under the email field. Signing in this way needs no email, password or code.

The face or finger never reaches SALEANE. The server keeps the passkey's public key, its count, how it connects, whether it is shared with the person's other devices, the name they gave, and when it was added and last used. Removing a device needs the password; the row is kept with when and why, and it never signs in again. Each device added or removed is emailed to the account. The owner's team list says who signs in with Face ID, never which devices.

Passkeys need a secure web address. An IP address such as the default `http://127.0.0.1:5173` has none, and Settings says so; `http://localhost` works on the computer itself.

## How it is kept safe

- Every passkey is discoverable and always checks the person (`residentKey` and `userVerification` both required), so one passkey sign-in counts as both steps.
- A new way in skips the password and the code, so adding one asks for both (the code only when two-step sign-in is on).
- Each prompt's challenge is kept as a hash for five minutes and works once. An answer from another web address, without the person checked, too late, or made with someone else's prompt is refused, and nothing is kept.
- A passkey whose count goes backwards, which can mean it was copied, is refused with a plain message. One whose answer names another account is refused.
- Ten devices each. Signing in is limited like the password (ten tries in five minutes from one address); prompts to thirty.
- Restoring a backup stops every passkey, since one may have been removed since the backup (a lost phone), and its count would go back. Each person adds their device again.
- When SALEANE refuses a passkey it no longer knows, the browser is asked to forget it (WebAuthn's unknown-credential signal), where the browser supports that.

## Tests

- `server/passkeys.test.ts` (10 tests), with a pretend phone (`server/test/authenticator.ts`) that makes real ES256 signatures: where passkeys can work (localhost, a domain on https; never an IP address or plain http elsewhere) and the plain answer elsewhere; adding with the password, the options asked of the device, what is kept, the notice, the session count and the passkey named so the device does not make a second; signing in with no email or password, and the same answer refused the second time; two-step sign-in asks for the code to add a device and then no code to sign in; answers from another address, without the person checked or too late are refused and nothing is kept; someone else's prompt is refused; ten devices each; removing needs the password, keeps the row and its reason, emails, and the device is then refused; a count that went backwards and an answer naming another person are refused; each person sees and removes only their own.
- `server/backup.test.ts`: a restore stops every passkey and says how many (`passkeysStopped`).
- `src/components/PasskeySettings.test.tsx` (4 tests): the list and its dates; adding with the suggested name changed and the password; the code asked for with two-step sign-in on; a closed prompt says "Nothing was changed." with no error; removing with a wrong then right password; the plain words where the address cannot use it.
- `src/pages/AccountPasskey.test.tsx` (4 tests): signing in with the button opens the studio; a closed prompt changes nothing; a removed passkey says so and the browser is asked to forget it; the passkey offered under the email field; nothing offered where the address or browser cannot use it.
- `src/state/passkeys.test.ts` (2 tests): device names from each kind of browser, and the words for each thing a device can say.

## Browser walk

Against the built server at `http://localhost:5181`, in Chromium with its virtual authenticator (CTAP2, built in, keeps passkeys, checks the person), at 1440 px and 390 px:

- Settings, Team, Face ID and fingerprint: Off; adding Studio Mac with the password; the device made one discoverable passkey; 1 device, "Added 10 October 2026 · not used yet".
- Signed out, the sign-in page's email field carries `autocomplete="email webauthn"`, and Chromium's stand-in picked the passkey from the field's suggestion and opened Today.
- In a browser that offers no suggestion: the "or" and Sign in with Face ID or fingerprint below the password; pressing it opened Today, and Settings then read "last used 10 October 2026".
- Removing Studio Mac with the password; signing in with it again said "This passkey is no longer set up for SALEANE. Sign in with your password, then add this device again."
- axe (WCAG 2.2 AA) found nothing on Settings closed, adding and with a device, or on the sign-in page; no sideways scroll at either width; no console errors.

## Not covered

- No real phone, Safari or Firefox. Chromium's stand-in authenticator follows the WebAuthn standard, and SimpleWebAuthn (14.0.3 on the server, 14.0.0 in the browser) is widely used with real devices, but a real iPhone's Face ID was not tried.
- A studio cannot yet require Face ID or two-step sign-in for its team.
- The migration is number 36, the next free one after the left-out features' 30 to 35.

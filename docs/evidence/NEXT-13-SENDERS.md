# NEXT-13, part 2: email from any sender

**Status: built locally on 10 October 2026. No real email account was used: every service's answers are simulated in tests.**

## What it does

`SALEANE_EMAIL_PROVIDER` chooses the service that sends every guest and account email:

| Setting     | Service                    | How SALEANE sends                                                    | Delivery receipts                                |
| ----------- | -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `postmark`  | Postmark                   | Email API, with a broadcast stream for news                          | Basic-auth webhook (already built)               |
| `resend`    | Resend                     | Email API                                                            | Svix-signed webhook                              |
| `sendgrid`  | Twilio SendGrid (US or EU) | Mail Send v3, `X-Message-Id` kept                                    | Event Webhook signed with an elliptic-curve key  |
| `mailgun`   | Mailgun (US or EU)         | Messages API, as a form                                              | Webhook signed with HMAC                         |
| `ses`       | Amazon SES                 | SES v2 `SendEmail`, signed with AWS Signature Version 4 by SALEANE   | Not read yet (SES sends them through Amazon SNS) |
| `smtp`      | Any mail server            | nodemailer, encrypted (465, or STARTTLS required)                    | None                                             |
| `google`    | A Google Workspace mailbox | Gmail API, signed in as a service account allowed to send as the box | None                                             |
| `microsoft` | A Microsoft 365 mailbox    | Microsoft Graph `sendMail` with the whole message                    | None                                             |

Every service gets the same message: the plain words, the designed email from part 1, the studio's name as the sender, whether it is a visit message or news, and, for news, the guest's one-click unsubscribe address as `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058). Nothing sets that address yet: the Marketing section will, from its stop links.

The rules that keep messages honest are the same for every service. A busy service (429 or 5xx) is tried again; a refusal is kept with the service's own words and not retried; a request that never left SALEANE (no address, refused connection) is tried again; one that dropped after the email was handed over is "unclear" and waits for a person. For a mail server, a 4xx reply or a failure before the message was handed over is tried again, a 5xx reply or a refused sign-in is not, and a dropped line during the message is unclear. Signing in to Google or Microsoft sends no email, so a failed sign-in is always safe to try again, unless the service refused SALEANE's credentials, which is said plainly. Only a verified receipt from the service in use marks an email delivered, and a receipt over five minutes old is refused.

## Tests

- `server/messaging/aws.test.ts` (4 tests): AWS Signature Version 4 matches AWS's own published examples: the test suite's plain GET (`5fa00fa3…`) and POST (`5da7c1a2…`), its query sorting example (`b97d918c…`), and the IAM example in AWS's guide with a signed content type (`5d672d79…`); a session token is signed when there is one.
- `server/messaging/emailSenders.test.ts` (17 tests): each service's request (address, sign-in, both parts, sender's name, stream, unsubscribe headers for news) and how its answers are read; Resend's busy, refused, dropped and unreachable answers; SendGrid's reference, a 202 with no reference (unclear), a refusal and its EU host; Mailgun's EU form and bare message id; SES's signed request and refusal; a mail server's six kinds of failure; the MIME message's headers and parts; Google's signed sign-in (checked with the matching public key), the reused token and a refused sign-in that sends nothing; Microsoft's sign-in, MIME send, refusal and dropped line; Resend, SendGrid and Mailgun receipts, forged, stale and genuine; each sender needing its own keys; only the sender in use being believed; Postmark news gaining the unsubscribe headers.
- `server/messaging.test.ts`: a booking's email sent through Mailgun is accepted with its bare reference, a receipt signed with the wrong key is refused with 403, and one signed with the right key marks it delivered.

## Not covered

- No service was used for real: there are no accounts. Each adapter follows the service's published API.
- Amazon SES receipts (through Amazon SNS) are not read, so SES emails stay "handed over".
- Guests' replies by email are read only through Postmark's inbound address, as before.
- The service is chosen once for all of SALEANE. A studio sending from its own Google Workspace or Microsoft 365 mailbox, chosen in its own settings, would need each studio's keys stored encrypted, which is not built.
- Microsoft is retiring password sign-in for mail servers, so a Microsoft 365 mailbox should use `microsoft`, not `smtp`.

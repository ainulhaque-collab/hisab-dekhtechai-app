# Firebase notification setup handoff

28 October 2026: owner confirmed no Firebase project exists. No Firebase resource,
account, billing plan, credential, token registration or push send was created by
this document. Existing Google Drive financial storage and OAuth remain unchanged.

## First owner step (no key needed)

Open https://console.firebase.google.com/ and create a notifications project,
for example "Hisab DekhteChai Notifications". Use the no-cost Spark plan without
linking a billing account; Analytics is optional and not needed for reminders.
Send only its public Project ID from Project settings > General, never credentials.

FCM itself is listed as no-cost. A new Spark project has no payment-method
requirement. An existing Google Cloud project can also have Firebase added, but
if that project already has billing (for example for Gemini), Firebase shares it
and shows Blaze. Do not enable billing or paid products just to follow this guide.
An independent Spark notifications project can keep the existing OAuth/Gemini
project and its settings untouched.

## Integration work after project creation

1. Register Android package `com.hisabdekhtechai.app` and a Web app. Preserve the
   existing permanent signing identity and Google OAuth IDs. Do not replace
   Google Drive sign-in with Firebase Authentication for this feature.
2. Configure native/web notification permission, a Web service worker and VAPID,
   device registration/token rotation, sign-out revocation and owner isolation.
3. Configure a trusted sender with least-privilege FCM credentials stored only on
   the server. Never commit service-account keys or expose them through VITE vars,
   the APK, Notion, chat or downloadable files. Private registration tokens stay
   server-side and owner-scoped.
4. Schedule at 13:00 UTC (19:00 Asia/Dhaka). Store only needed reminder metadata
   and authenticated device registrations, not a second copy of the ledger.
   Deduplicate each loan/local-date notification; cancel on full repayment and
   handle denied permissions, offline delivery, expired tokens and retries.
5. Test Android and Web background delivery with synthetic loans before enabling
   it for the owner. No public admin announcements are sent as a setup test.

FCM delivery does not execute financial transfers. Closed-app settlement needs
its own secure executor and current-balance/sync design. Current loan automatic
repayment is explicitly limited to the original device while the app is open
after verified sync. Do not label a sent reminder as a successful repayment.

## Official references reviewed

- Pricing: https://firebase.google.com/pricing
- Project/billing relationship: https://firebase.google.com/docs/projects/learn-more
- Trusted sender/secret tokens: https://firebase.google.com/docs/cloud-messaging/server-environment

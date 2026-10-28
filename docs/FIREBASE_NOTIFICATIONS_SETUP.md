# Firebase notification setup handoff

28 October 2026: owner created `hisab-dekhtechai-notifications` and provided its
Project ID. The project was verified in the signed-in Firebase console. Existing
Google Drive financial storage, OAuth clients and Android signing are unchanged.

## Current verified setup

- Sender/project number: `706081957087`; FCM HTTP v1 API shows Enabled.
- Android registered: `com.hisabdekhtechai.app`, app ID
  `1:706081957087:android:6d89a6f1696eab6b77356a`.
- Web registered: app ID `1:706081957087:web:2966864dcc99f41b77356a`.
  Firebase Hosting was not selected. No Analytics SDK is initialized by this setup.
- The owner explicitly approved creating the Web Push VAPID key pair. Its public
  key is saved locally; the private key was not displayed or exported.
- Web public config is saved as `.local-firebase/web-config.json`; public VAPID
  as `.local-firebase/web-push-public-key.txt`. Both are ignored by Git.
- Android config download stalled in the automated browser. The owner downloaded
  it in Chrome and saved `.local-firebase/google-services.json`. Exact project,
  sender number, release package and Android app ID now validate successfully.
  Android, Web and VAPID public inputs all report `verified`. These are client
  configs, not private sender credentials; SDK wiring and live delivery remain
  unimplemented. Do not register the apps again.
- `node scripts/Check-FirebaseSetup.mjs` verifies exact project/app/package IDs,
  rejects private credentials in client inputs and checks the VAPID public point.
  It prints fixed statuses only, never key values. It does not enable Firebase,
  send a notification, access a sensor or change the ledger. Client registration
  alone is not an implemented push feature.

Android settings:
https://console.firebase.google.com/project/hisab-dekhtechai-notifications/settings/general/android:com.hisabdekhtechai.app

Cloud Messaging settings:
https://console.firebase.google.com/project/hisab-dekhtechai-notifications/settings/cloudmessaging

The existing signed loan release `1.0.16-test` / code 17 was installed in place
on the known TECNO phone and cold launch succeeded. First install time remained
26 October 2026 19:17:09 and the app data directory was unchanged. This is upgrade
metadata evidence, not a financial-record parity test. USB disconnected during
the subsequent read-only native media probe, so it is not recorded as passed.
Actual loan flow/old records and native media owner acceptance remain pending.

## Initial project choice (completed by owner)

Open https://console.firebase.google.com/ and create a notifications project,
for example "Hisab DekhteChai Notifications". Use the no-cost Spark plan without
linking a billing account; Analytics is optional and not needed for reminders.
The public Project ID has been received. Never send private credentials in chat.

FCM itself is listed as no-cost. A new Spark project has no payment-method
requirement. An existing Google Cloud project can also have Firebase added, but
if that project already has billing (for example for Gemini), Firebase shares it
and shows Blaze. Do not enable billing or paid products just to follow this guide.
An independent Spark notifications project can keep the existing OAuth/Gemini
project and its settings untouched.

## Remaining implementation and verification

1. Wire the verified Android/Web client configs to the SDKs. Preserve the existing
   permanent signing identity and Google OAuth IDs. Do not replace Google Drive
   sign-in with Firebase Authentication for this feature.
2. Configure native/web notification permission and a Web service worker,
   device registration/token rotation, sign-out revocation and owner isolation.
3. Configure a trusted sender with least-privilege FCM credentials stored only on
   the server. Never commit service-account keys or expose them through VITE vars,
   the APK, Notion, chat or downloadable files. Private registration tokens stay
   server-side and owner-scoped.
   The owner approved the exact keyless sender proposal and its scoped IAM
   resources are now applied (details below). No static private key was created.
   Any further access expansion needs its own concrete review; do not reuse the
   broad default Firebase Admin account.
4. Schedule at 13:00 UTC (19:00 Asia/Dhaka). Store only needed reminder metadata
   and authenticated device registrations, not a second copy of the ledger.
   Deduplicate each loan/local-date notification; cancel on full repayment and
   handle denied permissions, offline delivery, expired tokens and retries.
5. Test Android and Web background delivery with synthetic loans before enabling
   it for the owner. No public admin announcements are sent as a setup test.

## Applied trusted-sender boundary

On 28 October 2026 the owner approved the exact proposal in
`config/firebase-sender-preview.plan.json`. These resources were applied and
verified in the Google Cloud UI:

- Custom role `hisabNotificationSender`: **only** `cloudmessaging.messages.create`;
  enabled, General Availability.
- Dedicated service account
  `hisab-preview-push@hisab-dekhtechai-notifications.iam.gserviceaccount.com`,
  unique ID `108365362847283654794`; custom role assigned; no keys.
- Pool `hisab-vercel-preview` / OIDC provider `vercel-preview`, enabled.
- Team issuer `https://oidc.vercel.com/ainulhaque-collab` and audience
  `https://vercel.com/ainulhaque-collab`, verified in Vercel Security UI first.
- `google.subject = assertion.sub`; provider CEL pins exact immutable Vercel
  team/project IDs, `preview` environment and the approved subject.
- Account-level `roles/iam.workloadIdentityUser` binding for the exact subject
  principal recorded in the plan; no whole-pool/wildcard grant. Existing inherited
  owner/Firebase-agent access was not modified.

Proof: `build/firebase-setup/sender-role-created.png`,
`sender-account-no-keys.png`, `preview-provider-condition.png`,
`preview-sender-binding-applied.png`, `sender-provisioning-progress.json`.

This permits **all Preview deployments of this Vercel project**, not only the
current branch alias. Other projects, development and production are excluded.
Keep that boundary explicit in the owner's IAM approval. It grants no Drive,
ledger, banking, Firebase Authentication or storage permission.

The connector omitted issuer mode, so it was verified directly in the Vercel
Security UI without changing that setting. No private JSON key or billing
change was made. Workload Identity setup enabled its prerequisite APIs through
Google's own console flow.

`server/notifications/keylessIdentity.mjs` uses official `@vercel/oidc` and
`google-auth-library` SDKs. It obtains a fresh request/build-context subject token,
checks its exact boundary and expiry before Google STS verifies its signature,
then requests a 600-second impersonated token scoped only to Firebase messaging.
It rejects production/local execution and never returns SDK errors with headers
or credentials. There is no public token/diagnostic route.

`scripts/Verify-FirebaseSender.mjs` runs after the Web build. It skips by default.
Only the existing test branch has Preview-only
`PUSH_VERIFY_IDENTITY_ON_BUILD=true`; an opted-in non-preview build fails closed.
Success logs only `PUSH_KEYLESS_IDENTITY_VERIFIED`, never a token. This probe
exchanges credentials but sends no notification and reads no financial records.
Local validation: 250 tests, browser/API types and Web build PASS; default skip
verified. Actual exchange results are recorded separately in deployment build
logs and the canonical Notion tracker. Only the fixed success code establishes
that live credential exchange passed. Diagnostics distinguish API-disabled,
billing-required, permission-denied and rejected-identity failures using fixed
codes; no raw SDK headers, descriptions or credentials are logged. A billing
requirement must be reported, never resolved by enabling billing automatically.

After the live exchange passes, implement owner token registration/revocation,
native/Web SDK permission UI, service worker, deduplication and reminder dispatch.
IAM provisioning and a successful exchange alone do not establish push delivery.

FCM delivery does not execute financial transfers. Closed-app settlement needs
its own secure executor and current-balance/sync design. Current loan automatic
repayment is explicitly limited to the original device while the app is open
after verified sync. Do not label a sent reminder as a successful repayment.

## Official references reviewed

- Pricing: https://firebase.google.com/pricing
- Project/billing relationship: https://firebase.google.com/docs/projects/learn-more
- Trusted sender/secret tokens: https://firebase.google.com/docs/cloud-messaging/server-environment
- Android config: https://firebase.google.com/docs/cloud-messaging/android/get-started
- Web/VAPID setup: https://firebase.google.com/docs/cloud-messaging/web/get-started
- HTTP v1 sender authentication: https://firebase.google.com/docs/cloud-messaging/send/v1-api
- Vercel GCP OIDC: https://vercel.com/docs/oidc/gcp
- Vercel claim boundaries: https://vercel.com/docs/oidc/reference
- Google federation: https://docs.cloud.google.com/iam/docs/workload-identity-federation

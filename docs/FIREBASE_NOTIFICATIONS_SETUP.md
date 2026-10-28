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
  configs, not private sender credentials. Android/Web SDK wiring is implemented;
  actual device delivery still requires the acceptance test below. Do not register the apps again.
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

## Delivery acceptance and next work

The Android/Web SDKs, explicit permission UI, bundled service worker, owner-scoped
token lifecycle and keyless sender are implemented as described below. Existing
permanent signing, Google OAuth, Drive storage and financial schema are retained.

1. Verify the actual test notification on the owner Android and HTTPS Web clients,
   including foreground/background receipt, denial, offline and rotation paths.
   FCM acceptance alone does not confirm delivery. No broad announcement is a test.
2. Schedule loan reminders at 13:00 UTC (19:00 Asia/Dhaka). Store only needed reminder metadata
   and authenticated device registrations, not a second copy of the ledger.
   Deduplicate each loan/local-date notification; cancel on full repayment and
   handle denied permissions, offline delivery, expired tokens and retries.
3. Add reviewed owner-only announcement controls and a safe scheduler/executor
   design. Never reuse the broad default Firebase Admin account or expand the
   approved Preview IAM boundary without a separate concrete review.

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

`server/notifications/verifyBuild.mjs` runs after the Web build. It skips by default.
Keep it under `server/`: Vercel intentionally excludes the local `scripts/`
folder, signing helpers and `.local-firebase/` inputs from deployment.
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

## Transaction push implementation (28 October)

Settings → Notifications supports explicit enable, connection refresh, a test
addressed only to this installation, and disable. English/Bangla labels are
available. Permission is requested only after the user presses Enable; silent
resume never prompts. The Web SDK is lazy loaded and its service worker is
bundled into one classic IIFE at `/push-sw.js`, without module-worker/shared
chunk dependencies. No Analytics or Firebase Authentication is used.
Android uses official Capacitor Push Notifications, a dedicated monochrome icon,
private lockscreen visibility and one notification channel. Auto-init starts off.

`scripts/Prepare-FirebasePush.mjs` validates local public client inputs and stages
Android's ignored config before a signed build. The test branch alone has Preview
`VITE_PUSH_ENABLED`, `VITE_FIREBASE_WEB_CONFIG`, `VITE_FIREBASE_VAPID_KEY`, and
server-only `PUSH_ENABLED=true`. Public Firebase client config intentionally enters
the bundle; Gemini credentials, Redis credentials and sender tokens never do.
CI debug APKs retain their separate `.debug` package with live notifications off.

`POST /api/notifications/push` authenticates the existing Google bearer token
online, binds the verified owner hash, checks exact allowed origins and accepts
only fixed register/unregister/test/transaction schemas. It cannot accept a
custom message, recipient, topic or campaign. Device registration is capped at
five per owner. Redis atomically claims each FCM token for one owner/installation,
checks an installation secret for revocation, expires inactive registrations,
deduplicates events and enforces owner/global daily limits. Its namespace is
separate from AI quota and financial storage. Production is explicitly disabled.

New local journals queue an opaque operation ID only after their durable commit.
Imports, restores, duplicate saves and incoming Drive sync do not emit this hook.
Delivery is best effort and cannot roll back or delay the Save operation. A
bounded, separate device queue retries on foreground/network restoration for up
to 24 hours; server event reservation provides at-most-once send attempts for
48 hours. A provider error can lose an alert; financial records remain durable.
The service stores no amount, account, workspace name, note or receipt in Redis
or notification payloads. Sender credentials remain server-only; device tokens
stay inside the client SDK and private registry and are never returned by the
notification API. Sign-out attempts server revocation before Google
logout and deletes the local FCM token; an incomplete disable is reported.

Validation: 11 focused notification tests plus the existing 250 regressions pass;
browser/API TypeScript checks and Web build pass. Synthetic browser UI checks
cover both languages and signed-out guidance. FCM acceptance alone is not proof
of delivery: on the signed APK and HTTPS Web preview, connect the same Gmail,
enable notifications and press Send test to this device. Check the actual device
notification. Then save a user-created test transaction on one device and check
the other. Agent tests do not create financial records in the owner's dataset.

Still pending: physical/Web receipt acceptance, loan reminder metadata/scheduled
dispatch at 19:00 Asia/Dhaka, and reviewed owner-only announcement controls.
Preview does not run a production Cron schedule. No production promotion, paid
scheduler, broad broadcast or background money executor was added.

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

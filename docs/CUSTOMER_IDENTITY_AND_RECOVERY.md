# Stable customer identity — phone / Gmail changes

**Follow-up milestone:** [Account settings integration](ACCOUNT_SETTINGS_INTEGRATION.md) mounts the panel while keeping contact changes, SMS and financial adoption gated. The staged-adapter results below describe PR14, not a completed production rollout.

Owner requirement and SMS decision: **2026-11-04 (Asia/Dhaka)**. Continuing PR-3
on top of `0f4dae9f8694bad5c2d0abfd8ec76d7aa62172d2`.

## User-facing rule

**হিসাব গ্রাহকের স্থায়ী ID-তে থাকবে। মোবাইল নম্বর ও Gmail সেই একই অ্যাকাউন্টে
প্রবেশের যাচাইকৃত মাধ্যম। নম্বর বা Gmail বদলালে হিসাব নতুন করে তৈরি বা অন্য
অ্যাকাউন্টে সরানো হবে না।**

- নতুন নম্বর: মূল অ্যাকাউন্টে প্রবেশ → নতুন নম্বরে OTP → যাচাই → একই হিসাব।
- নতুন Gmail: মূল অ্যাকাউন্টে প্রবেশ → নতুন Google পরিচয় যুক্ত ও যাচাই → মূল
  recovery email-ও নিশ্চিত করে বদলানো → চাইলে পুরোনো Google পরিচয় সরানো।
- শুধু নম্বর/ইমেইলের লেখা মিলিয়ে দুটি গ্রাহকের হিসাব একত্র করা হবে না।
- সব login/recovery মাধ্যম হারিয়ে গেলে পরিচয়ের প্রমাণ ছাড়া অ্যাকাউন্ট দেওয়া
  যাবে না। আগে যাচাই করা দ্বিতীয় মাধ্যম রাখতে হবে; support recovery পৃথক কাজ।

The owner has **no SMS service**. Google/email account work proceeds; phone OTP
remains disabled by default until a provider is configured and tested. No paid
service, SMS, real confirmation email, customer account, remote Auth setting or
financial migration was created/changed by this PR.

## Implementation

Financial tables already reference the stable `auth.users.id` UUID. Existing RLS
compares that UUID with the verified subject, not email or phone. No financial
schema migration, ownership rewrite, alias lookup table, or phone/email-derived
customer ID is necessary for a normal contact change.

| Source | Responsibility |
|---|---|
| `contracts/customerAccount.ts` | Provider-independent account/change results; no credentials |
| `auth/customerIdentity.ts` | Validate bound UUID and server-confirmed contacts; BD/Bangla phone → E.164 |
| `auth/cloud/cloudAuth.ts` | Verified Auth session, existing-customer phone OTP login and sync Auth port |
| `auth/cloud/customerChanges.ts` | Same-customer phone/email changes, Google linking and guarded removal |
| `auth/cloud/secureStorage.ts` | Existing encrypted credential/PKCE storage and revocation fence |
| `sync/postgres/engine.ts` | Reject a different Auth issuer, even for an identical UUID |

The config, encrypted storage and initial Auth tests were imported from the
preserved feature commit `75dde8280ed492083cbf40f8964f8458fa42c740`; Auth behavior
is extended here. SDK `@supabase/supabase-js` is pinned to the same **2.118.0**, with
its lockfile. Do not replace the existing native Keystore storage with a test
store or plaintext localStorage when integrating the Android runtime.

`CloudAuth.getCustomerAccount(boundCustomerId)` revalidates with Auth `getUser()`.
It checks the cached session UUID against the authoritative server UUID, rejects
anonymous/unverified users and validates the expected customer. `user_metadata`,
display names and email strings never authorize a financial scope. Confirmed
email or phone authentication is supported; a Google identity is not mandatory
for a returning phone-only account. `asSyncAuth(boundCustomerId)` returns only the
verified UUID and configured `/auth/v1` issuer, not tokens.

## Change flows

`customerChanges(boundCustomerId)` shares the Auth instance's exclusive mutation
guard and closed-session fence. Changes require a recent server-reported sign-in.
An expiring pending record saves the original UUID and requested target in the
credential store so restart/retry cannot select a different owner.

**Phone:** explicitly enable only after provider/config acceptance. `updateUser`
requests the change; its response alone is not verification. `verifyOtp` uses
`phone_change`, followed by a fresh `getUser()` for the same UUID and confirmed
target. Incorrect OTPs retain pending state and old financial data. Login on the
new verified number uses `signInWithOtp({shouldCreateUser:false})`, then `sms`
verification and the expected-customer fence. A number reassigned to another
UUID cannot adopt an existing local dataset. New phone-only signup is not part
of this existing-customer flow.

**Email:** `requestEmailChange` uses authenticated `updateUser` with the exact
configured callback. Keep Secure Email Change enabled on the host. After Auth's
confirmation links, `checkEmailChange` re-reads the confirmed target from Auth.
The first/partial confirmation stays pending. `handleCustomerCallback` can route
that callback without replacing the existing authenticated session. The URL or
an authorization code by itself is never proof that an email has changed.

**Google:** authenticated `linkIdentity` chooses a new Google account. Persist the
SDK's local S256 PKCE flow ID and original customer before accepting a callback.
The callback must match the configured endpoint, outstanding flow and unchanged
customer UUID. Another owner's identity fails rather than merging accounts.
The existing `handleCallback` entry point routes these contact confirmations.
Linking an already-linked identity does not create a new customer.

Old Google removal requires another linked Google login **and a confirmed primary
email belonging to a remaining Google identity**. This avoids leaving the old
Gmail as the email-login/recovery address after removing its Google identity.
The last Google sign-in cannot be removed by this slice. Nothing deletes an Auth
user, workspace or journal. Cancelling pending local UI state does not undo a
change already confirmed on the Auth server.

## What is verified / not yet live

Tests run the real pinned SDK against deterministic synthetic Auth HTTP
responses; these are **not live Google consent, email delivery or SMS tests**.
The original 16 Auth/storage tests remain, plus contact-change, wrong OTP,
restart, callback, recent-sign-in, owner mismatch, phone re-login, primary email,
old Google removal and late-logout tests. A real file-backed SQLite dataset with
pending operations remains byte-for-byte identical after phone/Google changes.

The HTTP/SQLite/Postgres pipeline additionally changes **synthetic** Auth contact
columns in a disposable stock-Postgres identity fixture. The same UUID retains
its ledger and cursor; another UUID with identical contact text cannot read it.
Foreign keys reject deletion of the identity anchoring existing financial rows.
These fixture alterations are test-only, never a hosted `auth` migration.

Existing lint, app regressions, portable SQL tests and web build are required.
Native PostgreSQL 17 CI also verifies concurrent commits and scoped dump/restore.
The current 17 web output files are byte-identical to PR-3a: the new Auth modules
are **not mounted into App**. No APK was replaced and no hosted migration applied.
Actual results are recorded in `qa/customer-identity-evidence.json` and PR checks.

Verified source `aa239516f2fbb71449e327f58fb9d40d535c2e25` passed
[CI 95](https://github.com/ainulhaque-collab/hisab-dekhtechai-app/actions/runs/41849451021):
128 app tests passed (one native-only skip in the WASM job), 11 WASM SQL tests,
12 native PostgreSQL SQL tests and 14 native HTTP/SQLite pipeline tests with no
skips. Native contact-change/issuer/deletion guards and the 10-table dump/restore
passed; both finance and sync cursor restore markers were verified in job logs.

## Activation gates

1. Reconcile the advanced feature/runtime branch before replacing a phone APK;
   preserve goals, loans, AI, PDF, push/inbox and native SQLite connection fixes.
2. Bind the account settings UI to this API and display confirmed contacts plus
   honest pending states. Route web/native callbacks before refreshing account
   state. Use the existing secure platform runtime; never expose tokens to UI.
3. Inspect the actual development project's Auth settings: manual Google linking,
   Google credentials, exact redirects, email confirmation/Secure Email Change,
   SMTP delivery, rate limits and session policy. Shared-project settings must
   not be changed blindly; this PR makes no such change.
4. Test real old/new Google identities and both email confirmations. SMS stays
   off until the owner chooses a provider; no test number/OTP bypass in release.
5. Finish the remaining sync commands, shared local write/cross-tab arbitration
   and explicit legacy owner/ID adoption from PR-3a. Do not relabel old Google
   hashes or silently upload old records because an email/number looks equal.
6. Verify upgrade/offline/restart/login/logout/owner-switch in the actual Android
   app and browser. Preserve existing ledgers and pending operations throughout.

**Host move/recovery:** preserve the same customer UUIDs when exporting/importing
Auth users and provider identities. Financial `pg_dump` alone excludes Auth
credentials/contact delivery and is not a complete login-recovery backup. The
stock adapter supplies UUID anchors; a real Auth migration needs its own tested,
protected identity export/import. Never create new owner UUIDs from restored
phone/email strings or reassign journal ownership to make login appear to work.

## SMS options (not provisioned)

[Supabase phone Auth](https://supabase.com/docs/guides/auth/phone-login) requires an
SMS provider; supported options include Twilio, Vonage and MessageBird. The owner
decision is to defer this purchase/setup. A Bangladesh-specific delivered-OTP
quote is still needed before choosing: include SMS segments, retry attempts,
provider/verification fees, sender requirements, taxes and currency conversion.
[Vonage pricing](https://www.vonage.com/communications-apis/sms/pricing/) uses a
country selector and says dashboard rates at purchase are authoritative. The
attempted Twilio Bangladesh URL redirected to US pricing; **US prices are not
used as a Bangladesh estimate**. No fixed BDT price or free production SMS is
claimed, and no provider account or billing was enabled.

Official guidance checked: [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser),
[secure email change](https://supabase.com/docs/reference/dart/auth-updateuser),
[phone Auth](https://supabase.com/docs/guides/auth/phone-login),
[Supabase changelog](https://supabase.com/changelog). CLI v3's hosted-change
confirmation/default-target change does not affect this SDK-only PR.

## Rollback / next work

Keep modules unmounted (current state), or revert this PR before activation.
No account reset, uninstall, financial restore or remote rollback is needed.
Reverting code after a real Auth contact change would not undo that confirmed
server change; use the same stable UUID and verified recovery process.

Next smallest work: account settings integration plus verified development Auth
configuration, alongside preserving the advanced runtime before live cutover.
The earlier selected feature IDs remain pending roadmap items: 04, 10, 11, 09,
13, 12, 39, 02, 14, 08, 15, 50, 18, 05, 47, 48. The old checklist's Drive wording
for central backup is superseded by the owner's Postgres handover.

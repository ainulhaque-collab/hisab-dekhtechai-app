# Gemini receipt and voice entry

This batch implements selected items **37/38** through the transaction review form. The provider boundary supports adding OpenAI later; an OpenAI adapter is not implemented yet. The ledger remains local/Drive based. AI services only return drafts and have no database or journal-post handle.

## What works in the code

- Add → AI → one-time device permission → camera/gallery or spoken entry → details directly in the normal transaction form → Save once. No separate review screen or recurring checkbox. Unknown type/currency stays a blocking field in the main form; a currently selected valid wallet is retained.
- Images: validated JPEG/PNG/WebP up to 2 MB. Audio: up to 2 MB, recordings stop after 45 seconds. The microphone is requested only on Record and released on Stop, close, background, permission cancellation or error. Files stay in memory until Save; closing the modal discards the AI draft/voice. A submitted remote AI request may finish after local cancellation.
- Missing amount/type/currency requires review. Missing dates/times stay blank until normal Save-time defaults apply. Source hashes, request IDs and Google owner identity are checked on replies. AI never chooses an account or posts a transaction.
- Android requests camera/microphone access during first-use setup and checks again when used. Sensors only start on a user action. The installed version 8 predates this simplified UI; a new signed APK remains required.

## Model policy confirmed by the owner

`GEMINI_MODEL=auto` is the default. On an authenticated, quota-reserved request, the server reads the model catalog available to the configured key. It intersects that catalog with a reviewed production list, preferring **gemini-3.6-flash**, then **gemini-3.8-flash**, requiring `generateContent` and at least 2048 output tokens. The list was checked against Google's official model documentation and live extraction on 27 October 2026. A larger numeric version in the catalog is not sufficient evidence of production availability. Selection is cached for 15 minutes. Prices and relative accuracy are not inferred from the catalog.

No suitable model → an honest unavailable message. One generation attempt per click; retries within the request are disabled. A model returning 5xx or 404 is cooled down for 10 minutes in that runtime instance, so the **next user-requested extraction** may choose another reviewed, advertised Flash model. There is no hidden generation fallback, no Pro/preview switch and no quota/auth-error retry. Catalog and health state are local to the runtime, not a shared global health guarantee. Operators may pin a supported `gemini-*` model later. Known 3.6/3.8 models use documented minimal/low thinking respectively to bound extraction latency. Truncated, blocked or invalid output cannot become a draft. `AI_PROVIDER` defaults to `gemini`; unsupported providers fail closed until their adapter is implemented.

## Local Web test without sharing the API key

1. Create the key in the **Hisab DekhteChai** Google AI Studio project.
2. Open your own PowerShell terminal in this repository and run `./scripts/Configure-LocalAI.ps1`. Paste the key only at the hidden prompt. No model selection is required. If using a different public Web OAuth client, pass `-WebClientId PUBLIC_CLIENT_ID`.
3. The helper writes only the dedicated ignored **`.env.ai.local`** server file. It does not print the key or change the app's OAuth `.env`. Do not send this file or the key to chat, Notion, GitHub or a client bundle. Existing shell environment variables take precedence; restart the server after changes.
4. In one terminal run `npm run dev:api`; expect the loopback address `127.0.0.1:3001` and `configured=true`. In another, run the usual `npm run dev` (or use the existing dev server after it reloads the Vite proxy config).
5. Open `http://localhost:3000`, connect the same Google account and use Add → AI. Enable media processing once, then try a synthetic receipt/short voice entry. Check/correct the filled transaction form and Save once. Confirm exactly one History entry and a receipt image for image-based entries. Repeat with cancel/denied mic permission/offline/unknown currency. A full app refresh may be needed after this code update.

The owner saved the key in the ignored local file. After the policy correction, the real automatic provider selected `gemini-3.6-flash` and successfully processed a synthetic receipt image and computer-generated English speech: both returned an expense of `120.00 BDT`, matching source hashes and mandatory confirmation. No real financial data was submitted or posted by these checks. This proves live media extraction, not the owner's browser token path, Bengali speech accuracy, or physical Android acceptance. A separate minimal 3.8 request returned 503/high demand; 3.6 succeeded. Catalog success alone does not establish inference availability.

The local server now logs fixed failure code/status/stage only, so authentication, quota and generation failures can be distinguished without logging tokens, media or drafts. The UI has separate Bengali/English messages for those failures, blocked content and incomplete output. If an error persists, refresh the page and report its text; inspect only the safe server diagnostic.

## Server authorization and spending limits

`POST /api/ai/extract` accepts JSON containing a UUID request ID, claimed owner hash and consented inline media. The server validates the existing opaque Google access token online using Google's token-info endpoint over POST/bearer transport, checks expiry, `openid`, subject, audience **and authorized-party client IDs**, and independently derives the owner hash. The client claim must match. Introspection/network failure denies AI while ordinary offline entry remains available. This adds online authorization latency and depends on Google's token-info availability; there is no insecure profile/email fallback.

Default limits: 3 attempts/minute/owner, 10/day/owner, 100/day/service, UTC window boundaries. Attempts are reserved **before** any generation call; failures consume an attempt. Identical owner/request IDs are rejected for 48 hours. The app does not silently retry requests. These are attempt limits, not a guaranteed money-denominated billing cap: set provider billing controls separately before public rollout.

Local loopback `server/dev.ts` alone may opt into an in-memory development budget. Counters reset on restart. The production/serverless adapter cannot opt into that fallback, even if a development flag was copied into its environment.

Production requires an existing Redis REST database supporting atomic `EVAL`, configured through server-only `AI_REDIS_REST_URL` and `AI_REDIS_REST_TOKEN`. The Lua reservation checks all owner/global quotas and duplicate IDs in one atomic operation across instances; outage/error disables processing. Only owner hashes, request IDs, counters and TTLs are stored there for up to 48 hours. Our route does not log or persist media, transcripts or drafts. Hosting/provider logs and Google's processing policies need their own deployment review.

## Android / hosted Web configuration still required

- A reachable HTTPS AI service; `localhost` on a phone is the phone itself. Set public `VITE_AI_API_BASE_URL=https://YOUR_AI_HOST` for Android builds. It is a public origin, never a secret. Same-origin hosted Web may leave it empty.
- Signed Android builds require `-AIServiceOrigin https://YOUR_AI_HOST` (or the equivalent process environment variable). The build script validates an HTTPS origin before signing work, injects it only for the build, and checks both the web output and final APK before archiving. It restores the caller environment afterward. This prevents a newly signed update from disabling existing native AI entry through a missing build-time variable.
- Set `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL=auto`, exact `AI_ALLOWED_ORIGINS` (hosted Web origin and Android `https://localhost`), and `GOOGLE_OAUTH_CLIENT_IDS` including the registered Web and Android IDs from the same Google project.
- Set the production Redis REST credentials and desired quota limits. Without shared quota storage, the endpoint stays unavailable. No Redis account, paid resource or hosting deployment is created by this code.
- Vercel adapter: `api/ai/extract.ts`, 60-second function budget, `/api` excluded from the SPA fallback. Vercel deployment/build routing and the actual Redis script have not been live-tested in this batch. No publication or production readiness is claimed.
- Rebuild/sign with a higher version code and perform physical microphone, camera/gallery, background, Google audience and receipt restore checks. Live accuracy and cross-device receipt acceptance remain open.

## Evidence

Server/client round-trip tests use an isolated loopback test server and a synthetic provider, not a real Gemini request. Tests cover Google expiry/audience/authorized-party checks, owner changes, consent/media limits, parser/error redaction, duplicate/concurrent requests, quotas, production fail-closed behavior, review validation, microphone cleanup and automatic model selection. Full suite, type check, Web build and native acceptance are recorded in the development tracker with their actual outcomes.

Official references: [Gemini models list](https://ai.google.dev/api/models#method:-models.list), [structured JSON output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [audio input](https://ai.google.dev/gemini-api/docs/generate-content/audio), [Google opaque token introspection](https://cloud.google.com/docs/authentication/token-types), [Redis REST command transport](https://upstash.com/docs/redis/features/restapi), [Vercel Express](https://vercel.com/docs/frameworks/backend/express).

## Official documentation review — 27 October 2026

Google's [3.6 model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) confirms production availability. The [thinking guide](https://ai.google.dev/gemini-api/docs/thinking) specifies supported levels. The [troubleshooting guide](https://ai.google.dev/gemini-api/docs/troubleshooting) distinguishes overload from credential/quota issues and explains why a successful model list does not prove inference permission. Our GenerateContent structured-output request matches the official schema configuration; server-side validation remains necessary.

For the future OpenAI adapter, the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) uses Responses `text.format` with a strict JSON schema. Handle refusals/incomplete results before reusing the existing draft validator. The official [file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text) provides `/v1/audio/transcriptions`; a voice adapter can transcribe an uploaded recording and then extract the same draft schema. Provider transport/model selection belongs on the server. OpenAI has not been activated or live-tested; adding it still requires its own credentials, limits and adapter tests.

## 27 October — simplified entry and Vercel repair

Owner requested removal of repeated checkboxes and extra review steps. Device-local Gemini media permission is stored separately from the ledger, scoped to owner/provider/policy and revocable under Settings → Privacy. It is excluded from financial backups and Drive sync. OS permission revocation or one-time grants can still cause another prompt. Android uses Capacitor's system camera intent and scoped gallery selection, without broad storage access. Camera images up to 12 MB/32 MP are resized whole (no crop) to the existing 2 MB validated receipt limit. Recording is user-started, stops after 45 seconds and releases tracks on cancellation/background. Only normal Save posts the transaction.

Vercel project hisab-dekhtechai-app has a prior READY main deployment at 438d535; three recent branch previews failed during npm ci because optional platform packages were missing from the lock. Repaired with npm 12 in an isolated folder: 74 missing entries added, no existing package versions changed; Node 22 now matches CI/local builds. No install-script policy bypass was committed. Attachments, signing files, local tooling and env files are excluded from uploads.

Vercel had no environment variables or installed integrations at inspection. Hosted AI awaits the owner-saved Preview Gemini key, shared Redis quota storage, exact OAuth audiences/origins and a reachable HTTPS endpoint. Complete Marketplace UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN pairs are recognized without mixing credential sources. No paid resource or production release has been created. Account for preview protection before embedding its host in an APK; never embed a Vercel bypass token.

The first repaired preview at 0f72bbf built successfully but its API invocation exposed ERR_MODULE_NOT_FOUND for an extensionless ESM import. The API graph now uses Node-compatible .js specifiers and a separate NodeNext tsconfig without browser-only vite/client types. Pure image signature validation no longer imports device storage on the server. CI now type-checks this API graph and runs a compiled plain-Node smoke test, covering safe 405/503 responses without identities or provider calls. The full 172-test suite passes after this repair; live Vercel runtime recheck is still required.

## 27 October — phone microphone permission follow-up

The owner reported the generic AI-unavailable banner immediately after tapping Speak in signed version 9. Read-only Android package metadata showed CAMERA and RECORD_AUDIO both ungranted. This establishes a capture/permission boundary failure; it does not prove a Gemini outage or successful audio upload. The exact underlying platform exception was hidden by the previous generic message.

The media bridge now declares concrete check/request methods and its own PermissionCallback, returns explicit string states and has an application-level R8 keep rule. Missing/malformed/rejected bridge results fail closed with a permission-specific message; denied permissions do not loop through prompts. OS microphone denial, missing hardware, busy capture, unsupported recorder and cancellation get fixed localized capture messages without exposing raw errors. Successful rechecks clear stale permission hints. Native diagnostics contain only camera/microphone state labels, never audio, accounts or tokens.

Focused permission/voice regressions pass (10 tests). Physical signed-build permission request and voice accuracy still require owner acceptance; no microphone permission has been force-granted through adb, and no private recording was made by the agent.

# Gemini receipt and voice entry

This batch implements selected items **37/38** through the transaction review form. The provider boundary supports adding OpenAI later; an OpenAI adapter is not implemented yet. The ledger remains local/Drive based. AI services only return drafts and have no database or journal-post handle.

## What works in the code

- Add → AI-assisted entry → receipt image or audio file/recording → explicit processing consent → editable draft → confirmation → transaction form → choose account/category → Save.
- Images: validated JPEG/PNG/WebP up to 2 MB. Audio: up to 2 MB, recordings stop after 45 seconds. The microphone is requested only on Record and released on Stop, close, background, permission cancellation or error. Files stay in memory until Save; closing the modal discards the AI draft/voice. A submitted remote AI request may finish after local cancellation.
- Missing amount/type/currency requires review. Missing dates/times stay blank until normal Save-time defaults apply. Source hashes, request IDs and Google owner identity are checked on replies. AI never chooses an account or posts a transaction.
- Android microphone permissions are declared and Capacitor's existing WebChromeClient requests them on demand. These new native permissions require a new APK; the installed version 7 does not contain this batch.

## Model policy confirmed by the owner

`GEMINI_MODEL=auto` is the default. On an authenticated, quota-reserved request, the server reads the model catalog available to the configured key. It intersects that catalog with a reviewed production list, preferring **gemini-3.6-flash**, then **gemini-3.8-flash**, requiring `generateContent` and at least 2048 output tokens. The list was checked against Google's official model documentation and live extraction on 27 October 2026. A larger numeric version in the catalog is not sufficient evidence of production availability. Selection is cached for 15 minutes. Prices and relative accuracy are not inferred from the catalog.

No suitable model → an honest unavailable message. One generation attempt per click; retries within the request are disabled. A model returning 5xx or 404 is cooled down for 10 minutes in that runtime instance, so the **next user-requested extraction** may choose another reviewed, advertised Flash model. There is no hidden generation fallback, no Pro/preview switch and no quota/auth-error retry. Catalog and health state are local to the runtime, not a shared global health guarantee. Operators may pin a supported `gemini-*` model later. Known 3.6/3.8 models use documented minimal/low thinking respectively to bound extraction latency. Truncated, blocked or invalid output cannot become a draft. `AI_PROVIDER` defaults to `gemini`; unsupported providers fail closed until their adapter is implemented.

## Local Web test without sharing the API key

1. Create the key in the **Hisab DekhteChai** Google AI Studio project.
2. Open your own PowerShell terminal in this repository and run `./scripts/Configure-LocalAI.ps1`. Paste the key only at the hidden prompt. No model selection is required. If using a different public Web OAuth client, pass `-WebClientId PUBLIC_CLIENT_ID`.
3. The helper writes only the dedicated ignored **`.env.ai.local`** server file. It does not print the key or change the app's OAuth `.env`. Do not send this file or the key to chat, Notion, GitHub or a client bundle. Existing shell environment variables take precedence; restart the server after changes.
4. In one terminal run `npm run dev:api`; expect the loopback address `127.0.0.1:3001` and `configured=true`. In another, run the usual `npm run dev` (or use the existing dev server after it reloads the Vite proxy config).
5. Open `http://localhost:3000`, connect the same Google account and use Add → AI. Try a synthetic receipt/short voice entry. Check/correct the draft, confirm, choose account/category and Save once. Confirm exactly one History entry and a receipt image for image-based entries. Repeat with cancel/denied mic permission/offline/unknown currency. A full app refresh may be needed after this code update.

The owner saved the key in the ignored local file. After the policy correction, the real automatic provider selected `gemini-3.6-flash` and successfully processed a synthetic receipt image and computer-generated English speech: both returned an expense of `120.00 BDT`, matching source hashes and mandatory confirmation. No real financial data was submitted or posted by these checks. This proves live media extraction, not the owner's browser token path, Bengali speech accuracy, or physical Android acceptance. A separate minimal 3.8 request returned 503/high demand; 3.6 succeeded. Catalog success alone does not establish inference availability.

The local server now logs fixed failure code/status/stage only, so authentication, quota and generation failures can be distinguished without logging tokens, media or drafts. The UI has separate Bengali/English messages for those failures, blocked content and incomplete output. If an error persists, refresh the page and report its text; inspect only the safe server diagnostic.

## Server authorization and spending limits

`POST /api/ai/extract` accepts JSON containing a UUID request ID, claimed owner hash and consented inline media. The server validates the existing opaque Google access token online using Google's token-info endpoint over POST/bearer transport, checks expiry, `openid`, subject, audience **and authorized-party client IDs**, and independently derives the owner hash. The client claim must match. Introspection/network failure denies AI while ordinary offline entry remains available. This adds online authorization latency and depends on Google's token-info availability; there is no insecure profile/email fallback.

Default limits: 3 attempts/minute/owner, 10/day/owner, 100/day/service, UTC window boundaries. Attempts are reserved **before** any generation call; failures consume an attempt. Identical owner/request IDs are rejected for 48 hours. The app does not silently retry requests. These are attempt limits, not a guaranteed money-denominated billing cap: set provider billing controls separately before public rollout.

Local loopback `server/dev.ts` alone may opt into an in-memory development budget. Counters reset on restart. The production/serverless adapter cannot opt into that fallback, even if a development flag was copied into its environment.

Production requires an existing Redis REST database supporting atomic `EVAL`, configured through server-only `AI_REDIS_REST_URL` and `AI_REDIS_REST_TOKEN`. The Lua reservation checks all owner/global quotas and duplicate IDs in one atomic operation across instances; outage/error disables processing. Only owner hashes, request IDs, counters and TTLs are stored there for up to 48 hours. Our route does not log or persist media, transcripts or drafts. Hosting/provider logs and Google's processing policies need their own deployment review.

## Android / hosted Web configuration still required

- A reachable HTTPS AI service; `localhost` on a phone is the phone itself. Set public `VITE_AI_API_BASE_URL=https://YOUR_AI_HOST` for Android builds. It is a public origin, never a secret. Same-origin hosted Web may leave it empty.
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

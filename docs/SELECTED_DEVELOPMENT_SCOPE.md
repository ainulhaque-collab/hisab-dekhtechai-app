# Owner-selected development scope — 26 October 2026

Canonical tracker: https://app.notion.com/p/403bf836a600815a8dcccec4ca26eda9

Confirmed selection: **01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 18, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50**.

Not selected: subscription/billing (17), and standalone projects 19–35. Necessary validation for selected features remains required. Selection is not completion, payment approval, public broadcast/deployment or data migration approval.

## First implementation batch

| Selection | Implementation | Evidence and remaining acceptance |
| --- | --- | --- |
| 42 | Date/time resolves at Save, not when a form opens. Optional manual date/time, explicit occurrence offset, independent entry timestamp, History clock/audit, correction preserves unchanged occurrence, local-day filter, sync/backup validation. | Five focused tests cover midnight, manual/backdated inputs, invalid values, UTC+06 crossing midnight, legacy non-mutation, restart, backup and correction. Native/visual acceptance pending; no existing record timestamps rewritten. |
| 04 | SHA-256 of actual image bytes; JPEG/PNG/WebP selection <=2 MB; image decode/dimension checks; atomic journal+receipt+outbox; content-addressed duplicate suppression; existing `receipt.attach` Drive protocol; validated backup import; History image/missing-image state; correction retains receipt reference. | Five focused tests cover independent digest verification, corruption/MIME/size rejection, restart/idempotency, storage-failure rollback, two-client simulated Drive and backup restore. Live Drive/gallery/device acceptance and large-library load tests pending. |
| 37/38 | Server-only Gemini adapter and provider factory; shared receipt/voice draft validation; authenticated owner-bound HTTP route; atomic shared quota adapter; receipt upload/preview, audio file/45-second recording, editable/confirmed review UI; explicit account selection before ordinary Save. Automatic reviewed Flash selection; future OpenAI adapter boundary. | Real automatic Gemini extraction passed for synthetic receipt and computer-generated English voice on 3.6 Flash, both exactly 120.00 BDT with confirmation required. Owner browser acceptance, Bengali accuracy, live Redis, Vercel routing and physical Android acceptance remain pending. See AI_ENTRY_SETUP.md. |
| 36 | Existing Web/Android checks retained; Web manual workflow dispatch, explicit read-only contents permission, and `codex/**` branches added to both workflows. | Latest local full suite **159/159 PASS** with serial test concurrency, TypeScript and Vite build PASS. Remote/native CI evidence is recorded separately; local evidence is not remote/native CI success. |

No new APK was built/installed in this batch. The previous signed version 7 remains the installed phone build. No financial storage key or schema version was changed, and no app data was cleared. The downloaded backup size cap remains 40 MB; receipt data uses the existing immutable operation protocol and contributes to that cap. A verified timestamp is not a physical restore drill.

## AI setup decision

The owner confirmed **Gemini API** is already purchased. Google is the initial provider; the owner wants an OpenAI provider later. The provider boundary is ready for another implementation, but no OpenAI SDK/integration or model call was added.

The owner requested automatic model choice. `GEMINI_MODEL=auto` intersects the key's catalog with reviewed production models, preferring 3.6 Flash then 3.8 Flash. It performs one generation attempt per user request; 5xx/404 cools the model down for the next explicit request. On 27 October, official documentation review and live tests established that 3.8 returned 503/high demand while 3.6 successfully extracted both a synthetic receipt and generated English voice as exactly 120.00 BDT. Choosing the largest advertised version was insufficient. The owner saved the real key directly in ignored `.env.ai.local`; it was not displayed or copied into source. Keys are never VITE variables. The adapter has no database handle or journal-post authority; all extracted outputs require user confirmation and an explicit account selection. Specific error messages and safe stage/code/status diagnostics distinguish auth, quota, overload and incomplete output. OpenAI's official structured-output and transcription docs were reviewed for its future adapter; OpenAI is not activated. See [AI setup](AI_ENTRY_SETUP.md) for evidence and remaining acceptance.

Official implementation references: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/generate-content/audio). Installed `@google/genai` types support `models.generateContent`, `responseMimeType` and `responseJsonSchema`. Model selection is explicit rather than an unverified hardcoded model.

## Remaining selected work

- 05 workspace-media private replication/backup.
- 06 recurring execution; 07 budget notifications.
- 08 PWA; 09 PDF; 10 calendar; 11 bookmarks; 12 reconciliation; 13 detailed group reports.
- 01–03 real Android/Web notification delivery, inbox and verified admin sender.
- 14 verified employee sharing; 15 admin-published blog; 16 customer API/MCP; 18 optional central backup.
- 37/38 live provider/hosting/Redis/native acceptance; 39 grounded financial analysis; 40 investment tracking/education.
- 41/43 goals/emergency fund; 44 debt/installments; 45 reminders; 46 forecasts; 47 review alerts; 48 digest; 49 split bills; 50 data health.
- 36 remote CI last passed for `a37fce4` (Web run #18; Android Debug APK run #30). The reviewed-model fix requires fresh current-commit CI; a CI debug build does not replace permanently signed physical acceptance.

Dependencies are recorded in Notion: shared event/dedup/preferences contracts, secure server identity/admin checks, notification service/project configuration, and optional central infrastructure decisions. Existing private Google Drive accounting is not silently replaced by a second financial authority. No Supabase, paid signup, billing activation, public deployment or announcement was introduced.

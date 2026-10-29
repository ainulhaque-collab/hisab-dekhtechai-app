# Private workspace photo/logo replication — 27 October 2026

Selected task 05 / FEAT-009 in the [canonical tracker](https://app.notion.com/p/403bf836a600815a8dcccec4ca26eda9).

## Implemented behavior

Workspace details now saves a name/description and selected photo in the same database transaction as its durable outbox operation. Failed commits restore all of them. Images keep the existing centered 384×384 JPEG optimization, 5 MB input limit and 256 KiB optimized data-URL limit. The saved JPEG bytes are validated and SHA-256 checked; external URLs, SVG, bad base64 and altered checksums are rejected.

An optional `Workspace.image` object travels in existing private `workspace.create`/`workspace.update` operations and version-1 backups. No financial operation, database key, schema version, Google scope or public media host is introduced. The current image is stored with its workspace; operation history retains earlier image revisions. Photos contribute to the existing 40 MB downloaded-backup cap. Device PIN/biometric settings remain separate. A Drive backup is reported successful only through the existing upload/read-back verification.

Each image change uses a positive logical version and UUID. Greater versions win; concurrent equal versions use an ordinal UUID tie-break, independent of delivery order and device clocks. This rule applies to non-financial photos only. Removal is a versioned null-image tombstone, so older updates/backups and retained local photos cannot resurrect it. Renames or older full workspace upserts without an image preserve the current image revision. Conflicting bytes under the exact same revision are rejected.

## Upgrade and owner handling

On startup and after verified owner bootstrap, existing device-local photos are copied into the workspace/outbox only when the workspace and old asset belong to the dataset owner. The old asset database is retained for rollback and retries. Offline images are claimed only after the existing consented Google ownership binding commits. New image edits never write that legacy store.

Older v1 clients may retain new image fields in operation history while ignoring them in their workspace projection. On upgrade, validated same-owner operations reconstruct that projection without generating duplicate operations. Both add and removal revisions recover this way. This also prevents an older device's stale local photo from overriding a replicated removal.

The current client verifies owner/reference/author and image contents on incoming workspace operations; shared employees cannot use workspace metadata operations to replace owner photos. Foreign, malformed or conflicting batches roll back atomically. Legacy migration failures keep originals; local diagnostics report that copying will retry. A malformed legacy photo may need re-selection before it can be copied.

## Evidence and remaining acceptance

- Nine focused regressions pass: actual-byte hash, unsupported/oversize/corrupt inputs, atomic save/restart/rollback and unchanged financial summaries, idempotent owner-scoped migration, simulated private Drive plus downloaded backup, concurrent/reordered changes and removal, dependency ordering/owner/employee rejection, rehashed corrupt backups, old-client upgrade recovery, and clock-independent revisions.
- Complete local suite: **168/168 PASS** with serial concurrency. TypeScript and Vite build pass; current-commit remote CI is recorded in Notion/PR after execution. The actual Gemini key is absent from the client bundle.
- Test images are synthetic signature fixtures for storage/protocol checks, not browser image-decoding or visual evidence. The Drive transport is simulated; these tests do not claim a live Google or physical-device photo roundtrip.
- Web app and local AI API were restarted on ports 3000 and 3001. AI browser-authenticated review/Save, Bengali voice, hosted quota/HTTPS and physical signed-APK acceptance remain open. Installed signed Android version 7 does not receive source edits automatically.

Manual acceptance: in an updated client choose Menu → Workspaces → a workspace → upload/change photo → Save. Sync the same Gmail on another updated client and check its header/workspace image. Repeat Remove, restart and backup download/restore; ensure one device's older backup does not restore a removed photo. Verify accounts, transaction IDs/counts and balances before/after. Do not uninstall or clear app data for this test.

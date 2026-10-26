# Android Google connection investigation — 2026-10-26

The owner reported that signed APK `1.0.2-test` immediately shows the generic sync error after tapping Continue with Google, without an account chooser. Screenshot shows the local-record retention message. Initial process-filtered error logs did not contain a crash or explain the rejection. A silent native grant is possible when permission already exists; the absence of a chooser alone does not identify the failing stage.

## Confirmed code defects and changes

- The installed native SQLite SDK's `run()` defaults to starting its own transaction. The durability driver called it inside the explicit transaction used by bootstrap/owner binding and journal commits. The SDK rejects nested transactions with `Already in transaction`, and its automatic rollback can also end the outer transaction. Writes/deletes now join the explicit transaction; standalone writes retain their automatic transaction.
- Native bridge errors may arrive as objects containing `code`/`message`. Error presentation now reads both safely and returns static actionable messages for integration availability, Android OAuth configuration and SQLite transaction failures. Raw tokens, owner identifiers and response bodies are not displayed.
- Native authorization logs now contain only fixed stage names, plugin-registration availability and numeric Google status codes. They never log account data or tokens. A missing native Google integration is checked before invoking the plugin.

Focused regression tests exercise the installed SDK's strict transaction contract through the real driver, LocalDatabase and sync bootstrap. They verify durable owner retention after reopening, rollback after injected write failure, standalone writes/deletes and sanitized native error objects. All three focused tests and TypeScript passed before rebuilding. Physical confirmation of the screenshot's exact failure remains pending until the corrected APK is tested.

Version 4 (`1.0.3-test`) finished building before this correction and was preserved but not installed. The corrected candidate uses a higher version and the same permanent package/signing identity. Existing app data must be retained with replacement installation; never uninstall or clear-data to diagnose this issue.

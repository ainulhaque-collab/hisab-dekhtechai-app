# Android signed test build and verification

Started 2026-10-26 (Asia/Dhaka) at the owner's request. Checklist is maintained in [the existing Notion tracker](https://app.notion.com/p/403bf836a600815a8dcccec4ca26eda9). No customer distribution has started.

## Signing identity

The permanent identity is held in `.local-signing/` outside Git, with access restricted to the desktop owner Windows account. The keystore is encrypted PKCS12; its random password is wrapped with Windows CurrentUser DPAPI. The signing key is RSA-4096 with a SHA-256 self-signed certificate valid for 30 years. Private material is never uploaded to Notion, GitHub, or the Web bundle. Public certificate fingerprints are safe to use in Android OAuth configuration.

- Package: `com.hisabdekhtechai.app` (customer/test signed release package).
- Key alias: `hisabdekhtechai`.
- SHA-1: `B3:AF:2E:42:CC:CD:6A:A0:35:A9:7C:2E:5E:A0:71:3F:A0:D0:21:15`.
- SHA-256: `FD:8B:9E:BB:27:BC:F1:40:73:B2:DE:3C:E5:06:C5:97:0E:B2:FC:0C:13:7F:55:BA:6A:4D:A3:51:CC:3D:E5:C3`.

An incomplete sandbox-account attempt was retained separately in ignored `.local-signing-sandbox-incomplete/`; it has no certificate/APK and is not the app's signing identity. Signing scripts now refuse sandbox accounts. Only the desktop-owner identity above is used for builds.

Verified locally: PKCS12 decryption succeeds under the desktop owner; rerunning setup refuses to overwrite and leaves keystore bytes unchanged. Owner-only ACLs, ignore rules and protected password storage were checked. **Independent recovery backup is still pending.** DPAPI-wrapped credentials alone cannot recover a key after losing this Windows profile. Before customer release the owner must keep the keystore plus a separately recoverable password in appropriate secure backups; never send those credentials in chat.

## Local commands

Run PowerShell under the desktop owner account. Setup never replaces an existing signing directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-AndroidSigningIdentity.ps1
```

The initial identity already exists; do not run this again to create another key. `-ResumeIncomplete` only packages an existing encrypted private key if no completed keystore exists; it never generates a replacement identity.

Free build tools are installed into ignored `.local-tools/`, without changing the system installation. Downloads use official sources and verified SHA-256 checksums:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-AndroidTools.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-SignedAndroid.ps1 -VersionCode 3 -VersionName 1.0.2-test
```

The setup installs JDK 21, Android platform 36/build-tools/platform-tools, Gradle 8.13 and a wrapper. It retains SDK license/install logs locally. The signed-build script runs type checks, tests, Web build, Capacitor sync and `assembleRelease`, then checks the APK signing certificate against the permanent key. It writes an APK hash, source commit and version evidence to the private local directory. VersionCode must increase after the last successful signed build. Build success is not physical-device acceptance.

Passwords pass only through the short-lived build process environment; no secret is passed in command-line arguments, Gradle source, JavaScript or committed properties. The script clears its password variables afterward. Do not enable verbose environment dumps or publish local signing files.

## CI and release policy

The existing debug CI retains test artifacts but no longer has a public GitHub Release action or write permission to repository contents. It remains a debug test build; fresh-runner debug signing does not provide customer update continuity. The placeholder Capacitor release-keystore path has been removed; Gradle is the signing authority, using explicit environment inputs. Release tasks fail if credentials, a real keystore, explicit version name, or versionCode above baseline 2 are missing.

No push, public release, paid account registration, OAuth production change, or customer deployment is authorized by completing these local scripts. Those operations require the owner's specific authorization when a concrete build and evidence are ready.

## Acceptance still required

- Register an Android OAuth client for the package/fingerprint above in the intended project, with the Web client and backup migration plan coordinated.
- Confirm that native compilation/signature verification really succeeds; do not label APK ready from script preparation alone.
- On the owner's test phone verify offline journals, selectors, app lock, backup/restore, charts and same-owner Android ↔ Web sync.
- Build a second, higher-version APK using the same key; install over the first without uninstall/clear-data and compare original UUIDs, balances, local preferences/media and pending operations.
- Complete recovery backups, privacy/branding and distribution registration before inviting customers. Existing historical debug APKs are a different package (`.debug`) and must not be uninstalled to force a signed release update.

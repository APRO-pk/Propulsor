# Propulsor — Windows packaging & "why Windows deletes it"

This document explains **why Windows security removes the app** and how to build a
Windows installer it will trust.

## TL;DR

Windows isn't rejecting Propulsor for a code bug. It deletes/blocks it because the
executable is **unsigned**. The exact block seen during builds and installs is:

- `os error 4551` / process exit `0xC0E90002` — **Windows Defender / Application
  Control (WDAC) deleting or blocking an unsigned binary.**
- SmartScreen "Windows protected your PC / unknown publisher".
- Defender Antivirus quarantining a freshly-built, low-reputation `.exe`.

The one real fix is **code signing** with a trusted certificate. Everything below
is how to do that; the app and its Tauri wrapping are already configured for it.

---

## 1. What's already set up

- **`src-tauri/tauri.conf.json`** — production bundle config: real reverse-domain
  identifier (`com.apro.propulsor`), `publisher: "APRO Works"`, copyright,
  descriptions, icons, `webviewInstallMode: downloadBootstrapper`, NSIS per-machine
  installer, and the signing knobs (`digestAlgorithm: sha256`,
  `timestampUrl`). No `certificateThumbprint` is committed (unsigned by default).
- **`package.json`** (this folder) — run Tauri from here; it finds `./src-tauri`.
- **`src-tauri/tauri.signing.json`** — a `--config` overlay that adds your cert
  thumbprint for signed builds (fill in the placeholder, keep it out of version
  control).

## 2. Build (unsigned — for internal/dev use)

```bash
# from engines/app/
npm install
npm run build          # runs `tauri build`
```

This builds the frontend (`beforeBuildCommand`), compiles the Rust host, and
produces installers under `src-tauri/target/release/bundle/` (NSIS `.exe` and MSI
`.msi`). An **unsigned** installer will trigger SmartScreen and may be quarantined
by Defender/WDAC — see §4.

> On a machine with a strict WDAC/Defender dev policy, the *compile* itself can be
> interrupted (`os error 4551`) when Defender deletes a freshly-built `.rlib`. Add a
> Defender exclusion for the `target/` directory while developing (see §5), or build
> on a machine/CI without that policy.

## 3. Build (signed — for distribution)

You need a **code-signing certificate**. Options, best first:

1. **Azure Trusted Signing** (Microsoft, cheap, cloud-based, no USB token). Gives
   immediate SmartScreen reputation for an approved publisher.
2. **OV or EV code-signing certificate** from a CA (DigiCert, Sectigo, GlobalSign).
   EV builds SmartScreen reputation instantly; OV builds it over time/installs.

### 3a. Sign with a certificate in the Windows cert store (signtool)

1. Import the cert; note its **SHA-1 thumbprint** (Certificates MMC → Details →
   Thumbprint, remove spaces).
2. Put it in `src-tauri/tauri.signing.json`:
   ```json
   { "bundle": { "windows": { "certificateThumbprint": "AB12CD…" } } }
   ```
3. Build signed:
   ```bash
   npm run build:signed        # tauri build --config src-tauri/tauri.signing.json
   ```
   Tauri signs the app `.exe` **and** the installer with SHA-256 + RFC-3161
   timestamping (so signatures stay valid after the cert expires).

### 3b. Sign with Azure Trusted Signing / a custom command

Add a `signCommand` under `bundle.windows` instead of a thumbprint, e.g. calling
`trusted-signing-cli` or your own `signtool` wrapper:
```json
{ "bundle": { "windows": {
  "signCommand": "trusted-signing-cli -e https://<region>.codesigning.azure.net -a <account> -c <profile> %1"
} } }
```
`%1` is the file Tauri passes to be signed.

## 4. Why an installed app still gets removed — and the fixes

| Guard | Symptom | Fix |
|---|---|---|
| **SmartScreen** | "Unknown publisher", "Windows protected your PC" | Sign with OV/EV or Azure Trusted Signing; reputation clears the prompt (instant with EV). |
| **Defender Antivirus** | Installer/exe quarantined or auto-deleted | Signing + a known publisher removes the low-reputation heuristic; submit a false-positive report to Microsoft if needed. |
| **WDAC / Application Control** (`os error 4551`, `0xC0E90002`) | File blocked/deleted even after install | The app must be signed by a certificate the **organization's WDAC policy trusts**, or an admin adds a signer/hash rule for it. This is an org-policy action, not something the app can self-fix. |

For the **APRO Works** deployment specifically: whatever WDAC/AppLocker policy is in
force on those machines is what deletes it. Sign with a cert their policy allows, or
have IT add a **publisher (signer) rule** for "APRO Works" (works for all future
signed versions) or a **file-hash rule** for this build.

## 5. Developer machine: stop Defender eating the build output

If Defender/WDAC on your dev box interrupts `cargo`/`tauri build`
(`os error 4551`), exclude the build directories (run as admin, **PowerShell**):

```powershell
Add-MpPreference -ExclusionPath "C:\Users\laiba\Downloads\Engine\target"
Add-MpPreference -ExclusionPath "C:\Users\laiba\Downloads\Engine\engines\app\src-tauri\target"
```

This only affects your local dev machine and does not change how the shipped,
signed installer behaves. (This is a Windows security setting — apply it yourself;
the app cannot and should not change it for you.)

## 6. WebView2 runtime

The installer uses `downloadBootstrapper` (small installer; pulls the Evergreen
WebView2 runtime at install if missing). For fully-offline target machines, switch
`bundle.windows.webviewInstallMode.type` to `"offlineInstaller"` (bundles the whole
runtime, ~130 MB) or `"embedBootstrapper"`.

## 7. This app is Tauri, not Electron

Propulsor is a **Tauri v2** app: a small native Rust host (`engine-core` +
`simulate` compiled in) rendering the React frontend in the OS WebView2. There is
no Electron/Chromium bundle. The commands above are the only build path — do not
add an Electron wrapper.

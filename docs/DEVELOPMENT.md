# Development

## Version

Three places carry it and they have to agree:

```text
package.json          version
android/AndroidManifest.xml  versionName and versionCode
```

`versionName` matches the `package.json` version; `versionCode` is an integer
that only ever goes up, because Android refuses an update whose code is not
higher than the installed one.

The APK build stamps a `version.json` into the bundled web assets containing:

- version
- code
- UTC build timestamp

Settings displays the build version/date.

## Philosophy

Dazzle Diary intentionally avoids a conventional Android/JavaScript dependency stack.

There is:

- no Gradle project
- no JavaScript framework
- no bundler
- no runtime npm dependencies

The repository should remain buildable with a small, explicit toolchain.

## Prerequisites

- JDK 17+
- Node.js 20+
- `zip`
- Android SDK platform 34
- Android build-tools 34.0.0

The build directly uses:

- `aapt2`
- `javac`
- `d8`
- `apksigner`

## Prepare the SDK

```bash
sdkmanager 'platforms;android-34' 'build-tools;34.0.0'
export PATH="$ANDROID_HOME/build-tools/34.0.0:$PATH"

mkdir -p android/sdk
cp "$ANDROID_HOME/platforms/android-34/android.jar" android/sdk/android.jar
```

## Build the APK

```bash
cd android
./build.sh
```

Default output:

```text
android/dazzle-diary.apk
```

## Build stages

`android/build.sh` runs seven explicit stages.

### 1. Bundle the web app

Copies:

```text
app/
```

into:

```text
android/assets/web/
```

and writes the build stamp.

### 2. Compile resources

`aapt2 compile`

### 3. Link resources, manifest and assets

`aapt2 link`

with:

```text
min SDK 24
target SDK 34
```

### 4. Compile Java

`javac` compiles the Android host.

The script uses source/target 8 bytecode while requiring a modern JDK toolchain.

### 5. Dex

`d8`

### 6. Package and align

The classes dex is inserted into the APK.

`android/zipalign.mjs` performs the 4-byte alignment required for stored resources, avoiding a dependency on a `zipalign` command in PATH.

### 7. Sign

`apksigner`

The final signature is verified.

## Build environment

Variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SDK_JAR` | `sdk/android.jar` | API 34 platform jar |
| `KEYSTORE` | `keystore.jks` | signing keystore |
| `KEYSTORE_PASS` | `changeit` | keystore/key password |
| `KEY_ALIAS` | `logbook` | key alias |
| `OUT` | `dazzle-diary.apk` | output path |

## Signing

If the configured keystore does not exist, local `build.sh` generates one.

This is convenient for development but the signing identity becomes part of the installed-app lifecycle.

Android will not install a differently signed APK over an existing copy.

Keep the real release key safe.

Never commit it.

## JavaScript checks

```bash
npm run check
```

This runs `node --check` across every tracked `.js`/`.mjs` file.

## Tests

```bash
npm test
```

The test command is:

```text
node --test test/*.test.mjs
```

The suite covers pure domain behaviour and user-facing client behaviour.

### Pure logic

High-value areas include:

- CSV parsing
- title matching
- ambiguous products
- order pricing
- status/date transitions
- drill-count estimation
- shop parsing
- restore semantics

### Client test harness

The repository now has a browser substitute under `test/`.

The hand-written harness includes:

- DOM implementation
- IndexedDB shim
- client mounting/stubbing

It can boot the real `app.js` and drive interactions by tapping/typing against rendered UI rather than only calling private functions.

This is useful because Dazzle's harder regressions increasingly sit in the boundary between:

- state
- routes
- DOM
- local API

rather than in a single pure function.

## Manual preview

`tools/preview.mjs` serves `app/` over HTTP so the client can be opened in an ordinary browser.

Use it for quick UI inspection while remembering that Android-only bridge features will be absent/stubbed.

## Layout probe

`tools/layout-probe.mjs` resolves the CSS cascade for a supplied viewport width.

It is not a browser renderer, but it is useful for questions such as:

> At 1028 CSS px, which width rules win?

This is particularly valuable for foldable/tablet regressions where reasoning from raw device pixels is misleading.

## Responsive checks

Manual testing should cover at least:

- narrow phone
- wider phone
- ~620px CSS width
- just below 900px
- just above 900px two-pane threshold
- 1000px+ Details form layout
- fold/unfold while app is running

Verify:

- card grid column count
- logbook/right-pane split
- Settings remains sequential
- Details form uses wide columns only where intended
- scroll position survives navigation
- keyboard/`adjustResize` behaviour

## Catalogue testing

For every adapter, test:

- kit classification
- supply exclusion
- title
- artist
- price/currency
- size
- shape
- drill count
- images
- product link

If an adapter has `spec()`, test the lazy product-page path separately.

## Native network allowlist

The Android host is a security boundary.

Adding an adapter in `app/core/shops.js` is not enough.

Update the native `ALLOWED` host list in `MainActivity` with the narrowest required merchant/CDN names.

A missing host fails safely with:

```text
host not allowed
```

This is checked automatically: `test/core.test.mjs` reads the allowlist out of `MainActivity.java` and fails if any shop in `app/core/shops.js` is missing from it. The check exists because Munimade once shipped in the adapters and not in the allowlist, which made the shop unreachable while reporting only `HTTP 500`.

## Main branch protection

The project expects work to land through pull requests rather than direct writes to `main`.

For an earlier local failure:

```bash
git config core.hooksPath tools/hooks
```

enables repository hooks intended to catch unsafe direct workflow before GitHub branch protection does.

## CI

`.github/workflows/ci.yml` runs on:

- pushes to `main`
- pull requests
- manual dispatch

### Tests and syntax

CI uses Node 22 and runs:

```bash
npm run check
npm test
```

### Workflow linting

`actionlint`

### Semgrep

CI installs a pinned Semgrep CLI version and scans JavaScript/Java plus security/secrets rules.

### Gitleaks

CI downloads a pinned Gitleaks release and verifies the archive SHA256 before running it.

### Repository content guard

CI fails if tracked files include patterns such as:

- keystores
- logbook data directories
- shopdata
- vendored `android.jar`

### APK build

CI:

- installs Java 17
- installs Android platform/build tools 34
- uses an ephemeral signing key
- runs `android/build.sh`
- verifies the APK signature
- checks APK structure/alignment
- uploads the debug artifact

### CodeQL

A separate CodeQL workflow provides additional static analysis.

### Pinned Actions

GitHub Actions are pinned to full commit SHAs.

## Release workflow

`.github/workflows/release.yml` runs for:

- `v*` tags
- manual release dispatch

It:

1. runs tests;
2. restores the real signing key from repository secrets when configured;
3. builds the APK;
4. writes release notes explaining whether the key was real/ephemeral;
5. uploads `dazzle-diary.apk` to the GitHub Release;
6. deletes the restored key from the runner.

A release signed with an ephemeral key cannot upgrade an installation signed with the real project key.

## Source organisation

```text
app/core/      domain logic
app/local/     local API and IndexedDB
app/app.js     UI/routes/state
app/styles.css responsive presentation
android/src/   WebView/native bridge
test/          unit + client harness
tools/         preview/layout/icon/hooks
.github/       automation
```

## Versioning

Keep these in step:

```text
package.json version
AndroidManifest.xml versionName
AndroidManifest.xml versionCode
release tag
```

`versionCode` must increase for Android upgrades.

`version.json` is generated during build rather than maintained by hand.

## No generated source of truth

Do not edit:

```text
android/assets/web/
```

as the authoritative app source.

`build.sh` recreates it from `app/`.

Changes belong under `app/`.

## Development review checklist

Before merging:

- [ ] `npm run check`
- [ ] `npm test`
- [ ] APK builds
- [ ] existing data upgrades safely
- [ ] backup/restore remains compatible
- [ ] no unsupported host added to proxy
- [ ] shop adapter and native allowlist agree
- [ ] project currency is preserved
- [ ] status/date semantics match across every UI path
- [ ] phone and wide layouts checked
- [ ] user-facing docs updated

# Security and privacy

## Privacy model

Dazzle Diary is local-first.

There is no Dazzle Diary account, analytics backend or central logbook database.

Personal state normally stays on the device.

The main exceptions are explicit/user-understandable actions:

- merchant catalogue/product requests go to those merchants/CDNs;
- opening **View on shop** hands that URL to the system browser;
- creating backup/CSV writes a copy into Downloads;
- sharing a progress photo copies it into Android shared media and gives another app permission to read it.

## Android permissions

The manifest requests:

```xml
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE
```

There is no broad storage permission in the manifest.

The app uses platform APIs such as MediaStore/file chooser instead of requesting unrestricted external-storage access.

## Application storage

Structured data is stored in IndexedDB.

Media bytes are stored in the app's private files directory.

The Android WebView itself has:

```text
setAllowFileAccess(false)
setAllowContentAccess(false)
```

so the page is not given generic filesystem/content access.

## Private application origin

The packaged page is served from:

```text
https://appassets.androidplatform.net
```

The native host intercepts this virtual origin.

Benefits:

- normal URL semantics
- IndexedDB/service worker support
- no need to give the page `file://` access
- an origin to bind trust-sensitive bridge behaviour to

## Top-level navigation

The WebView allows the packaged app origin to remain inside the WebView.

Other top-level destinations are opened through an external Android activity/browser rather than loading into the privileged WebView.

This matters because `JavascriptInterface` capabilities are attached to the WebView.

## JavaScript bridge trust check

`MainActivity` tracks whether the current page host is the packaged app host.

Bridge methods call a guard equivalent to:

```text
mustBeOurPage()
```

before operating.

This is defence in depth in case navigation behaviour changes later.

## Bridge capabilities

The bridge is purpose-specific rather than a general filesystem/network API.

Capabilities include:

- save a cover/progress file into controlled app-private paths
- save an export into Downloads
- share a progress photo
- read system dark mode
- update system bar colour

File paths are validated/canonicalised.

Incoming media writes have a size limit.

## Native network proxy

The packaged web page cannot directly fetch most merchant origins because they do not send suitable CORS headers.

Dazzle uses:

```text
/__net/?url=...
```

The Android host performs the request.

### Rules

The proxy accepts:

- HTTPS only
- GET-style retrieval
- allowlisted hosts only

Redirects are followed manually so every hop is revalidated.

A chain longer than five redirects is rejected.

Connection/read timeouts are configured.

## Host allowlist

The shell allows merchant/CDN suffixes for:

```text
diamondartclub.com
mysticaldreamdiamonds.com
pressedandplaced.com
diamondartuk.co.uk
fallongems.com
diamondartstudio.co.uk
munimade.com
cdn.shopify.com
myshopify.com
wp.com
```

Matching permits the exact hostname or a subdomain of one of those entries.

### Keeping it in step with the shop adapters

This list and `app/core/shops.js` have to agree. A shop in the adapters and not
here cannot reach the network at all: the proxy refuses the request, which is
the safe outcome, but the shop simply never syncs.

That happened once — Munimade shipped in the adapters and not in the allowlist —
so a test in `test/core.test.mjs` now reads the list out of `MainActivity.java`
and fails if any shop is missing from it. The fix for a new shop is a deliberate
one-host addition, never a loosening of the matching rule.

## Merchant redirects

Do not switch back to automatic unrestricted redirect handling.

An allowed merchant can return a redirect to another host.

The current host rechecks each target before following it.

That prevents an allowed origin from becoming an SSRF-style bounce to an arbitrary destination.

## External merchant content

Merchant JSON/HTML/image content is untrusted input.

The web client should:

- escape values inserted into HTML
- parse only required fields
- avoid executing merchant-supplied script
- avoid creating new privileged destinations from arbitrary merchant data

The native proxy returns merchant bytes but does not grant the merchant page access to the JavaScript bridge.

## Lazy product-page parsing

Some adapters may retrieve an individual product HTML page to fill missing specification.

This is deliberately limited to linked/owned projects with missing fields.

It avoids a broad crawl and reduces exposure to remote content.

## Photo privacy

Progress photos start in app-private storage.

### Add

The Android file chooser/camera supplies a user-selected image.

The app downscales it and writes the resulting bytes privately.

### View

Private photos are served only through the app's virtual origin route.

### Share

**Share** is an explicit export.

The bridge:

1. copies the image into Android `MediaStore.Images`;
2. creates an `ACTION_SEND` intent;
3. grants read permission to the receiving app.

Once shared/copied into shared media, that copy is outside Dazzle Diary's private storage boundary.

### Delete

Photo deletion is delayed for a short Undo window.

## Backups

A full backup contains sensitive personal history and progress-photo bytes.

It is written into the user's Downloads collection.

Treat it as private data.

Do not:

- attach it to a public GitHub issue;
- commit it to the repository;
- paste it into logs;
- upload it to an unrelated service for debugging without deliberate consent.

## Restore

Restore accepts user-selected JSON and therefore treats the file as untrusted input.

The local store:

- requires a `projects` array;
- only processes known application structures;
- maps project IDs rather than trusting old IDs as local identities;
- ignores old cover filenames;
- deduplicates sessions/photos where possible.

Additional schema/size validation is still a security-hardening area worth protecting in future changes.

## CSV import

CSV is user-selected input and should be parsed as data.

Do not evaluate cells or treat CSV content as HTML.

Spreadsheet formula injection is relevant to **exported CSV** if arbitrary user text is ever emitted at the beginning of spreadsheet formula cells; keep this in mind when changing export behaviour.

## Cleartext manifest setting

The manifest currently contains:

```xml
android:usesCleartextTraffic="true"
```

The native merchant proxy itself explicitly rejects non-HTTPS targets.

The private app URL also uses `https://appassets.androidplatform.net`.

`usesCleartextTraffic=true` therefore does not mean the intended merchant request path permits HTTP, but the broad manifest setting should still be reviewed if no longer necessary.

## WebView settings

Security-relevant current choices include:

- JavaScript enabled because the whole UI is JavaScript
- DOM storage enabled
- database storage enabled
- file access disabled
- content access disabled
- zoom controls disabled
- external navigation moved out of privileged WebView
- bridge trust state tied to page host

Any change to these deserves security review.

## Threat model

### Malformed merchant data

Risk:

- broken parsing
- unsafe markup insertion
- incorrect matching

Controls:

- normalisation
- HTML escaping in UI
- pure parser tests
- conservative matching

### Compromised/hostile merchant or redirect target

Risk:

- unexpected content or redirect

Controls:

- HTTPS
- host allowlist
- per-hop redirect validation
- no remote top-level page in privileged WebView

### Malicious backup

Risk:

- malformed/oversized content
- unexpected values

Controls:

- explicit restore route
- structured parsing
- known-field merge behaviour
- no trust in old local paths

### Malicious CSV

Risk:

- parser edge cases
- misclassification/matching

Controls:

- parse as text/data
- preview before commit
- ambiguity review

### Accidental data loss

Risk:

- uninstall
- clear storage
- destructive edit
- accidental back from a long form

Controls:

- full backup
- merge restore
- dirty-form confirmation
- Undo for photo deletion
- stable signing key for upgrades

## CI security controls

CI includes:

- `actionlint`
- Semgrep
- Gitleaks with downloaded archive hash verification
- CodeQL
- a guard against committing keystores/logbook data/vendor SDK files
- SHA-pinned GitHub Actions
- APK signature/structure verification

## Release signing

The signing key is the continuity identity of the Android application.

A different key cannot upgrade an installed copy.

Release automation restores the key from secrets when configured and deletes it from the runner afterwards.

Never commit:

```text
*.jks
*.keystore
```

## Third-party terms and artwork

Dazzle retrieves merchant product data and images for a personal logbook.

Product names, artwork and merchant branding remain third-party content.

When adding/changing a provider, review:

- merchant terms
- technical/rate limits
- intended API/feed usage
- caching constraints
- whether image redistribution is permitted

Dazzle should not become a bulk third-party catalogue redistribution service.

## Reporting security problems

See [`../SECURITY.md`](../SECURITY.md).

Do not include a real backup, personal photo, signing key or other sensitive material in a public report.

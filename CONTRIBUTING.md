# Contributing to Dazzle Diary

Dazzle Diary is intentionally small.

A good contribution improves the user's logbook without turning the app into a cloud service, framework-heavy build or collection of UI-specific business rules.

## Read first

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CATALOGUES_AND_IMPORTS.md`](docs/CATALOGUES_AND_IMPORTS.md)
- [`docs/DATA_AND_BACKUP.md`](docs/DATA_AND_BACKUP.md)
- [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md)
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for user-facing changes

## Principles

### Keep personal data local

Ordinary logbook use must not require a Dazzle Diary backend without an explicit architecture decision.

### Keep core rules out of individual screens

If a rule applies to multiple UI paths, put it in a shared domain/storage layer.

Examples:

- status/date coupling
- progress/completion semantics
- price provenance
- matching
- estimation

Dazzle now has several ways to change status/date/cost. They must not drift.

### Preserve durable projects

Catalogue data is enrichment.

A project must survive:

- unlink
- sync failure
- product rename/removal
- merchant outage

### Ask rather than guess

Import matching is intentionally conservative.

Reducing prompts by silently increasing wrong matches is a regression.

### Preserve user corrections

Catalogue refresh/relink should not casually overwrite user-entered project metadata.

### Keep the native bridge narrow

Do not add a general unrestricted:

- filesystem API
- arbitrary network fetch
- intent launcher

because it is convenient.

Add purpose-specific capabilities.

## Development checks

```bash
npm run check
npm test
```

For Android/native/packaging changes:

```bash
cd android
./build.sh
```

## UI changes

The client test harness can boot the real `app.js`.

Prefer tests that drive user-visible behaviour where practical.

For responsive changes also use:

```text
tools/layout-probe.mjs
tools/preview.mjs
```

and test real phone/wide widths.

Important thresholds currently include:

```text
620px  wide-layout rules
900px  two-pane shell
1000px Details/New form multi-column flow
```

Do not detect specific Samsung/Fold/tablet models when available CSS width answers the real question.

## Navigation changes

Protect:

- Android Back behaviour
- route depth/history semantics
- form discard protection
- scroll restoration
- two-pane left/right route behaviour

A route fix that works on phone can still regress two-pane history.

## Project interactions

The project page is the primary maintenance surface.

Routine actions include:

- status
- rating
- progress
- dates
- cost
- sessions
- holds
- notes
- photos

The **Details** form is the deeper correction surface.

Avoid moving ordinary recurring actions back into a giant form without a strong reason.

## Adding/changing a shop

A shop change is cross-layer work.

At minimum:

1. implement/update adapter in `app/core/shops.js`;
2. verify project/supply classification;
3. verify currency;
4. test feed parsing;
5. add any product-page `spec()` parser only when needed;
6. update the Android host allowlist;
7. verify CDN/redirect hosts;
8. test Browse;
9. test project creation/relink;
10. test import interactions;
11. review terms/rate limits;
12. update docs.

### Do not skip the native allowlist

A test enforces this: it reads the allowlist out of `MainActivity.java` and fails if a shop in `app/core/shops.js` is missing from it.

The proxy fails safely, but the feature is unusable.

Treat this as a regression class worth testing.

## Currency changes

Use the shared `CURRENCIES` list.

Do not create independent currency lists in Settings/forms.

Preserve an existing currency value even if it is not one of the currently offered buttons.

Do not sum mixed transaction currencies into a single amount unless there is an explicit conversion rule.

## Data migrations

When IndexedDB/project shape changes:

- preserve existing data;
- make migration idempotent where possible;
- test upgrade from realistic old state;
- confirm backup/restore;
- confirm Summary still interprets old records safely.

A clean-install-only success is not enough.

## Backup compatibility

Treat JSON backup as a user contract.

Current backup version includes:

- projects
- sessions
- photos

Hold history is part of projects.

When adding fields:

- old backups should normally restore;
- missing fields need safe defaults;
- do not repurpose an old field incompatibly.

When adding new irreplaceable personal data, decide explicitly whether backup must carry it.

## Native network boundary

The allowlist in `MainActivity` is security-critical.

Do not broaden it to wildcard internet access.

Every redirect hop is deliberately revalidated.

## Photo sharing

Sharing intentionally exports a private image into Android shared media.

Changes here should consider:

- what copy is left behind
- content URI permissions
- MIME type
- title/text passed to recipient apps
- whether temporary cleanup is desirable

## Pull-request expectations

Explain:

- user problem
- behaviour changed
- layer chosen and why
- tests
- data migration impact
- backup compatibility
- network host changes
- permissions/bridge changes
- catalogue/currency implications
- responsive/two-pane implications

## Branch workflow

The repository expects changes through pull requests.

To enable the repository's local hooks:

```bash
git config core.hooksPath tools/hooks
```

## Dependencies

The absence of runtime dependencies is intentional.

Before adding one, ask:

- can the platform already do this?
- does it improve correctness/security enough to justify supply-chain/update cost?
- does it require a bundler or Gradle?
- can the same result stay transparent in a small amount of code?

Framework adoption is an architecture decision.

## Security-sensitive files

Give extra review to:

- `android/src/.../MainActivity.java`
- `android/AndroidManifest.xml`
- `app/local/store.js`
- `app/core/shops.js`
- `app/core/status.js`
- backup/restore/export
- photo handling
- release workflow/signing

## Documentation

User-facing behaviour changes should update docs in the same PR.

Implementation comments are not a replacement for user/developer documentation.

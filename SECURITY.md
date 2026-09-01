# Security policy

## Reporting a vulnerability

Do not include sensitive Dazzle Diary data in a public GitHub issue.

In particular, do not attach:

- full backup JSON
- progress photos
- order-history CSVs containing personal/order information
- signing keys/keystores
- secret material

Use GitHub private vulnerability reporting for the repository if it is enabled.

If private reporting is unavailable, open a minimal public issue asking for a private contact route without exploit details or personal data.

## Security-sensitive scope

Areas that deserve security treatment include:

- Android WebView configuration
- top-level navigation
- `LogbookNative` JavaScript interface
- native HTTPS proxy
- host allowlist and redirect handling
- app-private media paths
- photo sharing/MediaStore export
- backup and restore
- CSV import/export
- APK signing
- release automation
- secret/personal-data exposure in the repository

## Supported versions

Until a formal support window exists, security fixes are expected on:

- current `main`
- the newest published release

Users should move to the newest release after a security fix.

## What is normally an ordinary bug

These are not automatically security vulnerabilities:

- a merchant catalogue changing shape
- a shop rate-limiting/refusing a sync
- incomplete/inaccurate merchant metadata
- a missing merchant product after it was delisted
- a user being able to read their own JSON/CSV export
- an unavailable catalogue adapter caused by an allowlist mismatch

They can still be important defects.

## Useful reports

A strong security report includes:

- affected version/build
- exact route/feature
- prerequisites
- reproducible steps with synthetic data
- security impact
- whether it crosses the app-private/network boundary

Avoid sending real personal logbook data when a minimal synthetic case can demonstrate the problem.

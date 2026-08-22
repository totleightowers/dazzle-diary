# Diamond Painting Logbook

A logbook for diamond painting projects that runs entirely on an Android phone.
No account, no cloud, no server. It reads the public product feeds of six shops,
so a kit you have bought arrives with its cover, artist, canvas size, drill
shape, colour count and diamond count already filled in.

Built on the phone it runs on — the Android toolchain, the build script and the
APK were all produced under Termux on the device itself.

## What it does

- **Import an order-history CSV** and match every line against the shops' own
  catalogues. Tools, coasters and accessories are recognised and skipped by
  product type, not by guessing at keywords.
- **Work out what you paid.** A kit ordered on its own takes the order total
  exactly; several kits with no accessories split it in proportion to list
  price; otherwise it falls back to the list price. Every project records which
  of the three it got, so an estimate never passes for a fact.
- **Estimate missing diamond counts** from canvas size. The densities
  (12.78/cm² round, 16.08/cm² square) were measured across 3,595 kits that
  publish both a size and a real count, and land within 5% for 95%+ of them.
  Square drills are 2.5 mm, which is exactly 16 per cm².
- **Track progress**, log hours, keep photos, browse all six catalogues offline,
  and drag a project between status columns.

## The interesting problems

**Titles are not unique.** One shop sells four different "Alice in Wonderland"
canvases. A CSV line gives only a title, so the importer prices out every
combination of candidates against what the order actually charged — accessories
included, which is why they stay in the catalogue — and takes the closest fit.
When the runner-up is within £4 it refuses to guess and asks.

**Products get renamed.** "Old Masters" became "Old Masters - MEGA Dazzles™".
Exact matches and prefix variants are both collected, so a renamed kit is still
offered even when the plain title also matches something.

**Titles can contain commas.** The Products column is a comma-joined list inside
one quoted CSV field, so *Frejya, Goddess of Beauty & War* arrives as two
fragments. They are rejoined by testing the combination against the catalogue
and preferring the longest match that exists.

**Currency.** Shopify's product feed accepts `?currency=`, which returns that
market's real prices rather than a conversion invented locally. Without it a
Canadian shop's CA$225 kit reads as £225.

## How it is put together

```
app/          the whole application — plain ES modules, no build step
  core/       pure logic: CSV, matching, pricing, status rules, shop adapters
  local/      IndexedDB storage and an API the UI talks to
android/      the APK: one Activity, ~300 lines of Java
test/         node --test over core/
```

The page is served from the APK's own assets over a private `https://` origin,
so it gets a secure context. A small Java layer covers the three things a web
page cannot do for itself: read and write the app's own files, and fetch another
origin — the shops send no CORS headers.

There are no dependencies. Nothing is installed at build or run time.

## Building

Needs `aapt2`, `d8`, `apksigner`, JDK 17+, `zip`, `node`, and an API 34
`android.jar` at `android/sdk/android.jar`. On Termux:

```sh
pkg install openjdk-17 aapt2 d8 apksigner nodejs-lts zip
cd android && ./build.sh
```

`zipalign.mjs` is included because Termux ships no `zipalign`, and Android will
not install an APK whose `resources.arsc` is not 4-byte aligned.

Signing uses `android/keystore.jks`, generated on first build. **Keep it** —
updates must be signed with the same key or Android will refuse to install over
the existing app. Override with `KEYSTORE`, `KEYSTORE_PASS` and `KEY_ALIAS`.

## Tests

```sh
npm test
```

Covers the parts where being wrong is quiet: comma-in-title CSV parsing, order
reconciliation, the refusal to guess, the status/date rules agreeing in both
directions, and the drill estimate against kits whose real counts are published.

## A note on the shops

The app reads each shop's public product listing — the same JSON their own
storefront uses — and caches cover images locally for kits you own, which is
what a shop's own logbook does. Artwork remains the copyright of the artists and
the shops. Don't redistribute it.

## Licence

MIT — see LICENSE.

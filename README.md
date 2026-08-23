# Dazzle Diary

**Dazzle Diary** is an Android app for keeping track of a diamond painting
stash — what you own, what you have finished, how far through you are, and what
it all cost.

It reads the public product listings of six shops, so a kit you have bought
arrives with its cover image, artist, canvas size, drill shape, colour count and
diamond count already filled in. There is no account, no cloud and no server:
everything lives in the app's own storage on the phone.

Supported shops: **Diamond Art Club**, **Mystical Dream Diamonds**,
**Pressed and Placed**, **Diamond Art UK**, **Fallon Gems** and
**Diamond Art Studio**.

## Features

### Your stash

- Projects grouped into **Not received → Received → Started → Completed**, with
  a cover thumbnail, artist, size, drill shape and diamond count on every card.
- **Drag a project between groups** to change its status.
- **Status and dates stay in agreement, in both directions.** Marking a project
  *received* fills in any blank dates up to that point and clears the later
  ones; typing a completion date moves it to *completed* on its own.
- **Progress percentage** with a bar on anything in progress, **hours logged**,
  free-text **notes**, and a **sold price** for kits that move on.
- Search across titles and artists, filter by status, and see at a glance which
  shop a project came from — each shop has its own colour throughout the app.

### Catalogues

- **Browse all six shops offline.** Catalogues are cached on the phone, so
  adding a kit needs no network once they are synced.
- Filter by shop, drill shape, canvas size (up to 40 cm, 40–60, 60–80, 80+) and
  a maximum price; sort by best match, A–Z, cheapest, dearest, biggest or most
  drills. A clear button resets the lot.
- **Choose which shops to sync.** Turn off the ones you do not buy from and they
  are neither fetched nor shown.
- Every project keeps a link back to its product page.

### Importing an order history

- **Load an order-history CSV** and have each line matched against the shops'
  own catalogues. Tools, coasters and accessories are recognised and skipped by
  product type rather than by guessing at keywords.
- **Prices are worked out, not invented.** A kit ordered on its own takes the
  order total exactly; several kits with no accessories split it in proportion
  to list price; otherwise it falls back to the current list price. Each project
  records which of the three it got, so an estimate never passes for a fact.
- Where a title is ambiguous the importer **asks instead of guessing**, and
  remembers the answer for future imports.

### Photos

- Attach **progress photos** to any project, several at a time, and swipe
  through them alongside the shop's own listing images in a carousel.
- Photos are downscaled on the way in, so a few hundred of them stay a sensible
  size rather than filling the phone with camera-resolution originals.

### Statistics

- Projects, completed count and hours logged.
- **Diamonds placed so far** — every finished canvas plus how far through you
  are on the ones on the go — and how many are **still to place** across the
  rest of the stash.
- Most collected artists and most bought-from shops.

### Missing diamond counts

Shops do not always publish a drill count. Where one is missing it is estimated
from the canvas size, at **12.78/cm² round** and **16.08/cm² square**. Those
densities were measured across 3,595 kits that publish both a size and a real
count, and land within 5% for over 95% of them. (Square drills are 2.5 mm,
which is exactly 16 per cm².) Estimated counts are always shown with a `≈`.

### Your data

- **Everything stays on the phone.** The only network requests are to the shops'
  own public product listings.
- **Back up to a single JSON file** — projects, photos and all — and restore it
  on another phone. Restoring merges rather than overwrites: it will not clobber
  progress, hours, notes or a sold price you have already entered, and covers
  are re-fetched from the catalogue so they are never broken links.
- Dark mode follows the phone's own setting.

## Installing

Download `dazzle-diary.apk` from the [releases page][releases] and open it on
the phone. Android will ask you to allow installing from this source.

Android 7.0 (API 24) or newer.

[releases]: https://github.com/totleightowers/dazzle-diary/releases

> Each build must be signed with the same key as the one before it, or Android
> refuses to install it over the top. If you build your own, keep your keystore.

## Using it

**Start with the catalogues.** Open **Settings → Shop catalogues**, turn off any
shop you do not buy from, and sync. This is the only step that needs a network.

**Add what you own**, either way round:

- *One at a time* — **Browse**, filter down to the kit, and add it. Everything
  the shop publishes comes with it.
- *All at once* — **Import**, and give it an order-history CSV. Each line is
  matched against the catalogues; anything ambiguous is put to you rather than
  guessed at. This is much the faster route for an established stash.

**Then just use it.** Drag projects between groups as they arrive and get
started, set a progress percentage and log hours as you go, and add photos.
Dates fill themselves in as the status changes, and can be corrected by hand at
any point.

**Back up now and then** from **Settings → Backup**. It is one file, it contains
the photos, and it is the only copy of your logbook that exists anywhere.

## Building from source

You need **JDK 17+**, **Node 20+**, `zip`, and the Android SDK's
`platforms;android-34` and `build-tools;34.0.0`.

With the SDK command-line tools installed and `$ANDROID_HOME` set:

```sh
sdkmanager 'platforms;android-34' 'build-tools;34.0.0'
export PATH="$ANDROID_HOME/build-tools/34.0.0:$PATH"

git clone https://github.com/totleightowers/dazzle-diary
cd dazzle-diary
mkdir -p android/sdk
cp "$ANDROID_HOME/platforms/android-34/android.jar" android/sdk/android.jar

cd android && ./build.sh
```

That writes `android/dazzle-diary.apk`, and prints its size and signature.
There is nothing to install first — the app has no dependencies, and no build
step beyond packaging.

The build script takes these from the environment:

| Variable        | Default            | What it is                        |
| --------------- | ------------------ | --------------------------------- |
| `SDK_JAR`       | `sdk/android.jar`  | API 34 `android.jar`              |
| `KEYSTORE`      | `keystore.jks`     | signing keystore, made on first build |
| `KEYSTORE_PASS` | `changeit`         | its password                      |
| `KEY_ALIAS`     | `logbook`          | key alias within it               |
| `OUT`           | `dazzle-diary.apk` | where to write the APK            |

`android/zipalign.mjs` does the 4-byte alignment `resources.arsc` needs, so the
build does not depend on a `zipalign` binary being on `PATH`.

### Tests

```sh
npm test     # node --test over core/
npm run check   # every tracked .js/.mjs parses
```

The tests cover the parts where being wrong is quiet: comma-in-title CSV
parsing, order reconciliation, the refusal to guess between candidates, the
status/date rules agreeing in both directions, and the drill estimate against
kits whose real counts are published.

CI runs those on every push, along with semgrep, CodeQL, a secret scan and a
guard against committing a keystore or personal data, and builds the APK to
prove it still packages.

## How it is put together

```
app/          the whole application — plain ES modules, no build step
  core/       pure logic: CSV, matching, pricing, status rules, shop adapters
  local/      IndexedDB storage and the API the UI talks to
android/      the APK: one Activity, ~370 lines of Java
test/         node --test over core/
```

The page is served from the APK's own assets over a private `https://` origin,
so it gets a secure context — IndexedDB and the rest — and ordinary relative
URLs. A small Java layer covers the three things a web page cannot do for
itself: read cover images and photos out of the app's private storage, write
them back, and fetch another origin — the shops send no CORS headers.

There are no dependencies. Nothing is downloaded at build or run time beyond the
Android SDK itself.

## The interesting problems

**Titles are not unique.** One shop sells four different "Alice in Wonderland"
canvases. A CSV line gives only a title, so the importer prices out every
combination of candidates against what the order actually charged —
accessories included, which is why those stay in the catalogue — and takes the
closest fit. When the runner-up is within £4 it refuses to guess and asks.

**Products get renamed.** "Old Masters" became "Old Masters - MEGA Dazzles™".
Exact matches and prefix variants are both collected, so a renamed kit is still
offered even when the plain title also matches something else.

**Titles can contain commas.** The products column is a comma-joined list inside
one quoted CSV field, so *Frejya, Goddess of Beauty & War* arrives as two
fragments. They are rejoined by testing the combination against the catalogue
and preferring the longest match that exists.

**Currency.** Shopify's product feed accepts `?currency=`, which returns that
market's real prices rather than a conversion invented locally. Without it a
Canadian shop's CA$225 kit reads as £225.

## A note on the shops

The app reads each shop's public product listing — the same JSON their own
storefront uses — and caches cover images locally for kits you own, which is
what a shop's own logbook does. Artwork remains the copyright of the artists and
the shops. Don't redistribute it.

## Licence

MIT — see [LICENSE](LICENSE).

# Dazzle Diary

Dazzle Diary is an offline-first Android logbook for diamond painting.

It keeps track of the kits you own, what has arrived, what you are working on,
what you have finished, how long you spent, what you paid, and the photos you
take along the way.

The app can also read product listings from supported diamond-art shops, so
adding a kit brings in its cover image, artist and published specification
instead of making you type everything by hand.

There is no Dazzle Diary account, cloud service, analytics backend or central
copy of your collection. Your logbook lives on your phone.

## What it does

### Your stash

- Organises projects across seven states: **Wish list**, **Not received**,
  **Received**, **Started**, **On hold**, **Completed** and **Abandoned**
- Long-press a project to drag it between sections; the dates it implies fill
  themselves in
- Keeps status and milestone dates in step in both directions — set a
  completion date and the project is completed, and the reverse
- Records **hold periods**: each time a canvas is put down and picked back up
  is kept, so "how long did that take" can be answered with or without the
  time it spent waiting
- Filters and sorts the logbook by shop, drill shape, canvas size and rating,
  and sorts within each section by name, progress, rating, size or diamonds
- Rate a finished piece out of five

### While you work

- Time a session with a **timer**, or add one by hand; hours are the sum of
  your sessions rather than a number you maintain
- Logging time on a kit you have not started starts it
- Track progress as a percentage, with the diamonds placed worked out from it
- Keep notes, cost, shipping, tax and sold price, in any of six currencies
- Add progress photos from the camera or the gallery; photos are downscaled on
  the way in so a backup stays a sensible size
- Swipe through a project's pictures, tap to open one full screen, pinch to
  zoom, and share one out to another app

### Catalogues

- Search and filter cached shop catalogues offline, by shop, shape, canvas
  size, price and stock
- Pull the catalogue down to refresh it
- Where a shop publishes a kit's canvas size, diamond count or colour count on
  its product page rather than in its feed, that page is fetched **once, only
  for a kit you own** — never for the whole catalogue
- Imports order-history CSVs and matches purchases against the catalogue
- Asks about ambiguous matches instead of silently attaching an order to the
  wrong kit

### Looking back

- A **summary page** with totals and records — canvases finished, diamonds
  placed, days at the board, hours logged, longest run of consecutive days,
  biggest and smallest canvas, longest and quickest to finish (with and
  without time on hold), fastest placing, best value per thousand diamonds —
  filterable by year and by month
- Collection statistics in Settings: spend by currency, most collected
  artists, most bought from

### Your data

- Exports CSV
- Creates a full JSON backup containing projects, sessions, hold periods and
  progress photos
- Restores by merging with the collection already on the device, rather than
  replacing it
- Follows the phone's light/dark mode, and lays out as two panes on a tablet
  or an unfolded foldable

## Supported shops

Dazzle Diary currently has catalogue adapters for:

| Shop | Platform |
| --- | --- |
| Diamond Art Club | Shopify |
| Mystical Dream Diamonds | Shopify |
| Pressed and Placed | Shopify |
| Diamond Art UK | Shopify |
| Fallon Gems | Shopify |
| Diamond Art Studio | WooCommerce |
| Munimade | Shopify |

You can switch off shops you do not use. Disabled shops are left out of
catalogue syncs and browsing.

Coasters, keychains, gem houses, bookmarks and the rest are treated as
projects, not accessories — they are things you place diamonds on and finish,
and they belong in a logbook. Pens, wax, trays, loose diamonds and mystery
boxes are not.

What each shop publishes differs, and every adapter is written against the real
feed rather than a specification. Diamond Art Club packs the whole spec into
the variant title; Mystical Dream Diamonds puts sizes in description prose;
Munimade keeps the artist in the product title and the specification on the
product page. Where a shop publishes no diamond count at all, Dazzle Diary
estimates one from the canvas size and marks it as an estimate.

## Install

Download the APK from the repository's **Releases** page and open it on your
Android device.

Dazzle Diary supports **Android 7.0 (API 24)** and later, and targets API 34.

Android may ask you to allow installation from the browser or file manager you
used to download the APK.

> Android requires app updates to be signed by the same key as the installed
> version. If you build your own copy, keep the signing keystore.

## First five minutes

1. Open **Settings → Shop catalogues**.
2. Switch off any shops you do not buy from.
3. Sync the catalogues. Nothing works properly until this has been done once:
   no covers, no sizes, no drill counts, and an order import has nothing to
   match against.
4. Add a kit from **Add from catalogue**, or import an order-history CSV from
   **Import**.
5. Open the project and fill in anything the shop did not publish.
6. As you work, start a session, update progress, and add photos.
7. Make a backup from **Settings → Backup**.

Once a catalogue has been synced, browsing and everyday use work entirely from
the local copy. The network is only needed to refresh shop data or fetch an
image.

## Privacy

The app asks for two permissions: `INTERNET` and `ACCESS_NETWORK_STATE`. They
are used to reach the shops whose catalogues you have enabled, and nothing
else. There is no analytics, no telemetry and no Dazzle Diary server. Projects,
photos, sessions and preferences are stored in the app's own storage on the
device, and leave it only when you make a backup or share a photo yourself.

## Build from source

The app has no runtime package dependencies and no JavaScript bundling step.

You need:

- JDK 17+
- Node.js 20+
- `zip`
- Android SDK platform 34
- Android build-tools 34.0.0

With `$ANDROID_HOME` set:

```bash
sdkmanager 'platforms;android-34' 'build-tools;34.0.0'
export PATH="$ANDROID_HOME/build-tools/34.0.0:$PATH"

git clone https://github.com/totleightowers/dazzle-diary
cd dazzle-diary

mkdir -p android/sdk
cp "$ANDROID_HOME/platforms/android-34/android.jar" android/sdk/android.jar

cd android
./build.sh
```

The APK is written to `android/dazzle-diary.apk`.

`build.sh` runs `aapt2`, `d8` and `apksigner` directly, with a small
`zipalign.mjs` standing in for `zipalign`. There is no Gradle.

## Tests

```bash
npm test        # the whole suite
npm run check   # every tracked JavaScript file parses
```

There is no browser on the machine this was built on, so the suite provides its
own: `test/dom.mjs` is a hand-written DOM and `test/mount.mjs` boots the real
`app.js` against it, with the native bridge and the shops stubbed. Tests drive
the app by tapping what is on screen rather than by calling internals.

`tools/layout-probe.mjs` resolves the CSS cascade at a given viewport width —
not a renderer, but enough to answer "at this width, which rules win, and what
do the layout properties come out as?" `tools/preview.mjs` serves `app/` over
HTTP so the same code can be opened in an ordinary browser.

CI runs the suite, `actionlint`, `semgrep`, `gitleaks` and CodeQL on every pull
request, and builds the APK. Every action is pinned to a commit SHA.

`main` is written to by merging a pull request, never by committing to it.
Branch protection applies to administrators too, and `tools/hooks` catches it
a step earlier:

```sh
git config core.hooksPath tools/hooks
```

## Repository layout

```text
app/
  core/       pure logic: CSV, matching, drill estimates, status rules, shop adapters
  local/      IndexedDB store and the app's own API
  fonts/      bundled Karla and Newsreader plus their OFL notices
  api.js      picks the local API in the standalone Android build
  app.js      the whole client
  index.html  application shell
  styles.css  styling

android/
  src/        the WebView host and the JavaScript bridge
  res/        Android resources
  build.sh    dependency-light APK build
  zipalign.mjs

test/         the DOM, the IndexedDB shim, and the suite
tools/        layout probe, preview server, icon generator, git hooks
.github/      CI, CodeQL, release and Dependabot configuration
```

## Design principles

**Local-first.** Your collection is not stored on a Dazzle Diary server.

**Low-dependency.** Plain JavaScript and a small Android shell. Nothing is
installed at build or run time, which is what makes it buildable on a phone.

**Conservative about guesses.** An import would rather ask than attach an order
to the wrong kit, and an estimated diamond count says that it is estimated.

**Durable.** A project is a record in its own right. The catalogue exists to
make creating that record easier, and unlinking one leaves it intact.

**Recoverable.** Backup and restore include progress photos and sessions, and
merge with what is already on the device rather than replacing it.

## Licence

Dazzle Diary is licensed under the MIT Licence. See [`LICENSE`](LICENSE).

The app bundles Karla and Newsreader under the SIL Open Font License 1.1. The
notices and licence text are in
[`THIRD_PARTY_LICENCES.md`](THIRD_PARTY_LICENCES.md), with the individual OFL
files under `app/fonts/`.

Product names, images, artwork and merchant branding remain the property of
their respective owners. Dazzle Diary is an independent application and is not
presented as an official app of any of the shops it reads.

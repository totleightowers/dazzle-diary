# Dazzle Diary

Dazzle Diary is an offline-first Android logbook for diamond painting.

It keeps track of what you own or want, what has arrived, what you are working on, what you have finished, how long you spent, what you paid, and the photos you take along the way.

The app can also read product listings from supported diamond-art shops, so adding a kit can bring in its cover image, artist and published specification instead of making you type everything by hand.

There is no Dazzle Diary account, cloud service, analytics backend or central copy of your collection. Your logbook lives on your phone.

## What it does

### Your logbook

- Organises projects across **Wish list**, **Not received**, **Received**, **Started**, **On hold**, **Completed** and **Abandoned**
- Lets you change status directly on a project or long-press and drag it between sections
- Keeps milestone dates and status in step
- Searches by title or artist
- Filters by shop, drill shape, canvas size and rating
- Sorts each status section by recently added, name, progress, rating, size or drill count
- Supports grid and list views
- Remembers where you were when you open a project and come back

### While you work

- Track progress as a percentage and estimate diamonds placed from it
- Start/stop a painting session or add past time
- Record periods when a project was put down
- Correct milestone dates without opening the full details form
- Correct price, shipping, tax and currency in place
- Rate a project directly from its page
- Keep free-text notes that save automatically

### Photos

- Add progress photos from the phone
- Swipe through shop images and your own photos in one gallery
- Pinch or double-tap to zoom
- Set one of your photos as the project cover
- Share a progress photo through Android's share sheet
- Remove a photo with an Undo window
- Downscale large camera images before storing them so backups stay manageable

### Catalogues and imports

- Browse cached shop catalogues offline
- Search and filter by shop, shape, size, price and stock
- Pull down in Browse to refresh enabled catalogues
- Fill project metadata from catalogue listings
- Import a Diamond Art Club order-history CSV
- Match order lines conservatively and ask when a title is ambiguous
- Keep the price source so a catalogue fallback is not presented as an exact receipt value
- Estimate missing diamond counts from canvas size and mark estimates with `≈`

### Looking back

**Summary and records** can be filtered by year and month and includes:

- projects finished and bought
- diamonds placed
- days at the board
- hours and sessions logged
- longest streak of consecutive painting days
- biggest and smallest completed canvases
- most and fewest diamonds
- quickest and longest projects, with and without time on hold
- most and fewest hours
- longest single session
- fastest and most unhurried placing rate
- dearest project and best value per thousand diamonds
- most frequent artist and shop

Settings also shows collection-level totals such as projects, completions, hours, spend, diamonds, artists and shops.

### Your data

- Full JSON backup of projects, sessions, hold history and progress photos
- Merge-based restore rather than destructive replacement
- CSV export
- Local-only application data unless you explicitly export, back up or share something
- System, light and dark appearance modes
- Two-pane layout on sufficiently wide tablets and unfolded foldables

## Supported catalogues

The source tree contains adapters for:

| Shop | Platform | Notes |
| --- | --- | --- |
| Diamond Art Club | Shopify | Full specification is largely available in the feed |
| Mystical Dream Diamonds | Shopify | Uses CAD; some metadata comes from description text |
| Pressed and Placed | Shopify | Variant/title parsing |
| Diamond Art UK | Shopify | Title-based classification |
| Fallon Gems | Shopify | Title/description parsing |
| Diamond Art Studio | WooCommerce | Uses the public WooCommerce Store API |
| Munimade | Shopify | Some specification fields are fetched lazily from a project's product page |

Dazzle Diary treats things you place diamonds on and finish — including supported non-canvas formats such as coasters or keychains — as projects. Tools and supplies such as pens, wax, trays and loose diamonds are not projects.

## Install

Download `dazzle-diary.apk` from the repository's **Releases** page and open it on your Android device.

Dazzle Diary supports **Android 7.0 / API 24 and later** and targets API 34.

Android may ask you to allow installation from the browser or file manager you used to download the APK.

> Android requires an update to be signed by the same key as the installed version. If you build your own copy, keep the signing keystore.

## First five minutes

1. Open **Settings → Shop catalogues**.
2. Switch off shops you do not use.
3. Download the catalogues.
4. Add something from **Add from catalogue**, or import a Diamond Art Club order-history CSV.
5. Open the project and use its status, rating, progress, dates, time, cost, photos and notes directly.
6. Use **Details** only when you need to correct the underlying project/catalogue metadata.
7. Create a full backup from **Settings → Your data**.

Once catalogues have been synced, browsing and everyday logbook use work from the local copy. Network access is needed when refreshing shop data, fetching missing listing images/specification, or following a shop product link.

## Documentation

Detailed documentation lives in [`docs/`](docs/README.md):

- [User guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Catalogues and order imports](docs/CATALOGUES_AND_IMPORTS.md)
- [Data and backup](docs/DATA_AND_BACKUP.md)
- [Development](docs/DEVELOPMENT.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Privacy

Dazzle Diary asks for:

- `INTERNET`
- `ACCESS_NETWORK_STATE`

These are used for enabled shop catalogues, product images/pages and network-aware behaviour. There is no Dazzle Diary analytics or application backend.

Projects, preferences, sessions and photo metadata live in IndexedDB inside the app. Cover and progress-photo bytes live in app-private storage.

A progress photo leaves that private store only when you explicitly use **Share**, which copies it into Android shared media so another app can receive it, or when you include it in a backup.

See [Security and privacy](docs/SECURITY_AND_PRIVACY.md) for the exact boundary.

## Build from source

The app has no runtime package dependencies and no JavaScript bundling step.

Requirements:

- JDK 17+
- Node.js 20+
- `zip`
- Android SDK platform 34
- Android build-tools 34.0.0

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

The APK is written to:

```text
android/dazzle-diary.apk
```

`build.sh` invokes `aapt2`, `javac`, `d8` and `apksigner` directly. A small `zipalign.mjs` performs the alignment needed by Android; there is no Gradle build.

Run:

```bash
npm test
npm run check
```

The current test suite includes pure domain tests plus a hand-written DOM/IndexedDB test harness that boots the real client and exercises user interactions.

See [Development](docs/DEVELOPMENT.md) for CI, signing, layout tools and releases.

## Repository layout

```text
app/
  core/       CSV, matching, estimates, status rules and shop adapters
  local/      IndexedDB-backed app API
  fonts/      Karla and Newsreader plus OFL notices
  api.js      selects the local API in the standalone build
  app.js      routes, UI state and interactions
  index.html  application shell
  styles.css  responsive UI

android/
  src/        native WebView host and JavaScript bridge
  res/        Android resources
  build.sh    dependency-light APK build
  zipalign.mjs

test/         domain tests, DOM harness and IndexedDB shim
tools/        preview, layout probe, icon tooling and git hooks
.github/      CI, CodeQL, release and dependency automation
```

## Design principles

**Local-first.** Your collection is not stored on a Dazzle Diary server.

**Low-dependency.** The client is plain JavaScript and the Android host is deliberately small.

**Conservative about guesses.** Import matching asks when evidence is ambiguous; estimated drill counts are labelled.

**Durable.** A project remains useful even if its original catalogue listing changes or disappears.

**Contextual.** Routine work happens on the project page; the larger Details form is for deeper correction.

**Recoverable.** Backup and restore include the irreplaceable parts of the logbook and merge with what is already on the device.

## Licence

Dazzle Diary is licensed under the MIT Licence. See [`LICENSE`](LICENSE).

The app bundles Karla and Newsreader under the SIL Open Font License 1.1. Their notices and licence text are in [`THIRD_PARTY_LICENCES.md`](THIRD_PARTY_LICENCES.md) and the individual OFL files under `app/fonts/`.

Product names, images, artwork and merchant branding remain the property of their respective owners. Dazzle Diary is an independent application and is not presented as an official app of any shop it reads.

# User guide

## What Dazzle Diary is for

Dazzle Diary is a personal logbook for diamond painting and related diamond-art projects.

It is designed around the lifecycle of something you might want, buy, receive, work on, put down, finish or abandon.

Your logbook is local to the phone. Catalogue data helps populate it, but the project record is yours and remains useful independently of the catalogue.

## First-time setup

Dazzle works best after at least one catalogue sync.

On a fresh install:

1. Open **Settings**.
2. Under **Shop catalogues**, switch off shops you do not use.
3. Tap **Download catalogues**.
4. Wait for the enabled shops to finish.
5. Return to **My Logbook**.

The home screen also prompts you to download catalogues if none are present.

Catalogues are cached on the device. After that, browsing/searching them works offline until you decide to refresh.

## My Logbook

The logbook is grouped by status:

1. **Started**
2. **On hold**
3. **Received**
4. **Not received**
5. **Wish list**
6. **Completed**
7. **Abandoned**

The ordering keeps active work near the top.

### Search

The main search box matches:

- project title
- artist

### Status chips

The chips under Search restrict the logbook to one lifecycle state.

### More filters

Open **Filters** to filter by:

- shop
- drill shape
- canvas size
- rating

You can also sort the contents of each status section by:

- Recently added
- A–Z
- Furthest on
- Best rated
- Biggest
- Most drills

**Clear all** removes the additional filters and returns sorting to Recently added.

### Grid and list

Use the grid/list toggle to change how project cards are presented.

On a wide screen the grid grows more columns rather than stretching a small number of cards across the whole display.

### Returning to your place

Dazzle remembers scroll position by screen.

If you open a project from a long logbook and go back, the logbook should return to the place you left rather than starting at the top.

## Adding a project from the catalogue

Tap **Add from catalogue**.

You can:

- search by name or artist
- choose a shop
- filter by Round/Square
- filter by longest canvas edge
- set a maximum price
- show only in-stock items
- sort by relevance, name, price, size or drills

Tap a catalogue card to create a project from it.

The project form is prefilled with the metadata Dazzle has for that listing.

### Refresh from Browse

When the catalogue needs refreshing, pull down from the top of Browse.

The refresh updates the enabled shop catalogues.

### Metadata that is not in the feed

Some shops publish important specification only on the individual product page.

Dazzle does **not** crawl every product page during catalogue sync. Where an adapter supports it, the app fetches the page only for a project you actually own and only when the project is missing supported fields.

This is used for fields such as:

- canvas size
- diamond count
- colour count
- special-diamond information

Once found, the result is cached.

## Adding a project by hand

Use the **+** action in My Logbook.

The full form lets you set:

- title and artist
- catalogue association
- shop
- status
- shape and coverage
- size
- colours and diamond count
- special diamonds
- brand/source
- milestone dates
- purchase cost
- currency
- progress
- sold price
- rating
- notes

The form is deliberately the detailed correction surface. Routine changes can usually be made faster on the project page itself.

### Leaving a form with unsaved changes

If you try to leave a New project or Details form after changing something, Dazzle asks whether to discard the changes.

If you choose to keep editing, the form is restored with what you typed.

## Project statuses

Dazzle uses:

- Wish list
- Not received
- Received
- Started
- On hold
- Completed
- Abandoned

There are two quick ways to change status.

### On the logbook

Long-press a project card, then drag it to another status section.

Dazzle shows the gesture hint once.

### On the project

Tap the status pill near the project title and choose the new status.

Both routes use the same status/date rules.

## Status and milestone dates

Status and dates describe the same lifecycle.

The important dates are:

- Ordered
- Received
- Started
- Completed

Changing status can fill or clear dates implied by that transition.

Changing the dates can change the derived status.

On the project page, expand **Correct a date** under Timeline to fix them without entering Details.

## Working on a project

Tap a project in My Logbook.

The project page is the normal place to maintain it.

### Progress

For a started project (or one that already has progress), use the slider.

The page shows:

- percentage
- approximate diamonds placed out of total, when a drill count exists

Progress saves automatically after a short delay.

Moving to 100% marks the project Completed and adds a completion date if one is missing.

### Rating

Tap the stars beside the project status.

Rating saves immediately.

### Notes

Type into Notes on the project page.

Notes save automatically.

### Time

For projects that can be worked on, the Time section supports:

- **Start a session**
- **Stop** an active session
- **Add past time**
- removing an incorrect session

Hours are calculated from sessions.

A timer that was running when the app was closed is recovered when the app opens again.

Wish-list and not-yet-received projects do not show the session controls.

### Holds

Use **Record a hold** when you put a canvas down.

Enter:

- Put down date
- Picked up date, or leave it blank if the hold is still open

Open holds put the project into On hold.

The history is preserved so Summary can distinguish:

- calendar time from start to finish
- active elapsed time excluding periods on hold

## Correcting cost

The project page shows:

- Price
- Shipping
- Tax
- Total

Expand **Correct the cost** to update those values and the project currency without entering Details.

A price you type yourself is marked as your figure rather than retaining an import/catalogue estimate provenance.

Supported project currencies are:

- GBP
- USD
- EUR
- CAD
- AUD
- NZD

Existing non-standard currency values are preserved by the Details form rather than being silently cleared.

## Project details

Tap **Details** over the project artwork when you need deeper correction.

Use Details for things such as:

- fixing the title/artist
- changing dimensions or drill metadata
- changing brand/source
- correcting the catalogue association
- setting a sold price
- editing several fields together

### Relink versus fill from catalogue

These are deliberately different operations.

**Relink** changes which catalogue listing supplies the cover/gallery/product link without overwriting fields you typed yourself.

Selecting a catalogue suggestion from the title field can fill multiple metadata fields from that listing.

If Dazzle detects that catalogue values would replace existing values, it asks before doing so.

### Unlink

Unlinking disconnects the project from the listing.

The project remains in your logbook.

## Photos and the gallery

A project can have:

- shop listing images
- your own progress photos

Dazzle presents both in one full-screen gallery.

### Open and navigate

Tap a project image.

You can:

- swipe through the gallery
- see the current image number
- pinch to zoom
- double-tap to toggle zoom
- pan while zoomed
- use Back/Escape to close

### Add progress photos

Use **Add** under Progress photos.

The Android file chooser can offer the gallery and, where supported, camera capture.

Large camera images are downscaled before storage.

### Use a progress photo as the cover

Open one of your photos full screen and choose **Use as cover**.

You can later return to the shop image from the project page.

### Share a photo

Open one of your own progress photos and tap **Share**.

Android opens the normal share chooser.

Sharing is an explicit data-export action: Dazzle copies that image into Android shared media so another app can read it.

### Remove a photo

Removing a progress photo gives you an **Undo** action for a few seconds before the deletion is committed.

## Importing order history

The current importer is built around the **Diamond Art Club order-history CSV format**.

Open **Import**, select the CSV and review the preview before committing it.

The importer:

- parses orders
- separates makeable projects from accessories/supplies
- matches product titles against catalogue rows
- detects projects already in the logbook
- derives Received/Not received from fulfilment
- works out the best available price source
- asks you to choose when a title is ambiguous

Nothing in the CSV is uploaded to a Dazzle Diary service.

### Ambiguous titles

Some shops sell multiple products with the same or similar title.

Dazzle does not silently choose when the evidence is too close.

The chooser shows candidate products and also lets you search the catalogue.

A choice can be remembered for later matching.

### Commas inside titles

The Diamond Art Club export can contain a comma-joined products field where an individual product title also contains a comma.

Dazzle's parser/matcher attempts to reconstruct such titles against the catalogue instead of naïvely splitting every comma.

## Price provenance

An imported price can mean different things.

Dazzle records which source was used:

- **order** — exact order value for a single relevant kit
- **allocated** — share of an order split across kits
- **catalogue** — current/list price used because the exact split cannot be known
- **receipt** — exact receipt-derived figure where available
- **you** — a value you typed

The project page explains non-user price provenance so an estimate is not presented as fact.

## Diamond-count estimates

Not every shop publishes a drill count.

When Dazzle has dimensions and shape but no exact count, it can estimate one from canvas area.

Estimated counts are displayed with:

```text
≈
```

They are useful for collection-scale summaries, but remain estimates.

## Summary and records

Open **Settings → Summary and records**.

Choose:

- All time
- a year
- optionally a month within that year

The time period is applied according to the meaning of each statistic:

- finished work uses completion dates
- purchases use ordered/received dates
- painting time uses session dates

### Totals

Depending on the selected period, Summary can show:

- paintings finished
- paintings bought/owned
- diamonds placed
- days with a painting session
- hours logged
- longest consecutive-day streak
- session count
- spend
- average hours on an active day
- how many projects were put down and later resumed
- diamonds still to place across the rest of the stash (All time only, since it
  is a fact about the stash as it stands rather than about a month)

A project with no order or delivery date belongs to no year, so the years do not
add up to All time. When a year or month is selected and some projects are
undated, the page says how many rather than leaving the gap unexplained.

### Records

Records link back to the project that set them.

They include:

- biggest/smallest canvas
- most/fewest diamonds
- longest/quickest start-to-finish
- longest/quickest excluding hold periods
- longest hold
- most/fewest hours
- most sessions
- longest sitting
- fastest/slowest diamonds per hour
- dearest project
- best value per thousand diamonds
- most frequent artist/shop

## Settings

Settings currently contains:

- Summary and records entry
- headline collection statistics
- diamond totals
- most collected artists
- most bought from
- shop catalogue controls
- shopping/catalogue currency preference
- appearance
- backup/restore/export
- open-source licences
- build version/date

Most settings apply immediately.

## Back up your logbook

Go to **Settings → Your data → Create a full backup**.

The backup is written to Downloads as:

```text
dazzle-diary-backup.json
```

It contains:

- projects
- hold history stored on the projects
- progress photos
- painting sessions

Shop cover images are not embedded because they can normally be refetched.

A backup in Downloads is still on the same phone. For protection against losing the device, move/copy the file somewhere else yourself.

## Restore

Choose **Restore from a backup file**.

Restore merges into the current logbook.

It does not simply wipe the device and replace everything.

See [Data and backup](DATA_AND_BACKUP.md) for the exact merge rules.

## CSV export

**Export logbook as CSV** creates a spreadsheet-friendly project export.

It does **not** include progress photos and is not a substitute for the full backup.

## Appearance

Choose:

- System
- Light
- Dark

The Android host also updates the phone's system bars to match.

## Foldables and tablets

At a CSS viewport width of 900px or more, Dazzle uses a two-pane shell:

```text
┌───────────────────────┬─────────────────────────┐
│ My Logbook            │ Project / Browse /      │
│                       │ Settings / Summary      │
└───────────────────────┴─────────────────────────┘
```

The logbook stays visible on the left while the selected destination opens on the right.

Grid screens use available width for more cards.

Reading/settings screens keep a readable line length.

On very wide screens the **Details/New project form only** can flow labelled form groups into multiple columns. Settings remains an ordered single-column reading sequence.

## Troubleshooting

### Browse is empty

Sync at least one enabled catalogue.

### A shop is missing

Check that the shop is enabled under Settings and has synced successfully.

### Import says it needs the catalogue

The importer needs the Diamond Art Club catalogue for matching.

Sync it first.

### A restored project has no cover

Sync the relevant catalogue. Covers are deliberately refetched rather than embedded in backups.

### A progress photo is missing after restore

The restore result reports photos it could not decode/write.

Keep the original backup and retry before deleting it.

### The APK will not install over an older copy

The new APK must be signed with the same signing key as the installed one.

### A catalogue sync partially fails

The sync job can complete for reachable shops while reporting another as failed.

Retry later or sync that shop individually from Settings.

# Data and backup

## Data ownership model

Dazzle Diary is local-first.

There is no Dazzle Diary account and no central application database.

The user's logbook is split between:

1. structured state in IndexedDB; and
2. app-private media files.

Network requests are used for merchant catalogue/product content, not for synchronising the personal logbook to a Dazzle Diary server.

## IndexedDB

The database is:

```text
logbook
```

Current schema version:

```text
2
```

Stores:

- `projects`
- `photos`
- `sessions`
- `catalogue`
- `blobs`
- `meta`

## Projects

A project is the durable record for something in the logbook.

Fields can include:

- identity: title, artist
- lifecycle: status and dates
- specification: dimensions, shape, coverage, colours, drills, special diamonds
- commercial: price, price source, shipping, tax, currency, sold price
- source: brand, obtained-from, order information
- catalogue relationship: shop + handle
- progress and rating
- notes
- hold history
- cover/gallery filenames
- derived hours

The exact project row evolves over time; backup/restore is designed to tolerate absent fields.

## Sessions

Painting time is stored as individual sessions.

Each session has concepts such as:

```text
project_id
on
minutes
note
created_at
```

The project `hours` value is recalculated from sessions.

A migration turns old pre-session aggregate hours into one session so historical time is retained.

## Hold history

Hold periods are stored on the project.

They are not the same as painting sessions.

A hold answers:

> When was this project put down and picked back up?

Sessions answer:

> When did I actually spend time painting?

Summary can therefore report both calendar elapsed time and elapsed time excluding holds.

## Photo metadata

The `photos` store contains metadata and a `project_id` index.

The image bytes themselves are stored as private files.

## Catalogue

Catalogue rows are cacheable/rebuildable data.

They are keyed by:

```text
[shop, handle]
```

and indexed by shop.

The catalogue is important for:

- Browse/search
- project enrichment
- covers/gallery
- order matching
- price fallback
- restoring covers

It is not the source of truth for the user's project history.

## Meta

`meta` stores non-project state such as:

- preferences
- excluded shops
- one-time UI hints
- sync timestamps
- migration markers

## Media files

The Android host stores media below its private files area.

Conceptually:

```text
media/
  covers/
  photos/
```

### Catalogue covers

Shop images are cached locally when needed.

They can be regenerated from the catalogue/listing and are therefore not treated as irreplaceable backup data.

### Progress photos

Progress photos are personal user content.

They cannot be reconstructed from a shop.

They are included in full backup.

Large incoming photos are downscaled before storage.

## Gallery state

The full-screen gallery itself is not persisted.

When a project is opened, Dazzle constructs one list in memory from:

- current listing/cover images
- current progress photos

This keeps gallery ordering consistent after photo removal.

## Summary data

Summary and records are derived.

Dazzle calculates them from:

- projects
- dates
- sessions
- holds
- prices

There is no separate persistent “statistics database”.

## What offline-first means

After catalogue sync:

- My Logbook works locally
- project editing works locally
- sessions/holds/notes/photos work locally
- Summary works locally
- catalogue search/browse works from cached rows

Network access is needed for activities such as:

- refreshing catalogues
- fetching missing cover/gallery images
- lazy product-page specification enrichment
- opening an external product page

## Full backup

From:

**Settings → Your data → Create a full backup**

Dazzle creates:

```text
dazzle-diary-backup.json
```

The current payload is version 2 and contains:

```json
{
  "version": 2,
  "exportedAt": "...",
  "projects": [],
  "photos": [],
  "sessions": []
}
```

Hold history is contained in each project.

Progress-photo bytes are base64 encoded into the photo entries.

## What the backup protects

A full backup carries the parts that matter if the app/private storage is lost:

- project records
- statuses and dates
- notes
- progress
- holds
- purchase metadata
- ratings
- sessions
- progress photos

## Why catalogue covers are not embedded

Cover galleries can be large and normally come from merchant content that can be downloaded again.

Portable cover filenames would also be unsafe across devices because they refer to local files on the originating installation.

Restore therefore deliberately ignores backed-up `cover`/`covers` filenames and attempts to refetch them.

This keeps backups much smaller than embedding every shop image.

## Restore is a merge

Restore is not:

```text
delete current logbook
replace with backup
```

It matches backed-up projects to local projects using:

```text
lowercase(title) + "::" + order_ref
```

and then merges.

## Existing-project merge rules

For a project that already exists locally, restore can bring in non-empty metadata from the backup.

It does **not** overwrite these local fields:

```text
progress
hours
notes
sold_price
id
created_at
```

It also ignores backup cover/gallery filenames.

This protects current-device work while still allowing metadata corrections from another backup/build to travel across.

## New projects

A backed-up project with no local match is inserted with a new local ID.

Its old cover/gallery filenames are removed before insertion.

The restore then maps the old project ID to the new local ID for sessions and photos.

## Sessions

Sessions are remapped to local project IDs.

To make repeated restore safe, Dazzle avoids inserting a session when the same local project already has one with the same:

- date
- duration

After session restore, project hours are recalculated.

## Progress photos

Progress photos are mapped to local project IDs.

Dazzle avoids importing the same project/file combination twice.

The restore result reports photos that could not be decoded or written.

## Covers after restore

After project/session/photo restore, Dazzle attempts to backfill covers from the local catalogue.

If the catalogue is empty or stale, some covers can remain missing until the relevant shop is synced.

## Restore result

The UI reports values such as:

- added
- updated
- fields changed
- unchanged
- photos restored
- photo failures
- covers fetched
- covers still missing

Keep the backup until you have checked the restored logbook.

## Backup versus CSV

### Full JSON backup

Use this for recovery/moving a logbook.

Contains personal media and sessions.

### CSV export

Use this for spreadsheet analysis.

It is project data only and does not include progress photos.

CSV is not a substitute for backup.

## Backup location

The Android build writes backup/export files into the public Downloads collection.

That is convenient, but it has an important consequence:

> A backup left only in Downloads is still on the same phone.

For protection against phone loss, reset or storage failure, copy the backup elsewhere yourself.

Examples include another device or a storage provider you already use.

Dazzle does not automatically upload backups.

## Photo sharing

Progress photos normally stay inside app-private storage.

When the user explicitly taps **Share**:

1. the Android bridge reads the selected private file;
2. writes a copy to `MediaStore.Images`;
3. shares that public content URI through the Android chooser.

This is a deliberate export from the app's private boundary.

The recipient application and Android shared-media collection are outside Dazzle Diary's storage model.

## Deleting a progress photo

Photo deletion is delayed, with an Undo action.

The photo is hidden immediately, but the actual delete is committed after the Undo window expires.

## Deleting a project

Deleting a project is a destructive operation.

Treat a current full backup as the recovery mechanism.

## Before uninstalling, clearing storage or resetting the phone

Create a full backup and move a copy off the phone.

App-private IndexedDB/media is not something the user should assume survives:

- uninstall
- Clear storage
- factory reset
- device loss

## Android `allowBackup`

The manifest currently sets:

```xml
android:allowBackup="true"
```

That is an Android platform facility, not a replacement for Dazzle's explicit JSON backup.

Platform backup/restore behaviour varies by device/configuration and should not be the only recovery plan for valuable logbook data.

## Data that is not sent to Dazzle Diary

There is no Dazzle Diary server receiving:

- project rows
- notes
- ratings
- sessions
- hold history
- order CSV
- backup contents
- progress photos

Merchant requests naturally reveal ordinary request metadata to the merchant/CDN involved.

A photo is exported only when the user explicitly shares it.

## Data lifecycle principles

1. Personal history is durable.
2. Catalogue content is replaceable cache.
3. Progress photos and sessions are irreplaceable and belong in backup.
4. Restore should be repeatable without multiplying content.
5. Local work should win over older backup progress/notes.
6. External sharing must be explicit.

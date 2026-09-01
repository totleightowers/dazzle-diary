# Catalogues and order imports

## Why Dazzle has a catalogue

A catalogue is an input to the logbook, not the logbook itself.

Its purpose is to make this:

```text
I own this kit.
```

turn into a useful project containing as much published metadata as Dazzle can safely obtain.

A project remains a durable record even if:

- the shop removes the listing;
- the listing is renamed;
- catalogue sync fails;
- the user unlinks the project.

## Providers

| ID | Shop | Platform | Nominal currency |
| --- | --- | --- | --- |
| `dac` | Diamond Art Club | Shopify | USD |
| `mdd` | Mystical Dream Diamonds | Shopify | CAD |
| `pnp` | Pressed and Placed | Shopify | USD |
| `dauk` | Diamond Art UK | Shopify | GBP |
| `fallon` | Fallon Gems | Shopify | USD |
| `das` | Diamond Art Studio | WooCommerce Store API | GBP |
| `muni` | Munimade | Shopify | USD |

Each adapter is based on what the real merchant publishes, not on a universal diamond-art schema.

## Shop definitions

A shop definition carries concepts such as:

```text
id
name
domain
platform
currency
colour identity
isKit(...)
parse(...)
optional context(...)
optional spec(...)
```

`isKit` answers whether a product is something the user places diamonds on and can meaningfully own/finish.

`parse` extracts the normalised project/catalogue fields available from the feed.

`spec` is optional and is used only when the feed omits useful specification that exists on an individual product page.

## Projects versus supplies

Dazzle does not equate “project” with “traditional canvas”.

For example, Diamond Art Club product classification can include makeable formats such as:

- canvas kits
- coasters
- keychains
- gem houses
- bookmarks
- frameables
- cards
- other items whose variants show a diamond count

Supplies such as pens, wax, trays and loose diamonds are not projects.

Accessory rows can still matter to import price reconciliation, because an order total may contain both canvases and supplies.

## Normalised catalogue rows

A normalised row can contain:

```text
shop
handle
title
artist
width_in
height_in
shape
coverage
colors
drills
special
price
currency
image
images
available
kind
type
variant_title
```

Some fields are legitimately null.

Null should mean:

> The source did not provide a value Dazzle can confidently use.

It should not trigger an invented value unless there is an explicit estimator.

## Catalogue sync

A normal sync:

1. determines enabled shops;
2. requests each shop's feed/API;
3. pages through results;
4. normalises rows;
5. replaces the local rows for that shop;
6. updates sync metadata;
7. backfills missing cover galleries for linked projects;
8. runs any supported lazy specification enrichment for owned projects.

The catalogue is cached in IndexedDB and held in memory during the app session.

### Shopify

Shopify adapters primarily use the public product JSON feed.

### WooCommerce

Diamond Art Studio uses the public WooCommerce Store API.

Its adapter also reads product categories to distinguish artist/category data from accessories.

## Lazy product-page enrichment

Some feeds are incomplete.

Munimade, for example, publishes fields such as diamond count, image size and colour count on the product page rather than the JSON feed.

Fetching every product page during sync would be unnecessarily heavy.

The pattern is:

```text
feed row is enough for browsing
        |
project is actually owned + linked
        |
some supported fields are still missing
        |
fetch that one product page
        |
parse missing spec
        |
cache result and fill only blank project fields
```

A successful check is marked so the same page is not repeatedly fetched.

A failed network request is not marked complete, allowing a later retry.

## Browsing

Browse can filter by:

- shop
- drill shape
- canvas size bucket
- maximum price
- in-stock only

Sort options include:

- Best match
- A–Z
- Cheapest
- Dearest
- Biggest
- Most drills

Results are loaded in pages.

### Pull-to-refresh

Pulling down from the top of Browse starts a catalogue refresh when the surface is already at the top.

The gesture is intentionally restricted so dragging a field/slider is not mistaken for a refresh.

## Logbook filtering versus catalogue filtering

These are separate.

The logbook filters **projects you own/track** by:

- shop
- shape
- size
- rating

and sorts each status section.

Browse filters **catalogue rows** by shop/specification/price/availability.

Do not share state accidentally between the two screens.

## Searching

Catalogue search normalises titles and artists and works against the local catalogue.

This allows routine search offline after sync.

## Linking a project

A project may carry:

```text
shop
dac_handle
```

Despite the historic `dac_handle` name, the handle is used as the linked product identifier across supported shops.

The project page uses the link for:

- product URL
- cover/gallery
- missing specification enrichment

### Relink

Relinking changes the catalogue pointer.

It intentionally does **not** overwrite corrections the user has typed into the project.

If the linked product changes, old shop images are cleared/refetched unless the user selected their own cover.

### Fill from catalogue

The Details form's title autocomplete is different.

Choosing a catalogue row can fill multiple fields from the selected product.

Relinking checks for clashes and asks before replacing existing values.

## Order import

The current parser is specifically designed for the **Diamond Art Club order-history CSV format**.

The UI wording should not imply that arbitrary merchant CSV exports are supported unless another parser is added.

The import is split into:

```text
CSV
 ↓
parseOrders
 ↓
catalogue matching
 ↓
preview
 ↓
user review/ambiguity resolution
 ↓
commit
```

No project is created until the user commits the preview.

## Matching strategy

Matching combines:

- normalised exact titles
- known prior user choices
- prefix/rename candidates
- catalogue evidence
- order pricing evidence
- ambiguity thresholds

The governing principle is:

> Ask rather than silently choose when two plausible products are too close.

## Duplicate titles

A shop can sell multiple products with the same visible name.

Import therefore treats title equality as candidate generation, not proof of identity.

The chooser can display multiple alternatives and search the wider catalogue.

## Renamed products

A product may be renamed between purchase and import.

Matching considers prefix-style variants so a historical order can still be reconciled to the current catalogue.

## Commas in product titles

Diamond Art Club's CSV has a products field that can itself contain titles with commas.

A naïve split would turn one kit into several fragments.

Dazzle repairs these using catalogue-aware matching, preferring the longest combination that corresponds to a known product.

## Price provenance

The project keeps the source of its purchase price.

### `order`

The exact order value is usable because the relevant kit is the only item whose price needs attribution.

### `allocated`

An order containing multiple kits can be proportionally allocated using their list prices as weights when that is defensible.

### `catalogue`

The exact split is unknowable, so a list/current catalogue price is used as a fallback.

### `receipt`

An exact figure came from receipt evidence.

### `you`

The user typed/corrected the value.

The UI should retain this distinction so an estimate does not look like a fact.

## Currency

Supported project currencies are:

```text
GBP
USD
EUR
CAD
AUD
NZD
```

A project carries its own currency.

This is important because historical transaction currency and catalogue-display preference are not the same thing.

Do not silently sum mixed currencies into one amount unless there is an explicit conversion model.

The editor builds its currency controls from the shared `CURRENCIES` list and also preserves an existing unknown currency value, avoiding the older failure where editing a CAD record could clear its currency.

## Drill-count estimation

When a real drill count is missing but size/shape are known, `estimate.js` can provide an area-based estimate.

The UI marks estimated values with:

```text
≈
```

If a real count later arrives from a product page or the user edits the count, the record can stop being marked as estimated.

## Adding a new shop

A shop is not complete when only `shops.js` has been changed.

### 1. Identify a structured source

Prefer:

- documented/public Store API
- stable product JSON
- other structured data used by the storefront

Avoid HTML scraping unless the needed data genuinely exists only on a product page and requests can be limited to projects the user owns.

### 2. Implement classification and parsing

Add:

- shop identity
- correct nominal currency
- `isKit`
- `parse`
- optional `context`
- optional `spec`

Use real examples for both projects and supplies.

### 3. Update the native host allowlist

The Android proxy rejects unknown hosts.

Add the narrowest required hostnames in `MainActivity`.

Also include any CDN/redirect targets that are genuinely required.

Every redirect target is checked.

### 4. Add tests

Cover:

- at least one normal project
- at least one supply/accessory
- missing metadata
- currency
- title/artist extraction
- any unusual variant/category structure
- per-product spec if present

### 5. Test Browse

Verify:

- search
- shop filter
- size/shape filters
- price
- availability
- image loading
- product link

### 6. Test project creation

Confirm that:

- metadata is populated correctly
- cover/gallery loads
- unlink/relink behaves safely
- user-entered corrections survive catalogue refresh

### 7. Test import interaction if relevant

A new catalogue can affect matching even if it does not add a new CSV parser.

Test ambiguous names and same-title products.

### 8. Check operational/legal constraints

Before enabling repeated catalogue access, review:

- merchant terms
- rate limits
- robots/technical restrictions where relevant
- whether content can be cached
- artwork/licensing implications

Keep sync user-benefiting, infrequent and respectful.

## Operational invariant

The catalogue is a convenience layer.

The project record is the user's durable state.

A shop failure must degrade enrichment/browsing, not erase the logbook.

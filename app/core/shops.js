/**
 * Shop adapters.
 *
 * Every shop here runs Shopify, so the product feed is the same shape — but
 * what they PUT in it differs wildly. Diamond Art Club packs the full spec into
 * the variant title; Mystical Dream Diamonds hides size and colour counts in
 * the description prose; Fallon Gems prefixes variants with emoji and the
 * artist with "Artist:"; Diamond Art UK sells unbranded blanks and puts the
 * size in the product title. One adapter each, all returning the same record.
 */

const IN_PER_CM = 1 / 2.54;
const cmToIn = (cm) => cm == null ? null : Math.round(cm * IN_PER_CM * 100) / 100;
const int = (s) => { const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const clean = (s) => String(s || '')
  .replace(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
  .replace(/\s+/g, ' ').trim();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', apos: "'", hellip: '…', ndash: '–', mdash: '—', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };
const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const textOf = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "45x60 cm", "40x 60 cm", "50x70" -> { w, h } in centimetres */
function sizeCm(s) {
  const m = String(s || '').match(/(\d{2,3})\s*[x×]\s*(\d{2,3})/i);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}
const shapeOf = (s) => {
  const m = String(s || '').match(/\b(round|square)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};
const coverageOf = (s) => /partial/i.test(String(s || '')) ? 'Partial drill' : 'Full drill';

/** Shops with no usable product_type need a guard: plenty of accessories have
 *  "diamond painting" in the title. */
const ACCESSORY = /\b(cover|release paper|replacement|coaster|glue|clay|wax|tweezer|tray|pen(?!cil)|multiplacer|placer|sheet|sticker|roller|light\s?pad|storage|organiser|organizer|ruler|apron|mat|bag|frame|magnet|button|gift card|tool)\b/i;
const isAccessory = (t) => ACCESSORY.test(String(t || ''));

/* ------------------------------------------------------------------ shops */

export const SHOPS = [
  {
    id: 'dac',
    hue: 265,
    platform: 'shopify',
    currency: 'USD',
    name: 'Diamond Art Club',
    domain: 'diamondartclub.com',
    isKit: (p) => ['Diamond Art Kit', 'Mega Dazzles', 'Mini Dazzles'].includes(p.product_type),
    parse(p, v) {
      // everything is in the variant: 22" x 28" (55.8cm x 70.6cm) / Round with 35 Colors including 2 ABs / 50,148
      const t = String(v.title || '');
      const inches = t.match(/([\d.]+)\s*"\s*x\s*([\d.]+)\s*"/i);
      const colors = t.match(/([\d,]+)\s+colou?rs?\b/i);
      const special = t.match(/includ(?:ing|es)\s+(.+?)(?:\s*\/|$)/i);
      const last = t.split('/').pop().trim().replace(/,/g, '');
      return {
        title: p.title,
        artist: String(p.vendor || '').replace(/^by\s+/i, '').trim() || null,
        width_in: inches ? parseFloat(inches[1]) : null,
        height_in: inches ? parseFloat(inches[2]) : null,
        shape: shapeOf(t), coverage: coverageOf(t),
        colors: colors ? int(colors[1]) : null,
        drills: /^\d{3,}$/.test(last) ? parseInt(last, 10) : null,
        special: special ? special[1].trim() : null
      };
    }
  },

  {
    id: 'mdd',
    hue: 345,
    platform: 'shopify',
    currency: 'CAD',
    name: 'Mystical Dream Diamonds',
    domain: 'mysticaldreamdiamonds.com',
    isKit: (p) => /^Diamond Painting$/i.test(p.product_type || ''),
    parse(p, v) {
      // size and colours live in the description prose:
      // "... 60 cm x 80 cm 57 Colours / 2 AB / 2 MD / 1 Metallic ..."
      const body = textOf(p.body_html);
      const sz = body.match(/(\d{2,3})\s*cm\s*[x×]\s*(\d{2,3})\s*cm/i);
      const cols = body.match(/(\d{1,3})\s*Colou?rs?/i);
      const special = body.match(/Colou?rs?\s*\/\s*([^.]{0,60}?)(?:\s*Rele|\s*$|\.)/i);
      return {
        title: String(p.title).replace(/\s+by\s+.+$/i, '').trim() || p.title,
        artist: clean(p.vendor) || null,
        width_in: sz ? cmToIn(+sz[1]) : null,
        height_in: sz ? cmToIn(+sz[2]) : null,
        shape: shapeOf(v.title), coverage: coverageOf(body),
        colors: cols ? int(cols[1]) : null,
        drills: null,
        special: special ? special[1].trim() : null
      };
    }
  },

  {
    id: 'pnp',
    hue: 155,
    platform: 'shopify',
    currency: 'USD',
    name: 'Pressed and Placed',
    domain: 'pressedandplaced.com',
    isKit: (p) => /^Diamond Art (Kit|Mini)/i.test(p.product_type || ''),
    parse(p, v) {
      // "Square / 50x70 / Basic Toolkit"
      const sz = sizeCm(v.title);
      return {
        title: String(p.title).replace(/\s*Hand Rendered\s*$/i, '').trim() || p.title,
        artist: clean(p.vendor) || null,
        width_in: sz ? cmToIn(sz.w) : null,
        height_in: sz ? cmToIn(sz.h) : null,
        shape: shapeOf(v.title), coverage: coverageOf(v.title),
        colors: null, drills: null, special: null
      };
    }
  },

  {
    id: 'dauk',
    hue: 62,
    platform: 'shopify',
    currency: 'GBP',
    name: 'Diamond Art UK',
    domain: 'diamondartuk.co.uk',
    // unbranded blanks; no product_type at all, so go by the title
    isKit: (p) => /diamond\s*painting/i.test(p.title || '') && !isAccessory(p.title),
    parse(p) {
      // "Diamond Painting Round Drill 40x40"
      const sz = sizeCm(p.title);
      return {
        title: p.title,
        artist: null,                       // vendor is the shop, not an artist
        width_in: sz ? cmToIn(sz.w) : null,
        height_in: sz ? cmToIn(sz.h) : null,
        shape: shapeOf(p.title), coverage: coverageOf(p.title),
        colors: null, drills: null, special: null
      };
    }
  },

  {
    id: 'fallon',
    hue: 210,
    platform: 'shopify',
    currency: 'USD',
    name: 'Fallon Gems',
    domain: 'fallongems.com',
    // no usable product_type, and most kits do not carry a size in the variant —
    // go by the title, which is consistently "<name> | Diamond Painting" or
    // "<name> | Unboxed Collection". Exclude the odd magnet/button/gift card.
    isKit: (p) => /diamond painting|unboxed collection/i.test(p.title || '')
              && !isAccessory(p.title) && !/\bbyob\b/i.test(p.title || ''),
    parse(p, v) {
      // "⭐ Velvet Canvas / 45x60 cm / ⚫️ Round"
      const parts = String(v.title || '').split('/').map(clean);
      const sizePart = parts.find(sizeCm);
      // many kits omit the size from the variant; the description usually has it
      const sz = sizeCm(sizePart) || sizeCm(textOf(p.body_html));
      const material = parts.find(x => /canvas/i.test(x));
      const vendor = clean(p.vendor).replace(/^artist:\s*/i, '');
      return {
        title: String(p.title).replace(/\s*\|.*$/, '').trim() || p.title,
        artist: /^fallon gems$/i.test(vendor) ? null : (vendor || null),
        width_in: sz ? cmToIn(sz.w) : null,
        height_in: sz ? cmToIn(sz.h) : null,
        shape: shapeOf(v.title), coverage: coverageOf(v.title),
        colors: null, drills: null,
        special: material || null
      };
    }
  },

  {
    id: 'das',
    hue: 120,
    name: 'Diamond Art Studio',
    domain: 'diamondartstudio.co.uk',
    platform: 'woo',
    currency: 'GBP',

    /* WooCommerce puts everything in categories: a top-level "Licensed
     * Artists" parent whose children are the artists, and an "Accessories"
     * parent whose children are the tools. Fetch that tree once per sync and
     * both questions answer themselves. */
    async context(getJson) {
      const cats = await getJson('/wp-json/wc/store/v1/products/categories?per_page=100');
      const byId = new Map(cats.map(c => [c.id, c]));
      const childrenOf = (name) => {
        const parent = cats.find(c => decode(c.name).toLowerCase() === name && !c.parent);
        if (!parent) return new Set();
        return new Set(cats.filter(c => c.parent === parent.id).map(c => decode(c.name)));
      };
      return { artists: childrenOf('licensed artists'), accessories: childrenOf('accessories') };
    },

    isKit(p, ctx) {
      const names = (p.categories || []).map(c => decode(c.name));
      if (names.some(n => ctx.accessories.has(n) || /^accessories$/i.test(n))) return false;
      if (/gift card/i.test(decode(p.name))) return false;
      return (p.attributes || []).some(a => /size/i.test(a.name)) || names.includes('All Paintings');
    },

    parse(p, _v, ctx) {
      // Size attribute reads "60x85cm Square Drill"
      const sizeAttr = (p.attributes || []).find(a => /size/i.test(a.name));
      const term = ((sizeAttr && sizeAttr.terms) || [])[0];
      const sz = sizeCm(term && term.name);
      const names = (p.categories || []).map(c => decode(c.name));
      const artist = names.find(n => ctx.artists.has(n));
      const shapeCat = names.find(n => /^(round|square)$/i.test(n));
      const minor = p.prices ? Math.pow(10, Number(p.prices.currency_minor_unit ?? 2)) : 100;
      return {
        title: decode(p.name),
        artist: artist || null,
        width_in: sz ? cmToIn(sz.w) : null,
        height_in: sz ? cmToIn(sz.h) : null,
        shape: shapeOf(term && term.name) || shapeOf(shapeCat),
        coverage: coverageOf(term && term.name),
        colors: null, drills: null, special: null,
        price: p.prices && p.prices.price != null ? Number(p.prices.price) / minor : null,
        currency: (p.prices && p.prices.currency_code) || null,
        image: ((p.images || [])[0] || {}).src || null,
        images: (p.images || []).map(i => i.src).filter(Boolean).slice(0, 6),
        available: p.is_in_stock ? 1 : 0,
        variant_title: term ? decode(term.name) : null,
        type: names.find(n => n !== 'All Paintings') || null
      };
    }
  },

  {
    id: 'muni',
    hue: 9,
    platform: 'shopify',
    currency: 'USD',
    name: 'Munimade',
    domain: 'munimade.com',
    // The one shop here with an honest product_type. "(Discontinued)" kits are
    // kept: they are still things you can own, and an order history full of
    // them has to match against something.
    isKit: (p) => /^Diamond Painting Kit/i.test(p.product_type || ''),
    parse(p) {
      /* The title carries the artist, and `vendor` does not — it is the
         manufacturer ("Vancy Arts"), which would put the wrong name on every
         card. Shape is in the tags. Size, drills and colours are on the product
         page and nowhere in the feed, so they stay empty rather than guessed:
         see the note in README about what this shop cannot give. */
      // "(v1.0) 'Sand and Spells' by TalySketch, Diamond Painting Canvas Kit (029)"
      const raw = String(p.title || '').replace(/^\(v[\d.]+\)\s*/i, '');
      const quoted = raw.match(/^[\u2018'"](.+?)[\u2019'"]\s+by\s+(.+?)\s*,/);
      const plain = quoted ? null : raw.match(/^(.*?)\s*-?\s*by\s+(.+?)\s*,/i);
      const found = quoted || plain;
      const title = found ? found[1].trim()
        : raw.replace(/,\s*[^,]*Diamond Painting[^,]*$/i, '').trim();

      const tags = (p.tags || []).map(t => String(t).toLowerCase());
      // "square drill" is the deliberate tag; "square" alone is the fallback
      const shapeTag = tags.find(t => /^(round|square) drill$/.test(t))
                    || tags.find(t => /^(round|square)$/.test(t));
      return {
        title: title || p.title,
        artist: found ? found[2].trim() : null,
        width_in: null, height_in: null,
        shape: shapeOf(shapeTag),
        coverage: coverageOf(tags.join(' ')),
        colors: null, drills: null,
        special: /ultimate sparkle/i.test(raw) ? 'Ultimate Sparkle' : null
      };
    }
  }
];

/* One list, used by the editor and by Settings. They disagreed: the editor
   offered three currencies and Settings four, so opening a CAD project and
   saving any field at all submitted a null currency and lost it. */
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'NZD'];

export const shopById = (id) => SHOPS.find(s => s.id === id) || null;
export const shopHue = (id) => (shopById(id) || {}).hue ?? null;

/** Link back to the canvas on the shop that sold it. Shopify and WooCommerce
 *  use different permalink shapes; both were checked against the live sites. */
/** Which currency a listed price is in. Catalogues are now fetched in your own
 *  currency where the shop supports it, so the stored value is the truth. */
export function displayCurrency(shopId, rowCurrency, preferred) {
  return rowCurrency || (shopById(shopId) || {}).currency || preferred || 'GBP';
}

export function productUrl(shopId, handle) {
  const shop = shopById(shopId);
  if (!shop || !handle) return null;
  const path = shop.platform === 'woo' ? 'product' : 'products';
  return `https://${shop.domain}/${path}/${encodeURIComponent(handle)}`;
}
export const SHOP_IDS = SHOPS.map(s => s.id);

/** Normalise one Shopify product into a catalogue row, or null if not a kit. */
export function toRow(shop, p, ctx, currency) {
  const v = (p.variants || [])[0] || {};
  // Accessories are kept, marked as such: their prices are what let an import
  // reconcile a mixed order, and it is how the importer can say WHY a line was
  // skipped instead of just "not found".
  const kind = shop.isKit(p, ctx) ? 'kit' : 'other';
  const f = shop.parse(p, v, ctx);
  if (!f.title) return null;
  const img = (p.images || [])[0];
  return {
    kind,
    shop: shop.id,
    // Shopify's product feed has no currency field and no way to ask for one —
    // prices are always in the shop's own currency, which is not always yours
    currency: f.currency || currency || shop.currency || 'USD',
    handle: p.handle || (p.slug || String(p.id)),
    title: f.title,
    artist: f.artist,
    type: f.type !== undefined ? f.type : (p.product_type || null),
    price: f.price !== undefined ? f.price : (v.price != null ? parseFloat(v.price) : null),
    available: f.available !== undefined ? f.available : (v.available ? 1 : 0),
    image: f.image !== undefined ? f.image : (img ? img.src : null),
    // the whole listing gallery, not just the first shot — capped so one
    // product with thirty photos cannot dominate the cache
    images: JSON.stringify(
      (f.images || (p.images || []).map(i => i.src) || []).filter(Boolean).slice(0, 6)),
    variant_title: f.variant_title !== undefined ? f.variant_title : (v.title || null),
    shape: f.shape,
    coverage: f.coverage,
    colors: f.colors,
    drills: f.drills,
    special: f.special,
    width_in: f.width_in,
    height_in: f.height_in
  };
}

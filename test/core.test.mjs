import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrders, normaliseDate } from '../app/core/csv.js';
import { norm, resolveFragments, disambiguate, cmFromIn } from '../app/core/match.js';
import { statusFromDates, applyStatus, parseHolds, openHold, heldDays,
         ALL_STATUSES } from '../app/core/status.js';
import { estimateDrills, DRILL_DENSITY } from '../app/core/estimate.js';
import { SHOPS, shopById, productUrl, displayCurrency, toRow } from '../app/core/shops.js';
import { buildPreview } from '../app/core/import.js';

/* ------------------------------------------------------------------ csv */

test('splits a quoted product list', () => {
  const { orders } = parseOrders(
    'Order,Date,Payment Status,Fulfillment Status,Total,Products\n' +
    '#1,2026/08/18,paid,fulfilled,£67.08,"Multiplacer,Lofi Cali Girl"\n');
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0].fragments, ['Multiplacer', 'Lofi Cali Girl']);
  assert.equal(orders[0].total, 67.08);
  assert.equal(orders[0].currency, 'GBP');
});

test('reads columns by header, not position', () => {
  const { orders } = parseOrders('Products,Total,Order\n"A,B",$10.00,#9\n');
  assert.equal(orders[0].ref, '#9');
  assert.equal(orders[0].currency, 'USD');
});

test('normalises the date formats shops use', () => {
  assert.equal(normaliseDate('2026/08/18'), '2026-08-18');
  assert.equal(normaliseDate('18/08/2026'), '2026-08-18');
  assert.equal(normaliseDate('nonsense'), null);
});

/* ---------------------------------------------------------------- match */

test('normalising folds trademarks, ampersands and punctuation', () => {
  assert.equal(norm('Frejya, Goddess of Beauty & War'), 'frejya goddess of beauty and war');
  assert.equal(norm('Mini Dazzles™ - UP'), 'mini dazzles up');
});

test('rejoins a title that contains a comma', () => {
  const row = { shop: 'dac', handle: 'frejya', kind: 'kit', price: 70,
                title: 'Frejya, Goddess of Beauty & War',
                title_norm: norm('Frejya, Goddess of Beauty & War') };
  const cat = {
    byTitle: (n) => n === row.title_norm ? [row] : [],
    byPrefix: () => [],
    byHandle: () => null
  };
  const out = resolveFragments(cat, ['Frejya', 'Goddess of Beauty & War']);
  assert.equal(out.length, 1, 'two fragments should become one product');
  assert.equal(out[0].product.title, 'Frejya, Goddess of Beauty & War');
});

test('offers variants even when a title matches exactly', () => {
  const exact = { shop: 'dac', handle: 'a', title: 'Starry Night', title_norm: 'starry night', kind: 'kit', price: 58 };
  const variant = { shop: 'dac', handle: 'b', title: 'Starry Night - Night Music',
                    title_norm: 'starry night night music', kind: 'kit', price: 26 };
  const cat = {
    byTitle: (n) => n === 'starry night' ? [exact] : [],
    byPrefix: (n) => n === 'starry night' ? [variant] : [],
    byHandle: () => null
  };
  const [r] = resolveFragments(cat, ['Starry Night']);
  assert.ok(r.variants.some(v => v.handle === 'b'), 'the renamed variant must be offered');
});

test('reconciles an ambiguous order against what was charged', () => {
  const cheap = { handle: 'cheap', price: 60, title: 'Alice', kind: 'kit' };
  const dear  = { handle: 'dear',  price: 84, title: 'Alice', kind: 'kit' };
  const other = { handle: 'o',     price: 79, title: 'Dragon', kind: 'kit' };
  const picked = disambiguate(
    [{ candidates: [cheap, dear] }, { candidates: [other] }], 163);
  assert.equal(picked.chosen[0].handle, 'dear', '84 + 79 is closest to 163');
  assert.equal(picked.confident, true);
});

test('refuses to guess when two readings are equally plausible', () => {
  const a = { handle: 'a', price: 79, kind: 'kit' };
  const b = { handle: 'b', price: 80, kind: 'kit' };
  assert.equal(disambiguate([{ candidates: [a, b] }], 79.5).confident, false);
});

test('inches are the authoritative size', () => {
  assert.equal(cmFromIn(22), 55.88);
  assert.equal(cmFromIn(28), 71.12);
});

/* --------------------------------------------------------------- status */

test('status follows the dates', () => {
  assert.equal(statusFromDates({}), 'notReceived');
  assert.equal(statusFromDates({ date_received: '2026-08-10' }), 'received');
  assert.equal(statusFromDates({ date_started: '2026-08-12' }), 'started');
  assert.equal(statusFromDates({ date_completed: '2026-08-20' }), 'completed');
});

test('choosing a status fills every earlier blank date, order date included', () => {
  const out = applyStatus({}, 'received', '2026-08-22');
  assert.equal(out.date_ordered, '2026-08-22');
  assert.equal(out.date_received, '2026-08-22');
});

test('moving backwards clears the dates that no longer apply', () => {
  const p = { date_ordered: '2026-08-01', date_received: '2026-08-10',
              date_started: '2026-08-12', date_completed: '2026-08-20' };
  const out = applyStatus(p, 'started', '2026-08-22');
  assert.equal(out.date_completed, null);
  assert.equal(out.date_started, undefined, 'an existing date is left alone');
});

test('the two rules agree with each other', () => {
  for (const status of ['notReceived', 'received', 'started', 'completed']) {
    const after = { ...applyStatus({}, status, '2026-08-22') };
    assert.equal(statusFromDates(after), status, `${status} must read back as itself`);
  }
});

/* ------------------------------------------------------------- estimate */

test('drill estimate lands close to published counts', () => {
  // real kits: title, inches, shape, published count
  const known = [[22, 28, 'Square', 63616], [23.6, 30.7, 'Square', 75433],
                 [39.4, 27.6, 'Square', 112681], [22, 34, 'Square', 77056]];
  for (const [w, h, shape, real] of known) {
    const est = estimateDrills(w, h, shape);
    const err = Math.abs(est - real) / real;
    assert.ok(err < 0.05, `estimate ${est} vs ${real} is ${(err * 100).toFixed(1)}% out`);
  }
});

test('no estimate without a known drill shape', () => {
  assert.equal(estimateDrills(20, 30, null), null);
  assert.equal(estimateDrills(null, 30, 'Square'), null);
});

test('square drills are 2.5mm, which is 16 per cm2', () => {
  assert.ok(Math.abs(DRILL_DENSITY.Square - 16) < 0.2);
});

/* ---------------------------------------------------------------- shops */

test('every shop is completely described', () => {
  for (const s of SHOPS) {
    assert.ok(s.id && s.name && s.domain, `${s.id} missing basics`);
    assert.ok(['shopify', 'woo'].includes(s.platform), `${s.id} platform`);
    assert.equal(typeof s.hue, 'number', `${s.id} needs a colour`);
    assert.equal(typeof s.isKit, 'function');
    assert.equal(typeof s.parse, 'function');
  }
});

const HUE_GAP = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('shop hues stay clear of each other', () => {
  /* 20 degrees, not 30. Seven shops and six coloured statuses share one hue
     circle, and at 30 there was no room left for a seventh shop at all. */
  const hues = SHOPS.map(s => [s.id, s.hue]);
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++)
      assert.ok(HUE_GAP(hues[i][1], hues[j][1]) >= 20,
                `${hues[i][0]} (${hues[i][1]}) and ${hues[j][0]} (${hues[j][1]}) are too close`);
});

/* The status hues are read out of the stylesheet rather than written down here.
   The hardcoded list said [32, 92, 178, 300] and had gone stale: Wish list and
   On hold were added later, so the check silently stopped covering two of the
   statuses it was meant to protect — and missed both clashes below. */
const statusHues = () => {
  const out = {};
  for (const m of CSS.matchAll(/--st-([A-Za-z]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+(\d+)\)/g)) {
    // abandoned is hue 60 at chroma 0.006 — grey, competing with nothing
    if (Number(m[3]) >= 0.02 && !(m[1] in out)) out[m[1]] = Number(m[4]);
  }
  return out;
};

/* Two shops were given their hues before Wish list and On hold existed, and now
   sit inside those bands: an MDD kit on the wish list shows a pink shop link
   beside a pink status pill. Recolouring a shop changes how the logbook has
   looked since it was built, so these are recorded rather than quietly changed
   — but nothing new may join them. */
const KNOWN_BAND_CLASHES = new Set(['mdd/wishlist', 'dac/onHold']);

test('no new shop hue clashes with a status band', () => {
  const bands = statusHues();
  assert.ok(Object.keys(bands).length >= 6, `only found ${Object.keys(bands).length} status hues`);
  const clashes = [];
  for (const s of SHOPS)
    for (const [name, hue] of Object.entries(bands))
      if (HUE_GAP(s.hue, hue) < 20 && !KNOWN_BAND_CLASHES.has(`${s.id}/${name}`))
        clashes.push(`${s.id} (${s.hue}) is ${HUE_GAP(s.hue, hue)} degrees from ${name} (${hue})`);
  assert.deepEqual(clashes, []);
});

test('product links match each platform', () => {
  assert.equal(productUrl('dac', 'catbeard'), 'https://diamondartclub.com/products/catbeard');
  assert.equal(productUrl('das', 'moon-bathing'), 'https://diamondartstudio.co.uk/product/moon-bathing');
  assert.equal(productUrl('nope', 'x'), null);
});

test('a stored currency is believed over any preference', () => {
  assert.equal(displayCurrency('mdd', 'GBP', 'GBP'), 'GBP');
  assert.equal(displayCurrency('mdd', 'CAD', 'GBP'), 'CAD');
});

test('DAC variant strings yield the full spec', () => {
  const row = toRow(shopById('dac'), {
    handle: 'x', title: 'Catbeard', vendor: 'By Sarah Richter', product_type: 'Diamond Art Kit',
    images: [{ src: 'https://cdn.shopify.com/a.jpg' }],
    variants: [{ title: '22" x 28" (55.8cm x 70.7cm) / Square with 52 Colors including 2 ABs and 3 Fairy Dust Diamonds / 63,616',
                 price: '62.99', available: true }]
  }, null, 'GBP');
  assert.equal(row.kind, 'kit');
  assert.equal(row.artist, 'Sarah Richter');
  assert.equal(row.shape, 'Square');
  assert.equal(row.colors, 52);
  assert.equal(row.drills, 63616);
  assert.equal(row.width_in, 22);
  assert.equal(row.currency, 'GBP');
});

test('accessories are kept but marked as not kits', () => {
  const row = toRow(shopById('dac'), {
    handle: 'tw', title: 'Tweezer Trio Set', vendor: 'Diamond Art Club',
    product_type: 'Accessories', images: [], variants: [{ title: 'Default', price: '16.00' }]
  }, null, 'GBP');
  assert.equal(row.kind, 'other');
  assert.equal(row.price, 16);
});

/* --------------------------------------------------------------- import */

const CSV = 'Order,Date,Payment Status,Fulfillment Status,Total,Products\n' +
            '#100,2026/08/07,paid,fulfilled,£120.00,"Alpha,Beta"\n' +
            '#101,2026/08/08,paid,processing,£40.00,Gamma\n';

function fakeCat(rows) {
  const byNorm = new Map();
  for (const r of rows) {
    const k = r.title_norm;
    byNorm.set(k, [...(byNorm.get(k) || []), r]);
  }
  return {
    byTitle: (n) => byNorm.get(n) || [],
    byPrefix: (n) => rows.filter(r => r.title_norm.startsWith(n + ' ')),
    byHandle: (hd) => rows.find(r => r.handle === hd) || null
  };
}
const kit = (h, t, price, extra = {}) => ({
  shop: 'dac', handle: h, kind: 'kit', title: t, title_norm: norm(t),
  price, currency: 'GBP', artist: 'Someone', shape: 'Square', width_in: 20, height_in: 30, ...extra
});

test('an accessory-free order reconciles to the penny', () => {
  const cat = fakeCat([kit('a', 'Alpha', 70), kit('b', 'Beta', 50)]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club');
  const first = p.kits.filter(k => k.orderRef === '#100');
  const sum = first.reduce((n, k) => n + k.price, 0);
  assert.equal(Math.round(sum * 100) / 100, 120);
  assert.ok(first.every(k => k.priceSource === 'allocated'));
});

test('a lone kit takes the order total exactly', () => {
  const cat = fakeCat([kit('a', 'Alpha', 70), kit('b', 'Beta', 50), kit('g', 'Gamma', 45)]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club');
  const g = p.kits.find(k => k.title === 'Gamma');
  assert.equal(g.price, 40);
  assert.equal(g.priceSource, 'order');
  assert.equal(g.status, 'notReceived', 'still processing');
});

/* Fulfilled means sent, not arrived. Only a delivery makes a kit Received. */
test('a fulfilled order is not received until it is delivered', () => {
  const cat = fakeCat([kit('a', 'Alpha', 70), kit('b', 'Beta', 50), kit('g', 'Gamma', 40)]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club');
  assert.ok(p.kits.filter(k => k.orderRef === '#100').every(k => k.status === 'notReceived'),
            'a fulfilled (shipped) order was marked received');
  const delivered = buildPreview(cat, new Map(), CSV.replace('paid,fulfilled', 'paid,delivered'), 'Diamond Art Club');
  assert.ok(delivered.kits.filter(k => k.orderRef === '#100').every(k => k.status === 'received'),
            'a delivered order was not marked received');
  const undelivered = buildPreview(cat, new Map(), CSV.replace('paid,fulfilled', 'paid,undelivered'), 'Diamond Art Club');
  assert.ok(undelivered.kits.every(k => k.status === 'notReceived'), '"undelivered" read as delivered');
});

test('a choice you already made is reused instead of re-guessed', () => {
  const rows = [kit('a1', 'Alpha', 70), kit('a2', 'Alpha', 71), kit('b', 'Beta', 50)];
  const cat = fakeCat(rows);
  const known = new Map([[norm('Alpha'), 'a2']]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club', known);
  const alpha = p.kits.find(k => k.title === 'Alpha');
  assert.equal(alpha.handle, 'a2');
  assert.equal(alpha.pinned, true);
  assert.equal(alpha.uncertain, false);
});

test('a missing drill count is estimated and flagged', () => {
  const cat = fakeCat([kit('g', 'Gamma', 45, { drills: null })]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club');
  const g = p.kits.find(k => k.title === 'Gamma');
  assert.ok(g.drills > 0);
  assert.equal(g.drillsEstimated, 1);
});

test('projects already logged are marked as duplicates', () => {
  const cat = fakeCat([kit('g', 'Gamma', 45)]);
  const p = buildPreview(cat, new Map([[norm('Gamma'), 7]]), CSV, 'Diamond Art Club');
  const g = p.kits.find(k => k.title === 'Gamma');
  assert.equal(g.duplicate, true);
  assert.equal(g.duplicateId, 7);
});

/* ------------------------------------------------------- holds and choices */

test('a chosen status is never overruled by the dates', () => {
  const held = { status: 'onHold', date_started: '2026-08-01' };
  assert.equal(statusFromDates(held), 'onHold', 'a held project must not snap back to started');
  const gone = { status: 'abandoned', date_started: '2026-08-01' };
  assert.equal(statusFromDates(gone), 'abandoned');
});

test('a wish list kit leaves the wish list as soon as it has a date', () => {
  assert.equal(statusFromDates({ status: 'wishlist' }), 'wishlist');
  assert.equal(statusFromDates({ status: 'wishlist', date_ordered: '2026-08-02' }), 'notReceived');
});

test('going on hold opens a period, coming off closes it', () => {
  let p = { status: 'started', date_started: '2026-08-01' };
  Object.assign(p, applyStatus(p, 'onHold', '2026-08-05'));
  assert.equal(p.status, 'onHold');
  assert.deepEqual(parseHolds(p), [{ held: '2026-08-05', restarted: null }]);
  assert.ok(openHold(p), 'it is on hold now');
  assert.equal(p.date_started, '2026-08-01', 'the start date survives the hold');

  Object.assign(p, applyStatus(p, 'started', '2026-08-09'));
  assert.deepEqual(parseHolds(p), [{ held: '2026-08-05', restarted: '2026-08-09' }]);
  assert.equal(openHold(p), null, 'the period is closed');
});

test('every in and out is its own period', () => {
  let p = { status: 'started', date_started: '2026-07-01' };
  for (const [held, back] of [['2026-07-05', '2026-07-10'], ['2026-07-20', '2026-07-25']]) {
    Object.assign(p, applyStatus(p, 'onHold', held));
    Object.assign(p, applyStatus(p, 'started', back));
  }
  assert.deepEqual(parseHolds(p), [
    { held: '2026-07-05', restarted: '2026-07-10' },
    { held: '2026-07-20', restarted: '2026-07-25' }
  ]);
  assert.equal(heldDays(p, '2026-08-01'), 10, 'five days twice');
});

test('going on hold twice without coming off does not restart the clock', () => {
  let p = { status: 'started', date_started: '2026-08-01' };
  Object.assign(p, applyStatus(p, 'onHold', '2026-08-05'));
  Object.assign(p, applyStatus(p, 'onHold', '2026-08-08'));
  assert.deepEqual(parseHolds(p), [{ held: '2026-08-05', restarted: null }]);
});

test('an open hold counts up to today', () => {
  const p = { status: 'onHold', holds: JSON.stringify([{ held: '2026-08-01', restarted: null }]) };
  assert.equal(heldDays(p, '2026-08-11'), 10);
});

test('finishing or abandoning from a hold still closes the period', () => {
  for (const end of ['completed', 'abandoned']) {
    let p = { status: 'started', date_started: '2026-08-01' };
    Object.assign(p, applyStatus(p, 'onHold', '2026-08-05'));
    Object.assign(p, applyStatus(p, end, '2026-08-12'));
    assert.equal(openHold(p), null, `${end} must close the hold`);
    assert.deepEqual(parseHolds(p), [{ held: '2026-08-05', restarted: '2026-08-12' }]);
  }
});

test('abandoning keeps the dates it earned', () => {
  let p = { status: 'started', date_ordered: '2026-07-01', date_received: '2026-07-08',
            date_started: '2026-07-10' };
  Object.assign(p, applyStatus(p, 'abandoned', '2026-08-01'));
  assert.equal(p.date_started, '2026-07-10');
  assert.equal(p.date_completed, undefined, 'abandoned is not finished');
});

test('back to the wish list clears everything, holds included', () => {
  let p = { status: 'started', date_ordered: '2026-07-01', date_received: '2026-07-08',
            date_started: '2026-07-10' };
  Object.assign(p, applyStatus(p, 'onHold', '2026-07-20'));
  Object.assign(p, applyStatus(p, 'wishlist', '2026-08-01'));
  assert.equal(p.date_ordered, null);
  assert.equal(p.date_started, null);
  assert.deepEqual(parseHolds(p), [], 'a kit you do not own has not been put down');
});

test('rewinding to before it was started throws the holds away', () => {
  let p = { status: 'started', date_ordered: '2026-07-01', date_received: '2026-07-08',
            date_started: '2026-07-10' };
  Object.assign(p, applyStatus(p, 'onHold', '2026-07-20'));
  Object.assign(p, applyStatus(p, 'received', '2026-08-01'));
  assert.equal(p.date_started, null);
  assert.deepEqual(parseHolds(p), [], 'a hold on something unstarted means nothing');
});

test('every status still reads back as itself', () => {
  for (const status of ALL_STATUSES) {
    const after = { status: 'notReceived', ...applyStatus({ status: 'notReceived' }, status, '2026-08-22') };
    assert.equal(statusFromDates(after), status, `${status} must read back as itself`);
  }
});

/* Adding a shop means editing shops.js and then eight separate places in the
   stylesheet. Miss one and the shop still works but renders colourless, or
   worse, half-coloured — which is not the kind of thing a person notices in a
   diff. So the stylesheet is checked against the list of shops rather than
   trusted. */
import { readFileSync as _read, existsSync, readdirSync } from 'node:fs';
const CSS = _read(new URL('../app/styles.css', import.meta.url), 'utf8');

test('every shop has the colours the stylesheet promises it', () => {
  const missing = [];
  for (const shop of SHOPS) {
    const want = [
      `--shop-${shop.id}:`,
      `--shop-${shop.id}-bg:`,
      `--shop-${shop.id}-soft:`,
      `.card[data-shop="${shop.id}"]`,
      `.pip[data-shop="${shop.id}"]`,
      `.cat-card[data-shop="${shop.id}"]`,
      `.chip[data-shop="${shop.id}"]`
    ];
    for (const w of want) if (!CSS.includes(w)) missing.push(`${shop.id}: ${w}`);
    // the three variable blocks: light, the dark media query, the dark attribute
    const defs = CSS.split(`--shop-${shop.id}:`).length - 1;
    if (defs !== 3) missing.push(`${shop.id}: --shop-${shop.id} defined ${defs}x, expected 3 (light, dark media, dark attribute)`);
  }
  assert.deepEqual(missing, []);
});

test('Munimade titles yield the name, the artist and the shape', () => {
  const shop = shopById('muni');
  const row = (title, tags, type = 'Diamond Painting Kit') => toRow(shop, {
    handle: 'x', title, vendor: 'Vancy Arts', product_type: type, tags,
    images: [{ src: 'https://cdn.shopify.com/a.jpg' }],
    variants: [{ title: 'Default Title', price: '85.00', available: true }]
  });

  // the artist is in the title; `vendor` is the manufacturer and must not be used
  const a = row("'The Underwater Castle' by Femke Deborah, Diamond Painting Canvas Kit (128)",
                ['square', 'square drill']);
  assert.equal(a.title, 'The Underwater Castle');
  assert.equal(a.artist, 'Femke Deborah');
  assert.equal(a.shape, 'Square');
  assert.equal(a.coverage, 'Full drill');

  // a reissued design carries a (v1.0) prefix that is not part of the name
  const b = row("(v1.0) 'Sand and Spells' by TalySketch, Diamond Painting Canvas Kit (029)", ['round drill']);
  assert.equal(b.title, 'Sand and Spells');
  assert.equal(b.artist, 'TalySketch');
  assert.equal(b.shape, 'Round');

  // ULTIMATE SPARKLE sits between the artist and the kit words
  const c = row("'Unbridled Soul' by Kat Fedora, ULTIMATE SPARKLE Diamond Painting Canvas Kit (158)", ['square']);
  assert.equal(c.title, 'Unbridled Soul');
  assert.equal(c.special, 'Ultimate Sparkle');

  // a grab-bag has no artist and must not invent one out of the quoted words
  const d = row("(OOPSIE) Discounted 'B Grade' Diamond Painting Kits", ['diamond painting kit']);
  assert.equal(d.artist, null);
  assert.equal(d.shape, null);

  // discontinued kits are still kits — an order history has to match them
  assert.equal(row("'Star Princess' by Jessica Maltezo, Diamond Painting Canvas Kit (008)",
                   ['round'], 'Diamond Painting Kit (Discontinued)').kind, 'kit');
  // accessories are not
  assert.equal(row('Washi Tape', [], 'Washi Tape').kind, 'other');
  assert.equal(row('Storage Box', [], 'DP Storage').kind, 'other');
});

test('Munimade links back to the right product page', () => {
  assert.equal(productUrl('muni', 'sand-and-spells-029'),
               'https://munimade.com/products/sand-and-spells-029');
});

test('a canvas size with decimals in it is still a size', () => {
  // Pressed and Placed lists 55.9x76.2, which an integers-only pattern read as
  // no size at all — and no size means no estimated diamond count either
  const pnp = shopById('pnp');
  const row = toRow(pnp, {
    handle: 'x', title: 'Forest Spooks', vendor: 'PnP', product_type: 'Diamond Painting',
    images: [{ src: 'https://cdn.shopify.com/a.jpg' }],
    variants: [{ title: 'Square / 55.9x76.2 / Basic Toolkit', price: '50.00', available: true }]
  });
  assert.ok(row.width_in > 21 && row.width_in < 23, `width came out as ${row.width_in}`);
  assert.ok(row.height_in > 29 && row.height_in < 31, `height came out as ${row.height_in}`);
});

test('Munimade reads its spec off the product page', () => {
  const spec = shopById('muni').spec(`<ul>
    <li><b>Diamond Amount:</b> 95,200</li>
    <li><b>Image Size:</b> 60cm x 85cm (23.6" x 33.5")</li>
    <li><b>Color Amount:</b> 80 Colors Including 3 AB, 5 Shimmer, 2 Metallic</li></ul>`);
  assert.equal(spec.drills, 95200);
  assert.equal(spec.width_in, 23.6);
  assert.equal(spec.height_in, 33.5);
  assert.equal(spec.colors, 80);
  assert.equal(spec.special, '3 AB, 5 Shimmer, 2 Metallic');

  // a colour line with no "including" clause is a count and nothing more
  const plain = shopById('muni').spec('<li><b>Color Amount:</b> 52 Shimmer Drill Colors</li>');
  assert.equal(plain.colors, 52);

  // and a page that says none of it yields nothing rather than nonsense
  assert.deepEqual(shopById('muni').spec('<p>no spec here</p>'), {});
});

/* The README listed six shops while the code had seven, because adding a shop
   and remembering to say so are two different acts. It is checked rather than
   trusted, the same way the stylesheet is. */
const README = _read(new URL('../README.md', import.meta.url), 'utf8');

test('the README names every shop the app supports', () => {
  const missing = SHOPS.filter(s => !README.includes(s.name)).map(s => s.name);
  assert.deepEqual(missing, [], 'these shops exist in the code but not in the README');
});

/* Every markdown file, not just the README: the docs cross-link heavily and a
   moved or renamed page is invisible until someone follows the link. */
test('no document links to a file that is not there', () => {
  const bad = [];
  const files = [...readdirSync(new URL('../', import.meta.url)).filter(f => f.endsWith('.md')).map(f => ['', f]),
                 ...readdirSync(new URL('../docs/', import.meta.url)).filter(f => f.endsWith('.md')).map(f => ['docs/', f])];
  for (const [dir, name] of files) {
    const text = _read(new URL(`../${dir}${name}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      if (!existsSync(new URL(`../${dir}${target}`, import.meta.url))) bad.push(`${dir}${name} -> ${target}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the things you place diamonds on are kits, and the supplies are not', () => {
  const dac = shopById('dac');
  const p = (title, product_type, variant) => ({
    handle: 'x', title, vendor: 'By Someone', product_type,
    images: [{ src: 'https://cdn.shopify.com/a.jpg' }],
    variants: [{ title: variant, price: '17.99', available: true }]
  });
  const SPEC = '4" x 4" (10cm x 10cm) / Round with 19 Colors including 19 Iridescent Diamonds / 5,730';

  // coasters, keychains and the rest are projects people own and finish
  for (const type of ['Coasters', 'Keychains', 'Gem Houses', 'Sparkle Boards', 'Bookmarks'])
    assert.equal(dac.isKit(p('Thing', type, SPEC)), true, `${type} should be a kit`);

  // a bundle carries no per-item spec, and is still a kit by its type
  assert.equal(dac.isKit(p('Sparkle Pals™ Complete Set', 'Sparkle Pals', 'Default Title')), true);

  // something filed oddly is caught by its diamond count alone
  assert.equal(dac.isKit(p('Mini Tumblr - Holly Jolly', 'Accessories',
    '5.3" x 3.1" (13.4cm x 8cm) / Round with 14 Colors / 3,000')), true);

  // supplies are not
  for (const [title, type] of [['Twist And Pick Premium Pen', 'Accessories'],
                               ['Bling Diamonds – Square (Set of 10)', 'Diamonds'],
                               ['Mystery Box', 'Mystery Box'], ['Wall Calendar', 'Calendar'],
                               ['Diamond Painting Table', 'Tables']])
    assert.equal(dac.isKit(p(title, type, 'Default Title')), false, `${type} should not be a kit`);

  // and a coaster's spec comes through like any other canvas
  const row = toRow(dac, p('Coasters - The Grinch™', 'Coasters', SPEC));
  assert.equal(row.kind, 'kit');
  assert.equal(row.drills, 5730);
  assert.equal(row.colors, 19);
  assert.equal(row.width_in, 4);
  assert.equal(row.shape, 'Round');
});

/* The Android shell will only fetch from hosts on a list compiled into it. A
   shop added to shops.js and not to that list cannot be reached at all, and the
   app reports only "HTTP 500" while failing — which is exactly what happened
   when Munimade shipped. The two lists are held in step here rather than by
   remembering. */
const SHELL = _read(new URL('../android/src/org/logbook/solo/MainActivity.java', import.meta.url), 'utf8');

test('the shell is allowed to reach every shop the app knows about', () => {
  const allowed = (SHELL.match(/private static final String\[\] ALLOWED = \{([\s\S]*?)\};/) || [])[1];
  assert.ok(allowed, 'could not find the allow-list in the Android shell');
  const hosts = [...allowed.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
  const reachable = (domain) => hosts.some(h => domain === h || domain.endsWith('.' + h));
  const unreachable = SHOPS.filter(s => !reachable(s.domain.toLowerCase()))
                           .map(s => `${s.name} (${s.domain})`);
  assert.deepEqual(unreachable, [], 'these shops cannot be reached from the app at all');
});

/* ------------------------------------------------- a kit's colours */

import { readPalette, paletteSection } from '../app/core/palette.js';

const PALETTE = (sku, shape, items, extra = '') => `
  <dac-pdp-palette class="dac-pdp-palette"><details class="palette" data-shape="${shape}" data-palette-sku="${sku}">
    <summary data-palette-dialog="dac-palette-dialog-template--999__abc-123-47423217107137">
      <span class="summary-meta">${items.length} colors · ${shape} diamonds</span></summary>
    <div class="palette-body">
      <div class="group-header"><h3>Specialty diamonds</h3></div>
      <ul class="special-grid">${items.filter((i) => i[3]).map((i) => `
        <li title="${i[0]} · ${i[1]} · ${i[3]}"><span class="swatch" style="--shade:${i[2]}"></span>
          <span><b>${i[0]}</b><small>${i[3]}</small></span></li>`).join('')}</ul>
      <ul class="color-grid">${items.filter((i) => !i[3]).map((i) => `
        <li title="${i[0]} · ${i[1]}"><span class="swatch" style="--shade:${i[2]}"></span><span>${i[0]}</span></li>`).join('')}</ul>
      <div class="palette-foot">DMC codes</div>
    </div></details>${extra}</dac-pdp-palette>`;

test('a kit’s colours are read off its own page, codes, names and all', () => {
  const r = readPalette('<html>' + PALETTE('DAC-6750S-DTC', 'square', [
    ['310', 'Black', '#000000'], ['3865', 'Winter White', '#FBFBF9'],
    ['105', 'Tan', '#CB9051', 'Aurora Borealis']]) + '</html>');
  assert.equal(r.sku, 'DAC-6750S-DTC');
  assert.equal(r.shape, 'square');
  assert.deepEqual(r.colours, [
    { code: '105', name: 'Tan', hex: '#cb9051', finish: 'Aurora Borealis' },
    { code: '310', name: 'Black', hex: '#000000', finish: null },
    { code: '3865', name: 'Winter White', hex: '#fbfbf9', finish: null }]);
});

test('the same list printed twice on a page is not read twice', () => {
  const items = [['310', 'Black', '#000000'], ['823', 'Navy Blue Dark', '#1B2853']];
  const dialog = `<dialog class="dac-palette-dialog"><div class="palette-body"><ul class="color-grid">${
    items.map((i) => `<li title="${i[0]} · ${i[1]}"><span class="swatch" style="--shade:${i[2]}"></span></li>`).join('')
  }</ul><div class="palette-foot"></div></div></dialog>`;
  const r = readPalette(PALETTE('DAC-1S', 'round', items, dialog));
  assert.deepEqual(r.colours.map((c) => c.code), ['310', '823']);
});

test('a page with no colour list gives nothing, rather than half a legend', () => {
  assert.equal(readPalette('<html><body>Coasters</body></html>'), null);
  assert.equal(readPalette(''), null);
  assert.equal(readPalette(null), null);
  // a list of nothing is not a list
  assert.equal(readPalette(PALETTE('DAC-2S', 'square', [])), null);
  // and neither is one of rubbish
  assert.equal(readPalette(PALETTE('DAC-3S', 'square', [['<script>alert(1)</script>', 'x', '#fff']])), null);
});

test('a colour with no swatch still counts, and a short hex is understood', () => {
  const r = readPalette(PALETTE('DAC-4S', 'square', [['310', 'Black', '#000'], ['777', 'Unknown', 'none']]));
  assert.deepEqual(r.colours.map((c) => [c.code, c.hex]), [['310', '#000000'], ['777', null]]);
});

test('an ampersand in a colour name is unescaped once, not twice', () => {
  const r = readPalette(PALETTE('DAC-5S', 'square', [['310', 'Black &amp; Blue', '#000000'],
                                                     ['3865', 'Not &amp;lt;b&amp;gt;bold', '#FFFFFF']]));
  assert.deepEqual(r.colours.map((c) => c.name), ['Black & Blue', 'Not &lt;b&gt;bold']);
});

/* ------------------------------------------------- the stash in colour */

import { colourStats, distinctDrills, family, lightness } from '../app/core/colourstats.js';

test('colours are put in the family they look like', () => {
  const cases = { '#000000': 'blacks', '#1b1b1b': 'blacks', '#ffffff': 'whites', '#fbfbf9': 'whites',
    '#808080': 'greys', '#c62828': 'reds', '#f7a1b5': 'pinks', '#b04a8f': 'pinks', '#ef8a2b': 'oranges',
    '#7a451f': 'browns', '#e8c49c': 'tans', '#ecc89e': 'tans', '#f2cf3c': 'yellows', '#4f9a4a': 'greens', '#253b73': 'blues',
    '#3f7c85': 'blues', '#7d52a8': 'purples' };
  for (const [hex, want] of Object.entries(cases)) assert.equal(family(hex), want, hex);
  assert.equal(family('nope'), null);
  assert.equal(family(null), null);
});

test('lightness runs from black at 0 to white at 100, the way the eye sees it', () => {
  assert.equal(lightness('#000000'), 0);
  assert.equal(lightness('#ffffff'), 100);
  assert.ok(lightness('#ffff00') > lightness('#0000ff'), 'yellow should read lighter than blue');
  assert.equal(lightness('#12'), null);
});

const KIT = (id, title, colours, variant = String(id)) => ({ id, title, variant, colours });
const D = (code, hex = null, finish = null, name = null) => ({ code, hex, finish, name });

test('the staples are the drills in the most kits, and a drill in one kit is a one-off', () => {
  const s = colourStats([
    KIT(1, 'Moon Eater', [D('310', '#000000', null, 'Black'), D('3865', '#fbfbf9'), D('105', '#cb9051', 'Aurora Borealis')]),
    KIT(2, 'Sif', [D('310', '#000000'), D('3865', '#fbfbf9'), D('823', '#1b2853')]),
    KIT(3, 'Wild Bloom', [D('310', '#000000'), D('105', '#cb9051')])]);
  assert.deepEqual(s.common.map((c) => [c.code, c.kits]), [['310', 3], ['3865', 2]],
                   'a drill in only one kit is not a staple');
  assert.equal(s.common[0].name, 'Black', 'the name from one list was lost');
  // 105 as an AB drill and 105 as a plain one are different bags
  assert.equal(s.distinct, 5);
  assert.deepEqual(s.oneOffs.sample.map((c) => [c.code, c.finish, c.kit.title]),
                   [['105', null, 'Wild Bloom'], ['105', 'Aurora Borealis', 'Moon Eater'], ['823', null, 'Sif']]);
  assert.equal(s.oneOffs.count, 3);
  assert.deepEqual(s.finishes, [{ finish: 'Aurora Borealis', n: 1 }]);
  assert.equal(s.mostSpecial.title, 'Moon Eater');
  assert.equal(s.mostColours.value, 3);
  assert.equal(s.fewestColours.title, 'Wild Bloom');
});

test('palette twins are the two kits that share the most drills, never two copies of one kit', () => {
  const s = colourStats([
    KIT(1, 'Moon Eater', [D('310'), D('3865'), D('823'), D('939')], 'v1'),
    KIT(2, 'Moon Eater again', [D('310'), D('3865'), D('823'), D('939')], 'v1'),
    KIT(3, 'Sif', [D('310'), D('3865'), D('823')], 'v3'),
    KIT(4, 'Tiny', [D('310')], 'v4')]);
  assert.deepEqual([s.twins.a.title, s.twins.b.title, s.twins.shared], ['Moon Eater', 'Sif', 3]);
});

test('darkest and brightest palettes, and the family the stash leans towards', () => {
  const dark = Array.from({ length: 14 }, (_, i) => D(String(100 + i), '#1b2853'));
  const light = Array.from({ length: 12 }, (_, i) => D(String(200 + i), '#fdf9cd'));
  const s = colourStats([KIT(1, 'Night', dark), KIT(2, 'Day', light)]);
  assert.equal(s.darkest.title, 'Night');
  assert.equal(s.brightest.title, 'Day');
  assert.equal(s.families[0].family, 'blues');
  assert.equal(Math.round(s.families.reduce((n, f) => n + f.share, 0)), 100);
});

test('colour records that need colours say nothing when too few are known', () => {
  // a list with no colours cannot be ranked for lightness, nor lean anywhere
  const s = colourStats([KIT(1, 'Codes only', [D('310'), D('3865')]), KIT(2, 'Also codes', [D('310')])]);
  assert.equal(s.brightest, null);
  assert.equal(s.darkest, null);
  assert.deepEqual(s.families, [], 'a list with no colours was called a leaning');
  // five blues are five blues, not a stash that leans blue
  const few = colourStats([KIT(1, 'Five', Array.from({ length: 5 }, (_, i) => D(String(i), '#253b73')))]);
  assert.deepEqual(few.families, [], 'a handful of colours was called a leaning');
  assert.equal(colourStats([]), null);
  assert.equal(colourStats([KIT(1, 'Empty', [])]), null);
});

test('different drills are counted once however many kits hold them', () => {
  assert.equal(distinctDrills([KIT(1, 'a', [D('310'), D('105', null, 'Aurora Borealis')]),
                               KIT(2, 'b', [D('310'), D('105')])]), 3);
  assert.equal(distinctDrills([]), 0);
});

test('the section holding the colours is read off the page, whatever the theme calls it', () => {
  const page = `<div id="shopify-section-template--1__header"></div>
    <div id="shopify-section-template--25650457411777__60c6fc7b-2109">
      ${PALETTE('DAC-6750S-DTC', 'square', [['310', 'Black', '#000000']])}</div>
    <div id="shopify-section-template--1__footer"></div>`;
  assert.equal(paletteSection(page), 'template--25650457411777__60c6fc7b-2109');
  assert.equal(paletteSection('<div id="shopify-section-template--1__main">no colours</div>'), null,
               'a page with no colour list named a section anyway');
  assert.equal(paletteSection(''), null);
});

/* ------------------------------------------- the colour filters' helpers */

import { drillQuery, drillMatches } from '../app/core/drills.js';
import { leanings } from '../app/core/colourstats.js';

test('a search that looks like a code matches codes only; a word matches names', () => {
  assert.deepEqual(drillQuery('161'), { code: '161', byName: null });
  assert.deepEqual(drillQuery(' b5200 '), { code: 'B5200', byName: null });
  assert.deepEqual(drillQuery('AB972'), { code: 'AB972', byName: null });
  assert.deepEqual(drillQuery('ecru'), { code: 'ECRU', byName: null });
  assert.deepEqual(drillQuery('Navy'), { code: 'NAVY', byName: 'navy' });
  assert.deepEqual(drillQuery('bl'), { code: 'BL', byName: null }, 'two letters is too little to search names on');
  // 161 is not hiding in "Pantone 1615", which is drill 6030
  assert.equal(drillMatches('161', '6030', 'Pantone 1615'), false);
  assert.equal(drillMatches('161', '161', 'Gray Blue'), true);
  assert.equal(drillMatches('navy', '823', 'Dark Navy Blue'), true);
  assert.equal(drillMatches('', '310', 'Black'), false);
});

test('a kit leans towards its biggest colour family, and any other with a quarter of it', () => {
  const blue = { hex: '#253b73' }, grey = { hex: '#8c8c8c' }, red = { hex: '#c62828' };
  const kit = (...xs) => xs.map((c, i) => ({ code: String(100 + i), ...c }));
  // six blues, two greys, two reds: blue, and grey and red are only a fifth each
  assert.deepEqual(leanings(kit(blue, blue, blue, blue, blue, blue, grey, grey, red, red)), ['blues']);
  // four blues, three greys, three reds: every one of them is past a quarter
  assert.deepEqual(leanings(kit(blue, blue, blue, blue, grey, grey, grey, red, red, red)), ['blues', 'reds', 'greys']);
  // fewer than five colours known says too little
  assert.deepEqual(leanings(kit(blue, blue, blue, blue, { hex: null }, { hex: null })), []);
  // a drill named twice counts once
  const twice = kit(blue, blue, blue, grey, grey, grey);
  assert.deepEqual(leanings([...twice, twice[0], twice[0], twice[0]]), ['blues', 'greys']);
  assert.deepEqual(leanings(null), []);
});

/* ------------------------------------------ Diamond Art Club's spreadsheet */

import { readXlsx, excelDate, looksLikeXlsx } from '../app/core/xlsx.js';
import { parseDacWorkbook, splitItem, isDacWorkbook } from '../app/core/dacworkbook.js';
import { makeXlsx, dacExport } from './xlsxfixture.mjs';

test('a spreadsheet is read, whichever way it stores its text', async () => {
  for (const shared of [false, true]) {
    const book = await readXlsx(makeXlsx({
      // the last is the literal text "&lt;", which only unescaping & last keeps
      First: [['Name', 'Count'], ['Fish & Chips <hot>', 3], ['', 4.5], ['&lt;b&gt;']],
      'Second tab': [['only']] }, { shared }));
    assert.deepEqual(book.names, ['First', 'Second tab']);
    assert.deepEqual(book.sheets.First[0], { A: 'Name', B: 'Count' });
    assert.deepEqual(book.sheets.First[1], { A: 'Fish & Chips <hot>', B: 3 }, 'text or numbers were misread');
    assert.deepEqual(book.sheets.First[2], { B: 4.5 }, 'an empty cell was given a value');
    assert.deepEqual(book.sheets.First[3], { A: '&lt;b&gt;' }, 'text was unescaped twice');
  }
});

test('a spreadsheet date is the day it names, and a zip is told from text', () => {
  assert.equal(excelDate(46289.642060185186), '2026-09-24');
  assert.equal(excelDate(1), '1899-12-31');
  assert.equal(excelDate(''), null);
  assert.equal(looksLikeXlsx(new Uint8Array(makeXlsx({ A: [['x']] }))), true);
  assert.equal(looksLikeXlsx(new TextEncoder().encode('Order,Date\n')), false);
});

test('an item splits into its title and variant at the canvas size, not the first dash', () => {
  assert.deepEqual(splitItem('Coasters - Blooms - 4" x 4" (10cm x 10cm) / Round with 20 Colors / 2,970'),
    { title: 'Coasters - Blooms', variant: '4" x 4" (10cm x 10cm) / Round with 20 Colors / 2,970', drills: 2970 });
  assert.equal(splitItem('Fishergal - 22" x 29″ (56cm x 74cm) / Square With 54 Colors / 64,532').title, 'Fishergal');
  assert.equal(splitItem('Starry Night - Night Music - 13" x 18" (33cm x 46cm) / Square / 24,156').title, 'Starry Night - Night Music');
  assert.deepEqual(splitItem('Twist-On Dual-Threaded Premium Drill Pen – Seafoam Swirl'),
    { title: 'Twist-On Dual-Threaded Premium Drill Pen – Seafoam Swirl', variant: null, drills: null });
});

test('each item costs its original price less its share of the discount', async () => {
  const book = await readXlsx(dacExport([
    // the "final" price already discounted here, and not on the next one: DAC does both
    { ref: '#1', serial: 46289.5, delivery: 'Fulfilled', items: [
      { name: 'Gobbler - 25" x 22" (63.7cm x 55.8cm) / Square / 57,344', original: 55, final: 49.5, discount: 5.5 },
      { name: 'Stainless Steel 12 Tip Multiplacer', original: 18, discount: 2.7 }] },
    { ref: '#2', serial: 46290, items: [
      { name: 'Fairy Lights - 22" x 28" (56cm x 71cm) / Square / 62,101', original: 110, qty: 2, discount: 53.41 }] },
    { ref: '#3', serial: 46291, shipping: 5, items: [
      { name: 'Aura - 22" x 28" (55.8cm x 70.7cm) / Square / 63,616', original: 60 },
      { name: 'Moon Eater - 23.6" x 30.7" (60cm x 78cm) / Square / 75,433', original: 40 }] },
    { ref: '#4', serial: 46292, cancelled: 'Yes', items: [{ name: 'Sif - 22" x 31" / Square / 70,784', original: 70 }] }]));
  assert.equal(isDacWorkbook(book), true);
  const { orders, warnings } = parseDacWorkbook(book);
  assert.deepEqual(warnings, []);
  assert.deepEqual(orders.map((o) => o.ref), ['#1', '#2', '#3'], 'a cancelled order was imported');
  const [a, b, c] = orders;
  assert.equal(a.date, '2026-09-24');
  assert.equal(a.fulfillmentStatus, 'fulfilled');
  assert.deepEqual(a.lines.map((l) => l.paid), [49.5, 15.3], 'a discount was taken off twice, or not at all');
  assert.equal(a.lines[0].drills, 57344);
  assert.deepEqual([b.lines[0].qty, b.lines[0].paid], [2, 28.3], 'two of a kit were not priced one at a time');
  assert.deepEqual(c.lines.map((l) => l.paid), [63, 42], 'shipping was not shared out over the items');
  for (const o of orders)
    assert.ok(Math.abs(o.lines.reduce((n, l) => n + l.paid * l.qty, 0) - o.total) < 0.02, `${o.ref} does not add up`);
});

test('a kit sold square and round is told apart by the shape its line names', async () => {
  const both = [
    { ...kit('magic-round', 'A Little Bit of Magic', 46), shape: 'Round', drills: 39601 },
    { ...kit('magic-square', 'A Little Bit of Magic', 47), shape: 'Square', drills: 39601 }];
  const book = await readXlsx(dacExport([{ ref: '#5', serial: 46289, items: [
    { name: 'A Little Bit of Magic - 19.5" x 19.5" (49.6cm x 49.6cm) / Square with 62 Colors / 39,601', original: 47 }] }]));
  const [magic] = buildPreview(fakeCat(both), new Map(), parseDacWorkbook(book), 'Diamond Art Club').kits;
  assert.equal(magic.handle, 'magic-square', 'the shape on the line did not pick the square kit');
  assert.equal(magic.uncertain, false, 'a kit the line names exactly was still called uncertain');
});

test('a spreadsheet that is not an order export says so', async () => {
  const book = await readXlsx(makeXlsx({ Budget: [['Month', 'Spent'], ['May', 40]] }));
  assert.equal(isDacWorkbook(book), false);
  assert.match(parseDacWorkbook(book).warnings[0], /not a Diamond Art Club order export/);
});

test('a spreadsheet line is matched by its drill count when titles collide', async () => {
  const twoAlices = [
    { ...kit('alice-a', 'Alice in Wonderland', 80), drills: 119425 },
    { ...kit('alice-b', 'Alice in Wonderland', 80), drills: 56000 },
    kit('tool', 'Stainless Steel 12 Tip Multiplacer', 18)];
  twoAlices[2].kind = 'accessory';
  const book = await readXlsx(dacExport([{ ref: '#9', serial: 46289, delivery: 'Unfulfilled', items: [
    { name: 'Alice in Wonderland - 20" x 28" (51cm x 71cm) / Square / 56,000', original: 64, discount: 9.6 },
    { name: 'Stainless Steel 12 Tip Multiplacer', original: 18 }] }]));
  const p = buildPreview(fakeCat(twoAlices), new Map(), parseDacWorkbook(book), 'Diamond Art Club');
  assert.equal(p.kits.length, 1);
  const alice = p.kits[0];
  assert.equal(alice.handle, 'alice-b', 'the drill count did not pick the kit');
  assert.equal(alice.uncertain, false);
  assert.deepEqual([alice.price, alice.priceSource], [54.4, 'order'], 'the exact price was not used');
  assert.equal(alice.status, 'notReceived');
  assert.equal(p.skipped.length, 1, 'the multiplacer was not left out');
});

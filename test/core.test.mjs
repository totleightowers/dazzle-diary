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

test('fulfilment decides the status', () => {
  const cat = fakeCat([kit('a', 'Alpha', 70), kit('b', 'Beta', 50)]);
  const p = buildPreview(cat, new Map(), CSV, 'Diamond Art Club');
  assert.ok(p.kits.filter(k => k.orderRef === '#100').every(k => k.status === 'received'));
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
import { readFileSync as _read } from 'node:fs';
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

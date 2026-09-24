/**
 * Turning an order-history CSV into projects. Pure: the catalogue and the
 * existing logbook arrive through `cat` and `existing`.
 */
import { parseOrders } from './csv.js';
import { resolveFragments, disambiguate, norm, cmFromIn, round2 } from './match.js';
import { estimateDrills } from './estimate.js';
import { displayCurrency } from './shops.js';

/* Fulfilled only means it was sent. A kit is received once it has been
   delivered, and nothing else says so — so a fulfilled or shipped order stays
   Not received until it arrives. "Unfulfilled" has to be ruled out first: it
   contains the word it negates. */
const statusFor = (fulfillment) => {
  const f = String(fulfillment || '').toLowerCase();
  return !/\bun/.test(f) && /delivered/.test(f) ? 'received' : 'notReceived';
};

/* One line of the spreadsheet export is one item, so it is matched on its own
   rather than being stitched back together like the CSV's comma-joined titles.
   The variant says how many drills the kit has — "… / 39,601" — which tells
   apart canvases that share a title far more surely than a price can. */
function resolveLine(cat, line) {
  let [r] = resolveFragments(cat, [line.title]);
  /* A title the catalogue does not have whole may be a listing and a variant
     name: "Starry Night - Night Music" is sold as "Starry Night". */
  if ((!r || !r.product) && / - /.test(line.title)) {
    const [alt] = resolveFragments(cat, [line.title.slice(0, line.title.lastIndexOf(' - '))]);
    if (alt && alt.product) r = { ...alt, title: line.title, loose: true };
  }
  r = r || { title: line.title, candidates: [], variants: [], product: null };
  if (line.drills != null) {
    const pool = [...(r.candidates || []), ...(r.variants || [])];
    let exact = pool.filter((c) => Number(c.drills) === line.drills);
    /* A kit sold square and round has the same drill count both ways, and the
       variant says which it was. */
    const shape = /\b(square|round)\b/i.exec(line.variant || '');
    if (exact.length > 1 && shape) {
      const same = exact.filter((c) => String(c.shape || '').toLowerCase() === shape[1].toLowerCase());
      if (same.length) exact = same;
    }
    if (exact.length === 1) { r.product = exact[0]; r.candidates = [exact[0], ...(r.candidates || []).filter((c) => c !== exact[0])]; r.byDrills = true; }
  }
  return r;
}

/**
 * @param cat       { byTitle, byPrefix }
 * @param existing  Map of normalised title -> project id
 */
/**
 * @param cat       { byTitle, byPrefix }
 * @param existing  Map of normalised title -> project id
 * @param known     Map of normalised CSV title -> handle you already chose once.
 *                  Corrections stick: if you told it a "Starry Night" line is
 *                  the Wanda Mumm one, it stops guessing next time.
 */
export function buildPreview(cat, existing, input, shopName = 'Diamond Art Club', known = new Map(), prefCurrency = 'GBP') {
  // a CSV's text, or orders already read out of a spreadsheet
  const { orders, warnings } = typeof input === 'string' ? parseOrders(input) : input;
  const kits = [], skipped = [];
  let lineCount = 0;

  for (const order of orders) {
    const lines = order.lines || null;
    const resolved = lines ? lines.map((l) => resolveLine(cat, l)) : resolveFragments(cat, order.fragments);
    if (lines) resolved.forEach((r, i) => { r.line = lines[i]; });
    lineCount += resolved.length;
    const flag = order.paymentStatus && order.paymentStatus !== 'paid' ? order.paymentStatus : null;

    /* The price-fit guess is only needed where the variant did not settle it. */
    const { chosen, confident } = lines
      ? { chosen: resolved.map((r) => r.product), confident: resolved.every((r) => r.byDrills || (r.candidates || []).length <= 1) }
      : disambiguate(resolved, order.total);
    resolved.forEach((r, i) => {
      // A choice you made once beats anything inferred — including when the
      // product you picked is not among this line's candidates at all (yours
      // may have been a renamed variant found by prefix, not exact title).
      const pinned = known.get(norm(r.title));
      const direct = pinned
        ? ((r.candidates || []).find(c => c.handle === pinned) || (cat.byHandle && cat.byHandle(pinned)))
        : null;
      r.product = direct || chosen[i] || r.product;
      r.pinned = !!direct;
      if (r.byDrills && !direct) r.pinned = true;      // the variant named it; nothing to second-guess
      if (direct && !(r.candidates || []).some(c => c.handle === direct.handle))
        r.candidates = [direct, ...(r.candidates || [])];
    });

    const orderKits = [], orderSkipped = [];
    for (const r of resolved) {
      const p = r.product;
      if (!p) { orderSkipped.push({ r, reason: 'Not found in the catalogue', kind: 'unknown' }); continue; }
      if (p.kind !== 'kit') { orderSkipped.push({ r, reason: p.type || 'Not a canvas', kind: 'notKit' }); continue; }
      orderKits.push({ r, p });
    }

    /* Pricing. The catalogue knows today's LIST price, which is not what was
     * paid. So: one kit alone in an order takes the total exactly; several kits
     * with no accessories split it in proportion to list price (the order then
     * reconciles to the penny); anything else falls back to list price. Each
     * project records which of the three it got. */
    const listSum = orderKits.reduce((n, k) => n + (k.p.price || 0), 0);
    const canAllocate = orderSkipped.length === 0 && order.total != null && listSum > 0;
    /* Currency matters here: a price worked out from YOUR order total is in the
     * currency you were charged, but a list price is in whatever the shop
     * quotes — Diamond Art Club quotes USD, Mystical Dream Diamonds CAD. Each
     * price carries its own, so nothing gets a £ sign it has not earned. */
    const priceFor = (k) => {
      // the spreadsheet says what each item cost, discounts and all
      if (k.r.line && k.r.line.paid != null)
        return { price: k.r.line.paid, source: 'order', currency: order.currency };
      if (canAllocate && orderKits.length === 1)
        return { price: round2(order.total), source: 'order', currency: order.currency };
      if (canAllocate)
        return { price: round2(order.total * (k.p.price || 0) / listSum), source: 'allocated', currency: order.currency };
      // the shop's numeral is the price in your market too, so it carries your
      // currency rather than the one the shop's own storefront happens to quote
      return {
        price: k.p.price != null ? round2(k.p.price) : null,
        source: k.p.price != null ? 'catalogue' : null,
        currency: displayCurrency(k.p.shop, k.p.currency, prefCurrency || order.currency)
      };
    };

    for (const { r, reason, kind } of orderSkipped) {
      skipped.push({
        key: `${order.ref}::${r.title}`, title: r.product ? r.product.title : r.title,
        rawTitle: r.title, orderRef: order.ref, orderDate: order.date, orderTotal: order.total,
        orderItems: resolved.length, currency: order.currency, flag, reason, kind
      });
    }

    for (const k of orderKits) {
      const p = k.p, r = k.r;
      const { price, source, currency } = priceFor(k);
      const dupeId = existing.get(norm(p.title));
      kits.push({
        key: `${order.ref}::${r.title}`,
        title: p.title, rawTitle: r.title,
        orderRef: order.ref, orderDate: order.date, orderTotal: order.total,
        orderItems: resolved.length, currency, orderCurrency: order.currency, flag,
        renamed: r.loose || norm(p.title) !== norm(r.title),
        handle: p.handle, shop: p.shop, shopName,
        artist: p.artist, cover: p.image,
        uncertain: (r.candidates || []).length > 1 && !confident && !r.pinned,
        qty: r.line ? r.line.qty : 1,
        pinned: !!r.pinned,
        alternatives: (() => {
          const all = [...(r.candidates || []), ...(r.variants || [])];
          const seen = new Set();
          const list = all.filter(c => {
            const k = c.shop + '/' + c.handle;
            return seen.has(k) ? false : (seen.add(k), true);
          });
          return list.length > 1
            ? list.map(c => ({ handle: c.handle, title: c.title, artist: c.artist,
                               price: c.price, cover: c.image, drills: c.drills,
                               colors: c.colors, shop: c.shop, currency: c.currency,
                               chosen: c.handle === p.handle }))
            : null;
        })(),
        listPrice: p.price, price, priceSource: source,
        available: !!p.available,
        shape: p.shape, coverage: p.coverage, colors: p.colors,
        drills: p.drills ?? estimateDrills(p.width_in, p.height_in, p.shape),
        drillsEstimated: p.drills == null && estimateDrills(p.width_in, p.height_in, p.shape) != null ? 1 : 0,
        special: p.special, width_in: p.width_in, height_in: p.height_in,
        width_cm: cmFromIn(p.width_in), height_cm: cmFromIn(p.height_in),
        status: statusFor(order.fulfillmentStatus),
        duplicate: dupeId != null, duplicateId: dupeId ?? null
      });
    }
  }

  const newKits = kits.filter(k => !k.duplicate);
  return {
    warnings,
    summary: {
      orders: orders.length, lines: lineCount, kits: kits.length,
      newKits: newKits.length, duplicates: kits.length - newKits.length,
      skipped: skipped.length,
      received: newKits.filter(k => k.status === 'received').length,
      notReceived: newKits.filter(k => k.status === 'notReceived').length,
      multiItemOrders: orders.filter(o => o.fragments.length > 1).length,
      flagged: orders.filter(o => o.paymentStatus && o.paymentStatus !== 'paid')
                     .map(o => ({ ref: o.ref, status: o.paymentStatus, total: o.total })),
      pricing: {
        exact: newKits.filter(k => k.priceSource === 'order').length,
        allocated: newKits.filter(k => k.priceSource === 'allocated').length,
        list: newKits.filter(k => k.priceSource === 'catalogue').length,
        none: newKits.filter(k => !k.priceSource).length
      },
      uncertain: newKits.filter(k => k.uncertain).length
    },
    kits, skipped
  };
}

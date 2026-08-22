/**
 * Turning an order-history CSV into projects. Pure: the catalogue and the
 * existing logbook arrive through `cat` and `existing`.
 */
import { parseOrders } from './csv.js';
import { resolveFragments, disambiguate, norm, cmFromIn, round2 } from './match.js';
import { estimateDrills } from './estimate.js';
import { displayCurrency } from './shops.js';

const statusFor = (fulfillment) =>
  /fulfilled|shipped|delivered|complete/i.test(fulfillment || '') ? 'received' : 'notReceived';

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
export function buildPreview(cat, existing, csvText, shopName = 'Diamond Art Club', known = new Map(), prefCurrency = 'GBP') {
  const { orders, warnings } = parseOrders(csvText);
  const kits = [], skipped = [];
  let lineCount = 0;

  for (const order of orders) {
    const resolved = resolveFragments(cat, order.fragments);
    lineCount += resolved.length;
    const flag = order.paymentStatus && order.paymentStatus !== 'paid' ? order.paymentStatus : null;

    const { chosen, confident } = disambiguate(resolved, order.total);
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

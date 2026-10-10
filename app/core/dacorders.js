/* DAC's read-only order export endpoint, inspected in dac-orders-export.js
 * (theme 1265, October 2026). This reads the records before spreadsheet creation
 * or file sharing, so neither download nor navigator.share is needed.
 */
import { splitItem } from './dacworkbook.js';

/* Self-contained: injected into an isolated, unprivileged DAC WebView. Only
   order fields needed by the importer return to the app, never credentials,
   customer IDs, addresses, payment transactions or page HTML. */
export async function scanOrders(env) {
  const { location, fetch, out, signal } = env;
  out.done = false;
  try {
    if (location.protocol !== 'https:' || !['diamondartclub.com', 'www.diamondartclub.com'].includes(location.hostname))
      throw new Error('Open Diamond Art Club to scan orders.');
    const url = new URL('/pages/orders?view=logbook-export-orders', location.origin);
    const orders = [], seen = new Set();
    let customer = null, total = null, pages = null, resultSize = 0;
    const id = v => (typeof v === 'number' && !Number.isSafeInteger(v) ? '' : String(v ?? '')).replace(/^gid:\/\/shopify\/(?:Customer|Order)\//, '');
    const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
    for (let page = 1; page <= 500; page++) {
      if (signal.aborted) throw new Error('Order scan cancelled.');
      url.searchParams.set('page', String(page));
      out.progress = 'Reading order history… page ' + page;
      const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) throw new Error('DAC could not load your orders (' + response.status + '). Please try again.');
      const data = await response.json();
      if (signal.aborted) throw new Error('Order scan cancelled.');
      if (data.version !== 1) throw new Error('DAC’s order format has changed. The scan could not be completed.');
      if (page === 1 && data.authenticated === false) { out.waiting = true; return; }
      if (data.authenticated !== true || !/^[1-9]\d{0,19}$/.test(id(data.customer_id))
          || (customer !== null && customer !== id(data.customer_id)))
        throw new Error('Your DAC account changed or signed out. Please scan again.');
      customer = id(data.customer_id);
      if (!Number.isSafeInteger(data.total) || data.total < 0 || data.total > 25000
          || data.page !== page || data.pages !== Math.max(1, Math.ceil(data.total / 50))
          || data.orders_count !== data.total || !Array.isArray(data.orders)
          || data.orders.length !== Math.min(50, Math.max(0, data.total - (page - 1) * 50))
          || (total !== null && (total !== data.total || pages !== data.pages)))
        throw new Error('DAC did not return a complete order history. Please scan again.');
      total = data.total; pages = data.pages;
      for (const order of data.orders) {
        const key = id(order?.id);
        if (!/^[1-9]\d{0,19}$/.test(key) || seen.has(key) || !Array.isArray(order.lines) || order.lines.length > 50)
          throw new Error('DAC returned incomplete or repeated orders. Please scan again.');
        seen.add(key);
        const row = pick(order, ['name', 'created_at', 'cancelled', 'financial_status', 'fulfillment_status',
          'formatted_total', 'total_price', 'total_refunded_amount', 'shipping_price', 'tax_price', 'total_duties', 'line_count']);
        row.lines = order.lines.map(line => {
          if (!line || !Array.isArray(line.discount_allocations) || line.discount_allocations.length > 50)
            throw new Error('DAC returned incomplete item discounts. Please scan again.');
          return { ...pick(line, ['title', 'quantity', 'original_line_price', 'discount_count']),
            discount_allocations: line.discount_allocations.map(d => ({ amount: d?.amount })) };
        });
        resultSize += JSON.stringify(row).length;
        if (resultSize > 8 * 1024 * 1024) throw new Error('This order history is too large to scan.');
        orders.push(row);
      }
      out.progress = 'Read ' + orders.length + ' of ' + total + ' orders';
      if (page === pages) {
        out.orders = orders; out.version = 1; out.done = true;
        return;
      }
      await env.sleep(200);
    }
    throw new Error('This order history exceeds DAC’s export limit.');
  } catch (e) {
    out.error = signal.aborted ? 'The order scan took too long. Please try again.'
      : String(e?.message || 'Could not read DAC orders. Please try again.').slice(0, 300);
    out.done = true;
  }
}

export function buildOrdersScript() {
  return '(function(){if(window.__dazzleOrders)return;'
    + 'var controller=new AbortController();'
    + 'var timer=setTimeout(function(){controller.abort();},240000);'
    + '(' + scanOrders.toString() + ')({location:location,fetch:fetch.bind(window),signal:controller.signal,'
    + 'sleep:function(ms){return new Promise(function(r){setTimeout(r,ms);});},'
    + 'out:(window.__dazzleOrders={})}).finally(function(){clearTimeout(timer);});})();';
}

/** Validate the untrusted result again inside the local store and normalise it
 * for the existing importer. Amounts in DAC's JSON are integer minor units.
 * A truncated order fails the whole scan rather than silently omitting kits.
 */
export function parseDacOrders(raw) {
  const fail = () => { throw new Error('DAC returned incomplete order details. Please scan again.'); };
  if (!raw || raw.done !== true || raw.version !== 1 || raw.error || !Array.isArray(raw.orders)
      || raw.orders.length > 25000) fail();
  const text = (v, max = 1000) => typeof v === 'string' && v.length <= max ? v.trim() : fail();
  const cents = v => Number.isSafeInteger(v) && v >= 0 ? v : fail();
  const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 50 ? v : fail();
  const orders = [], warnings = [], refs = new Set();
  for (const o of raw.orders) {
    if (!o || typeof o.cancelled !== 'boolean' || !Array.isArray(o.lines) || count(o.line_count) !== o.lines.length) fail();
    if (o.cancelled) continue;
    const ref = text(o.name, 100);
    if (!ref || refs.has(ref)) fail();
    refs.add(ref);
    const date = text(o.created_at, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) fail();
    const currencies = [...new Set(text(o.formatted_total, 200).match(/\b[A-Z]{3}\b/g) || [])];
    // A missing currency must never turn a dollar amount into a pound amount.
    if (currencies.length !== 1) {
      warnings.push(`Order ${ref} was skipped because DAC did not identify its currency.`);
      continue;
    }
    const currency = currencies[0];
    const total = cents(o.total_price), refunds = cents(o.total_refunded_amount);
    const extras = cents(o.shipping_price) + cents(o.tax_price) + (o.total_duties == null ? 0 : cents(o.total_duties));
    if (!Number.isSafeInteger(extras)) fail();
    const lines = o.lines.map(l => {
      if (!l || !Array.isArray(l.discount_allocations) || count(l.discount_count) !== l.discount_allocations.length
          || !Number.isSafeInteger(l.quantity) || l.quantity <= 0 || l.quantity > 10000) fail();
      const original = cents(l.original_line_price);
      const discount = l.discount_allocations.reduce((n, d) => n + cents(d?.amount), 0);
      if (!Number.isSafeInteger(discount) || discount > original) fail();
      const name = text(l.title);
      if (!name) fail();
      return { ...splitItem(name), qty: l.quantity, raw: name, paidCents: original - discount };
    });
    const itemTotal = lines.reduce((n, l) => n + l.paidCents, 0);
    if (!Number.isSafeInteger(itemTotal)) fail();
    // Same allocation as the spreadsheet importer: item discounts first, then
    // shipping/tax/duties proportionally across all items (including supplies).
    for (const l of lines) {
      l.paid = Math.round((l.paidCents + (itemTotal ? extras * l.paidCents / itemTotal : 0)) / l.qty) / 100;
      delete l.paidCents;
    }
    orders.push({ ref, date: date.slice(0, 10), paymentStatus: text(o.financial_status, 80).toLowerCase(),
      fulfillmentStatus: text(o.fulfillment_status ?? '', 80).toLowerCase(), currency,
      total: total / 100, refunds: refunds / 100, fragments: lines.map(l => l.title), lines });
  }
  if (!orders.length && !warnings.length) warnings.push('No active orders were found in this DAC account.');
  return { orders, warnings };
}

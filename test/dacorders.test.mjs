import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { scanOrders, buildOrdersScript, parseDacOrders } from '../app/core/dacorders.js';
import { dacOrder, orderLine, orderPage, scanResult } from './dacordersfixture.mjs';

async function scan(pages, extra = {}) {
  const out = {}, calls = [];
  await scanOrders({ location: new URL('https://www.diamondartclub.com/pages/account'), out,
    signal: new AbortController().signal, sleep: async () => {},
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => pages[calls.length - 1] };
    }, ...extra });
  return { out, calls };
}

test('reads every page through DAC’s read-only endpoint and returns no account or payment data', async () => {
  const first = Array.from({ length: 50 }, (_, i) => dacOrder({ id: String(i + 1), name: '#' + (i + 1),
    email: 'private@example.test', shipping_address: { street: 'private' }, transactions: [{ secret: 'private' }] }));
  const { out, calls } = await scan([
    orderPage(first, { total: 51, orders_count: 51, pages: 2 }),
    orderPage([dacOrder({ id: '51', name: '#51' })], { total: 51, orders_count: 51, pages: 2, page: 2 })
  ]);
  assert.equal(out.done, true);
  assert.equal(out.error, undefined);
  assert.equal(out.orders.length, 51);
  assert.equal(parseDacOrders(out).orders.length, 51);
  for (const [i, call] of calls.entries()) {
    assert.equal(call.url, 'https://www.diamondartclub.com/pages/orders?view=logbook-export-orders&page=' + (i + 1));
    assert.equal(call.opts.credentials, 'same-origin');
    assert.equal(call.opts.method, undefined, 'the scan must only GET');
  }
  assert.doesNotMatch(JSON.stringify(out), /private|customer_id|transactions|email|shipping_address/);
});

test('signed-out accounts wait for sign-in and never return an empty successful scan', async () => {
  const { out } = await scan([orderPage([], { authenticated: false, customer_id: null })]);
  assert.equal(out.waiting, true);
  assert.equal(out.done, false);
  assert.equal(out.orders, undefined);
});

test('rejects incomplete pages, repeated orders, account switches and changes during pagination', async () => {
  const first = Array.from({ length: 50 }, (_, i) => dacOrder({ id: String(i + 1), name: '#' + (i + 1) }));
  const page1 = orderPage(first, { total: 51, orders_count: 51, pages: 2 });
  for (const extra of [{ customer_id: '78' }, { authenticated: false }, { total: 52, orders_count: 52 },
    { page: 1 }, { orders: [] }, { orders: [dacOrder({ id: '1' })] }]) {
    const { out } = await scan([page1,
      orderPage([dacOrder({ id: '51' })], { total: 51, orders_count: 51, pages: 2, page: 2, ...extra })]);
    assert.equal(out.done, true);
    assert.ok(out.error);
    assert.equal(out.orders, undefined, 'partial results must not reach the importer');
  }
});

test('rejects off-site execution, network errors and aborted scans', async () => {
  for (const extra of [{ location: new URL('https://evil.test/') },
    { location: new URL('http://www.diamondartclub.com/') },
    { fetch: async () => ({ ok: false, status: 503 }) },
    { fetch: async () => { throw new Error('Network unavailable'); } },
    { signal: AbortSignal.abort() }]) {
    const { out } = await scan([orderPage([dacOrder()])], extra);
    assert.equal(out.done, true);
    assert.ok(out.error);
    assert.equal(out.orders, undefined);
  }
});

test('generated script works without a sharing API and runs only once on a page', async () => {
  let calls = 0;
  const context = vm.createContext({ window: {}, location: new URL('https://www.diamondartclub.com/pages/account'),
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async () => { calls++; return { ok: true, json: async () => orderPage([dacOrder()]) }; } });
  vm.runInContext(buildOrdersScript(), context);
  for (let i = 0; i < 20 && !context.window.__dazzleOrders?.done; i++) await new Promise(r => setImmediate(r));
  assert.equal(context.window.__dazzleOrders.done, true);
  assert.equal(context.window.__dazzleOrders.orders.length, 1);
  vm.runInContext(buildOrdersScript(), context);
  assert.equal(calls, 1);
});

test('normalises discounts, quantities, shipping and dates without treating shipped as delivered', () => {
  const { orders, warnings } = parseDacOrders(scanResult([dacOrder({ total_price: 9900, shipping_price: 900,
    line_count: 2, lines: [orderLine('Moon Eater - 22" x 28" / Square with 40 Colors / 60,000',
      { quantity: 2, original_line_price: 10000, discount_allocations: [{ amount: 2000 }] }),
    orderLine('Wax', { original_line_price: 1000, discount_count: 0, discount_allocations: [] })] })]));
  assert.deepEqual(warnings, []);
  assert.equal(orders[0].date, '2026-09-24');
  assert.equal(orders[0].currency, 'GBP');
  assert.equal(orders[0].fulfillmentStatus, 'fulfilled');
  assert.equal(orders[0].lines[0].title, 'Moon Eater');
  assert.equal(orders[0].lines[0].drills, 60000);
  assert.equal(orders[0].lines[0].qty, 2);
  assert.equal(orders[0].lines[0].paid, 44);
  assert.equal(orders[0].lines[1].paid, 11);
});

test('cancellation, refunds and unknown currency are handled conservatively', () => {
  assert.equal(parseDacOrders(scanResult([dacOrder({ cancelled: true })])).orders.length, 0);
  const unknown = parseDacOrders(scanResult([dacOrder({ formatted_total: '$44.00' })]));
  assert.equal(unknown.orders.length, 0);
  assert.match(unknown.warnings[0], /currency/);
  const refunded = parseDacOrders(scanResult([dacOrder({ financial_status: 'partially_refunded', total_refunded_amount: 1200 })]));
  assert.equal(refunded.orders[0].paymentStatus, 'partially_refunded');
  assert.equal(refunded.orders[0].refunds, 12);
});

test('malformed and truncated order details cannot be silently imported', () => {
  for (const extra of [{ line_count: 51 }, { total_price: '4400' }, { total_price: -1 },
    { created_at: 'yesterday' }, { lines: [orderLine('Moon', { quantity: 0 })] },
    { lines: [orderLine('Moon', { discount_count: 2 })] },
    { lines: [orderLine('Moon', { discount_allocations: [{ amount: 6000 }] })] },
    { lines: [orderLine('Moon', { original_line_price: null })] }])
    assert.throws(() => parseDacOrders(scanResult([dacOrder(extra)])), /incomplete/);
  assert.throws(() => parseDacOrders({ done: false, version: 1, orders: [] }), /incomplete/);
  assert.throws(() => parseDacOrders(scanResult([dacOrder(), dacOrder()])), /incomplete/);
});

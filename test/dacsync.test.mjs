/**
 * The scripts that run on Diamond Art Club's pages, run here against stand-ins
 * instead. They are the same function text that gets injected, so this is the
 * only way to prove what they will do to a real account before they do it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tickAll, buildTickScript, runLegends, buildLegendScript,
         readSyncResult, cleanColour, readDrillOptions } from '../app/core/dacsync.js';

/* ------------------------------------------------------------ ticking */

/** DAC's ALPManager in miniature: updatePurchased toggles, and answers with the
 *  resulting state, the way the real one does. */
function alp({ ticked = [], signsIn = true, format = 'array', fails = [], orders = [] } = {}) {
  const state = new Map(ticked.map((s) => [s, 'MA']));
  const calls = [];
  const M = {
    auth_token: signsIn ? 'tok' : null,
    async updatePurchased(sku) {
      calls.push(sku);
      if (fails.includes(sku)) throw new Error('Failed to update purchased product state.');
      state.set(sku, state.get(sku) === 'MA' ? 'MR' : 'MA');
      // kits bought by order are listed as the bare SKU, whatever else is marked
      const list = [...orders, ...[...state].map(([s, v]) => v + ':' + s)];
      return format === 'string' ? list.join(',') : list;
    } };
  return { window: { ALPManager: M }, calls, state };
}
const kit = (n) => ({ variant: String(100 + n), sku: 'DAC-' + n + 'S', name: 'Kit ' + n });
const tickRun = async (dac, kits, opts = {}) => {
  const out = {};
  await tickAll({ window: dac.window, sleep: async () => {}, kits, out, ...opts });
  return out;
};

test('an unticked kit is ticked with one call, no page opened', async () => {
  const dac = alp();
  const out = await tickRun(dac, [kit(1)]);
  assert.equal(out.results[0].state, 'marked');
  assert.deepEqual(dac.calls, ['DAC-1S']);
  assert.equal(dac.state.get('DAC-1S'), 'MA');
});

/* It is a toggle: a call on a ticked kit un-ticks it. The reply says so, and a
   second call puts it right — it is never left un-ticked. */
test('a kit that turns out to be ticked already is ticked again, never left off', async () => {
  const dac = alp({ ticked: ['DAC-1S'] });
  const out = await tickRun(dac, [kit(1)]);
  assert.equal(out.results[0].state, 'marked');
  assert.equal(dac.calls.length, 2, 'it left the kit un-ticked after the toggle');
  assert.equal(dac.state.get('DAC-1S'), 'MA');
});

/* A kit bought by order is listed as its bare SKU; un-ticked by hand it is ALSO
   "MR:" — and DAC's own page then hides it. Bare SKU present is not enough. */
test('a kit bought by order but un-ticked ("MR:") is not taken as ticked', async () => {
  const dac = alp({ orders: ['DAC-1S'], ticked: ['DAC-1S'] });
  const out = await tickRun(dac, [kit(1)]);
  assert.equal(dac.calls.length, 2, 'a reply saying MR: was read as ticked, leaving the kit hidden');
  assert.equal(dac.state.get('DAC-1S'), 'MA');
  assert.equal(out.results[0].state, 'marked');
});

test('a kit that already has its colour list is never touched', async () => {
  const dac = alp();
  const out = await tickRun(dac, [kit(1), kit(2)], { have: ['101'] });
  assert.deepEqual(dac.calls, ['DAC-2S'], 'it called DAC for a kit that already had colours');
  assert.equal(out.results[0].state, 'skipped');
  assert.equal(out.results[1].state, 'marked');
});

test('a reply given as text rather than a list is read the same way', async () => {
  const dac = alp({ format: 'string' });
  assert.equal((await tickRun(dac, [kit(1)])).results[0].state, 'marked');
});

test('the trial ticks only as many as it is allowed, and leaves the rest', async () => {
  const dac = alp();
  const out = await tickRun(dac, [kit(1), kit(2), kit(3), kit(4)], { limit: 2, have: ['101'] });
  assert.deepEqual(out.results.map((r) => r.state), ['skipped', 'marked', 'marked', 'deferred']);
  assert.equal(dac.calls.length, 2);
});

test('a DAC error on one kit is reported, and the rest carry on', async () => {
  const dac = alp({ fails: ['DAC-1S'] });
  const out = await tickRun(dac, [kit(1), kit(2)]);
  assert.equal(out.results[0].state, 'failed');
  assert.match(out.results[0].error, /Failed to update/);
  assert.equal(out.results[1].state, 'marked');
});

test('with no service on the page and no details to sign in with, nothing is called', async () => {
  const dac = alp({ signsIn: false });
  const out = await tickRun(dac, [kit(1)]);
  assert.match(out.error, /No signed-in DAC page offered/);
  assert.deepEqual(dac.calls, []);
  assert.equal(out.done, true);
});

/* ------------------------------------------------------ calling the API directly */

/** DAC's ticking service over HTTP, toggling the way the real one does. */
function alpApi({ ticked = [], acceptDigest = 'sig' } = {}) {
  const state = new Map(ticked.map((s) => [s, 'MA']));
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => '' });
    if (url.startsWith('/products/')) return { ok: true, status: 200, text: async () => PROBE_HTML };
    const u = new URL(url);
    if (u.pathname === '/api/customer/identify') {
      return JSON.parse(opts.body).digest === acceptDigest ? json(200, { auth_token: 'alp-tok' }) : json(401, {});
    }
    if (u.pathname === '/api/update_purchased') {
      if (opts.headers.Authorization !== 'Bearer alp-tok') return json(401, {});
      const sku = JSON.parse(opts.body).sku;
      state.set(sku, state.get(sku) === 'MA' ? 'MR' : 'MA');
      return json(200, { new_value: [...state].map(([s, v]) => v + ':' + s) });
    }
    return json(404, {});
  };
  return { fetch, calls, state };
}
const PROBE_HTML = '<html><div id="already-purchased-init" data-customer-id="42" data-customer-email="a@b.c" '
  + 'data-customer-real-email="a@b.c" data-customer-first-name="J" data-digest="sig"></div>'
  + '<script>ALPManager.initialize({ shop: "diamond-art-club.myshopify.com" })</script></html>';
const initDoc = (attrs) => ({ getElementById: (id) => id === 'already-purchased-init'
  ? { getAttribute: (k) => attrs[k] ?? null } : null });

test('with no service on the page, it signs in to the API itself and ticks', async () => {
  const api = alpApi();
  const out = {};
  await tickAll({ window: {}, document: initDoc({ 'data-customer-id': '42', 'data-customer-email': 'a@b.c',
    'data-customer-first-name': 'J', 'data-digest': 'sig' }), fetch: api.fetch,
    location: { host: 'www.diamondartclub.com' }, sleep: async () => {}, kits: [kit(1)], out });
  assert.equal(out.error, null);
  assert.equal(out.via, 'api');
  assert.equal(out.results[0].state, 'marked');
  const who = api.calls.find((c) => c.url.includes('/identify'));
  assert.deepEqual(JSON.parse(who.body), { customer: { id: '42', email: 'a@b.c', real_email: '', first_name: 'J' }, digest: 'sig' });
  assert.match(who.url, /shop=www\.diamondartclub\.com/);
});

test('if the page lacks the sign-in details, a kit page is fetched for them, not opened', async () => {
  const api = alpApi();
  const out = {};
  await tickAll({ window: {}, document: initDoc({}), fetch: api.fetch, probe: '/products/kit-1',
    location: { host: 'www.diamondartclub.com' }, sleep: async () => {}, kits: [kit(1)], out });
  assert.equal(out.results[0].state, 'marked');
  assert.equal(api.calls[0].url, '/products/kit-1', 'it did not fetch a page for the details');
  assert.match(api.calls.find((c) => c.url.includes('/identify')).url, /shop=diamond-art-club\.myshopify\.com/,
    'the shop named on the page was not used');
});

test('directly, too, a toggled-off kit is ticked again', async () => {
  const api = alpApi({ ticked: ['DAC-1S'] });
  const out = {};
  await tickAll({ window: {}, document: initDoc({ 'data-digest': 'sig' }), fetch: api.fetch,
    location: { host: 'x' }, sleep: async () => {}, kits: [kit(1)], out });
  assert.equal(out.results[0].state, 'marked');
  assert.equal(api.state.get('DAC-1S'), 'MA');
});

test('a refused sign-in to the API stops it before any kit is ticked', async () => {
  const api = alpApi({ acceptDigest: 'other' });
  const out = {};
  await tickAll({ window: {}, document: initDoc({ 'data-digest': 'sig' }), fetch: api.fetch,
    location: { host: 'x' }, sleep: async () => {}, kits: [kit(1)], out });
  assert.match(out.error, /did not accept the sign-in/);
  assert.equal(api.calls.filter((c) => c.url.includes('update_purchased')).length, 0);
});

test('the tick script is the tested function, parses, and carries the kits', () => {
  const src = buildTickScript([kit(1)], { limit: 3, probe: '/products/x' });
  assert.ok(src.includes(tickAll.toString()));
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /^window\.__tk \|\|/, 'a page could run it twice');
  assert.match(src, /limit: 3/);
  assert.match(src, /"sku":"DAC-1S"/);
  assert.match(buildTickScript([kit(1)]), /limit: null/);
  assert.match(src, /probe: "\/products\/x"/);
});

/* ------------------------------------------------------------ legends */

const API = 'https://logbook-app-theta.vercel.app/api';

function fakeDac({ signedIn = true, owned = {}, legends = {}, pending = [], refuse = false,
                   shape = 'square', options = null } = {}) {
  const attrs = signedIn
    ? { 'data-logged-in': 'true', 'data-customer-id': '42', 'data-customer-email': 'x@example.com',
        'data-customer-first-name': 'J', 'data-auth-digest': 'sig', 'data-customer-country': 'GB' }
    : { 'data-logged-in': 'false' };
  const el = { getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  const document = { getElementById: (id) => (id === 'logbook-customer-data' ? el : null) };
  const calls = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    if (url === API + '/identify') return refuse ? json(401, {}) : json(200, { data: { token: 'tok' } });
    if (opts.headers?.Authorization !== 'Bearer tok') return json(401, {});
    const u = new URL(url);
    if (u.pathname === '/api/drills' && u.searchParams.get('mode') === 'options')
      return options ? json(200, options) : json(404, {});
    if (u.pathname === '/api/drills') {
      const v = u.searchParams.get('variant');
      if (!owned[v]) return json(200, { project: null });
      return json(200, { project: owned[v],
        colors: pending.includes(v) ? { status: 'checking' }
                                    : { status: 'available', shape, codes: legends[v] || [] } });
    }
    return json(404, {});
  };
  return { document, fetch, calls };
}
const legendsFor = async (dac, variants) => {
  const out = {};
  await runLegends({ document: dac.document, fetch: dac.fetch, sleep: async () => {}, variants, out });
  return out;
};

test('legends are read for owned kits, and nothing on the account is changed', async () => {
  const dac = fakeDac({ owned: { 111: { id: 'p1' } }, legends: { 111: [{ code: '310', name: 'Black', hex: '000000' }] } });
  const out = await legendsFor(dac, ['111', '222']);
  assert.equal(out.error, null);
  assert.equal(out.done, true);
  assert.deepEqual(out.results[0].colors.codes, [{ code: '310', name: 'Black', hex: '000000' }]);
  assert.equal(out.results[1].owned, false);
  assert.deepEqual([...new Set(dac.calls.map((c) => c.method))], ['POST', 'GET']);
  assert.equal(dac.calls.filter((c) => c.method === 'POST').length, 1, 'it wrote to the account');
  assert.equal(dac.calls[0].url, API + '/identify', 'the only POST is signing in');
});

test('it signs in the way DAC\'s own page does, and sends the country header', async () => {
  const dac = fakeDac({ owned: { 111: {} } });
  await legendsFor(dac, ['111']);
  assert.deepEqual(JSON.parse(dac.calls[0].body),
    { customer: { id: '42', email: 'x@example.com', first_name: 'J' }, digest: 'sig' });
  assert.equal(dac.calls[1].headers['x-customer-country'], 'GB');
});

test('not being signed in stops it before anything is sent', async () => {
  const dac = fakeDac({ signedIn: false });
  const out = await legendsFor(dac, ['111']);
  assert.match(out.error, /not signed in/);
  assert.equal(dac.calls.length, 0);
});

test('a refused sign-in stops it before any kit is read', async () => {
  const dac = fakeDac({ refuse: true });
  const out = await legendsFor(dac, ['111']);
  assert.match(out.error, /did not accept the sign-in/);
  assert.equal(dac.calls.length, 1);
});

/* ------------------------------------------------------------ scripts */

test('the legend script is the tested function, and parses', () => {
  const lg = buildLegendScript(['111', '222']);
  assert.ok(lg.includes(runLegends.toString()));
  assert.doesNotThrow(() => new Function(lg));
  assert.ok(lg.includes('window.__dd'));
});

/* ------------------------------------------------------------ results */

test('a result reports what was ticked, what already had colours, and what failed', () => {
  const r = readSyncResult({
    tk: { results: [{ variant: '111', state: 'marked' }, { variant: '222', state: 'skipped' },
                    { variant: '333', state: 'failed', name: 'Gone Kit' }, { variant: '444', state: 'deferred' }] },
    dd: { results: [
      { variant: '111', owned: true, colors: { status: 'available', codes: [{ code: '310', hex: '000000' }] } },
      { variant: '222', owned: true, colors: { status: 'checking' } } ] } });
  assert.equal(r.marked, 1);
  assert.equal(r.already, 1);
  assert.equal(r.deferred, 1);
  assert.deepEqual(r.missing, [{ variant: '333', state: 'failed', name: 'Gone Kit' }]);
  assert.equal(r.pending, 1);
  assert.deepEqual(Object.keys(r.legends), ['111']);
});

test('only sane colours survive the trip back', () => {
  assert.deepEqual(cleanColour({ code: '310', name: 'Black', hex: '000000' }),
                   { code: '310', name: 'Black', hex: '#000000' });
  assert.deepEqual(cleanColour('B5200'), { code: 'B5200', name: null, hex: null });
  assert.equal(cleanColour({ code: '<img onerror=x>' }), null);
  assert.equal(cleanColour({ code: '' }), null);
  assert.equal(cleanColour({ code: '310', hex: 'javascript:1' }).hex, null);
  assert.deepEqual(readSyncResult({ dd: { results: [{ variant: '../x', owned: true,
    colors: { status: 'available', codes: ['310'] } }] } }).legends, {});
});

/* A legend is bare codes. DAC's own drill list is what turns 3865 into a
   colour on screen, and it is only worth fetching once per shape. */
test('the drill list is fetched once for each shape, and only after the legends', async () => {
  const dac = fakeDac({ owned: { 111: {}, 222: {} }, legends: { 111: ['310'], 222: ['3865'] },
    options: { data: [{ code: '310', name: 'Black', hex: '000000' },
                      { code: '3865', name: 'Winter White', hex: 'fbfbf9' }] } });
  const out = await legendsFor(dac, ['111', '222']);
  const asked = dac.calls.filter((c) => /mode=options/.test(c.url));
  assert.equal(asked.length, 1, 'the drill list was not fetched once per shape');
  assert.match(asked[0].url, /shape=square/);
  assert.ok(dac.calls.indexOf(asked[0]) > dac.calls.findIndex((c) => /variant=222/.test(c.url)),
            'the drill list was fetched before the legends it describes');
  assert.equal(out.options.square.data.length, 2);
  assert.equal(out.error, null, 'fetching the drill list broke the sync');
});

test('a sync still stands when DAC will not give up its drill list', async () => {
  const dac = fakeDac({ owned: { 111: {} }, legends: { 111: ['310'] } });   // no options
  const out = await legendsFor(dac, ['111']);
  assert.equal(out.error, null, 'a missing drill list failed the whole sync');
  assert.deepEqual(out.results[0].colors.codes, ['310'], 'the legend was lost with it');
  assert.deepEqual(out.options, {}, 'a refusal was stored as a drill list');
});

test('DAC\'s drill list is read whatever shape it arrives in, and rubbish is ignored', async () => {
  assert.deepEqual(readDrillOptions({ square: { data: [{ code: '310', name: 'Black', hex: '#000000' }] } }),
                   { 310: { code: '310', name: 'Black', hex: '#000000' } });
  assert.deepEqual(readDrillOptions({ square: { drills: [{ value: '3865', label: 'Winter White', color: 'fbfbf9' }] } }),
                   { 3865: { code: '3865', name: 'Winter White', hex: '#fbfbf9' } });
  assert.deepEqual(readDrillOptions({ round: ['310'] }), { 310: { code: '310', name: null, hex: null } });
  assert.deepEqual(readDrillOptions({ square: { data: [{ code: '<script>', hex: 'nope' }] } }), {},
                   'a code that is not a code was taken');
  assert.deepEqual(readDrillOptions(null), {});
});

test('a sync carries the drill list and each kit\'s shape back to the app', async () => {
  const r = readSyncResult({ dd: { results: [{ variant: '111', owned: true,
      colors: { status: 'available', shape: 'round', codes: ['310'] } }],
    options: { round: { data: [{ code: '310', name: 'Black', hex: '000000' }] } } } });
  assert.deepEqual(r.shapes, { 111: 'round' });
  assert.deepEqual(r.drills['310'], { code: '310', name: 'Black', hex: '#000000' });
});

/**
 * The scripts that run on Diamond Art Club's pages, run here against stand-ins
 * instead. They are the same function text that gets injected, so this is the
 * only way to prove what they will do to a real account before they do it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { markPurchased, buildMarkScript, buildMarkPrep, runLegends, buildLegendScript,
         readSyncResult, cleanColour } from '../app/core/dacsync.js';

/* ------------------------------------------------------------ marking */

/** A signed-in DAC product page, with DAC's owned list behind it. */
function dacPage({ sku = 'DAC-1S', owned = [], takes = true, offerShown = true, cards = ['DAC-9S'], listOk = true, escaped = false } = {}) {
  const server = { list: [...owned] };
  const clicks = [];
  const node = (attrs, cls, text, onClick) => ({
    attrs, className: cls, textContent: text, shown: true,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    click() { clicks.push(this.className); onClick && onClick(); } });
  const offer = node({ 'data-already-purchased-indicator': '', 'data-update-state': '', 'data-product-variant-sku': sku },
                     'to-hide offer', 'Already purchased this?', () => { if (takes) server.list.push('MA:' + sku); });
  offer.shown = offerShown;
  const unmark = node({ 'data-update-state': '', 'data-product-variant-sku': sku }, 'unmark', '',
                      () => server.list.push('MR:' + sku));
  const pill = node({ 'data-already-purchased-indicator': '', 'data-product-variant-sku': sku }, 'hidden pill',
                    'You already purchased this product.');
  const cardNodes = cards.map((c) => node({ 'data-already-purchased-indicator': '', 'data-update-state': '',
                                             'data-product-variant-sku': c }, 'card ' + c, 'ALREADY PURCHASED'));
  const all = [offer, unmark, pill, ...cardNodes];
  const document = {
    querySelectorAll(sel) {
      if (sel === '[data-update-state]') return all.filter((n) => n.hasAttribute('data-update-state'));
      return all.filter((n) => n.hasAttribute('data-update-state') || n.hasAttribute('data-already-purchased-indicator'));
    } };
  const fetches = [];
  const fetch = async (url) => {
    fetches.push(url);
    if (!listOk) return { text: async () => '<html>nothing here</html>' };
    let json = JSON.stringify(server.list);
    if (escaped) json = json.replace(/"/g, '&quot;');
    return { text: async () => `<div><pre data-already-purchased-skus>${json}</pre></div>` };
  };
  return { document, fetch, clicks, server, fetches, offer, unmark, isShown: (e) => e.shown !== false };
}
const tick = async (page, opts = {}) => {
  const out = {};
  await markPurchased({ document: page.document, fetch: page.fetch, sleep: async () => {}, out,
    isShown: page.isShown, location: { origin: 'https://dac.test', pathname: '/products/kit' },
    sku: 'DAC-1S', window: null, ...opts });
  return out;
};

test('an unticked kit is ticked, and DAC\'s own list confirms it', async () => {
  const page = dacPage();
  const out = await tick(page);
  assert.equal(out.state, 'marked');
  assert.deepEqual(page.clicks, ['to-hide offer']);
  assert.ok(page.server.list.includes('MA:DAC-1S'));
});

/* It is a toggle: DAC's list is asked first, and a kit on it is never touched. */
test('a kit already on DAC\'s list is left completely alone', async () => {
  for (const owned of [['DAC-1S'], ['MA:DAC-1S']]) {
    const page = dacPage({ owned });
    assert.equal((await tick(page)).state, 'already', `owned as ${owned[0]} was not seen`);
    assert.deepEqual(page.clicks, [], `it pressed a kit already owned as ${owned[0]}`);
  }
});

test('a kit un-ticked on DAC ("MR:") counts as not owned, and is ticked', async () => {
  const page = dacPage({ owned: ['MA:DAC-1S', 'MR:DAC-1S'] });
  page.server.list = ['MR:DAC-1S'];
  const out = await tick(page);
  assert.deepEqual(page.clicks, ['to-hide offer']);
  // the list now has both; DAC's own page hides the pill while MR is there
  assert.equal(out.state, 'unconfirmed', 'a kit still marked MR was reported as ticked');
});

test('the ⓧ is never pressed, though it updates state for the same SKU', async () => {
  const page = dacPage({ offerShown: false });
  page.unmark.shown = true;
  const out = await tick(page);
  assert.equal(out.state, 'missing');
  assert.deepEqual(page.clicks, [], 'it pressed the ⓧ, which un-ticks the kit');
});

test('other kits\' widgets on the page are never pressed', async () => {
  const page = dacPage({ offerShown: false, cards: ['DAC-9S', 'DAC-1S-OTHER'] });
  const out = await tick(page);
  assert.equal(out.state, 'missing');
  assert.deepEqual(page.clicks, [], 'it pressed a recommended kit\'s widget');
});

test('a page told only to watch never presses', async () => {
  const page = dacPage();
  const out = await tick(page, { press: false });
  assert.deepEqual(page.clicks, []);
  assert.equal(out.state, 'unconfirmed');
});

test('an owned list that cannot be read stops it before anything is pressed', async () => {
  const page = dacPage({ listOk: false });
  const out = await tick(page);
  assert.equal(out.state, 'failed');
  assert.deepEqual(page.clicks, []);
});

test('no SKU stops it before anything is pressed', async () => {
  const page = dacPage();
  const out = await tick(page, { sku: '' });
  assert.equal(out.state, 'failed');
  assert.deepEqual(page.clicks, []);
  assert.equal(page.fetches.length, 0);
});

test('a press that does not take is pressed once, never again', async () => {
  const page = dacPage({ takes: false });
  const out = await tick(page);
  assert.equal(out.state, 'unconfirmed');
  assert.equal(page.clicks.length, 1, 'it kept pressing a toggle');
  assert.ok(out.found, 'no report of what was on the page');
});

test('the owned list is read even when DAC escapes it for HTML', async () => {
  const page = dacPage({ owned: ['DAC-1S'], escaped: true });
  assert.equal((await tick(page)).state, 'already');
});

test('the request a press makes is recorded in full, so it can be made directly', async () => {
  const page = dacPage();
  const win = { fetch: async () => ({ ok: true }), XMLHttpRequest: null };
  page.offer.click = function () {
    page.clicks.push(this.className);
    win.fetch('https://api.dac.test/projects/create?x=1',
              { method: 'POST', body: JSON.stringify({ sku: 'DAC-1S', from_app: 'already-purchased' }) });
    page.server.list.push('MA:DAC-1S');
  };
  const out = await tick(page, { window: win });
  assert.equal(out.state, 'marked');
  assert.deepEqual(out.request, [{ via: 'fetch', method: 'POST',
    url: 'https://api.dac.test/projects/create?x=1', sent: { sku: 'DAC-1S', from_app: 'already-purchased' } }]);
});

/* The script that sends the tick is only served to a signed-in page, and stays
   in the page after running — so the report takes it whole. */
test('a kit that could not be ticked reports the page\'s own tick script, whole', async () => {
  const page = dacPage({ offerShown: false });
  const code = 'document.querySelectorAll("[data-update-state]").forEach(el => el.onclick = () => fetch("/x", {body: JSON.stringify({from_app: "already-purchased"})}))';
  const qsa = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = (sel) => sel === 'script'
    ? [{ src: '', textContent: code }, { src: '', textContent: 'console.log(1)' }, { src: 'https://cdn.test/dac-owned.js', textContent: '' }]
    : qsa(sel);
  const out = await tick(page);
  assert.equal(out.state, 'missing');
  assert.equal(out.found.scripts.length, 2, 'it kept an unrelated script, or dropped the tick script');
  assert.equal(out.found.scripts[0].body, code, 'the tick script was not taken whole');
  assert.equal(out.found.scripts[1].src, 'https://cdn.test/dac-owned.js');
  assert.match(out.found.ownedRaw, /data-already-purchased-skus/, 'the raw owned list was not kept');
});

/* ------------------------------------------------------------ legends */

const API = 'https://logbook-app-theta.vercel.app/api';

function fakeDac({ signedIn = true, owned = {}, legends = {}, pending = [], refuse = false } = {}) {
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
    if (u.pathname === '/api/drills') {
      const v = u.searchParams.get('variant');
      if (!owned[v]) return json(200, { project: null });
      return json(200, { project: owned[v],
        colors: pending.includes(v) ? { status: 'checking' } : { status: 'available', codes: legends[v] || [] } });
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

test('the injected scripts are the tested functions, and parse', () => {
  const mk = buildMarkScript();
  assert.ok(mk.includes(markPurchased.toString()));
  assert.doesNotThrow(() => new Function(mk));
  assert.match(mk, /^window\.__ap \|\|/, 'a page could run it twice');
  assert.match(mk, /press: true/);
  assert.match(buildMarkScript({ press: false }), /press: false/);
  const prep = buildMarkPrep('DAC-1S"; alert(1); "');
  const box = {};
  new Function('window', prep)(box);
  assert.equal(box.__apSku, 'DAC-1S"; alert(1); "', 'a SKU could break out of the prep');
  const lg = buildLegendScript(['111', '222']);
  assert.ok(lg.includes(runLegends.toString()));
  assert.doesNotThrow(() => new Function(lg));
  assert.ok(lg.includes('window.__dd'));
});

/* ------------------------------------------------------------ results */

test('a result reports what was marked, what already was, and what was not found', () => {
  const r = readSyncResult({
    marks: [{ variant: '111', state: 'marked' }, { variant: '222', state: 'already' },
            { variant: '333', state: 'missing', name: 'Gone Kit' }, { variant: '444', state: 'sneaky' }],
    dd: { results: [
      { variant: '111', owned: true, colors: { status: 'available', codes: [{ code: '310', hex: '000000' }] } },
      { variant: '222', owned: true, colors: { status: 'checking' } } ] } });
  assert.equal(r.marked, 1);
  assert.equal(r.already, 1);
  assert.deepEqual(r.missing, [{ variant: '333', state: 'missing', name: 'Gone Kit' }]);
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

/* ---------------------------------------------- reading the right page */
import { readMarkFor, buildReadMark } from '../app/core/dacsync.js';

test('a result is only read off the kit\'s own page, not the one still showing from before', () => {
  const done = { state: 'marked' };
  assert.equal(readMarkFor({ location: { pathname: '/en-gb/products/lofi-cali-girl' }, ap: done, handle: 'aries' }), null,
    'the last kit\'s "ticked" was read as this kit\'s');
  assert.equal(readMarkFor({ location: { pathname: '/en-gb/products/aries' }, ap: done, handle: 'aries' }),
    JSON.stringify(done));
  assert.equal(readMarkFor({ location: { pathname: '/products/aries/' }, ap: done, handle: 'aries' }), JSON.stringify(done));
  assert.equal(readMarkFor({ location: { pathname: '/products/big-aries' }, ap: done, handle: 'aries' }), null,
    'a handle that merely ends the same way was accepted');
  assert.equal(readMarkFor({ location: { pathname: '/products/aries' }, ap: null, handle: 'aries' }), null);
});

test('the read expression is the tested function, and a handle cannot break out of it', () => {
  const expr = buildReadMark('aries');
  assert.ok(expr.includes(readMarkFor.toString()));
  assert.doesNotThrow(() => new Function('return ' + expr));
  assert.doesNotThrow(() => new Function('return ' + buildReadMark('x"}),alert(1),({"')));
  const run = new Function('location', 'window', 'return ' + buildReadMark('x"}),alert(1),({"'));
  assert.equal(run({ pathname: '/products/other' }, { __ap: { state: 'marked' } }), null);
});

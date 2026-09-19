/**
 * The script that runs on Diamond Art Club's page, run here against a stand-in
 * for DAC instead. It is the same function text that gets injected, so this is
 * the only way to prove what it will do to a real account before it does it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSync, buildSyncScript, readSyncResult, cleanColour } from '../app/core/dacsync.js';

const API = 'https://logbook-app-theta.vercel.app/api';

/** A DAC account in miniature: who is signed in, and which variants it holds. */
function fakeDac({ signedIn = true, owned = {}, legends = {}, pendingLegend = [], refuse = false } = {}) {
  const attrs = signedIn
    ? { 'data-logged-in': 'true', 'data-customer-id': '42', 'data-customer-email': 'x@example.com',
        'data-customer-first-name': 'J', 'data-auth-digest': 'sig', 'data-customer-country': 'GB' }
    : { 'data-logged-in': 'false' };
  const el = { getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  const document = { getElementById: (id) => (id === 'logbook-customer-data' ? el : null) };
  const calls = [];
  const account = new Map(Object.entries(owned));
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    if (url === API + '/identify') {
      if (refuse) return json(401, { error: 'no' });
      const b = JSON.parse(opts.body);
      return b.digest === 'sig' ? json(200, { data: { token: 'tok' } }) : json(401, {});
    }
    if (opts.headers?.Authorization !== 'Bearer tok') return json(401, {});
    const u = new URL(url);
    if (u.pathname === '/api/drills') {
      const v = u.searchParams.get('variant');
      if (!account.has(v)) return json(200, { project: null });
      const colors = pendingLegend.includes(v) ? { status: 'checking' }
        : { status: 'available', codes: legends[v] || [] };
      return json(200, { project: account.get(v), colors });
    }
    if (u.pathname === '/api/projects/create') {
      const f = Object.fromEntries(opts.body.entries());
      account.set(f['from_product.variant'], { id: 'p' + account.size, name: f.name });
      return json(200, { data: { id: 'p' + account.size } });
    }
    return json(404, {});
  };
  return { document, fetch, calls, account };
}

const kit = (variant, name = 'Kit ' + variant) =>
  ({ variant, product: 'prod' + variant, name, status: 'received_not_started', shape: 'square', drill: 'full', currency: 'GBP' });
const run = (dac, kits) => {
  const out = {};
  return runSync({ document: dac.document, fetch: dac.fetch, FormData, sleep: async () => {}, kits, out })
    .then(() => out);
};

test('a kit not on the account is added, then its legend is fetched', async () => {
  const dac = fakeDac({ legends: { 111: [{ code: '310', name: 'Black', hex: '000000' }] } });
  const out = await run(dac, [kit('111', 'Little Wanderer')]);
  assert.equal(out.error, null);
  assert.equal(out.done, true);
  assert.equal(out.results[0].outcome, 'created');
  assert.deepEqual(out.results[0].colors.codes, [{ code: '310', name: 'Black', hex: '000000' }]);
  const made = dac.calls.find((c) => c.url.endsWith('/projects/create'));
  const sent = Object.fromEntries(made.body.entries());
  assert.equal(sent['from_product.variant'], '111', 'the entry is not linked to its variant, so no legend');
  assert.equal(sent['from_product.id'], 'prod111');
  assert.equal(sent.status, 'received_not_started');
});

/* Running it twice must not put everything on the account twice. */
test('a kit already on the account is never added again', async () => {
  const dac = fakeDac({ owned: { 111: { id: 'p0' } }, legends: { 111: [{ code: '310' }] } });
  const out = await run(dac, [kit('111')]);
  assert.equal(out.results[0].outcome, 'existing');
  assert.equal(dac.calls.filter((c) => c.url.endsWith('/projects/create')).length, 0,
               'it added a kit that was already there');
});

test('a legend still being checked is reported as pending, not as a failure', async () => {
  const dac = fakeDac({ pendingLegend: ['111'] });
  const out = await run(dac, [kit('111')]);
  const r = readSyncResult(out);
  assert.equal(r.created, 1);
  assert.equal(r.pending, 1, 'a kit waiting on DAC was counted as a failure');
  assert.equal(r.failed, 0);
  assert.deepEqual(r.legends, {});
});

test('it signs in the way DAC\'s own page does, and sends the country header', async () => {
  const dac = fakeDac({ legends: { 111: [{ code: '310' }] } });
  await run(dac, [kit('111')]);
  const who = dac.calls[0];
  assert.equal(who.url, API + '/identify');
  assert.deepEqual(JSON.parse(who.body), {
    customer: { id: '42', email: 'x@example.com', first_name: 'J' }, digest: 'sig' });
  const later = dac.calls.find((c) => c.url.includes('/drills'));
  assert.equal(later.headers['x-customer-country'], 'GB');
});

test('not being signed in stops it before anything is sent', async () => {
  const dac = fakeDac({ signedIn: false });
  const out = await run(dac, [kit('111')]);
  assert.match(out.error, /not signed in/);
  assert.equal(dac.calls.length, 0, 'it talked to DAC without a signed-in account');
  assert.equal(out.done, true);
});

test('a refused sign-in stops it before any kit is touched', async () => {
  const dac = fakeDac({ refuse: true });
  const out = await run(dac, [kit('111')]);
  assert.match(out.error, /did not accept the sign-in/);
  assert.equal(dac.calls.filter((c) => !c.url.endsWith('/identify')).length, 0);
});

/* The script that actually gets injected must be the same code tested above. */
test('the injected script is the tested function, with the kits embedded safely', () => {
  const src = buildSyncScript([kit('111', 'Frejya, "Goddess" </script> & War')]);
  assert.ok(src.includes(runSync.toString()), 'the injected script is not the function under test');
  assert.doesNotThrow(() => new Function(src), 'the injected script does not parse');
  assert.ok(src.includes('window.__dd'), 'the result has nowhere to land');
});

/* What comes back was written on someone else's page. */
test('only sane colours survive the trip back', () => {
  assert.deepEqual(cleanColour({ code: '310', name: 'Black', hex: '000000' }),
                   { code: '310', name: 'Black', hex: '#000000' });
  assert.deepEqual(cleanColour('B5200'), { code: 'B5200', name: null, hex: null });
  assert.equal(cleanColour({ code: '<img onerror=x>' }), null);
  assert.equal(cleanColour({ code: '' }), null);
  assert.equal(cleanColour(null), null);
  assert.equal(cleanColour({ code: '310', hex: 'javascript:1' }).hex, null);
  const r = readSyncResult({ results: [{ variant: '../../etc', outcome: 'created' }] });
  assert.deepEqual(r.legends, {}, 'a variant that is not a number was accepted');
});

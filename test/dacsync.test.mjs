/**
 * The scripts that run on Diamond Art Club's pages, run here against stand-ins
 * instead. They are the same function text that gets injected, so this is the
 * only way to prove what they will do to a real account before they do it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { markPurchased, buildMarkScript, runLegends, buildLegendScript,
         readSyncResult, cleanColour } from '../app/core/dacsync.js';

/* ------------------------------------------------------------ marking */

/** A product page in miniature, drawn from the two states DAC shows. */
function productPage({ marked = false, button = true, appearsAfter = 0, pillInMarkup = true } = {}) {
  const clicks = [];
  const els = [];
  const el = (tag, textContent, shown, onClick) => {
    const e = { tagName: tag, textContent, shown, children: [],
                click() { clicks.push(textContent); onClick && onClick(); } };
    els.push(e); return e;
  };
  // the pill, with the ⓧ that UN-marks, is always in the markup; shown when marked
  const pill = el('div', 'You already purchased this product.', marked);
  const unmark = el('button', 'You already purchased this product. ⓧ', marked, () => { pill.shown = false; });
  let offer = null;
  let tries = 0;
  const makeOffer = () => {
    offer = el('button', 'Already purchased this?', !marked, () => { pill.shown = true; unmark.shown = true; offer.shown = false; });
  };
  if (button && !appearsAfter) makeOffer();
  if (!pillInMarkup) { pill.shown = false; }
  const document = {
    querySelectorAll(sel) {
      tries++;
      if (button && appearsAfter && !offer && tries > appearsAfter) makeOffer();
      if (sel === 'body *') return els;
      return els.filter((e) => e.tagName === 'button');
    }
  };
  return { document, clicks, pill, isShown: (e) => !!e.shown };
}
const mark = async (page, opts = {}) => {
  const out = {};
  await markPurchased({ document: page.document, sleep: async () => {}, out, isShown: page.isShown, ...opts });
  return out.state;
};

test('an unmarked kit gets its button pressed, and the pill confirms it', async () => {
  const page = productPage();
  assert.equal(await mark(page), 'marked');
  assert.deepEqual(page.clicks, ['Already purchased this?']);
  assert.equal(page.pill.shown, true);
});

/* It is a toggle. Pressing anything on a marked kit risks UN-marking it. */
test('a kit already marked is left completely alone', async () => {
  const page = productPage({ marked: true });
  assert.equal(await mark(page), 'already');
  assert.deepEqual(page.clicks, [], 'it pressed something on a kit that was already marked');
  assert.equal(page.pill.shown, true, 'the kit is no longer marked');
});

/* If DAC ever shows the button AND the pill together, the only thing standing
   between us and un-marking the kit is checking the pill first. */
test('when the pill and the button both show, it still presses nothing', async () => {
  const page = productPage({ marked: true });
  page.document.querySelectorAll('button').find((b) => /^Already/.test(b.textContent)).shown = true;
  assert.equal(await mark(page), 'already');
  assert.deepEqual(page.clicks, [], 'it pressed the toggle on a kit that was already marked');
});

/* The ⓧ says "this product", the button says "this?" — the question mark is
   what keeps them apart, even with the ⓧ showing and no pill detected. */
test('the ⓧ alone, showing, is never pressed', async () => {
  const page = productPage({ button: false });
  page.document.querySelectorAll('button')[0].shown = true;     // the ⓧ
  page.pill.textContent = '';                                     // and no pill to see
  assert.equal(await mark(page), 'already',
    'with the ⓧ showing, its own text says the kit is marked');
  assert.deepEqual(page.clicks, [], 'it pressed the ⓧ that un-marks');
});

test('the pill\'s ⓧ is never mistaken for the button, even though both say "already purchased"', async () => {
  const page = productPage();
  await mark(page);
  assert.ok(!page.clicks.some((t) => /You already purchased/.test(t)), 'it pressed the ⓧ that un-marks');
});

/* The dangerous case: DAC draws the button, THEN notices the kit is marked. */
test('a button that turns into the pill a moment later is never pressed', async () => {
  const page = productPage({ marked: true });
  const buttons = page.document.querySelectorAll('button');
  const offer = buttons.find((b) => /^Already/.test(b.textContent));
  const unmark = buttons.find((b) => /^You already/.test(b.textContent));
  // looks exactly like an unmarked kit at first: button showing, no pill, no ⓧ…
  offer.shown = true; page.pill.shown = false; unmark.shown = false;
  let looks = 0;
  const qsa = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = (sel) => {
    // …then DAC catches up, a few looks in
    if (++looks === 8) { offer.shown = false; page.pill.shown = true; unmark.shown = true; }
    return qsa(sel);
  };
  assert.equal(await mark(page), 'already');
  assert.deepEqual(page.clicks, [], 'it pressed before the page had settled, un-marking the kit');
});

test('a page told only to watch never presses, even an unmarked kit', async () => {
  const page = productPage();
  assert.equal(await mark(page, { press: false }), 'unconfirmed');
  assert.deepEqual(page.clicks, []);
});

test('the pill sitting hidden in the page markup does not count as marked', async () => {
  const page = productPage({ marked: false });
  assert.equal(page.pill.shown, false);
  assert.equal(await mark(page), 'marked', 'a hidden pill was read as "already purchased"');
});

test('a button DAC draws late is still found', async () => {
  const page = productPage({ appearsAfter: 5 });
  assert.equal(await mark(page), 'marked');
});

test('no button at all is reported, not guessed at', async () => {
  const page = productPage({ button: false });
  assert.equal(await mark(page), 'missing');
  assert.deepEqual(page.clicks, []);
});

test('it presses the button once, never twice', async () => {
  const page = productPage();
  // a button that does nothing: the pill never appears
  page.document.querySelectorAll('button')[1].click = function () { page.clicks.push(this.textContent); };
  assert.equal(await mark(page), 'unconfirmed');
  assert.equal(page.clicks.length, 1, 'it kept pressing a toggle');
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

/* ------------------------------------------- finding the real control */

/** A tiny tree: enough for parentElement and querySelectorAll('*'). */
function tree(spec, parent = null, all = [], clicks = []) {
  const node = { tagName: spec.tag, className: spec.cls || '', id: '', parentElement: parent,
    shown: spec.shown !== false, children: [], attrs: spec.attrs || {},
    getAttribute(k) { return this.attrs[k] ?? null; },
    get textContent() { return (spec.text || '') + this.children.map((c) => c.textContent).join(''); },
    get outerHTML() { return `<${spec.tag.toLowerCase()} ${Object.entries(this.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${this.textContent}</${spec.tag.toLowerCase()}>`; },
    querySelectorAll() { const out = []; const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; },
    click() { clicks.push(this); spec.onClick && spec.onClick(); } };
  all.push(node);
  node.children = (spec.kids || []).map((k) => tree(k, node, all, clicks).node);
  return { node, all, clicks };
}
function pageFrom(root, extra = {}) {
  const { all, clicks } = tree(root);
  const document = { querySelectorAll: (sel) => (sel === 'body *' ? all : sel === 'script[src]' ? (extra.scripts || []) : []) };
  return { document, clicks, all, isShown: (e) => e.shown !== false };
}

test('a plain div saying "Already purchased this?" is pressed, not just real buttons', async () => {
  let pill;
  const page = pageFrom({ tag: 'DIV', kids: [
    { tag: 'DIV', cls: 'ap-offer', text: 'Already purchased this?', onClick: () => { pill.shown = true; } },
    { tag: 'DIV', cls: 'ap-pill', text: 'You already purchased this product.', shown: false } ] });
  pill = page.all.find((n) => n.className === 'ap-pill');
  assert.equal(await mark(page), 'marked', 'a div control was never found');
  assert.equal(page.clicks[0].className, 'ap-offer');
});

test('wording split across pieces with no space between still reads as the question', async () => {
  let pill;
  const page = pageFrom({ tag: 'DIV', kids: [
    { tag: 'BUTTON', cls: 'offer', kids: [{ tag: 'SPAN', text: 'Already purchased' }, { tag: 'SPAN', text: 'this?' }],
      onClick: () => { pill.shown = true; } },
    { tag: 'DIV', cls: 'pill', text: 'You already purchased this product.', shown: false } ] });
  pill = page.all.find((n) => n.className === 'pill');
  assert.equal(await mark(page), 'marked', '"Already purchasedthis?" was not recognised');
});

test('the text inside a button presses the button around it', async () => {
  let pill;
  const page = pageFrom({ tag: 'DIV', kids: [
    { tag: 'BUTTON', cls: 'the-control', kids: [{ tag: 'SPAN', cls: 'label', text: 'Already purchased this?' }],
      onClick: () => { pill.shown = true; } },
    { tag: 'DIV', cls: 'pill', text: 'You already purchased this product.', shown: false } ] });
  pill = page.all.find((n) => n.className === 'pill');
  await mark(page);
  assert.equal(page.clicks[0].className, 'the-control', 'it clicked the label, not the button holding it');
});

test('a kit that could not be ticked reports what was on the page, with nothing private in it', async () => {
  const page = pageFrom({ tag: 'DIV', kids: [
    { tag: 'SECTION', cls: 'purchase-widget', attrs: { 'data-email': 'someone@example.com', 'data-auth-digest': 'abc123' },
      text: 'Purchase history for someone@example.com' } ] },
    { scripts: [{ src: 'https://cdn.example/already-purchased.js' }, { src: 'https://www.google-analytics.com/x.js' }] });
  const out = {};
  await markPurchased({ document: page.document, sleep: async () => {}, out, isShown: page.isShown,
                        location: { pathname: '/products/kit' } });
  assert.equal(out.state, 'missing');
  const report = JSON.stringify(out.found);
  assert.ok(out.found.cands.length >= 1, 'it did not say what on the page mentioned "purchased"');
  assert.deepEqual(out.found.scripts, ['https://cdn.example/already-purchased.js'], 'the scripts were not listed, or trackers were kept');
  assert.doesNotMatch(report, /someone@example\.com/, 'an email address leaked into the report');
  assert.doesNotMatch(report, /abc123/, 'a sign-in signature leaked into the report');
  assert.equal(out.found.page, '/products/kit');
});

/* What happened on the real page: the pill's markup is always there, hidden,
   inside visible containers — so "is any visible element saying 'You already
   purchased'?" was true everywhere, and nothing was ever pressed. */
test('a hidden pill inside visible containers does not make every kit look marked', async () => {
  let pill;
  const page = pageFrom({ tag: 'MAIN', kids: [{ tag: 'SECTION', cls: 'product-info', kids: [
    { tag: 'H1', text: 'Princess & The Pea Kitty' },
    { tag: 'DIV', cls: 'ap-widget', kids: [
      { tag: 'BUTTON', cls: 'ap-offer', kids: [{ tag: 'SPAN', text: 'Already purchased this?' }],
        onClick: () => { pill.shown = true; } },
      { tag: 'DIV', cls: 'ap-pill', shown: false, kids: [
        { tag: 'SPAN', text: 'You already purchased this product.' },
        { tag: 'BUTTON', cls: 'ap-unmark', text: 'ⓧ' } ] } ] } ] }] });
  pill = page.all.find((n) => n.className === 'ap-pill');
  const words = page.all.find((n) => n.textContent === 'You already purchased this product.');
  const shownNow = (e) => { for (let x = e; x; x = x.parentElement) if (x.shown === false) return false; return true; };
  const out = {};
  await markPurchased({ document: page.document, sleep: async () => {}, out, isShown: shownNow });
  assert.equal(out.state, 'marked', 'the visible containers around a hidden pill were read as "already purchased"');
  assert.equal(page.clicks[0].className, 'ap-offer');
  assert.ok(shownNow(words), 'sanity: the pill now shows');
  assert.ok(!page.clicks.some((c) => c.className === 'ap-unmark'), 'it pressed the ⓧ');
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

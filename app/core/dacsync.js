/**
 * Borrowing Diamond Art Club's drill legends through a DAC account.
 *
 * DAC keeps each kit's legend — every drill code in it, with its name and
 * colour — and hands it out only for kits the signed-in account owns. A kit
 * counts as owned when it came from an order, or when "Already purchased this?"
 * has been ticked on its product page. Adding it to DAC's logbook by hand does
 * NOT count: that makes an entry, and unlocks nothing.
 *
 * So there are two steps, both run on DAC's own pages after you sign in there:
 *
 *   markPurchased — on one kit's product page, press DAC's own button, exactly
 *                   as you would. It is a toggle, so it never presses anything
 *                   when the kit is already marked.
 *   runLegends    — on DAC's account page, read the legend of each kit. This
 *                   only reads; it changes nothing on the account.
 *
 * Each is one self-contained function, sent to DAC's page as its own source
 * text, so the exact code that runs there is the code tested here.
 *
 * Nothing here ever sees a password.
 */

/* ------------------------------------------------------------ marking */

/* Self-contained: no imports, no closures — it is sent as source text.

   Whether a kit is ticked is NOT read off the page. DAC keeps the answer as a
   list of SKUs — `?section_id=already-purchased-data`, the same list its own
   page reads — with ticked-by-hand entries as "MA:<sku>" and un-ticked ones as
   "MR:<sku>". So the script asks that list before pressing and asks it again
   afterwards to confirm. The button is a toggle; this presses it only when
   DAC's own list says the kit is not there. */
export async function markPurchased(env) {
  const { document, fetch, sleep, out } = env;
  out.state = 'working';
  const press = env.press !== false;
  const sku = String(env.sku || '');
  const loc = env.location || (typeof location !== 'undefined' ? location : { origin: '', pathname: '' });
  const shown = env.isShown || function (el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    if (el.classList && el.classList.contains('hidden')) return false;
    const cs = el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
    return !cs || (cs.visibility !== 'hidden' && cs.display !== 'none');
  };
  const scrub = (v) => String(v || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(data-auth-digest|digest|token|password)(["'=:\s]+)[^"'\s,}&]+/gi, '$1$2[removed]');
  const text = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();

  /* What was on the page, when a kit could not be ticked. */
  const diagnose = () => {
    const widgets = Array.from(document.querySelectorAll('[data-update-state], [data-already-purchased-indicator]'))
      .slice(0, 12).map((el) => ({
        sku: scrub(el.getAttribute && el.getAttribute('data-product-variant-sku')),
        indicator: !!(el.hasAttribute && el.hasAttribute('data-already-purchased-indicator')),
        updates: !!(el.hasAttribute && el.hasAttribute('data-update-state')),
        cls: scrub(String(el.className || '')).slice(0, 120), shown: !!shown(el),
        text: scrub(text(el)).slice(0, 80) }));
    return { page: String(loc.pathname || ''), sku, widgets };
  };

  // DAC's own list of what this account owns
  const decode = (t) => t.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const owned = async () => {
    const r = await fetch(String(loc.origin || '') + '/?section_id=already-purchased-data&_=' + Date.now(),
                          { credentials: 'same-origin' });
    const html = await r.text();
    const m = html.match(/<pre[^>]*data-already-purchased-skus[^>]*>([\s\S]*?)<\/pre>/i);
    if (!m) throw new Error('DAC did not send the list of kits this account owns');
    const list = JSON.parse(decode(m[1]).trim() || '[]');
    if (!Array.isArray(list)) throw new Error('the owned list was not a list');
    return list.map(String);
  };
  const has = (list) => !list.includes('MR:' + sku) && (list.includes(sku) || list.includes('MA:' + sku));

  /* The requests the press makes, recorded so a faster version could make them
     directly. Only the address, the method and the NAMES of what was sent. */
  const seen = [];
  const watch = () => {
    const w = env.window || (typeof window !== 'undefined' ? window : null);
    if (!w) return () => {};
    const f0 = w.fetch, x0 = w.XMLHttpRequest && w.XMLHttpRequest.prototype.open;
    const keys = (b) => { try { return Object.keys(JSON.parse(b)); } catch (e) {
      return b && typeof b.keys === 'function' ? Array.from(b.keys()) : []; } };
    if (f0) w.fetch = function (u, o) {
      seen.push({ via: 'fetch', method: (o && o.method) || 'GET', url: scrub(String(u)).split('?')[0], sent: keys(o && o.body) });
      return f0.apply(this, arguments);
    };
    if (x0) w.XMLHttpRequest.prototype.open = function (m, u) {
      seen.push({ via: 'xhr', method: m, url: scrub(String(u)).split('?')[0] });
      return x0.apply(this, arguments);
    };
    return () => { if (f0) w.fetch = f0; if (x0) w.XMLHttpRequest.prototype.open = x0; };
  };

  if (!sku) { out.state = 'failed'; out.error = 'no SKU for this kit'; out.found = diagnose(); return; }
  let list;
  try { list = await owned(); }
  catch (e) { out.state = 'failed'; out.error = String(e && e.message || e); out.found = diagnose(); return; }
  if (has(list)) { out.state = 'already'; return; }
  if (!press) {
    // a page that loaded again for this kit: never press, only see if it worked
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      try { if (has(await owned())) { out.state = 'already'; return; } } catch (e) { /* keep looking */ }
    }
    out.state = 'unconfirmed'; out.found = diagnose(); return;
  }

  // the kit's own "Already purchased this?" — marked as the indicator that updates
  // state, for exactly this SKU. The ⓧ also updates state, but is not an indicator.
  const offer = () => Array.from(document.querySelectorAll('[data-update-state]')).find((el) =>
    el.getAttribute('data-product-variant-sku') === sku
    && el.hasAttribute('data-already-purchased-indicator') && shown(el)) || null;
  let el = null;
  for (let i = 0; i < 40 && !el; i++) { el = offer(); if (!el) await sleep(300); }
  if (!el) { out.state = 'missing'; out.found = diagnose(); return; }

  const restore = watch();
  el.click();
  let ok = false;
  for (let i = 0; i < 15 && !ok; i++) {
    await sleep(1000);
    try { ok = has(await owned()); } catch (e) { /* keep looking */ }
  }
  restore();
  out.request = seen.filter((r) => !/section_id=already-purchased-data/.test(r.url)).slice(0, 6);
  out.state = ok ? 'marked' : 'unconfirmed';
  if (!ok) out.found = diagnose();
}

/* `press: false` is for a page that loaded again during the same kit: the first
   may already have pressed, and a second press un-marks. Each page runs it at
   most once. The kit's SKU is set just before, by `buildMarkPrep`. */
export function buildMarkScript({ press = true } = {}) {
  return 'window.__ap || (' + markPurchased.toString() + ')({'
    + 'document: document, fetch: fetch.bind(window), window: window, location: location,'
    + 'press: ' + (press ? 'true' : 'false') + ', sku: window.__apSku || "",'
    + 'sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },'
    + 'out: (window.__ap = {})'
    + '});';
}

/** Run before the mark script on a kit's page: which SKU this page is for. */
export function buildMarkPrep(sku) {
  return 'window.__apSku = ' + JSON.stringify(String(sku || '')) + ';';
}

/* A result only counts if it was read on THAT kit's page. The screen opens the
   next kit and then reads the result off whatever page is showing — and until
   the new page has loaded, that is still the last kit's, still holding the last
   kit's "ticked". Every kit after the first was recorded that way, untouched. */
export function readMarkFor(env) {
  const { location, ap, handle } = env;
  const path = String((location && location.pathname) || '').replace(/\/+$/, '');
  const want = '/products/' + handle;
  if (!ap || !handle || !path.endsWith(want)) return null;
  return JSON.stringify(ap);
}

/** The expression the DAC screen evaluates to read one kit's result. */
export function buildReadMark(handle) {
  return '(' + readMarkFor.toString() + ')({'
    + 'location: location, ap: window.__ap || null,'
    + 'handle: ' + JSON.stringify(String(handle)) + '})';
}

/* ------------------------------------------------------------ legends */

export async function runLegends(env) {
  const { document, fetch, sleep, variants, out } = env;
  const API = 'https://logbook-app-theta.vercel.app/api';
  out.done = false;
  out.error = null;
  out.results = [];
  out.progress = { done: 0, total: variants.length, now: '' };
  const msg = (e) => String((e && e.message) || e);
  try {
    const el = document.getElementById('logbook-customer-data');
    if (!el || el.getAttribute('data-logged-in') !== 'true')
      throw new Error('You are not signed in to Diamond Art Club on this page.');
    const id = el.getAttribute('data-customer-id') || '';
    const email = el.getAttribute('data-customer-email') || '';
    // DAC's own page falls back to a second element when the first has no name
    const fb = document.getElementById('dac-logbook-auth-fallback');
    const src = (!el.getAttribute('data-customer-first-name') && fb
                 && fb.getAttribute('data-customer-id') === id
                 && fb.getAttribute('data-customer-email') === email) ? fb : el;
    const digest = src.getAttribute('data-auth-digest');
    if (!digest) throw new Error('Diamond Art Club did not give this page a sign-in signature.');
    const customer = { id, email, first_name: src.getAttribute('data-customer-first-name') || '' };

    const who = await fetch(API + '/identify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, digest })
    });
    let token = null;
    try { token = who.ok ? ((await who.json()) || {}).data?.token : null; } catch { token = null; }
    if (!token) throw new Error('Diamond Art Club did not accept the sign-in (' + who.status + ').');

    const headers = { Authorization: 'Bearer ' + token };
    const country = el.getAttribute('data-customer-country');
    if (country) headers['x-customer-country'] = country;

    for (const variant of variants) {
      out.progress.now = variant;
      const res = { variant, owned: false, colors: null };
      try {
        const r = await fetch(API + '/drills?mode=source&variant=' + encodeURIComponent(variant), { headers });
        if (!r.ok) throw new Error('looking it up failed (' + r.status + ')');
        const found = await r.json();
        res.owned = !!(found && found.project);
        res.colors = found && found.colors ? found.colors : null;
      } catch (e) { res.error = msg(e); }
      out.results.push(res);
      out.progress.done++;
      await sleep(250);
    }
  } catch (e) { out.error = msg(e); }
  out.done = true;
}

export function buildLegendScript(variants) {
  return '(' + runLegends.toString() + ')({'
    + 'document: document, fetch: fetch.bind(window),'
    + 'sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },'
    + 'variants: ' + JSON.stringify(variants.map(String)) + ','
    + 'out: (window.__dd = {})'
    + '});';
}

/* ------------------------------------------------------------ results */

/* What comes back was written by scripts running on someone else's page, so
   it is treated as untrusted: only the shape we expect, only sane values. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,15}$/;
const HEX = /^#?[0-9a-fA-F]{6}$/;
const MARKS = ['marked', 'already', 'missing', 'unconfirmed', 'timeout', 'failed'];

export function cleanColour(c) {
  const raw = typeof c === 'string' ? { code: c } : (c && typeof c === 'object' ? c : null);
  if (!raw) return null;
  const code = String(raw.code ?? '').trim();
  if (!CODE.test(code)) return null;
  const hex = String(raw.hex ?? '').trim();
  const name = String(raw.name ?? '').trim().slice(0, 60);
  return { code, name: name || null, hex: HEX.test(hex) ? (hex.startsWith('#') ? hex : '#' + hex).toLowerCase() : null };
}

/** Legends by variant, and what happened on each product page. */
export function readSyncResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const dd = r.dd && typeof r.dd === 'object' ? r.dd : {};
  const out = { legends: {}, marked: 0, already: 0, missing: [], pending: 0,
                error: typeof dd.error === 'string' ? dd.error.slice(0, 200)
                     : (typeof r.error === 'string' ? r.error.slice(0, 200) : null) };

  for (const m of Array.isArray(r.marks) ? r.marks : []) {
    const variant = String(m && m.variant || '');
    if (!/^\d{1,20}$/.test(variant) || !MARKS.includes(m.state)) continue;
    if (m.state === 'marked') out.marked++;
    else if (m.state === 'already') out.already++;
    else out.missing.push({ variant, state: m.state, name: String(m.name || '').slice(0, 80) });
  }
  for (const x of Array.isArray(dd.results) ? dd.results : []) {
    const variant = String(x && x.variant || '');
    if (!/^\d{1,20}$/.test(variant)) continue;
    const colors = x.colors;
    const codes = colors && colors.status === 'available' && Array.isArray(colors.codes)
      ? colors.codes.map(cleanColour).filter(Boolean) : [];
    if (codes.length) out.legends[variant] = codes;
    else if (x.owned) out.pending++;          // owned, legend not out yet
  }
  return out;
}

/** Dazzle Diary's status, in DAC's words — kept for describing a kit. */
export const DAC_STATUS = {
  notReceived: 'not_received', received: 'received_not_started', started: 'started',
  onHold: 'started', abandoned: 'started', completed: 'completed'
};

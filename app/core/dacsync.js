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

/* Self-contained: no imports, no closures — it is sent as source text. */
export async function markPurchased(env) {
  const { document, sleep, out } = env;
  out.state = 'working';
  const text = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = env.isShown || function (el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const cs = el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
    return !cs || (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0');
  };
  const MARKED = /you already purchased this product/i;
  const OFFER = /already purchased this\s*\?/i;

  /* The pink "You already purchased this product." pill. Its markup is on the
     page either way; it only counts when it is actually showing. */
  const marked = () => Array.from(document.querySelectorAll('body *'))
    .some((el) => MARKED.test(text(el)) && shown(el));

  /* "Already purchased this?" — the most specific shown element saying so, and
     never anything that also says "You already purchased": that one holds the
     ⓧ that UN-marks a kit. */
  const offer = () => {
    const hits = Array.from(document.querySelectorAll('button, a, [role="button"], label'))
      .filter((el) => OFFER.test(text(el)) && !MARKED.test(text(el)) && shown(el));
    hits.sort((a, b) => text(a).length - text(b).length);
    return hits[0] || null;
  };

  /* Pressing is only ever safe once the page has SETTLED. If DAC draws the
     button first and swaps in the pill only after checking the account, acting
     at once would press it on a kit that is already marked — and un-mark it.
     So the button must have been showing, with no pill, for `settle` looks in
     a row. And a script that must not press (because this kit's page already
     had its press) only watches. */
  const press = env.press !== false;
  const settle = env.settle ?? 7;
  let pressed = false;
  let steady = 0;
  for (let i = 0; i < 50; i++) {
    if (marked()) { out.state = pressed ? 'marked' : 'already'; return; }
    if (press && !pressed) {
      const b = offer();
      steady = b ? steady + 1 : 0;
      if (b && steady >= settle) { b.click(); pressed = true; }
    }
    await sleep(300);
  }
  out.state = pressed ? 'unconfirmed' : (press ? 'missing' : 'unconfirmed');
}

/* `press: false` is for a page that loaded again during the same kit — the
   first page may already have pressed, and a second press un-marks. Each page
   runs it at most once. */
export function buildMarkScript({ press = true } = {}) {
  return 'window.__ap || (' + markPurchased.toString() + ')({'
    + 'document: document, press: ' + (press ? 'true' : 'false') + ','
    + 'sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },'
    + 'out: (window.__ap = {})'
    + '});';
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

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

/* ------------------------------------------------------------ ticking */

/* Self-contained: no imports, no closures — it is sent as source text.

   "Already purchased this?" is DAC's ALPManager.updatePurchased(sku): one call
   to its own service, already signed in on every signed-in DAC page. So this
   runs once, on one page, and ticks every kit by calling it — no opening of
   each product page.

   updatePurchased is a TOGGLE, but its reply is the resulting state: "MA:<sku>"
   ticked, "MR:<sku>" un-ticked. If a call un-ticks a kit, a second call ticks
   it again, so a kit is never left un-ticked. Kits whose colour list is already
   available are ticked already and are never touched at all. */
export async function tickAll(env) {
  const { sleep, kits, out } = env;
  const w = env.window || {};
  const doc = env.document;
  const have = new Set((env.have || []).map(String));    // variants that already have colours
  const limit = env.limit == null ? Infinity : env.limit;
  const API = 'https://already-purchased.vercel.app';
  out.done = false; out.error = null; out.results = []; out.via = null;
  out.progress = { done: 0, total: kits.length, now: '' };
  const has = (nv, x) => Array.isArray(nv) ? nv.map(String).includes(x)
                        : String(nv == null ? '' : nv).split(/[\s,;|]+/).includes(x);
  const ticked = (nv, sku) => !has(nv, 'MR:' + sku) && (has(nv, 'MA:' + sku) || has(nv, sku));
  const decode = (t) => String(t || '').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  /* The customer details and signature DAC's ticking service signs in with.
     They are written into signed-in DAC pages as #already-purchased-init; if
     this page has none, a signed-in page is FETCHED (not opened) to read it. */
  const initData = async () => {
    const el = doc && doc.getElementById && doc.getElementById('already-purchased-init');
    if (el && el.getAttribute('data-digest')) {
      const g = (k) => el.getAttribute('data-' + k) || '';
      return { id: g('customer-id'), email: g('customer-email'), real_email: g('customer-real-email'),
               first_name: g('customer-first-name'), digest: g('digest'), html: '' };
    }
    if (!env.probe) return null;
    const html = await (await env.fetch(env.probe, { credentials: 'same-origin' })).text();
    const tag = (html.match(/<[^>]*\bid=["']already-purchased-init["'][^>]*>/i) || [])[0];
    if (!tag) return null;
    const attr = (k) => decode((tag.match(new RegExp('\\bdata-' + k + '=["\']([^"\']*)["\']', 'i')) || [])[1]);
    return { id: attr('customer-id'), email: attr('customer-email'), real_email: attr('customer-real-email'),
             first_name: attr('customer-first-name'), digest: attr('digest'), html };
  };

  try {
    let update = null;
    // the page's own service, if it is here and signed in already
    for (let i = 0; i < 12 && !(w.ALPManager && w.ALPManager.auth_token); i++) await sleep(250);
    if (w.ALPManager && w.ALPManager.auth_token && typeof w.ALPManager.updatePurchased === 'function') {
      update = (sku) => w.ALPManager.updatePurchased(sku);
      out.via = 'page';
    } else {
      // otherwise sign in to it directly, exactly as DAC's alp-app.js does
      const d = await initData();
      if (!d || !d.digest) throw new Error('No signed-in DAC page offered the details its ticking service needs.');
      const shop = (w.ALPManager && w.ALPManager.shop)
        || ((d.html.match(/initialize\(\s*\{\s*shop\s*:\s*["'`]([^"'`]+)/) || [])[1])
        || (env.location && env.location.host) || 'www.diamondartclub.com';
      const q = '?shop=' + encodeURIComponent(shop);
      const who = await env.fetch(API + '/api/customer/identify' + q, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: { id: d.id, email: d.email, real_email: d.real_email,
                                           first_name: d.first_name }, digest: d.digest }) });
      const token = who.ok ? ((await who.json()) || {}).auth_token : null;
      if (!token) throw new Error('DAC\'s ticking service did not accept the sign-in (' + who.status + ').');
      update = async (sku) => {
        const r = await env.fetch(API + '/api/update_purchased' + q, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ sku }) });
        if (!r.ok) throw new Error('DAC refused the tick (' + r.status + ')');
        return ((await r.json()) || {}).new_value;
      };
      out.via = 'api';
    }

    let tried = 0;
    for (const k of kits) {
      out.progress.now = k.name || k.sku;
      const r = { variant: String(k.variant), sku: String(k.sku), name: k.name || '', state: 'failed', calls: 0 };
      if (have.has(r.variant)) r.state = 'skipped';
      else if (tried >= limit) r.state = 'deferred';
      else {
        tried++;
        try {
          let nv = await update(r.sku); r.calls++;
          if (!ticked(nv, r.sku)) { nv = await update(r.sku); r.calls++; }
          r.state = ticked(nv, r.sku) ? 'marked' : 'unconfirmed';
          r.reply = Array.isArray(nv) ? nv.filter((x) => String(x).includes(r.sku)) : String(nv).slice(0, 300);
        } catch (e) { r.error = String(e && (e.message || e.error) || e); }
        await sleep(200);
      }
      out.results.push(r);
      out.progress.done++;
    }
  } catch (e) { out.error = String(e && e.message || e); }
  out.done = true;
}

/** The script for DAC's account page. `window.__have` is set just before it by
 *  the DAC screen, from the first read of colour lists. `probe` is a kit page
 *  to FETCH, if the account page lacks the ticking service's sign-in details. */
export function buildTickScript(kits, { limit = null, probe = null } = {}) {
  return 'window.__tk || (' + tickAll.toString() + ')({'
    + 'window: window, document: document, fetch: fetch.bind(window), location: location,'
    + 'have: window.__have || [], probe: ' + JSON.stringify(probe) + ','
    + 'limit: ' + (limit == null ? 'null' : Number(limit)) + ','
    + 'sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },'
    + 'kits: ' + JSON.stringify(kits.map((k) => ({ variant: String(k.variant), sku: String(k.sku), name: k.name || '' }))) + ','
    + 'out: (window.__tk = {})'
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
  out.options = {};                    // DAC's own drill list, by shape
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

    /* A legend is bare codes. DAC's own drill list is what turns 3865 into a
       colour on screen, so it is fetched once for each shape seen. */
    const shapes = [];
    for (const r of out.results) {
      const shape = r.colors && r.colors.shape;
      if (shape && shapes.indexOf(shape) < 0) shapes.push(shape);
    }
    for (const shape of shapes) {
      try {
        const r = await fetch(API + '/drills?mode=options&shape=' + encodeURIComponent(shape), { headers });
        if (r.ok) out.options[shape] = await r.json();
      } catch (e) { /* the legends still stand without it */ }
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

export function cleanColour(c) {
  const raw = typeof c === 'string' ? { code: c } : (c && typeof c === 'object' ? c : null);
  if (!raw) return null;
  const code = String(raw.code ?? '').trim();
  if (!CODE.test(code)) return null;
  const hex = String(raw.hex ?? '').trim();
  const name = String(raw.name ?? '').trim().slice(0, 60);
  /* What DAC calls the drill when it is not a standard one: "Aurora Borealis",
     "Fairy Dust", "Iridescent", "Glow in the Dark". Its own words, kept. */
  const finish = String(raw.finish ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/[^A-Za-z0-9 '&()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return { code, name: name || null,
           hex: HEX.test(hex) ? (hex.startsWith('#') ? hex : '#' + hex).toLowerCase() : null,
           finish: finish || null };
}

/* DAC's drill list comes back as its own shape, and has changed before. Any
   of these is understood; anything else is simply ignored, and the codes stay
   bare rather than a sync failing over a list it did not need. */
export function readDrillOptions(raw) {
  const out = {};
  const take = (x) => {
    const c = cleanColour(x && typeof x === 'object' && !Array.isArray(x)
      ? { code: x.code ?? x.value ?? x.id ?? x.dmc ?? x.name, name: x.name ?? x.label ?? x.title,
          hex: x.hex ?? x.color ?? x.colour ?? x.rgb ?? x.hex_code }
      : x);
    if (c && !out[c.code]) out[c.code] = c;
  };
  const walk = (node, depth) => {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) { for (const x of node) take(x); return; }
    if (typeof node !== 'object') return;
    for (const key of ['data', 'drills', 'colors', 'colours', 'options', 'items', 'results']) {
      if (node[key]) walk(node[key], depth + 1);
    }
  };
  for (const byShape of Object.values(raw && typeof raw === 'object' ? raw : {})) walk(byShape, 0);
  return out;
}

/** Legends by variant, and what happened to each kit. */
export function readSyncResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const dd = r.dd && typeof r.dd === 'object' ? r.dd : {};
  const tk = r.tk && typeof r.tk === 'object' ? r.tk : {};
  const out = { legends: {}, shapes: {}, drills: readDrillOptions(dd.options), marked: 0, already: 0,
                deferred: 0, missing: [], pending: 0,
                error: [tk.error, dd.error, r.error].find((x) => typeof x === 'string' && x) || null };
  if (out.error) out.error = out.error.slice(0, 200);

  for (const m of Array.isArray(tk.results) ? tk.results : []) {
    const variant = String(m && m.variant || '');
    if (!/^\d{1,20}$/.test(variant)) continue;
    if (m.state === 'marked') out.marked++;
    else if (m.state === 'skipped') out.already++;
    else if (m.state === 'deferred') out.deferred++;
    else out.missing.push({ variant, state: String(m.state || 'failed'), name: String(m.name || '').slice(0, 80) });
  }
  for (const x of Array.isArray(dd.results) ? dd.results : []) {
    const variant = String(x && x.variant || '');
    if (!/^\d{1,20}$/.test(variant)) continue;
    const colors = x.colors;
    const codes = colors && colors.status === 'available' && Array.isArray(colors.codes)
      ? colors.codes.map(cleanColour).filter(Boolean) : [];
    if (codes.length) {
      out.legends[variant] = codes;
      const shape = colors.shape === 'round' || colors.shape === 'square' ? colors.shape : null;
      if (shape) out.shapes[variant] = shape;
    }
    else if (x.owned) out.pending++;
  }
  return out;
}

/** Dazzle Diary's status, in DAC's words — kept for describing a kit. */
export const DAC_STATUS = {
  notReceived: 'not_received', received: 'received_not_started', started: 'started',
  onHold: 'started', abandoned: 'started', completed: 'completed'
};

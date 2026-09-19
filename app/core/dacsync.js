/**
 * Borrowing Diamond Art Club's drill legends through a DAC account.
 *
 * DAC keeps each kit's legend — every drill code in it, with its name and
 * colour — and hands it out only for kits on the signed-in account. Its own
 * logbook lets you add a kit you bought elsewhere as one you own, and a kit
 * added that way comes with its legend. So signing into an account and adding
 * the kits you own is what makes their legends available.
 *
 * `runSync` is what runs on DAC's own page, from DAC's own origin, after you
 * have signed in there. It is written as one self-contained function so the
 * exact code that runs on DAC's site can be tested here against a stand-in:
 * `buildSyncScript` turns it into the text that gets injected.
 *
 * It never sees a password. It reads the signed customer record DAC's page
 * carries for its own logbook, trades it for a token the way DAC's page does,
 * and uses nothing else.
 */

/** Dazzle Diary's status, in DAC's words. A wish list kit is not bought. */
export const DAC_STATUS = {
  notReceived: 'not_received',
  received: 'received_not_started',
  started: 'started',
  onHold: 'started',       // DAC has no "on hold": it is a started kit, paused
  abandoned: 'started',    // or "abandoned": started, and set aside
  completed: 'completed'
};

/* Self-contained: no imports, no closures. It is sent to DAC's page as source
   text, so anything it needs arrives through `env`. */
export async function runSync(env) {
  const { document, fetch, FormData, sleep, kits, out } = env;
  const API = 'https://logbook-app-theta.vercel.app/api';
  out.done = false;
  out.error = null;
  out.results = [];
  out.progress = { done: 0, total: kits.length, now: '' };
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

    const lookup = async (variant) => {
      const r = await fetch(API + '/drills?mode=source&variant=' + encodeURIComponent(variant), { headers });
      if (!r.ok) throw new Error('looking it up failed (' + r.status + ')');
      return r.json();
    };

    for (const k of kits) {
      out.progress.now = k.name;
      const res = { variant: k.variant, outcome: 'failed', colors: null };
      try {
        /* Asking first is what makes this safe to run again: a kit already on
           the account is left alone, and one whose legend was still being
           checked last time gets another chance. */
        let found = await lookup(k.variant);
        if (found && found.project) res.outcome = 'existing';
        else {
          const f = new FormData();
          f.append('name', k.name);
          f.append('status', k.status);
          f.append('shape_type', k.shape);
          f.append('drill_type', k.drill);
          f.append('price_v2.currency_code', k.currency || 'GBP');
          f.append('from_product.id', k.product);
          f.append('from_product.variant', k.variant);
          const made = await fetch(API + '/projects/create', { method: 'POST', headers, body: f });
          if (!made.ok) throw new Error('adding it failed (' + made.status + ')');
          res.outcome = 'created';
          await sleep(600);
          found = await lookup(k.variant);
        }
        res.colors = found && found.colors ? found.colors : null;
      } catch (e) { res.error = msg(e); }
      out.results.push(res);
      out.progress.done++;
      await sleep(350);            // one kit at a time, gently
    }
  } catch (e) { out.error = msg(e); }
  out.done = true;
}

/** The text injected into DAC's page. The result lands on `window.__dd`. */
export function buildSyncScript(kits) {
  return '(' + runSync.toString() + ')({'
    + 'document: document, fetch: fetch.bind(window), FormData: FormData,'
    + 'sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },'
    + 'kits: ' + JSON.stringify(kits) + ','
    + 'out: (window.__dd = {})'
    + '});';
}

/* What comes back was written by a script running on someone else's page, so
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
  return { code, name: name || null, hex: HEX.test(hex) ? (hex.startsWith('#') ? hex : '#' + hex).toLowerCase() : null };
}

/** Legends from a finished sync, keyed by variant, and a count of what happened. */
export function readSyncResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { legends: {}, created: 0, existing: 0, failed: 0, pending: 0,
                error: typeof r.error === 'string' ? r.error.slice(0, 200) : null, problems: [] };
  for (const x of Array.isArray(r.results) ? r.results : []) {
    const variant = String(x && x.variant || '');
    if (!/^\d{1,20}$/.test(variant)) continue;
    if (x.outcome === 'created') out.created++;
    else if (x.outcome === 'existing') out.existing++;
    else { out.failed++; if (x.error) out.problems.push(String(x.error).slice(0, 120)); }
    const colors = x.colors;
    const codes = colors && colors.status === 'available' && Array.isArray(colors.codes)
      ? colors.codes.map(cleanColour).filter(Boolean) : [];
    if (codes.length) out.legends[variant] = codes;
    else if (x.outcome !== 'failed') out.pending++;   // on the account, legend not out yet
  }
  return out;
}

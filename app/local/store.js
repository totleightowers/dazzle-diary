/**
 * The whole server, reimplemented in the browser.
 *
 * Same routes, same shapes, same core logic — only the storage differs. The
 * catalogue lives in IndexedDB but is held in memory while the app runs (about
 * 7,700 rows, a few MB) so matching and search stay simple and instant.
 * Everything the shops serve goes through the native proxy, which is what lets
 * a page fetch another origin at all.
 */
import * as idb from './idb.js';
import { SHOPS, shopById, toRow } from '../core/shops.js';
import { norm } from '../core/match.js';
import { buildPreview } from '../core/import.js';

export const PROXY = '/__net/?url=';
const via = (url) => PROXY + encodeURIComponent(url);
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------ catalogue in memory */
let cache = null;                       // { rows, byNorm: Map }
async function catalogue() {
  if (cache) return cache;
  const rows = await idb.all('catalogue');
  const byNorm = new Map();
  for (const r of rows) {
    const k = r.title_norm;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(r);
  }
  cache = { rows, byNorm };
  return cache;
}
const invalidate = () => { cache = null; };

function catFor(shopId) {
  return {
    byHandle: (h) => cache.rows.find(r => r.handle === h && (!shopId || r.shop === shopId)) || null,
    byTitle: (n) => {
      const hits = (cache.byNorm.get(n) || []);
      return shopId ? hits.filter(r => r.shop === shopId) : hits;
    },
    byPrefix: (n) => {
      const p = n + ' ';
      const hits = cache.rows.filter(r => (!shopId || r.shop === shopId) && r.title_norm.startsWith(p));
      hits.sort((a, b) => a.title_norm.length - b.title_norm.length || a.title.localeCompare(b.title));
      return hits.slice(0, 80);
    }
  };
}

/** Fetch covers for any project still missing one. Safe to call repeatedly. */
export async function backfillCovers(onProgress) {
  await catalogue();
  const rows = await idb.all('projects');
  let done = 0;
  for (const row of rows) {
    if (!row.dac_handle) continue;
    if (row.cover && Native()?.exists('covers/' + row.cover)) continue;
    const c = cache.rows.find(r => r.shop === (row.shop || 'dac') && r.handle === row.dac_handle);
    if (!c || !c.image) continue;
    const urls = Array.isArray(c.images) ? c.images
      : (() => { try { return JSON.parse(c.images || '[]'); } catch { return []; } })();
    const g = await cacheGallery(`${row.shop || 'dac'}-${row.dac_handle}`, urls.length ? urls : [c.image]);
    if (g.length) {
      row.cover = g[0];
      if (g.length > 1) row.covers = JSON.stringify(g);
      await idb.put('projects', row); done++; onProgress?.(done);
    }
  }
  return done;
}

/* -------------------------------------------------------------------- jobs */
const jobs = new Map();
const newJob = (id) => {
  const j = { id, state: 'running', done: 0, total: 0, message: '', result: null, error: null };
  jobs.set(id, j);
  return j;
};

/* ------------------------------------------------------------------- sync */
async function fetchJson(url) {
  const res = await fetch(via(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function syncOne(shop, job, want) {
  const products = [];
  let page = 1;
  while (page <= 60) {
    const url = shop.platform === 'woo'
      ? `https://${shop.domain}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
      : `https://${shop.domain}/products.json?limit=250&page=${page}${want ? '&currency=' + encodeURIComponent(want) : ''}`;
    const perPage = shop.platform === 'woo' ? 100 : 250;
    let json;
    try { json = await fetchJson(url); }
    catch (e) { if (page > 1) break; throw new Error(`${shop.name}: ${e.message}`); }
    const batch = Array.isArray(json) ? json : (json.products || []);
    if (!batch.length) break;
    products.push(...batch);
    if (job) job.message = `${shop.name} · ${products.length.toLocaleString()} products`;
    if (batch.length < perPage) break;
    page++;
    await sleep(400);
  }
  const ctx = shop.context ? await shop.context((path) => fetchJson(`https://${shop.domain}${path}`)) : null;
  const rows = products.map(p => toRow(shop, p, ctx)).filter(Boolean)
                       .map(r => ({ ...r, title_norm: norm(r.title),
                                    currency: (shop.platform !== 'woo' && want) ? want : r.currency }));
  await idb.replaceShop(shop.id, rows);
  invalidate();
  const kits = rows.filter(r => r.kind === 'kit').length;
  return { shop: shop.id, name: shop.name, seen: products.length, kits, other: rows.length - kits };
}

/* ------------------------------------------------------------- projects */
const PROJECT_FIELDS = ['title','artist','status','shape','coverage','width_in','height_in','colors','drills',
  'special','drills_estimated','brand','source','price','price_source','shipping','tax','currency','sold_price','hours','progress',
  'date_ordered','date_received','date_started','date_completed','order_ref','order_total','order_items',
  'order_flag','dac_handle','shop','cover','covers','notes'];

const projects = () => idb.all('projects');

async function withPhotos(p) {
  if (!p) return p;
  p.photos = (await idb.byIndex('photos', 'project_id', p.id))
    .map(({ id, file, caption, taken_at }) => ({ id, file, caption, taken_at }));
  return p;
}

/* Covers and progress photos are written to the app's own storage through the
 * native bridge, and served back by the shell at /covers/ and /photos/. Keeping
 * them as real files (rather than blobs in IndexedDB) means the rest of the app
 * uses ordinary <img src="/covers/x.jpg"> and needs no special casing. */
const Native = () => (typeof window !== 'undefined' ? window.LogbookNative : null);

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function saveFile(path, blobOrBuffer) {
  const n = Native();
  if (!n) return false;
  const buf = blobOrBuffer instanceof Blob ? await blobOrBuffer.arrayBuffer() : blobOrBuffer;
  return n.save(path, toBase64(buf));
}

/** Download a whole listing gallery; returns the local filenames. */
async function cacheGallery(key, urls, width = 600) {
  const out = [];
  for (let i = 0; i < (urls || []).length; i++) {
    const f = await cacheCover(i === 0 ? key : `${key}-${i}`, urls[i], width);
    if (f) out.push(f);
  }
  return out;
}

async function cacheCover(key, url, width = 600) {
  if (!url) return null;
  let src = url;
  try {
    const u = new URL(url);
    if (u.hostname.includes('shopify')) { u.searchParams.set('width', String(width)); src = u.toString(); }
  } catch {}
  const ext = (String(url).match(/\.(png|webp|gif|jpe?g)/i) || ['.jpg'])[0].toLowerCase();
  const name = key + (ext === '.jpeg' ? '.jpg' : ext);
  const n = Native();
  if (n && n.exists('covers/' + name)) return name;
  try {
    const res = await fetch(via(src));
    if (!res.ok) return null;
    return (await saveFile('covers/' + name, await res.arrayBuffer())) ? name : null;
  } catch { return null; }
}

/* --------------------------------------------------------------- routing */
const q = (u, k) => u.searchParams.get(k);

export async function localApi(path, opts = {}) {
  const url = new URL(path, 'http://local');
  const p = url.pathname;
  const m = (opts.method || 'GET').toUpperCase();
  // NOT every body is JSON — the import posts raw CSV text. Parse only where
  // a route actually expects an object.
  const json = () => {
    if (!opts.body) return {};
    if (typeof opts.body !== 'string') return opts.body;
    try { return JSON.parse(opts.body); } catch { return {}; }
  };
  await catalogue();

  if (p === '/state') {
    const rows = await projects();
    const counts = {};
    rows.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
    const per = {};
    cache.rows.forEach(r => { if (r.kind === 'kit') per[r.shop] = (per[r.shop] || 0) + 1; });
    const meta = await idb.get('meta', 'synced') || {};
    return {
      catalogue: {
        kits: Object.values(per).reduce((a, b) => a + b, 0),
        total: cache.rows.length,
        syncedAt: meta.all || null,
        shops: SHOPS.map(s => ({ id: s.id, name: s.name, domain: s.domain, kits: per[s.id] || 0, syncedAt: meta[s.id] || null }))
      },
      counts, total: rows.length
    };
  }

  if (p === '/shops') return (await localApi('/state')).catalogue.shops;

  if (p === '/prefs' && m === 'GET') {
    const pr = (await idb.get('meta', 'prefs')) || {};
    return { currency: pr.currency || 'GBP', excluded: pr.excluded || [] };
  }

  if (p === '/prefs' && m === 'PATCH') {
    const prefs = (await idb.get('meta', 'prefs')) || {};
    const b = json();
    if (b.currency) prefs.currency = String(b.currency).slice(0, 3).toUpperCase();
    if (Array.isArray(b.excluded)) prefs.excluded = b.excluded;
    await idb.put('meta', prefs, 'prefs');
    return { currency: prefs.currency || 'GBP', excluded: prefs.excluded || [] };
  }

  if (p === '/catalogue/sync' && m === 'POST') {
    const want = q(url, 'shop');
    const off = ((await idb.get('meta', 'prefs')) || {}).excluded || [];
    const list = want ? [shopById(want)].filter(Boolean) : SHOPS.filter(sh => !off.includes(sh.id));
    const job = newJob('sync-' + Date.now());
    job.total = list.length;
    job.message = `Contacting ${list[0].name}…`;
    (async () => {
      const results = [], failed = [];
      const meta = (await idb.get('meta', 'synced')) || {};
      for (const shop of list) {
        try {
          const want = ((await idb.get('meta', 'prefs')) || {}).currency || 'GBP';
          results.push(await syncOne(shop, job, want));
          meta[shop.id] = nowIso();
        }
        catch (e) { failed.push({ shop: shop.name, error: e.message }); }
        job.done++;
      }
      meta.all = nowIso();
      await idb.put('meta', meta, 'synced');
      // anything restored before the catalogue existed can get its cover now
      try {
        const filled = await backfillCovers((n) => { job.message = `Fetching covers · ${n}`; });
        if (filled) job.coversFilled = filled;
      } catch { /* covers are cosmetic; never fail a sync over them */ }
      job.result = { shops: results, failed };
      job.state = results.length ? 'done' : 'error';
      if (!results.length) job.error = failed.map(f => `${f.shop}: ${f.error}`).join('; ');
      const kits = results.reduce((n, r) => n + r.kits, 0);
      job.message = `${kits.toLocaleString()} kits from ${results.length} shop${results.length === 1 ? '' : 's'}`
        + (failed.length ? ` · ${failed.length} could not be reached` : '');
    })();
    return { job: job.id };
  }

  if (p.startsWith('/jobs/')) {
    const j = jobs.get(p.slice(6));
    if (!j) throw Object.assign(new Error('No such job'), { status: 404 });
    return j;
  }

  if (p === '/catalogue/facets') {
    const shop = q(url, 'shop');
    const rows = cache.rows.filter(r => r.kind === 'kit' && (!shop || r.shop === shop));
    const priced = rows.filter(r => r.price != null).map(r => r.price);
    const edges = rows.filter(r => r.width_in && r.height_in)
                      .map(r => Math.max(r.width_in, r.height_in) * 2.54);
    const shapes = [...new Set(rows.map(r => r.shape).filter(Boolean))];
    return {
      minPrice: priced.length ? Math.floor(Math.min(...priced)) : 0,
      maxPrice: priced.length ? Math.ceil(Math.max(...priced)) : 200,
      minCm: edges.length ? Math.floor(Math.min(...edges)) : 0,
      maxCm: edges.length ? Math.ceil(Math.max(...edges)) : 200,
      shapes
    };
  }

  if (p === '/catalogue/search' || p === '/catalogue/browse') {
    const shop = q(url, 'shop');
    const limit = Math.min(60, Number(q(url, 'limit')) || 30);
    const offset = Number(q(url, 'offset')) || 0;
    const shape = q(url, 'shape');
    const minCm = Number(q(url, 'minCm')) || null;
    const maxCm = Number(q(url, 'maxCm')) || null;
    const maxPrice = Number(q(url, 'maxPrice')) || null;
    const inStock = q(url, 'inStock') === '1';
    const sort = q(url, 'sort') || 'relevance';
    const edge = (r) => (r.width_in && r.height_in) ? Math.max(r.width_in, r.height_in) * 2.54 : null;

    const off = ((await idb.get('meta', 'prefs')) || {}).excluded || [];
    let rows = cache.rows.filter(r => r.kind === 'kit'
      && (shop ? r.shop === shop : !off.includes(r.shop)));
    if (shape) rows = rows.filter(r => r.shape === shape);
    if (inStock) rows = rows.filter(r => r.available);
    if (maxPrice) rows = rows.filter(r => r.price != null && r.price <= maxPrice);
    if (minCm) rows = rows.filter(r => edge(r) != null && edge(r) >= minCm);
    if (maxCm) rows = rows.filter(r => edge(r) != null && edge(r) <= maxCm);

    const bySort = {
      name: (a, b) => a.title.localeCompare(b.title),
      price: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
      priceDesc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      size: (a, b) => ((b.width_in||0)*(b.height_in||0)) - ((a.width_in||0)*(a.height_in||0)),
      drills: (a, b) => (b.drills ?? -1) - (a.drills ?? -1)
    };

    if (p === '/catalogue/search') {
      const n = norm(q(url, 'q') || '');
      if (n.length < 2) return [];
      rows = rows.filter(r => r.title_norm.includes(n) || (r.artist || '').toLowerCase().includes(n));
      const rank = (r) => r.title_norm === n ? 0 : r.title_norm.startsWith(n) ? 1 : r.title_norm.includes(n) ? 2 : 3;
      rows.sort(bySort[sort] || ((a, b) => rank(a) - rank(b) || (b.available - a.available)
                       || a.title.length - b.title.length || a.title.localeCompare(b.title)));
    } else {
      rows = rows.filter(r => r.image);
      rows.sort(bySort[sort] || ((a, b) => (b.available - a.available) || a.title.localeCompare(b.title)));
    }
    return rows.slice(offset, offset + limit);
  }

  if (p === '/import/preview' && m === 'POST') {
    const shop = q(url, 'shop') || 'dac';
    if (!cache.rows.some(r => r.shop === shop))
      throw Object.assign(new Error('Sync the catalogue first so orders can be matched.'), { status: 409 });
    const rows = await projects();
    const existing = new Map(rows.map(r => [norm(r.title), r.id]));
    const known = new Map();
    for (const r of rows) if (r.dac_handle) known.set(norm(r.title), r.dac_handle);
    const s = shopById(shop);
    const pref = ((await idb.get('meta', 'prefs')) || {}).currency || 'GBP';
    return buildPreview(catFor(shop), existing, String(opts.body), s ? s.name : 'Diamond Art Club', known, pref);
  }

  if (p === '/import/commit' && m === 'POST') {
    const kits = json().kits || [];
    const job = newJob('import-' + Date.now());
    job.total = kits.length;
    (async () => {
      try {
        let i = 0, inserted = 0;
        for (const k of kits) {
          const g = await cacheGallery(`${k.shop || 'dac'}-${k.handle || 'kit-' + i}`,
            (k.images && k.images.length) ? k.images : [k.cover]);
          k.coverFile = g[0] || null;
          k.coverFiles = g;
          job.done = ++i;
          job.message = `Fetching covers · ${i} of ${kits.length}`;
        }
        const seen = new Set((await projects()).map(r => (r.title || '').toLowerCase() + '::' + (r.order_ref || '')));
        const ts = nowIso();
        for (const k of kits) {
          const key = k.title.toLowerCase() + '::' + (k.orderRef || '');
          if (seen.has(key)) continue;
          seen.add(key);
          await idb.put('projects', {
            title: k.title, artist: k.artist ?? null, status: k.status || 'notReceived',
            shape: k.shape ?? null, coverage: k.coverage ?? null,
            width_in: k.width_in ?? null, height_in: k.height_in ?? null,
            colors: k.colors ?? null, drills: k.drills ?? null,
            drills_estimated: k.drillsEstimated ?? 0, special: k.special ?? null,
            brand: k.shopName || null, source: k.shopName || null, currency: k.currency || 'GBP',
            date_ordered: k.orderDate ?? null,
            date_received: k.status === 'received' ? k.orderDate ?? null : null,
            date_started: null, date_completed: null,
            order_ref: k.orderRef ?? null, order_total: k.orderTotal ?? null,
            order_items: k.orderItems ?? null, order_flag: k.flag ?? null,
            dac_handle: k.handle ?? null, shop: k.shop ?? 'dac', cover: k.coverFile ?? null,
            covers: (k.coverFiles && k.coverFiles.length > 1) ? JSON.stringify(k.coverFiles) : null,
            price: k.price ?? null, price_source: k.priceSource ?? null,
            shipping: null, tax: null, sold_price: null, hours: 0, progress: 0, notes: null,
            created_at: ts, updated_at: ts
          });
          inserted++;
        }
        job.result = { inserted, skipped: kits.length - inserted };
        job.state = 'done';
        job.message = `${inserted} projects added`;
      } catch (e) { job.state = 'error'; job.error = e.message; }
    })();
    return { job: job.id };
  }

  if (p === '/projects' && m === 'GET') {
    let rows = await projects();
    const status = q(url, 'status'), qq = (q(url, 'q') || '').toLowerCase();
    if (status && status !== 'all') rows = rows.filter(r => r.status === status);
    if (qq) rows = rows.filter(r => r.title.toLowerCase().includes(qq) || (r.artist || '').toLowerCase().includes(qq));
    const sort = q(url, 'sort') || 'added';
    const cmp = {
      added: (a, b) => b.id - a.id,
      name: (a, b) => a.title.localeCompare(b.title),
      drills: (a, b) => (b.drills || 0) - (a.drills || 0),
      size: (a, b) => ((b.width_in || 0) * (b.height_in || 0)) - ((a.width_in || 0) * (a.height_in || 0)),
      progress: (a, b) => (b.progress || 0) - (a.progress || 0)
    }[sort] || ((a, b) => b.id - a.id);
    return rows.sort(cmp);
  }

  if (p === '/projects' && m === 'POST') {
    const body = json();
    if (!body.title || !String(body.title).trim()) throw Object.assign(new Error('A project name is required.'), { status: 400 });
    if (body.dac_handle && body.shop && !body.cover) {
      const c = cache.rows.find(r => r.shop === body.shop && r.handle === body.dac_handle);
      if (c && c.image) {
        const urls = Array.isArray(c.images) ? c.images
          : (() => { try { return JSON.parse(c.images || '[]'); } catch { return []; } })();
        const g = await cacheGallery(`${body.shop}-${body.dac_handle}`, urls.length ? urls : [c.image]);
        body.cover = g[0] || null;
        if (g.length > 1) body.covers = JSON.stringify(g);
      }
    }
    const ts = nowIso();
    const row = { created_at: ts, updated_at: ts, hours: 0, progress: 0 };
    for (const f of PROJECT_FIELDS) if (body[f] !== undefined) row[f] = body[f];
    const id = await idb.put('projects', row);
    return withPhotos(await idb.get('projects', id));
  }

  const pm = p.match(/^\/projects\/(\d+)$/);
  if (pm) {
    const id = Number(pm[1]);
    const row = await idb.get('projects', id);
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    if (m === 'GET') return withPhotos(row);
    if (m === 'PATCH') {
      const body = json();
      for (const f of PROJECT_FIELDS) if (f in body) row[f] = body[f];
      row.updated_at = nowIso();
      await idb.put('projects', row);
      return withPhotos(row);
    }
    if (m === 'DELETE') {
      for (const ph of await idb.byIndex('photos', 'project_id', id)) {
        Native()?.remove('photos/' + ph.file);
        await idb.del('photos', ph.id);
      }
      await idb.del('projects', id);
      return { ok: true };
    }
  }

  const ph = p.match(/^\/projects\/(\d+)\/photos$/);
  if (ph && m === 'POST') {
    const id = Number(ph[1]);
    const ts = nowIso();
    const type = (opts.headers && opts.headers['Content-Type']) || 'image/jpeg';
    const ext = { 'image/png': '.png', 'image/webp': '.webp' }[type] || '.jpg';
    const file = `p${id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
    if (!await saveFile('photos/' + file, opts.body))
      throw Object.assign(new Error('Could not save that photo.'), { status: 500 });
    const pid = await idb.put('photos', { project_id: id, file, taken_at: ts.slice(0, 10), created_at: ts });
    return { id: pid, file };
  }

  const dp = p.match(/^\/photos\/(\d+)$/);
  if (dp && m === 'DELETE') {
    const row = await idb.get('photos', Number(dp[1]));
    if (row) { Native()?.remove('photos/' + row.file); await idb.del('photos', row.id); }
    return { ok: true };
  }

  if (p === '/restore' && m === 'POST') {
    const data = json();
    if (!data || !Array.isArray(data.projects))
      throw Object.assign(new Error('That is not a logbook backup.'), { status: 400 });

    const existing = await projects();
    const keyOf = (r) => (r.title || '').toLowerCase() + '::' + (r.order_ref || '');
    const here = new Map(existing.map(r => [keyOf(r), r.id]));

    // Map EVERY backed-up project to a local id — including ones already here.
    // Only mapping the newly added ones silently dropped their photos.
    const idMap = new Map();
    let added = 0;
    /* A restore is also how corrections travel from the other build into this
       one, so a project that is already here gets UPDATED rather than skipped.
       Only fields the backup actually has a value for are touched, and your own
       progress, hours and notes are never overwritten. */
    const KEEP_MINE = new Set(['progress', 'hours', 'notes', 'sold_price', 'id', 'created_at']);
    let updated = 0, fieldsChanged = 0;
    for (const row of data.projects) {
      const key = keyOf(row);
      if (here.has(key)) {
        const id = here.get(key);
        idMap.set(row.id, id);
        const mine = await idb.get('projects', id);
        if (mine) {
          let touched = false;
          for (const [f, v] of Object.entries(row)) {
            if (KEEP_MINE.has(f) || f === 'cover') continue;
            if (v == null || v === '') continue;
            if (mine[f] === v) continue;
            mine[f] = v; touched = true; fieldsChanged++;
          }
          if (touched) { mine.updated_at = nowIso(); await idb.put('projects', mine); updated++; }
        }
        continue;
      }
      const copy = { ...row };
      delete copy.id;
      // The filename in the backup belongs to the machine it came from; this
      // app stores covers under its own name. Keeping it produced broken
      // images, so drop it and re-fetch below.
      delete copy.cover;
      const newId = await idb.put('projects', copy);
      here.set(key, newId);
      idMap.set(row.id, newId);
      added++;
    }

    // progress photos: the only part of a logbook that cannot be re-downloaded
    let photos = 0, photosFailed = 0;
    const seenPhotos = new Set();
    for (const ph of (await idb.all('photos'))) seenPhotos.add(ph.project_id + '::' + ph.file);
    for (const ph of (data.photos || [])) {
      const pid = idMap.get(ph.project_id);
      if (!pid || !ph.data) { photosFailed++; continue; }
      if (seenPhotos.has(pid + '::' + ph.file)) continue;      // restoring twice is safe
      try {
        const bytes = Uint8Array.from(atob(ph.data), (c) => c.charCodeAt(0));
        if (!await saveFile('photos/' + ph.file, bytes.buffer)) { photosFailed++; continue; }
        await idb.put('photos', { project_id: pid, file: ph.file, caption: ph.caption ?? null,
                                  taken_at: ph.taken_at ?? null, created_at: ph.created_at || nowIso() });
        seenPhotos.add(pid + '::' + ph.file);
        photos++;
      } catch { photosFailed++; }
    }

    // covers are not carried in the backup (they would treble its size); fetch
    // them from the catalogue, which is why it has to be synced first
    let covers = 0, coversMissing = 0;
    for (const [, pid] of idMap) {
      const row = await idb.get('projects', pid);
      if (!row) continue;
      if (row.cover && Native()?.exists('covers/' + row.cover)) continue;   // already on disk
      if (!row.dac_handle) { if (!row.cover) coversMissing++; continue; }
      const c = cache.rows.find(r => r.shop === (row.shop || 'dac') && r.handle === row.dac_handle);
      if (!c || !c.image) { coversMissing++; continue; }
      const file = await cacheCover(`${row.shop || 'dac'}-${row.dac_handle}`, c.image);
      if (file) { row.cover = file; await idb.put('projects', row); covers++; }
      else { coversMissing++; }
      if (row.cover && !file) { row.cover = null; await idb.put('projects', row); }
    }

    return {
      added, updated, fieldsChanged,
      skipped: data.projects.length - added - updated,
      photos, photosFailed,
      covers, coversMissing,
      catalogueEmpty: cache.rows.length === 0
    };
  }

  if (p === '/stats') {
    const rows = await projects();
    const sum = (f) => rows.reduce((n, r) => n + (Number(r[f]) || 0), 0);
    const byArtist = {};
    rows.forEach(r => { if (r.artist) byArtist[r.artist] = (byArtist[r.artist] || 0) + 1; });
    const placed = Math.round(rows.reduce((n, r) => n + (r.status === 'completed'
      ? (Number(r.drills) || 0)
      : (Number(r.drills) || 0) * (Number(r.progress) || 0) / 100), 0));
    return {
      projects: rows.length, drills: sum('drills'), hours: sum('hours'), spend: sum('price'),
      completed: rows.filter(r => r.status === 'completed').length,
      placed, remaining: Math.max(0, sum('drills') - placed),
      estimatedCounts: rows.filter(r => r.drills_estimated).length,
      byStatus: Object.entries(rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}))
                      .map(([status, n]) => ({ status, n })),
      topArtists: Object.entries(byArtist).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .slice(0, 8).map(([artist, n]) => ({ artist, n })),
      topShops: Object.values(rows.reduce((a, r) => {
        const k = r.brand || r.source || r.shop || 'Unknown';
        a[k] = a[k] || { shop: k, n: 0, spend: 0 };
        a[k].n++; a[k].spend += Number(r.price) || 0;
        return a;
      }, {})).map(v => ({ ...v, spend: Math.round(v.spend * 100) / 100 }))
        .sort((a, b) => b.n - a.n || b.spend - a.spend).slice(0, 8),
      spendBy: Object.entries(rows.filter(r => r.price != null).reduce((a, r) => {
        const c = r.currency || 'GBP';
        a[c] = a[c] || { currency: c, total: 0, n: 0 };
        a[c].total += Number(r.price) || 0; a[c].n++;
        return a;
      }, {})).map(([, v]) => ({ ...v, total: Math.round(v.total * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
    };
  }

  if (p === '/export') {
    const rows = await projects();
    const cols = Object.keys(rows[0] || { id: 1 });
    const esc = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    return { __csv: [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') };
  }

  throw Object.assign(new Error('Unknown endpoint ' + p), { status: 404 });
}



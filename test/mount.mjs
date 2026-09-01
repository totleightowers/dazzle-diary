/**
 * Boots the real app against the DOM in dom.mjs, with the native bridge and the
 * shops stubbed, and hands back the few things a test needs: navigate, tap,
 * query, and the store's own API for setting a situation up.
 *
 * The point is that a test drives the app the way a finger does — tap what is
 * on screen — rather than calling internals. Anything that only works because
 * the test knew a private name is not worth asserting.
 */
import './idbshim.mjs';
import { makeDocument, matches } from './dom.mjs';

const IMAGE = 'https://cdn.shopify.com/kit.jpg';

export async function mount({ width = 390, products = null, catalogue = true, shop = 'dac' } = {}) {
  const document = makeDocument();
  const files = new Map();          // the native file store
  const downloads = [];
  const listeners = Object.create(null);
  const confirms = [];
  let confirmAnswer = true;
  const toasts = [];

  const media = (q) => {
    const m = /min-width:\s*(\d+)px/.exec(q);
    return { matches: m ? win.innerWidth >= Number(m[1]) : false,
             addEventListener() {}, addListener() {}, removeEventListener() {} };
  };

  const win = {
    LOGBOOK_STANDALONE: true,
    innerWidth: width,
    innerHeight: 900,
    devicePixelRatio: 2,
    LogbookNative: {
      save: (p, b64) => { files.set(p, Buffer.from(b64, 'base64')); return true; },
      exists: (p) => files.has(p),
      remove: (p) => files.delete(p),
      isSystemDark: () => true,
      setBarColor() {},
      saveDownload: (name, b64, mime) => {
        downloads.push({ name, mime, text: Buffer.from(b64, 'base64').toString('utf8') });
        return 'Downloads';
      }
    },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    scrollTo() {},
    matchMedia: media,
    getSelection: () => ({ removeAllRanges() {} })
  };

  const DEFAULT_PRODUCT = {
    id: 1, title: 'Moon Eater', vendor: 'Yuumei Art', handle: 'moon-eater',
    product_type: 'Diamond Art Kit',
    images: [{ src: IMAGE }, { src: IMAGE.replace('kit', 'kit-2') }],
    variants: [{ title: '23.6" x 30.7" (59.9cm x 78cm) / Square with 42 Colors including 3 ABs / 75433',
                 price: '169.00', available: true }]
  };
  const feed = products || [DEFAULT_PRODUCT];
  /* Which shop's domain answers with that feed. Tests that care about one
     shop's adapter stand that shop up rather than pretending it is DAC. */
  const { SHOPS: _SHOPS } = await import('../app/core/shops.js');
  const FEED_HOST = (_SHOPS.find((s) => s.id === shop) || {}).domain || 'diamondartclub.com';

  globalThis.window = win;
  globalThis.document = document;
  /* Assigning location.hash navigates: the browser fires hashchange for it.
     Without that here, anything the app navigates to itself — go(), swap(),
     back() — happened silently and the test saw the previous screen. */
  let _hash = '#/';
  let pending = null;
  globalThis.location = {
    get hash() { return _hash; },
    set hash(v) {
      const next = String(v).startsWith('#') ? String(v) : '#' + v;
      if (next === _hash) return;
      const old = _hash;
      _hash = next;
      pending = Promise.resolve().then(() => fire('hashchange',
        { oldURL: 'http://x/' + old, newURL: 'http://x/' + next }));
    }
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // things a WebView provides and Node does not
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.matchMedia = media;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.history = {
    state: {}, _stack: [],
    pushState(s) { this._stack.push(s); this.state = s; },
    back() { this._stack.pop(); this.state = this._stack[this._stack.length - 1] || {}; fire('popstate', {}); }
  };
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate() {} }, configurable: true });
  globalThis.confirm = (q) => { confirms.push(q); return confirmAnswer; };
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  globalThis.Blob = class {
    constructor(parts, opts) { this.parts = parts || []; this.type = (opts || {}).type || ''; }
    get size() { return this.parts.reduce((n, x) => n + Buffer.byteLength(String(x)), 0); }
    async arrayBuffer() {
      const b = Buffer.from(this.parts.join(''));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  };
  globalThis.File = class extends globalThis.Blob {
    constructor(p, n, o) { super(p, o); this.name = n; }
  };
  globalThis.fetch = async (u) => {
    const raw = String(u);
    const real = decodeURIComponent(raw.replace('/__net/?url=', ''));
    if (/\.(jpg|jpeg|png|webp)/i.test(real)) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
               blob: async () => new globalThis.Blob(['x'], { type: 'image/jpeg' }) };
    }
    const local = raw.match(/^\/(photos|covers)\/(.+)$/);
    if (local) {
      const key = local[1] + '/' + decodeURIComponent(local[2]);
      return files.has(key)
        ? { ok: true, status: 200, arrayBuffer: async () => files.get(key).buffer,
            blob: async () => new globalThis.Blob(['x'], { type: 'image/jpeg' }) }
        : { ok: false, status: 404 };
    }
    if (/version\.json$/.test(raw)) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' },
               text: async () => '{"version":"test","code":0,"built":"2026-01-01T00:00:00Z"}',
               json: async () => ({ version: 'test', code: 0, built: '2026-01-01T00:00:00Z' }) };
    }
    if (/OFL\.txt$/.test(raw)) return { ok: true, status: 200, text: async () => 'SIL OPEN FONT LICENSE Version 1.1' };
    let url;
    try { url = new URL(real); } catch { return { ok: false, status: 400 }; }
    /* A product PAGE, which is where some shops put the canvas size, diamond
       count and colour count that never appear in the feed. Answering it here
       is what makes the lazy spec fetch testable at all. */
    const productPage = url.pathname.match(/^\/products\/([^/.]+)$/);
    if (productPage) {
      const p = feed.find((x) => x.handle === decodeURIComponent(productPage[1]));
      if (!p) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => p.specHtml || '<html></html>' };
    }
    /* One product, the way a Shopify shop answers for it. The app falls back to
       this when a catalogue row carries no picture, so the stub has to answer
       it honestly or the fallback looks broken when it works. */
    const single = url.pathname.match(/^\/products\/(.+)\.js$/);
    if (single) {
      const p = feed.find((x) => x.handle === decodeURIComponent(single[1]));
      if (!p) return { ok: false, status: 404 };
      const shots = (p.gallery || p.images || []).map((i) => (i.src || i).replace('https:', ''));
      return { ok: true, status: 200,
               json: async () => ({ handle: p.handle, featured_image: shots[0] || null, images: shots }) };
    }
    const page = Number(url.searchParams.get('page') || 1);
    if (!catalogue || url.hostname !== FEED_HOST || page > 1)
      return { ok: true, status: 200, json: async () => ({ products: [] }) };
    return { ok: true, status: 200, json: async () => ({ products: feed }) };
  };

  const fire = (type, ev) => Promise.all((listeners[type] || []).map(fn => fn(ev)));

  const store = await import('../app/local/store.js');
  await import('../app/app.js?mount=' + Date.now() + Math.random());

  const api = store.localApi;
  const app = document.getElementById('app');

  const go = async (hash) => {
    if (globalThis.location.hash === hash) await fire('hashchange', {});
    else globalThis.location.hash = hash;
    await settle();
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) { await pending; await new Promise(r => setTimeout(r, 12)); }
  };

  /* Tap something that is actually on screen. If the selector matches nothing,
     say so loudly — a test that silently taps nothing proves nothing. */
  const tap = async (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`nothing on screen matches ${selector}`);
    el.dispatchEvent({ type: 'click' });
    await settle();
    return el;
  };

  const sync = async () => {
    const { job } = await api('/catalogue/sync', { method: 'POST' });
    for (let i = 0; i < 3000; i++) {
      const j = await api('/jobs/' + job);
      if (j.state !== 'running') return j;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('the catalogue sync never finished');
  };

  const seed = (body) => api('/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  return {
    document, window: win, api, app, go, tap, settle, sync, seed, fire, files, downloads,
    html: () => document.documentElement.innerHTML,
    text: () => document.documentElement.textContent,
    screen: () => (document.getElementById('main') || app).innerHTML,
    find: (s) => document.querySelector(s),
    all: (s) => document.querySelectorAll(s),
    matches,
    setWidth: (w) => { win.innerWidth = w; },
    answerConfirms: (yes) => { confirmAnswer = yes; },
    confirms,
    toasts,
    IMAGE
  };
}

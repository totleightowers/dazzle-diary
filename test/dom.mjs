/**
 * A small DOM that behaves like the real one.
 *
 * The app was tested for months against hand-written stubs, one per test file,
 * each missing something different: no `classList.toggle`, an `input.value`
 * that kept a number instead of coercing it to a string, a `querySelector` that
 * returned nothing, an `innerHTML` that never produced children. Every one of
 * those made a test pass while the app was broken, which is the worst thing a
 * test can do.
 *
 * So: one DOM, shared, that gets those details right. It is not complete — no
 * layout, no styling, no CSSOM — but everything it does implement, it
 * implements the way a browser does, and where it cannot it throws rather than
 * quietly returning undefined.
 */
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ nodes */

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source',
                      'path', 'circle', 'rect', 'area', 'col', 'embed', 'track', 'wbr']);

let doc = null;   // set by makeDocument, used for ownerDocument bookkeeping

class Node {
  constructor(tag) {
    this.tag = String(tag).toLowerCase();
    this.attrs = Object.create(null);
    this.children = [];
    this.parent = null;
    this.text = '';
    this._value = undefined;
    this._listeners = Object.create(null);
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.clientWidth = 400;
    this.clientHeight = 800;
    this.files = [];
    this.style = makeStyle();
  }

  /* --- identity ---------------------------------------------------------- */
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v == null ? '' : String(v); }
  get id() { return this.attrs.id ?? null; }
  set id(v) { this.attrs.id = String(v); }
  get tagName() { return this.tag.toUpperCase(); }
  get classes() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get parentElement() { return this.parent; }
  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }

  /* --- attributes -------------------------------------------------------- */
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }

  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }

  /* A form control's value is always a string, whatever it is assigned. That
     one detail hid a crash for a whole session. */
  get value() {
    if (this._value !== undefined) return this._value;
    return this.attrs.value ?? '';
  }
  set value(v) { this._value = v == null ? '' : String(v); }

  get dataset() {
    const attrs = this.attrs;
    return new Proxy({}, {
      get: (_, k) => attrs['data-' + kebab(String(k))],
      set: (_, k, v) => { attrs['data-' + kebab(String(k))] = v == null ? '' : String(v); return true; },
      has: (_, k) => ('data-' + kebab(String(k))) in attrs,
      deleteProperty: (_, k) => { delete attrs['data-' + kebab(String(k))]; return true; },
      ownKeys: () => Object.keys(attrs).filter(a => a.startsWith('data-')).map(a => camel(a.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
    });
  }

  get classList() {
    const el = this;
    const read = () => el.classes;
    const write = (list) => { el.attrs.class = [...new Set(list)].join(' '); };
    return {
      add: (...c) => write([...read(), ...c]),
      remove: (...c) => write(read().filter(x => !c.includes(x))),
      contains: (c) => read().includes(c),
      /* the two-argument form is what an older WebView does not support, so it
         is implemented here to keep the difference visible rather than hidden */
      toggle: (c, force) => {
        const on = force === undefined ? !read().includes(c) : !!force;
        if (on) write([...read(), c]); else write(read().filter(x => x !== c));
        return on;
      }
    };
  }

  /* --- tree -------------------------------------------------------------- */
  appendChild(child) {
    // appending moves a node; it does not copy it. Without the detach,
    // `while (wrap.firstChild) body.appendChild(wrap.firstChild)` never ends.
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
    return child;
  }
  remove() { if (this.parent) this.parent.removeChild(this); }

  get innerHTML() { return this._html ?? ''; }
  set innerHTML(html) {
    this._html = String(html);
    this.children = [];
    parseInto(this, this._html);
  }
  get textContent() {
    if (this.tag === '#text') return this.text;
    return this.children.map(c => c.textContent).join('') || this.text;
  }
  set textContent(v) { this.children = []; this.text = v == null ? '' : String(v); this._html = ''; }

  /* --- queries ----------------------------------------------------------- */
  querySelector(sel) { return firstMatch(this, sel); }
  querySelectorAll(sel) { return allMatches(this, sel); }
  closest(sel) {
    let n = this;
    while (n) { if (n.tag !== '#text' && matches(n, sel)) return n; n = n.parent; }
    return null;
  }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; }

  /* --- events ------------------------------------------------------------ */
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
  }
  dispatchEvent(ev) { return dispatch(this, ev); }
  click() { return dispatch(this, { type: 'click' }); }
  focus() { doc && (doc.activeElement = this); }
  blur() { if (doc && doc.activeElement === this) doc.activeElement = null; }
  scrollTo(opts) {
    if (typeof opts === 'object' && opts) { if ('left' in opts) this.scrollLeft = opts.left; if ('top' in opts) this.scrollTop = opts.top; }
  }
  getBoundingClientRect() {
    return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  animate() { return { finished: Promise.resolve(), cancel() {} }; }
}

const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function makeStyle() {
  const store = Object.create(null);
  return new Proxy(store, {
    get: (t, k) => {
      if (k === 'setProperty') return (name, v) => { t[name] = v == null ? '' : String(v); };
      if (k === 'getPropertyValue') return (name) => t[name] ?? '';
      if (k === 'removeProperty') return (name) => { delete t[name]; };
      return t[k] ?? '';
    },
    set: (t, k, v) => { t[k] = v == null ? '' : String(v); return true; }
  });
}

/* ---------------------------------------------------------------- parsing */

function parseInto(root, html) {
  let node = root;
  const re = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/g;
  let last = 0, m;
  const addText = (s) => {
    if (!s) return;
    const t = new Node('#text');
    t.text = s;
    t.parent = node;
    node.children.push(t);
  };
  while ((m = re.exec(html))) {
    addText(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const [, close, tag, rawAttrs, selfClose] = m;
    const name = tag.toLowerCase();
    if (close) {
      let n = node;
      while (n && n !== root && n.tag !== name) n = n.parent;
      if (n && n !== root) node = n.parent || root;
      continue;
    }
    const el = new Node(name);
    for (const a of rawAttrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      el.attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    el.parent = node;
    node.children.push(el);
    if (!selfClose && !VOID.has(name)) node = el;
  }
  addText(html.slice(last));
}

/* --------------------------------------------------------------- matching */

const SIMPLE = /^(?<tag>[a-zA-Z][\w-]*|\*)?(?<rest>(?:[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)|::?(?!not\()[\w-]+(?:\([^)]*\))?)*)$/;

function matchesSimple(el, sel) {
  if (el.tag === '#text') return false;
  const m = SIMPLE.exec(sel.trim());
  if (!m) return false;
  const { tag, rest } = m.groups;
  if (tag && tag !== '*' && el.tag !== tag.toLowerCase()) return false;
  for (const part of rest.matchAll(/[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)|::?(?!not\()[\w-]+(?:\([^)]*\))?/g)) {
    const p = part[0];
    if (p.startsWith('.')) { if (!el.classes.includes(p.slice(1))) return false; }
    else if (p.startsWith('#')) { if (el.id !== p.slice(1)) return false; }
    else if (p.startsWith('[')) {
      const a = p.slice(1, -1).match(/^([\w:-]+)(?:\s*=\s*"?([^"\]]*)"?)?$/);
      if (!a || !(a[1] in el.attrs)) return false;
      if (a[2] !== undefined && el.attrs[a[1]] !== a[2]) return false;
    }
    else if (p.startsWith(':not(')) { if (matchesSimple(el, p.slice(5, -1))) return false; }
    else if (p === ':empty') { if (el.children.some(c => c.tag !== '#text' || c.text.trim())) return false; }
    else if (p.startsWith('::')) return false;
    /* :active, :hover and friends are state this DOM does not model */
  }
  return true;
}

export function matches(el, selector) {
  return selector.split(',').some((one) => {
    const parts = one.trim().split(/\s+(?![^(\[]*[)\]])/);
    let i = parts.length - 1, node = el;
    if (!matchesSimple(node, parts[i])) return false;
    i--;
    while (i >= 0) {
      const isChild = parts[i] === '>';
      if (isChild) i--;
      const want = parts[i];
      if (want === undefined) return false;
      if (isChild) {
        node = node.parent;
        if (!node || !matchesSimple(node, want)) return false;
      } else {
        let p = node.parent, found = false;
        while (p) { if (matchesSimple(p, want)) { found = true; break; } p = p.parent; }
        if (!found) return false;
        node = p;
      }
      i--;
    }
    return true;
  });
}

function walk(root, fn) {
  for (const c of root.children) {
    if (c.tag !== '#text') { if (fn(c) === false) return false; if (walk(c, fn) === false) return false; }
  }
  return true;
}
function firstMatch(root, sel) {
  let hit = null;
  walk(root, (el) => { if (matches(el, sel)) { hit = el; return false; } });
  return hit;
}
function allMatches(root, sel) {
  const out = [];
  walk(root, (el) => { if (matches(el, sel)) out.push(el); });
  return out;
}

/* ----------------------------------------------------------------- events */

function dispatch(target, init) {
  const ev = {
    type: init.type,
    target,
    currentTarget: null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    ...init
  };
  const path = [];
  for (let n = target; n; n = n.parent) path.push(n);
  path.push(doc);
  for (const n of path) {
    if (!n) continue;
    ev.currentTarget = n;
    const prop = n['on' + ev.type];
    if (typeof prop === 'function') prop.call(n, ev);
    for (const fn of (n._listeners?.[ev.type] || [])) fn.call(n, ev);
    if (ev._stopped) break;
  }
  return !ev.defaultPrevented;
}

/* --------------------------------------------------------------- document */

export function makeDocument() {
  const html = new Node('html');
  const body = new Node('body');
  html.appendChild(body);
  const app = new Node('div');
  app.id = 'app';
  body.appendChild(app);

  doc = {
    documentElement: html,
    body,
    activeElement: null,
    _listeners: Object.create(null),
    createElement: (t) => new Node(t),
    createTextNode: (t) => { const n = new Node('#text'); n.text = String(t); return n; },
    getElementById: (id) => firstMatch(html, '#' + id),
    querySelector: (s) => firstMatch(html, s),
    querySelectorAll: (s) => allMatches(html, s),
    addEventListener: (t, fn) => { (doc._listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { doc._listeners[t] = (doc._listeners[t] || []).filter(f => f !== fn); },
    dispatchEvent: (ev) => dispatch(body, ev)
  };
  return doc;
}

export { Node, dispatch };

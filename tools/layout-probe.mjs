/**
 * What does the stylesheet actually do at a given width?
 *
 * There is no browser on the machine this is developed on, so the layout could
 * only be checked by asking someone for a screenshot — which is a slow loop,
 * and a misleading one: a scrolling screenshot is stitched from several frames
 * and its measurements do not agree with each other.
 *
 * This resolves the cascade instead. It is not a renderer and does not lay
 * anything out; it answers the question that kept being guessed at: at this
 * viewport width, which rules win for this element, and what do the properties
 * that decide the layout come out as?
 *
 *   node tools/layout-probe.mjs            # the usual widths
 *   node tools/layout-probe.mjs 938 1180   # specific ones
 */
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');

/* ----------------------------------------------------------------- parsing */

/** Rules, in source order, each tagged with the media width it needs. */
function parseCss(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /* Scans the text it is given, not the whole stylesheet. Reading from the
     outer string while parsing the inside of an @media block silently dropped
     every rule in it — which made the tool answer confidently and wrongly. */
  const readBlock = (text, from) => {           // returns [body, endIndex]
    let depth = 0, j = from;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (!depth) break; }
    }
    return [text.slice(from + 1, j), j + 1];
  };
  const rules = (text, minWidth) => {
    let k = 0;
    while (k < text.length) {
      const brace = text.indexOf('{', k);
      if (brace < 0) break;
      const selector = text.slice(k, brace).trim();
      const [body, end] = readBlock(text, brace);
      if (selector.startsWith('@media')) {
        const m = selector.match(/min-width:\s*(\d+)px/);
        rules(body, m ? Math.max(minWidth, Number(m[1])) : Infinity);
      } else if (selector.startsWith('@')) {
        /* keyframes and the like decide nothing here */
      } else {
        const decls = {};
        for (const part of body.split(';')) {
          const c = part.indexOf(':');
          if (c < 0) continue;
          const prop = part.slice(0, c).trim();
          let val = part.slice(c + 1).trim();
          const bang = /!important$/.test(val);
          if (bang) val = val.replace(/!important$/, '').trim();
          if (prop) decls[prop] = { val, important: bang };
        }
        for (const sel of selector.split(',')) out.push({ sel: sel.trim(), decls, minWidth });
      }
      k = end;
    }
  };
  rules(src, 0);
  return out;
}

/** The markup the app produces, as a tree. Good enough for generated HTML. */
export function parseHtml(html) {
  const root = { tag: 'root', attrs: {}, children: [], parent: null, id: null, classes: [] };
  let node = root;
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect']);
  const re = /<(\/)?([a-zA-Z][\w-]*)([^>]*?)(\/)?>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) { if (node.parent && node.tag === tag) node = node.parent; continue; }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = { tag, attrs, children: [], parent: node,
                 id: attrs.id || null,
                 classes: (attrs.class || '').split(/\s+/).filter(Boolean) };
    node.children.push(el);
    if (!selfClose && !VOID.has(tag)) node = el;
  }
  return root;
}

/* ---------------------------------------------------------------- matching */

const SIMPLE = /^(?<tag>[a-zA-Z][\w-]*)?(?<rest>(?:[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)|::?(?!not\()[\w-]+(?:\([^)]*\))?)*)$/;

function matchesSimple(el, sel) {
  const m = SIMPLE.exec(sel);
  if (!m) return false;
  const { tag, rest } = m.groups;
  if (tag && tag !== '*' && el.tag !== tag) return false;
  for (const part of rest.matchAll(/[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)|::?[\w-]+(?:\([^)]*\))?/g)) {
    const p = part[0];
    if (p.startsWith('.')) { if (!el.classes.includes(p.slice(1))) return false; }
    else if (p.startsWith('#')) { if (el.id !== p.slice(1)) return false; }
    else if (p.startsWith('[')) {
      const a = p.slice(1, -1).match(/^([\w-]+)(?:\s*=\s*"?([^"\]]*)"?)?$/);
      if (!a) return false;
      if (!(a[1] in el.attrs)) return false;
      if (a[2] !== undefined && el.attrs[a[1]] !== a[2]) return false;
    }
    else if (p.startsWith(':not(')) {
      if (matchesSimple(el, p.slice(5, -1).trim())) return false;
    }
    else if (p.startsWith('::')) return false;      // pseudo-elements are not this element
    /* other pseudo-classes (:active, :empty, …) are state we do not model */
    else if (!/^:(root|first-child|last-child)$/.test(p)) return false;
  }
  return true;
}

function matches(el, selector) {
  const parts = selector.trim().split(/\s+(?![^(]*\))/);
  let i = parts.length - 1, node = el;
  if (!matchesSimple(node, parts[i])) return false;
  i--;
  while (i >= 0) {
    const combinator = parts[i] === '>' ? '>' : ' ';
    if (combinator === '>') i--;
    const want = parts[i];
    if (want === undefined) return false;
    if (combinator === '>') {
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
}

const specificity = (sel) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const typ = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + cls * 100 + typ;
};

/** Everything that applies to one element at one viewport width. */
export function computed(el, width, rules) {
  const winners = {};
  rules.forEach((r, order) => {
    if (width < r.minWidth) return;
    if (!matches(el, r.sel)) return;
    const spec = specificity(r.sel);
    for (const [prop, d] of Object.entries(r.decls)) {
      const prev = winners[prop];
      const better = !prev
        || (d.important && !prev.important)
        || (d.important === prev.important && (spec > prev.spec || (spec === prev.spec && order > prev.order)));
      if (better) winners[prop] = { ...d, spec, order, sel: r.sel };
    }
  });
  const inline = el.attrs.style || '';
  for (const part of inline.split(';')) {
    const c = part.indexOf(':');
    if (c < 0) continue;
    const prop = part.slice(0, c).trim();
    if (!prop) continue;
    const cur = winners[prop];
    if (!cur || !cur.important) winners[prop] = { val: part.slice(c + 1).trim(), sel: '(inline)' };
  }
  return winners;
}

export const rulesFor = (css = CSS) => parseCss(css);

/** Find the first element matching a selector, depth first. */
export function find(root, selector) {
  const stack = [...root.children];
  while (stack.length) {
    const el = stack.shift();
    if (matches(el, selector)) return el;
    stack.unshift(...el.children);
  }
  return null;
}

/** Every element matching, in document order. */
export function findAll(root, selector) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (matches(c, selector)) out.push(c); walk(c); } };
  walk(root);
  return out;
}

export { CSS };

/* What the colour lists say about a stash, taken together.
 *
 * Each kit's list is a set of drills — a DMC code, DMC's name for it, the
 * colour, and for a specialty diamond what kind it is. Laid side by side they
 * answer questions no single kit can: which drills turn up in nearly
 * everything, which only ever in one canvas, which two kits could share their
 * leftovers, and what colour the whole stash leans towards.
 *
 * A drill is its code AND its finish. 105 as a plain drill and 105 as an
 * aurora borealis one are different things in different bags, so they are
 * counted apart; a list from a DAC account, which writes the AB drill as
 * "AB105", keeps its own spelling and is simply another code.
 *
 * Pure: no storage, no DOM. Given the kits, it returns plain data.
 */

const HEX = /^#?([0-9a-f]{6})$/i;

function rgb(hex) {
  const m = HEX.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How light a colour looks, 0 for black to 100 for white. This is the
    relative luminance a screen uses, so a yellow reads lighter than a blue of
    the same strength, which is how the eye sees them too. */
export function lightness(hex) {
  const c = rgb(hex);
  if (!c) return null;
  const lin = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  // luminance is not linear to the eye; CIE lightness is, near enough
  const l = y <= 216 / 24389 ? y * (24389 / 27) : 116 * Math.cbrt(y) - 16;
  return Math.round(l * 10) / 10;
}

/* The families a colour is put in. Kept deliberately coarse, because the
   question is "what does my stash lean towards", not colour science:
     - anything with hardly any colour in it is a black, a grey or a white,
       by how light it is;
     - a dark orange is a brown, and a pale, soft one a tan — skin, sand,
       parchment — which is how a drill bag of each looks;
     - a light red is a pink;
     - the rest go by where they sit on the colour wheel. */
export const FAMILIES = ['reds', 'pinks', 'oranges', 'browns', 'tans', 'yellows', 'greens', 'blues',
                         'purples', 'blacks', 'greys', 'whites'];

/* One colour to draw each family with, so a bar of them reads at a glance. */
export const FAMILY_SWATCH = {
  reds: '#c62828', pinks: '#ec79a8', oranges: '#ef8a2b', browns: '#7a4a2a', tans: '#d8b48a', yellows: '#f2cf3c',
  greens: '#4f9a4a', blues: '#3a6fc4', purples: '#7d52a8', blacks: '#1b1b1b', greys: '#8c8c8c',
  whites: '#f4f1ea'
};

export function family(hex) {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15 || d < 0.08) return l < 0.18 ? 'blacks' : l > 0.88 ? 'whites' : 'greys';
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  if (h >= 15 && h < 50 && l < 0.45) return 'browns';
  if (h >= 15 && h < 50 && l >= 0.6 && s < 0.75) return 'tans';
  if ((h < 15 || h >= 345) && l > 0.7) return 'pinks';
  if (h < 15 || h >= 345) return 'reds';
  if (h < 45) return 'oranges';
  if (h < 70) return 'yellows';
  if (h < 165) return 'greens';
  if (h < 255) return 'blues';
  if (h < 300) return 'purples';
  return 'pinks';
}

const keyOf = (c) => c.code + '|' + (c.finish || '');
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true })
  || String(a.finish || '').localeCompare(String(b.finish || ''));

/**
 * kits: [{ id, title, shop, variant, colours: [{ code, name, hex, finish }] }]
 *       — only kits that have a colour list; the caller leaves the rest out.
 * Returns everything the summary shows about colour, or null with no kits.
 */
export function colourStats(kits, { top = 8, sample = 6 } = {}) {
  const list = (kits || []).filter((k) => k && Array.isArray(k.colours) && k.colours.length);
  if (!list.length) return null;

  // every drill, and the kits it is in
  const drills = new Map();
  for (const k of list) {
    const seen = new Set();
    for (const c of k.colours) {
      const key = keyOf(c);
      if (seen.has(key)) continue;            // a list that names a drill twice holds it once
      seen.add(key);
      const d = drills.get(key) || { code: c.code, name: c.name || null, hex: c.hex || null,
                                      finish: c.finish || null, kits: [] };
      if (!d.name && c.name) d.name = c.name;
      if (!d.hex && c.hex) d.hex = c.hex;
      d.kits.push(k);
      drills.set(key, d);
    }
  }
  const all = [...drills.values()];
  const brief = (d) => ({ code: d.code, name: d.name, hex: d.hex, finish: d.finish, kits: d.kits.length });
  const kitRef = (k) => ({ id: k.id, title: k.title, shop: k.shop || null });

  /* The staples: most kits first, and among equals the lower code, so the
     same stash always gives the same list. */
  const common = all.slice().sort((a, b) => b.kits.length - a.kits.length || byCode(a, b))
    .filter((d) => d.kits.length > 1).slice(0, top).map(brief);

  /* One-offs: a drill only one of your kits uses. Their leftovers are the
     ones nothing else will ever call for. */
  const single = all.filter((d) => d.kits.length === 1).sort(byCode);
  const oneOffs = {
    count: single.length,
    sample: single.slice(0, sample).map((d) => ({ ...brief(d), kit: kitRef(d.kits[0]) }))
  };
  const onlyHere = new Map();
  for (const d of single) onlyHere.set(d.kits[0], (onlyHere.get(d.kits[0]) || 0) + 1);

  const pick = (value, better) => {
    let best = null;
    for (const k of list) {
      const v = value(k);
      if (v == null || !Number.isFinite(v)) continue;
      if (!best || better(v, best.value)) best = { ...kitRef(k), value: v };
    }
    return best;
  };
  const size = (k) => new Set(k.colours.map(keyOf)).size;
  const special = (k) => { const n = new Set(k.colours.filter((c) => c.finish).map(keyOf)).size; return n || null; };

  /* How light a palette is: the average over the drills whose colour is
     known. A list where fewer than half have one is not worth ranking. */
  const bright = (k) => {
    const ls = k.colours.map((c) => lightness(c.hex)).filter((v) => v != null);
    if (!ls.length || ls.length < k.colours.length / 2) return null;
    return Math.round(ls.reduce((n, v) => n + v, 0) / ls.length);
  };

  /* Palette twins: the two kits that share the most drills — the pair whose
     spare bags are most use to each other. Two copies of one kit are the same
     list, so they are not a pair worth naming. */
  let twins = null;
  const sets = list.map((k) => ({ k, s: new Set(k.colours.map(keyOf)) }));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i], b = sets[j];
      if (a.k.variant && a.k.variant === b.k.variant) continue;
      let shared = 0;
      for (const x of a.s) if (b.s.has(x)) shared++;
      if (shared && (!twins || shared > twins.shared))
        twins = { a: kitRef(a.k), b: kitRef(b.k), shared };
    }
  }

  // the specialty diamonds, in DAC's own words, most first
  const finishes = Object.entries(all.filter((d) => d.finish).reduce((acc, d) => {
    acc[d.finish] = (acc[d.finish] || 0) + 1; return acc;
  }, {})).map(([finish, n]) => ({ finish, n })).sort((a, b) => b.n - a.n || a.finish.localeCompare(b.finish));

  /* What the stash leans towards: every drill in every kit counted once per
     kit, so a colour that turns up everywhere weighs more than a one-off —
     which is what a shelf of drill bags looks like. */
  const fam = {};
  let known = 0;
  for (const k of list) {
    for (const c of k.colours) {
      const f = family(c.hex);
      if (!f) continue;
      fam[f] = (fam[f] || 0) + 1; known++;
    }
  }
  const families = known < 20 ? [] : Object.entries(fam)
    .map(([name, n]) => ({ family: name, n, share: Math.round(n / known * 1000) / 10 }))
    .sort((a, b) => b.n - a.n || FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family));

  return {
    kits: list.length,
    distinct: all.length,
    common, oneOffs,
    mostColours: pick(size, (a, b) => a > b),
    fewestColours: pick(size, (a, b) => a < b),
    mostSpecial: pick(special, (a, b) => a > b),
    mostOneOffs: pick((k) => onlyHere.get(k) || null, (a, b) => a > b),
    brightest: pick(bright, (a, b) => a > b),
    darkest: pick(bright, (a, b) => a < b),
    twins, finishes, families
  };
}

/** How many different drills a set of kits holds, counted the same way. */
export function distinctDrills(kits) {
  const s = new Set();
  for (const k of kits || []) for (const c of (k && k.colours) || []) s.add(keyOf(c));
  return s.size;
}

/**
 * Title matching and order reconciliation.
 *
 * Pure logic: everything it needs from the catalogue arrives through a small
 * `cat` interface, so the server can back it with SQLite and the phone app can
 * back it with an in-memory index. No storage assumptions live here.
 *
 *   cat.byTitle(normTitle)   -> rows with exactly that normalised title
 *   cat.byPrefix(normTitle)  -> rows whose title STARTS WITH it (all of them)
 */

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();

export const cmFromIn = (inches) =>
  inches == null ? null : Math.round(inches * 2.54 * 100) / 100;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One order's comma-split fragments back into products.
 *
 * A title containing a comma arrives as two fragments, so prefer the LONGEST
 * join that the catalogue recognises — "Frejya" + "Goddess of Beauty & War"
 * is one product, not two.
 */
export function resolveFragments(cat, fragments) {
  const out = [];
  let i = 0;
  while (i < fragments.length) {
    let best = null;
    for (let take = Math.min(3, fragments.length - i); take >= 1; take--) {
      const joined = fragments.slice(i, i + take).join(', ');
      const hits = cat.byTitle(norm(joined));
      if (hits.length) { best = { take, title: joined, candidates: hits }; break; }
    }
    if (best) {
      // An exact title match does not mean there is nothing else it could be:
      // "Starry Night" matches two products exactly, but the one actually
      // bought was "Starry Night - Night Music". Collect those variants too so
      // they can be offered — kept separate from `candidates` so they do not
      // multiply out the price-fit search.
      const variants = (cat.byPrefix(norm(best.title)) || [])
        .filter(v => !best.candidates.some(c => c.handle === v.handle && c.shop === v.shop));
      out.push({ title: best.title, candidates: best.candidates, variants,
                 product: best.candidates[0], matched: true });
      i += best.take;
    } else {
      // Shops rename and sub-divide things: "Old Masters" became "Old Masters -
      // MEGA Dazzles", and a bare "Mini Dazzles" line could be any of 67
      // variants. Keep every prefix match as a candidate — picking the shortest
      // silently was how "Mini Dazzles" became "UP" instead of "Star Wars".
      const frag = fragments[i];
      const loose = cat.byPrefix(norm(frag)) || [];
      out.push({ title: frag, candidates: loose, variants: [], product: loose[0] || null,
                 matched: loose.length > 0, loose: loose.length > 0 });
      i += 1;
    }
  }
  return out;
}

/**
 * Titles are not unique — one shop sells four different "Alice in Wonderland"
 * canvases. The CSV only gives a title, so score every combination of
 * candidates against what the order actually charged (accessories included,
 * which is why they stay in the catalogue) and take the closest. Only trust it
 * when it wins clearly; otherwise say so rather than inventing an artist.
 */
const DECISIVE_MARGIN = 4;   // £ the runner-up must lose by
const SANE_ORDER_GAP = 20;   // £ the winner may be off before we distrust it

export function disambiguate(resolved, orderTotal) {
  const slots = resolved.map(r => (r.candidates && r.candidates.length ? r.candidates : [r.product]));
  if (!slots.some(c => c.length > 1)) return { chosen: slots.map(c => c[0]), confident: true };
  if (orderTotal == null) return { chosen: slots.map(c => c[0]), confident: false };

  let combos = 1;
  for (const c of slots) combos *= Math.max(1, c.length);
  if (combos > 4096) return { chosen: slots.map(c => c[0]), confident: false };

  const scored = [];
  for (let n = 0; n < combos; n++) {
    let k = n, pick = [], sum = 0, priced = true;
    for (const c of slots) {
      const sp = Math.max(1, c.length), item = c[k % sp];
      pick.push(item); k = Math.floor(k / sp);
      if (!item || item.price == null) priced = false; else sum += item.price;
    }
    if (priced) scored.push({ pick, diff: Math.abs(sum - orderTotal) });
  }
  if (!scored.length) return { chosen: slots.map(c => c[0]), confident: false };
  scored.sort((a, b) => a.diff - b.diff);

  const best = scored[0];
  const runnerUp = scored.find(s => s.pick.some((p, i) => p !== best.pick[i]));
  const decisive = !runnerUp || runnerUp.diff - best.diff >= DECISIVE_MARGIN;
  return { chosen: best.pick, confident: decisive && best.diff <= SANE_ORDER_GAP, gap: round2(best.diff) };
}

export { round2 };

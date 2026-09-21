/* What a drill code says about itself.
 *
 * A legend from Diamond Art Club is bare codes: "310", "AB972", "Z743",
 * "ECRU". The number is the DMC colour; a letter in front is the kind of
 * drill rather than the colour — AB is aurora borealis, and DAC uses a
 * handful of other letters for its special finishes. Which finish a letter
 * means is DAC's business and is not guessed at here: a code that is not
 * plain and not AB is simply a special, and its own letter is kept so it can
 * be shown as DAC writes it.
 */

export function drillKind(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return 'plain';
  if (/^AB/.test(c)) return 'ab';
  return /^[A-Z]/.test(c) && c !== 'ECRU' && c !== 'BLANC' && c !== 'NOIR' ? 'special' : 'plain';
}

export const KIND_LABEL = { plain: 'Standard', ab: 'Aurora borealis', special: 'Special finish' };

/** The letters DAC puts in front, for a code that carries one. */
export function drillPrefix(code) {
  const m = String(code || '').trim().toUpperCase().match(/^[A-Z]+/);
  return m && drillKind(code) !== 'plain' ? m[0] : null;
}

/* A legend is easier to read in DAC's own order: the plain colours by number,
   then the AB drills, then the rest. */
const RANK = { plain: 0, ab: 1, special: 2 };
export function byDrill(a, b) {
  const x = drillKind(a.code || a), y = drillKind(b.code || b);
  if (RANK[x] !== RANK[y]) return RANK[x] - RANK[y];
  return String(a.code || a).localeCompare(String(b.code || b), 'en', { numeric: true });
}

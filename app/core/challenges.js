/**
 * Challenges: which kits a challenge is about, and where each one stands in it.
 *
 * A challenge is three things. A RULE picks kits out of the stash — conditions
 * gathered into groups, each group "all of these" or "any of these", the groups
 * joined by AND or OR — plus any kits picked by hand, for the challenges no
 * field can describe (a theme, a host's list). A REQUIREMENT says what has to
 * happen to a kit inside the challenge's dates for it to count. And the dates.
 *
 * Nothing is stored on a kit. Where a kit stands is worked out each time from
 * what the logbook already holds — its start and completion dates, its sessions
 * and its progress entries — so it cannot drift from them, and changing a date
 * on the kit changes the challenge with it.
 *
 * Three places a kit can be:
 *   eligible  it qualifies, and has not yet done what the challenge asks
 *   going     it has done it, or is on the way, and is not finished
 *   done      it is finished, and met the requirement on the way
 * "Done" always means the painting is finished. A drills-down challenge is met
 * the day diamonds go down, but the kit sits under "going" until the day it is
 * completed, however long after the dates that turns out to be.
 */

/** What a condition can ask about. `list` picks values; `num` compares a number. */
export const FIELDS = {
  artist:  { label: 'Artist', kind: 'list' },
  title:   { label: 'Title', kind: 'list' },
  shop:    { label: 'Shop', kind: 'list' },
  shape:   { label: 'Drill shape', kind: 'list' },
  size:    { label: 'Canvas length + width', kind: 'num', unit: 'cm', step: 10, start: 200, op: 'min' },
  drills:  { label: 'Diamond count', kind: 'num', unit: '', step: 10000, start: 50000, op: 'min' },
  colours: { label: 'Colour count', kind: 'num', unit: '', step: 5, start: 40, op: 'min' },
  rating:  { label: 'Rating', kind: 'num', unit: '', step: 1, start: 4, op: 'min', max: 5 },
  artistOwned:    { label: 'Artist’s kits I own', kind: 'num', unit: '', step: 1, start: 4, op: 'min' },
  artistFinished: { label: 'Artist’s kits I’ve finished', kind: 'num', unit: '', step: 1, start: 0, op: 'max' }
};

/** What has to happen inside the dates. */
export const REQUIREMENTS = [
  { k: 'both',   label: 'Start and finish in the dates' },
  { k: 'finish', label: 'Finish in the dates' },
  { k: 'start',  label: 'Start in the dates' },
  { k: 'drills', label: 'Drills down in the dates' }
];
const REQ_KEYS = REQUIREMENTS.map((r) => r.k);

export const SECTIONS = [
  { k: 'eligible', label: 'Eligible' },
  { k: 'going',    label: 'In progress' },
  { k: 'done',     label: 'Completed' }
];

const key = (s) => String(s ?? '').trim().toLowerCase();
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const CM = 2.54;

/** A new, empty challenge: every owned kit, finished inside dates not yet chosen. */
export const blank = () => ({
  name: '', from: '', to: '', req: 'finish', join: 'any',
  groups: [{ mode: 'all', conds: [] }], picks: []
});

/** A condition as it starts out when its field is first chosen. */
export function freshCondition(field) {
  const F = FIELDS[field];
  if (!F) return null;
  return F.kind === 'list' ? { f: field, not: false, vals: [] } : { f: field, op: F.op, n: F.start };
}

/**
 * Whatever arrives — a form, a backup from an older build, a hand-edited file —
 * comes out as a challenge every other function here can trust. Anything it
 * does not recognise is dropped rather than guessed at.
 */
export function normalise(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const groups = (Array.isArray(c.groups) ? c.groups : []).map((g) => ({
    mode: g && g.mode === 'any' ? 'any' : 'all',
    conds: (Array.isArray(g && g.conds) ? g.conds : []).map((x) => {
      const F = x && FIELDS[x.f];
      if (!F) return null;
      if (F.kind === 'list') {
        const vals = [...new Set((Array.isArray(x.vals) ? x.vals : [])
          .map((v) => String(v ?? '').trim()).filter(Boolean))];
        return { f: x.f, not: !!x.not, vals };
      }
      let n = Math.max(0, Math.round(Number(x.n) || 0));
      if (F.max != null) n = Math.min(F.max, n);
      return { f: x.f, op: x.op === 'max' ? 'max' : 'min', n };
    }).filter(Boolean)
  }));
  const from = isDate(c.from) ? c.from : '';
  let to = isDate(c.to) ? c.to : '';
  if (from && to && to < from) to = from;
  return {
    name: String(c.name ?? '').trim().slice(0, 80),
    from, to,
    req: REQ_KEYS.includes(c.req) ? c.req : 'finish',
    join: c.join === 'all' ? 'all' : 'any',
    groups: groups.length ? groups : [{ mode: 'all', conds: [] }],
    picks: [...new Set((Array.isArray(c.picks) ? c.picks : []).map(Number).filter(Number.isFinite))]
  };
}

/* A kit on the wish list is not owned, so it is in no challenge. */
const owned = (p) => p.status !== 'wishlist';
const finished = (p) => p.status === 'completed';
const begun = (p) => !!p.date_started || ['started', 'onHold', 'completed'].includes(p.status);

/**
 * What each artist's shelf looked like when the challenge began. "An artist I
 * have never finished" has to be asked as of the start date: asked today, the
 * first finish would make the artist stop qualifying, and the challenge would
 * drop them the moment it was met.
 */
function artistStats(projects, from) {
  const stats = new Map();
  for (const p of projects) {
    const k = key(p.artist);
    if (!k || !owned(p)) continue;
    const a = stats.get(k) || { owned: 0, finished: 0 };
    a.owned++;
    if (finished(p) && (!from || !p.date_completed || p.date_completed < from)) a.finished++;
    stats.set(k, a);
  }
  return stats;
}

function numberFor(field, p, stats) {
  if (field === 'size') return p.width_in && p.height_in ? (Number(p.width_in) + Number(p.height_in)) * CM : null;
  if (field === 'drills') return p.drills ? Number(p.drills) : null;
  if (field === 'colours') return p.colors ? Number(p.colors) : null;
  if (field === 'rating') return Number(p.rating) || 0;
  const a = stats.get(key(p.artist)) || { owned: 0, finished: 0 };
  return field === 'artistOwned' ? a.owned : a.finished;
}

function holds(cond, p, stats) {
  const F = FIELDS[cond.f];
  if (F.kind === 'list') {
    if (!cond.vals.length) return true;           // not filled in yet: it rules nothing out
    const mine = key(p[cond.f]);
    const hit = cond.vals.some((v) => key(v) === mine);
    return cond.not ? !hit : hit;
  }
  const v = numberFor(cond.f, p, stats);
  if (v == null) return false;                    // a kit with no size cannot be "at least 200 cm"
  /* Half a centimetre of grace: sizes are kept in inches, and 100 cm + 100 cm
     comes back from them as 199.9. */
  return cond.op === 'min' ? v >= cond.n - 0.5 : v <= cond.n + 0.5;
}

/** Does the rule, leaving hand-picks aside, describe this kit? */
function ruleMatches(c, p, stats) {
  const live = c.groups.filter((g) => g.conds.length);
  /* No conditions at all means every owned kit — unless kits were picked by
     hand, in which case the picks are the whole challenge. */
  if (!live.length) return !c.picks.length;
  const each = live.map((g) => g.mode === 'all'
    ? g.conds.every((x) => holds(x, p, stats))
    : g.conds.some((x) => holds(x, p, stats)));
  return c.join === 'all' ? each.every(Boolean) : each.some(Boolean);
}

/**
 * Every day diamonds went down on each kit: the days of its sessions, the days
 * its progress went up, and the days it was started and completed — nobody
 * starts or finishes a painting without placing a drill.
 */
export function activityDays(projects, sessions = [], progress = []) {
  const days = new Map(projects.map((p) => [p.id, new Set()]));
  const add = (id, d) => { if (isDate(d) && days.has(id)) days.get(id).add(d); };
  for (const p of projects) { add(p.id, p.date_started); add(p.id, p.date_completed); }
  for (const s of sessions) if (Number(s.minutes) > 0) add(s.project_id, s.on);
  for (const h of progress) {
    if (Number(h.to) > Number(h.from)) add(h.project_id, h.on || String(h.at || '').slice(0, 10));
  }
  return days;
}

/**
 * Sort the stash into the challenge's three sections.
 * Returns { eligible, going, done }, each a list of projects.
 */
export function evaluate(challenge, projects, activity = new Map()) {
  const c = normalise(challenge);
  const inDates = (d) => isDate(d) && (!c.from || d >= c.from) && (!c.to || d <= c.to);
  const stats = artistStats(projects, c.from);
  const picked = new Set(c.picks);
  const out = { eligible: [], going: [], done: [] };

  for (const p of projects) {
    if (!owned(p)) continue;
    if (!picked.has(p.id) && !ruleMatches(c, p, stats)) continue;
    const fin = finished(p);
    // given up on: not something still to do, and not something done
    if (p.status === 'abandoned') continue;
    const startedIn = inDates(p.date_started);
    const finishedIn = fin && (inDates(p.date_completed) || (!p.date_completed && !c.from && !c.to));
    const drilledIn = [...(activity.get(p.id) || [])].some(inDates);

    let where = null;
    if (c.req === 'drills') where = drilledIn ? (fin ? 'done' : 'going') : (fin ? null : 'eligible');
    else if (c.req === 'start') where = startedIn ? (fin ? 'done' : 'going') : (fin || begun(p) ? null : 'eligible');
    else if (c.req === 'finish') where = fin ? (finishedIn ? 'done' : null) : (begun(p) ? 'going' : 'eligible');
    else where = fin ? (startedIn && finishedIn ? 'done' : null)
                     : (begun(p) ? (startedIn ? 'going' : null) : 'eligible');
    if (where) out[where].push(p);
  }
  return out;
}

/** One condition in plain words. `name` turns a stored value into what to show for it. */
export function conditionText(cond, name = (_f, v) => v) {
  const F = FIELDS[cond.f];
  if (!F) return '';
  if (F.kind === 'list') {
    if (!cond.vals.length) return `${F.label}: choose…`;
    return `${F.label} ${cond.not ? 'is not' : 'is'} ${cond.vals.map((v) => name(cond.f, v)).join(' or ')}`;
  }
  const word = cond.op === 'min' ? 'at least' : 'at most';
  if (cond.f === 'artistFinished') {
    return cond.op === 'max' && cond.n === 0 ? 'Artist has none finished' : `Artist has ${word} ${cond.n} finished`;
  }
  if (cond.f === 'artistOwned') return `Artist has ${word} ${cond.n} kits owned`;
  if (cond.f === 'size') return `Length + width is ${word} ${cond.n} cm`;
  if (cond.f === 'rating') return `Rating is ${word} ${cond.n}`;
  return `${F.label} is ${word} ${cond.n.toLocaleString('en-GB')}`;
}

/** The whole rule read back as a sentence, so a tapped-together rule can be checked. */
export function describe(challenge, name) {
  const c = normalise(challenge);
  const live = c.groups.filter((g) => g.conds.length);
  const parts = live.map((g) => {
    const t = g.conds.map((x) => conditionText(x, name)).join(g.mode === 'all' ? ' and ' : ' or ');
    return live.length > 1 && g.conds.length > 1 ? `(${t})` : t;
  });
  let s = parts.length ? 'Owned kits where ' + parts.join(c.join === 'all' ? ' AND ' : ' OR ')
        : (c.picks.length ? '' : 'Every kit you own');
  if (c.picks.length) s += `${s ? ', plus ' : ''}${c.picks.length} picked by hand`;
  return s + '.';
}

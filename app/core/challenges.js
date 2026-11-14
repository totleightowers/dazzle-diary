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

/**
 * What a condition can ask about.
 *   list  picks values                       artist is A or B
 *   num   compares a number                  at least 200 cm
 *   date  compares the day a kit was bought  bought before 1 Jan 2024
 *   rank  places a kit within the stash      among the oldest 25%
 * `top` and `bottom` name the two ends a rank can be taken from.
 */
export const FIELDS = {
  artist:  { label: 'Artist', kind: 'list' },
  title:   { label: 'Title', kind: 'list' },
  shop:    { label: 'Shop', kind: 'list' },
  shape:   { label: 'Drill shape', kind: 'list' },
  size:    { label: 'Canvas length + width', kind: 'num', unit: 'cm', step: 10, start: 200, op: 'min' },
  drills:  { label: 'Diamond count', kind: 'num', unit: '', step: 10000, start: 50000, op: 'min' },
  colours: { label: 'Colour count', kind: 'num', unit: '', step: 5, start: 40, op: 'min' },
  rating:  { label: 'Rating', kind: 'num', unit: '', step: 1, start: 4, op: 'min', max: 5 },
  bought:   { label: 'Bought', kind: 'date' },
  rankAge:  { label: 'Oldest or newest in the stash', kind: 'rank', top: 'oldest', bottom: 'newest' },
  rankSize: { label: 'Largest or smallest in the stash', kind: 'rank', top: 'largest', bottom: 'smallest' },
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
const bought = (p) => (isDate(p.date_ordered) ? p.date_ordered : isDate(p.date_received) ? p.date_received : null);
const dayText = (d) => new Date(d + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const safeLink = (s) => {
  const t = String(s ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(t) ? t.slice(0, 500) : '';
};

/** A new, empty challenge: every owned kit, finished inside dates not yet chosen. */
export const blank = () => ({
  name: '', from: '', to: '', req: 'finish', join: 'any',
  groups: [{ mode: 'all', conds: [] }], picks: [], notes: '', link: ''
});

/** A condition as it starts out when its field is first chosen. */
export function freshCondition(field) {
  const F = FIELDS[field];
  if (!F) return null;
  if (F.kind === 'list') return { f: field, not: false, vals: [] };
  if (F.kind === 'date') return { f: field, op: 'before', d: '' };
  if (F.kind === 'rank') return { f: field, op: 'top', n: 25, unit: 'pct' };
  return { f: field, op: F.op, n: F.start };
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
      if (F.kind === 'date') return { f: x.f, op: x.op === 'after' ? 'after' : 'before', d: isDate(x.d) ? x.d : '' };
      if (F.kind === 'rank') {
        const unit = x.unit === 'count' ? 'count' : 'pct';
        const n = Math.max(1, Math.round(Number(x.n) || 0));
        return { f: x.f, op: x.op === 'bottom' ? 'bottom' : 'top', n: unit === 'pct' ? Math.min(100, n) : n, unit };
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
    picks: [...new Set((Array.isArray(c.picks) ? c.picks : []).map(Number).filter(Number.isFinite))],
    notes: String(c.notes ?? '').trim().slice(0, 2000),
    // only a web address is kept: this ends up as a link on screen
    link: safeLink(c.link)
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

/**
 * Where each kit comes in the stash, oldest first or largest first. Like the
 * artist counts, the stash is taken as it stood on the challenge's first day —
 * what was owned then and not yet finished — so "the oldest quarter" is a fixed
 * set of kits. Asked of today's stash, every finish would promote the next
 * oldest into the quarter and the challenge could never be completed; and every
 * kit bought would move the line.
 */
function rankings(projects, from) {
  const pool = projects.filter((p) => owned(p) && p.status !== 'abandoned'
    && !(from && finished(p) && (!p.date_completed || p.date_completed < from))
    && !(from && bought(p) && bought(p) > from));
  const order = (value, cmp) => {
    const list = pool.map((p) => ({ id: p.id, v: value(p) })).filter((x) => x.v != null)
      .sort((a, b) => cmp(a.v, b.v) || a.id - b.id);
    return { size: list.length, at: new Map(list.map((x, i) => [x.id, i])) };
  };
  return {
    rankAge: order(bought, (a, b) => a.localeCompare(b)),
    rankSize: order((p) => (p.width_in && p.height_in ? Number(p.width_in) * Number(p.height_in) : null), (a, b) => b - a)
  };
}

function numberFor(field, p, stats) {
  if (field === 'size') return p.width_in && p.height_in ? (Number(p.width_in) + Number(p.height_in)) * CM : null;
  if (field === 'drills') return p.drills ? Number(p.drills) : null;
  if (field === 'colours') return p.colors ? Number(p.colors) : null;
  if (field === 'rating') return Number(p.rating) || 0;
  const a = stats.get(key(p.artist)) || { owned: 0, finished: 0 };
  return field === 'artistOwned' ? a.owned : a.finished;
}

function holds(cond, p, stats, ranks) {
  const F = FIELDS[cond.f];
  if (F.kind === 'date') {
    if (!cond.d) return true;                     // no date chosen yet
    const d = bought(p);
    if (!d) return false;                         // a kit with no date is neither older nor newer
    return cond.op === 'before' ? d < cond.d : d >= cond.d;
  }
  if (F.kind === 'rank') {
    const r = ranks[cond.f];
    const i = r.at.get(p.id);
    if (i == null) return false;                  // not in the stash that was ranked
    const k = cond.unit === 'pct' ? Math.ceil(r.size * cond.n / 100) : cond.n;
    return cond.op === 'top' ? i < k : i >= r.size - k;
  }
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
function ruleMatches(c, p, stats, ranks) {
  const live = c.groups.filter((g) => g.conds.length);
  /* No conditions at all means every owned kit — unless kits were picked by
     hand, in which case the picks are the whole challenge. */
  if (!live.length) return !c.picks.length;
  const each = live.map((g) => g.mode === 'all'
    ? g.conds.every((x) => holds(x, p, stats, ranks))
    : g.conds.some((x) => holds(x, p, stats, ranks)));
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
  const ranks = rankings(projects, c.from);
  const picked = new Set(c.picks);
  const out = { eligible: [], going: [], done: [] };

  for (const p of projects) {
    if (!owned(p)) continue;
    if (!picked.has(p.id) && !ruleMatches(c, p, stats, ranks)) continue;
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
  if (F.kind === 'date') {
    if (!cond.d) return `${F.label}: choose a date…`;
    return `Bought ${cond.op === 'before' ? 'before' : 'on or after'} ${dayText(cond.d)}`;
  }
  if (F.kind === 'rank') {
    const end = F[cond.op];
    if (cond.unit === 'pct') return `Among the ${end} ${cond.n}% of the stash`;
    return cond.n === 1 ? `The ${end} in the stash` : `Among the ${cond.n} ${end} in the stash`;
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

/**
 * A challenge is complete when it has kits and every one of them is done. It
 * is how an ongoing challenge — one with no end date — ever finishes: not on a
 * day, but when nothing in it is left to do.
 */
export const isComplete = (sections) => !!sections && sections.done.length > 0
  && !sections.eligible.length && !sections.going.length;

/**
 * Community challenges, ready to start from. Each carries what its host has
 * published and a link to where the host says it; where the host's own rules
 * were not written down anywhere that could be read, the notes say which parts
 * are a starting point to check rather than the rule.
 */
const group = (...conds) => [{ mode: 'all', conds }];
export const PRESETS = [
  { name: 'Refresh Your Stash 2026', from: '2026-01-01', to: '', req: 'finish',
    groups: group({ f: 'rankAge', op: 'top', n: 25, unit: 'pct' }),
    link: 'https://www.youtube.com/watch?v=qr0-2wGZlQg',
    notes: 'Hosted by Lisette Crafts and Tells: work through the older kits in your stash. The host sets no age cut-off, so this starts from the oldest quarter of your stash. Change the share, or swap it for “Bought before” a date, to suit. Ongoing: it is complete when none of them are left.' },
  { name: '26 for 26', from: '2026-01-01', to: '2026-12-31', req: 'drills', groups: group(),
    link: 'https://www.youtube.com/watch?v=CRzIQbnZ9Ao',
    notes: 'Hosted by Shire Shenanigans: “26 wips for 2026. We are kitting up 26 projects for 2026.” Pick your 26 under Hand-picked kits. “Drills down” is a starting point; check the video for what the host counts.' },
  { name: 'Art by Julia DP-along 2026', from: '2026-01-01', to: '2026-01-31', req: 'drills',
    groups: group({ f: 'artist', vals: ['Art by Julia'] }),
    link: 'https://www.youtube.com/watch?v=buJ1BKZpb7o',
    notes: 'Hosted by dietcoke.and.diamonds, Diamonds at Tiffani’s and Michaela Renee. Any Art by Julia kit counts. “Drills down” is a starting point; the linked video goes through the rules.' },
  { name: 'Fairy Tales & Folklore 2026', from: '2026-02-01', to: '2026-02-28', req: 'drills', groups: group(),
    link: 'https://www.youtube.com/watch?v=a5AZz84mnYI',
    notes: 'Hosted by Diamonds and Washi and Diamond Painting & Dr. Pepper: “celebrates mythology, classic fairy tales, and more”. A theme cannot be worked out from a kit, so pick yours under Hand-picked kits. The video says what qualifies.' },
  { name: 'Summer With the Masters 2026', from: '2026-06-01', to: '2026-07-31', req: 'drills', groups: group(),
    link: 'https://www.youtube.com/watch?v=k9qPf-5eKC8',
    notes: 'Hosted by Diamonds and Washi: “artwork created anywhere, by anyone, from the year 1930 or earlier”. The logbook does not record when an artwork was made, so pick yours under Hand-picked kits.' },
  { name: 'Mega Drill Challenge 2027', from: '2027-01-01', to: '2027-12-31', req: 'finish',
    groups: group({ f: 'size', op: 'min', n: 200 }),
    link: 'https://www.tiktok.com/@queenmotherconfettiqueen/video/7655429023895473422',
    notes: 'Hosted by QueenConfetti: a canvas whose length and width add up to at least 200 cm, finished by 31 December 2027. Registration with the host runs 31 December 2026 to 31 January 2027.' },
  { name: 'Artists in Waiting 2027', from: '2027-01-01', to: '2027-12-31', req: 'finish',
    groups: group({ f: 'artistOwned', op: 'min', n: 4 }, { f: 'artistFinished', op: 'max', n: 0 }),
    link: '',
    notes: 'Complete a painting for each artist you have several kits by and have never finished one of. Four or more kits is the starting point; change the number to suit your stash.' },
  { name: 'Tiffany challenge', from: '', to: '', req: 'drills',
    groups: group({ f: 'title', vals: ['Onihime'] }, { f: 'artist', vals: ['MM'] }),
    link: '',
    notes: 'The only painting allowed is Onihime by MM. Set the dates and what counts once the challenge says.' }
];

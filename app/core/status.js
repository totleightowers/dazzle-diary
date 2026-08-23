/**
 * Status and dates are two views of the same thing, so they are kept in step.
 *
 * Four of the statuses are *stages*, ordered ordered -> received -> started ->
 * completed, each with a date. Choosing one fills in every date up to and
 * including it that is still blank — so marking a new painting "received"
 * dates the order too.
 *
 * Three are *choices* that no date can imply: a kit on the wish list is not
 * owned yet, and a project on hold or abandoned is one you have said something
 * about rather than one the dates worked out. Those never get overruled by
 * statusFromDates, or a held project would snap back to "started" the moment
 * anything re-derived it.
 *
 * An earlier version treated "received on the same day as ordered" as unset,
 * to catch a placeholder the importer used to write. Real delivery dates have
 * since replaced all of those, and the rule would now break a legitimate case:
 * buying and receiving on the same day would read back as not received. A date
 * is simply set or it is not.
 */
export const STAGES = ['notReceived', 'received', 'started', 'completed'];
export const STAGE_DATE = {
  notReceived: 'date_ordered',
  received: 'date_received',
  started: 'date_started',
  completed: 'date_completed'
};

/** Statuses you choose, which the dates never override. */
export const CHOSEN = ['wishlist', 'onHold', 'abandoned'];
export const isChosen = (s) => CHOSEN.includes(s);

/** Every status, in the order a project travels through them. */
export const ALL_STATUSES = ['wishlist', 'notReceived', 'received', 'started',
                             'onHold', 'completed', 'abandoned'];

const rank = (s) => Math.max(0, STAGES.indexOf(s));

/** Is this date set? */
export function hasDate(p, field) {
  return !!p[field];
}

/* ------------------------------------------------------------------ holds
   A project can be put down and picked up more than once, so holds are kept
   as a list of periods rather than one pair of dates. The open one — the one
   with no end — is the hold it is on now. */

export function parseHolds(p) {
  const raw = p && p.holds;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch { return []; }
}

export const serialiseHolds = (list) => (list && list.length ? JSON.stringify(list) : null);

/** The hold it is on right now, or null. */
export function openHold(p) {
  const list = parseHolds(p);
  const last = list[list.length - 1];
  return last && !last.restarted ? last : null;
}

const days = (from, to) => {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
};

/** How long this project has spent put down, counting an open hold up to today. */
export function heldDays(p, today) {
  return parseHolds(p).reduce((n, h) => n + (h && h.held ? days(h.held, h.restarted || today) : 0), 0);
}

/* ---------------------------------------------------------------- changes */

/**
 * Moving to a status fills in its date and any earlier ones still blank, and
 * clears the ones that come after — otherwise the two rules would fight, with
 * a leftover completion date dragging the status straight back.
 *
 * Holds ride along: going on hold opens a period, leaving one closes it, and
 * going back to before the project was ever started throws them away, since a
 * hold on something unstarted means nothing.
 *
 * @returns {object} only the fields that need changing
 */
export function datesForStatus(p, status, today) {
  const out = {};
  const list = parseHolds(p);
  const open = list.length && !list[list.length - 1].restarted ? list[list.length - 1] : null;

  if (status === 'wishlist') {
    // not owned: nothing about it has happened yet
    for (const stage of STAGES) if (p[STAGE_DATE[stage]]) out[STAGE_DATE[stage]] = null;
    if (list.length) out.holds = null;
    return out;
  }

  if (status === 'onHold') {
    if (!open) out.holds = JSON.stringify([...list, { held: today, restarted: null }]);
    return out;                       // already on hold: leave the period alone
  }

  if (open) {                          // leaving a hold closes it, whatever for
    out.holds = JSON.stringify([...list.slice(0, -1), { ...open, restarted: today }]);
  }

  if (status === 'abandoned') return out;   // keep the dates it did earn

  const target = rank(status);
  for (const stage of STAGES) {
    const r = rank(stage), field = STAGE_DATE[stage];
    if (r <= target) {
      if (!hasDate(p, field)) out[field] = today;
    } else if (p[field]) {
      out[field] = null;
    }
  }
  // back to before it was started: the holds no longer describe anything
  if (target < rank('started') && (list.length || out.holds)) out.holds = null;
  return out;
}

/** Work the status out from whatever dates are filled in. */
export function statusFromDates(p) {
  // a choice is a choice; only leaving the wish list can be inferred, and only
  // because putting a date on something means you have it after all
  if (p.status === 'onHold' || p.status === 'abandoned') return p.status;
  const anyDate = STAGES.some((s) => hasDate(p, STAGE_DATE[s]));
  if (p.status === 'wishlist' && !anyDate) return 'wishlist';

  if (hasDate(p, 'date_completed')) return 'completed';
  if (hasDate(p, 'date_started')) return 'started';
  if (hasDate(p, 'date_received')) return 'received';
  return 'notReceived';
}

/** Everything a status change implies, ready to PATCH. */
export function applyStatus(p, status, today) {
  return { status, ...datesForStatus(p, status, today) };
}

/** Everything a date change implies. */
export function applyDates(p) {
  const status = statusFromDates(p);
  return status === p.status ? {} : { status };
}

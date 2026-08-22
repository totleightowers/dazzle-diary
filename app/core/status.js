/**
 * Status and dates are two views of the same thing, so they are kept in step.
 *
 * The four stages are ordered: ordered -> received -> started -> completed,
 * and each has a date. Choosing a status fills in every date up to and
 * including it that is still blank — so marking a new painting "received"
 * dates the order too.
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
const rank = (s) => Math.max(0, STAGES.indexOf(s));

/** Is this date set? */
export function hasDate(p, field) {
  return !!p[field];
}

/** Work the status out from whatever dates are filled in. */
export function statusFromDates(p) {
  if (hasDate(p, 'date_completed')) return 'completed';
  if (hasDate(p, 'date_started')) return 'started';
  if (hasDate(p, 'date_received')) return 'received';
  return 'notReceived';
}

/**
 * Moving to a status fills in its date and any earlier ones still blank, and
 * clears the ones that come after — otherwise the two rules would fight, with
 * a leftover completion date dragging the status straight back.
 *
 * @returns {object} only the fields that need changing
 */
export function datesForStatus(p, status, today) {
  const target = rank(status);
  const out = {};
  for (const stage of STAGES) {
    const r = rank(stage), field = STAGE_DATE[stage];
    if (!field) continue;
    if (r <= target) {
      if (!hasDate(p, field)) out[field] = today;
    } else if (p[field]) {
      out[field] = null;
    }
  }
  return out;
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

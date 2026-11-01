/**
 * Forecast the current stash using calendar months ending before this month.
 * Old completions count even when imported after they were finished. Partial
 * work needs a dated snapshot; it must not be silently assigned to last month.
 */
const dateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
};
const count = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const percent = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function stashForecast(rows, history = [], today = localToday()) {
  const currentMonth = dateOnly(today)?.slice(0, 7);
  const owned = rows.filter(r => !['wishlist', 'abandoned'].includes(r.status));
  const unfinished = owned.filter(r => r.status !== 'completed');
  const remaining = Math.max(0, Math.round(unfinished.reduce((n, r) =>
    n + count(r.drills) * (1 - percent(r.progress) / 100), 0)));
  const starts = owned.map(r => dateOnly(r.date_started)).filter(d => d && currentMonth && d <= today).sort();
  const firstStarted = starts[0] || null;
  const months = firstStarted ? Math.max(0, monthIndex(currentMonth) - monthIndex(firstStarted)) : 0;
  const through = currentMonth
    ? new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10)
    : null;
  const result = {
    firstStarted, through, months, remaining, placed: 0, monthlyAverage: 0, totalMonths: null,
    missingCounts: unfinished.filter(r => !count(r.drills)).length,
    undatedProgress: 0,
    estimatedCounts: owned.filter(r => count(r.drills) && r.drills_estimated).length,
    reason: null
  };
  if (!owned.length) return { ...result, reason: 'empty' };
  if (!remaining && !result.missingCounts) return { ...result, totalMonths: 0 };
  if (!firstStarted) return { ...result, reason: 'no-start' };
  if (!months) return { ...result, reason: 'no-months' };

  const byProject = new Map();
  for (const x of history) {
    if (!dateOnly(x.on)) continue;
    if (!byProject.has(x.project_id)) byProject.set(x.project_id, []);
    byProject.get(x.project_id).push(x);
  }
  let placed = 0;
  for (const r of owned) {
    const drills = count(r.drills);
    if (!drills) continue;
    const started = dateOnly(r.date_started), completed = dateOnly(r.date_completed);
    if (started && started > through) continue;
    // A completion date is stronger evidence than the day it was imported.
    if (r.status === 'completed' && completed && completed <= through) {
      if (completed >= firstStarted) placed += drills;
      else result.undatedProgress++;
      continue;
    }
    const events = (byProject.get(r.id) || []).slice().sort((a, b) =>
      a.on.localeCompare(b.on) || String(a.at || '').localeCompare(String(b.at || '')) || (a.id || 0) - (b.id || 0));
    const before = events.filter(x => x.on <= through);
    const after = events.find(x => x.on > through);
    let progress = null;
    if (before.length) progress = percent(before[before.length - 1].to);
    else if (after) progress = percent(after.from);
    else {
      const updated = dateOnly(String(r.updated_at || r.created_at || '').slice(0, 10));
      if (r.status !== 'completed' && updated && updated <= through) progress = percent(r.progress);
    }
    if (progress != null) placed += drills * progress / 100;
    else if (percent(r.progress) > 0 || r.status === 'completed') result.undatedProgress++;
  }
  result.placed = Math.round(placed);
  result.monthlyAverage = placed / months;
  if (!result.monthlyAverage) return { ...result, reason: 'no-pace' };
  if (!remaining && result.missingCounts) return { ...result, reason: 'missing-counts' };
  // Round up: a fraction of the final month still takes a month to finish.
  result.totalMonths = Math.ceil(remaining / result.monthlyAverage);
  return result;
}

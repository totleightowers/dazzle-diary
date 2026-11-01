import test from 'node:test';
import assert from 'node:assert/strict';
import { stashForecast } from '../app/core/forecast.js';

const done = { id: 1, status: 'completed', date_started: '2026-07-15',
  date_completed: '2026-10-10', drills: 4000 };
const active = { id: 2, status: 'started', date_started: '2026-09-01', drills: 10000, progress: 50 };
const history = [
  { project_id: 2, on: '2026-10-15', from: 0, to: 20 },
  { project_id: 2, on: '2026-11-01', from: 20, to: 50 }
];

test('stash forecast uses remaining drills and calendar months through last month', () => {
  const s = stashForecast([done, active,
    { id: 3, status: 'wishlist', drills: 900000, date_started: '2020-01-01' },
    { id: 4, status: 'abandoned', drills: 900000, date_started: '2020-01-01' }
  ], history, '2026-11-01');
  assert.equal(s.firstStarted, '2026-07-15');
  assert.equal(s.through, '2026-10-31');
  assert.equal(s.months, 4); // includes the start month and idle months
  assert.equal(s.placed, 6000);
  assert.equal(s.monthlyAverage, 1500);
  assert.equal(s.remaining, 5000);
  assert.equal(s.totalMonths, 4);
  const later = stashForecast([done, { ...active, progress: 80 }], [
    ...history, { project_id: 2, on: '2026-11-10', from: 50, to: 80 }
  ], '2026-11-15');
  assert.equal(later.monthlyAverage, s.monthlyAverage);
  assert.equal(later.remaining, 2000);
  assert.equal(later.totalMonths, 2);
});

test('historical finishes imported this month count once and current-month finishes do not count in full', () => {
  const s = stashForecast([done, { ...active, status: 'completed', progress: 100, date_completed: '2026-11-01' },
    { id: 3, status: 'received', drills: 1500 }], [
    { project_id: 1, on: '2026-11-01', from: 0, to: 100 },
    ...history, { project_id: 2, on: '2026-11-01', from: 50, to: 100, at: '2026-11-01T12:00:00Z' }
  ], '2026-11-02');
  assert.equal(s.placed, 6000);
  assert.equal(s.remaining, 1500);
  assert.equal(s.totalMonths, 1);
});

test('month-end snapshots account for corrections, baseline progress, and multiple changes', () => {
  const s = stashForecast([done, active], [
    { project_id: 2, on: '2026-10-02', from: 20, to: 70 },
    { project_id: 2, on: '2026-10-20', from: 70, to: 40 },
    { project_id: 2, on: '2026-10-20', from: 40, to: 30, id: 4 },
    { project_id: 2, on: '2026-11-01', from: 30, to: 50 }
  ], '2026-11-02');
  assert.equal(s.placed, 7000);
  const baseline = stashForecast([done, active], [
    { project_id: 2, on: '2026-11-01', from: 30, to: 50 }
  ], '2026-11-02');
  assert.equal(baseline.placed, 7000);
});

test('the rate advances at month boundaries including January and leap February', () => {
  const rows = [{ ...done, date_started: '2023-12-10', date_completed: '2023-12-20' }, active];
  const jan = stashForecast(rows, [], '2024-01-01');
  assert.equal(jan.months, 1);
  assert.equal(jan.through, '2023-12-31');
  assert.equal(jan.monthlyAverage, 4000);
  const march = stashForecast(rows, [], '2024-03-01');
  assert.equal(march.months, 3);
  assert.equal(march.through, '2024-02-29');
});

test('missing start dates, first-month-only activity and zero pace have no invented estimate', () => {
  assert.equal(stashForecast([], [], '2026-11-01').reason, 'empty');
  assert.equal(stashForecast([{ status: 'received', drills: 1000 }], [], '2026-11-01').reason, 'no-start');
  assert.equal(stashForecast([{ ...active, date_started: '2026-11-01' }], history, '2026-11-01').reason, 'no-months');
  const zero = stashForecast([{ ...active, progress: 0 }], [], '2026-11-01');
  assert.equal(zero.reason, 'no-pace');
  assert.equal(zero.totalMonths, null);
  assert.equal(stashForecast([{ ...active, date_started: '2026-02-30' }], [], '2026-11-01').reason, 'no-start');
  assert.equal(stashForecast([done], [], '2026-11-01').totalMonths, 0);
});

test('undated partial progress and unknown counts are visible limitations, not zero-duration promises', () => {
  const s = stashForecast([done, { ...active, drills_estimated: 1 },
    { id: 3, status: 'received', drills: null }], [], '2026-11-01');
  assert.equal(s.undatedProgress, 1);
  assert.equal(s.missingCounts, 1);
  assert.equal(s.estimatedCounts, 1);
  assert.equal(s.placed, 4000);
  assert.equal(s.totalMonths, 5);
  const missing = stashForecast([done, { id: 3, status: 'received', drills: null }], [], '2026-11-01');
  assert.equal(missing.reason, 'missing-counts');
  assert.equal(missing.totalMonths, null);
  const dated = stashForecast([done, { ...active, updated_at: '2026-10-10T12:00:00Z' }], [], '2026-11-01');
  assert.equal(dated.placed, 9000);
  assert.equal(dated.undatedProgress, 0);
});

test('sub-month estimates round up and progress is clamped to usable bounds', () => {
  const s = stashForecast([done, { ...active, drills: 1, progress: -10 }], [], '2026-11-01');
  assert.equal(s.remaining, 1);
  assert.equal(s.totalMonths, 1);
  assert.equal(stashForecast([done, { ...active, progress: 200 }], [], '2026-11-01').remaining, 0);
});

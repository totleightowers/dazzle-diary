import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, activityDays, describe, normalise, blank, freshCondition,
         conditionText } from '../app/core/challenges.js';

let nextId = 1;
const kit = (title, artist, more = {}) => ({ id: nextId++, title, artist, status: 'received', ...more });
const names = (list) => list.map((p) => p.title).sort();
const rule = (conds, more = {}) => ({ ...blank(), groups: [{ mode: 'all', conds }], ...more });
const is = (f, ...vals) => ({ f, vals });

test('a rule picks owned kits by artist, and leaves the wish list out', () => {
  const kits = [
    kit('Panda Cafe', 'Art by Julia'),
    kit('Ramen Night', 'Art by Julia', { status: 'wishlist' }),
    kit('Onihime', 'MM')
  ];
  const r = evaluate(rule([is('artist', 'art by julia')]), kits);
  assert.deepEqual(names(r.eligible), ['Panda Cafe']);
  assert.deepEqual(r.going, []);
  assert.deepEqual(r.done, []);
});

test('a challenge can be a single painting: title and artist together', () => {
  const kits = [kit('Onihime', 'MM'), kit('Kitsune', 'MM'), kit('Onihime', 'Somebody Else')];
  const r = evaluate(rule([is('title', 'Onihime'), is('artist', 'MM')]), kits);
  assert.deepEqual(names(r.eligible), ['Onihime']);
  assert.equal(r.eligible[0].artist, 'MM');
});

test('groups combine with AND and OR, and a condition can be turned round', () => {
  const kits = [
    kit('A', 'One', { shape: 'Square', shop: 'dac' }),
    kit('B', 'Two', { shape: 'Round', shop: 'dac' }),
    kit('C', 'Three', { shape: 'Square', shop: 'mdd' })
  ];
  const groups = [
    { mode: 'any', conds: [is('artist', 'One'), is('artist', 'Three')] },
    { mode: 'all', conds: [is('shop', 'dac')] }
  ];
  assert.deepEqual(names(evaluate({ ...blank(), join: 'any', groups }, kits).eligible), ['A', 'B', 'C']);
  assert.deepEqual(names(evaluate({ ...blank(), join: 'all', groups }, kits).eligible), ['A']);
  // several values in one condition mean any of them
  assert.deepEqual(names(evaluate(rule([is('artist', 'One', 'Two')]), kits).eligible), ['A', 'B']);
  assert.deepEqual(names(evaluate(rule([{ f: 'shape', not: true, vals: ['Square'] }]), kits).eligible), ['B']);
});

test('no conditions means every owned kit, unless kits were picked by hand', () => {
  const kits = [kit('A', 'One'), kit('B', 'Two'), kit('W', 'Two', { status: 'wishlist' })];
  assert.deepEqual(names(evaluate(blank(), kits).eligible), ['A', 'B']);
  assert.deepEqual(names(evaluate({ ...blank(), picks: [kits[1].id] }, kits).eligible), ['B']);
  // hand-picks join whatever the rule finds
  const both = evaluate(rule([is('artist', 'One')], { picks: [kits[1].id] }), kits);
  assert.deepEqual(names(both.eligible), ['A', 'B']);
  // picking a wish-list kit does not make it owned
  assert.deepEqual(evaluate({ ...blank(), picks: [kits[2].id] }, kits).eligible, []);
});

test('a drills-down challenge is met by placing diamonds in the dates, and completes when the kit does', () => {
  const kits = [
    kit('Untouched', 'J'),
    kit('Worked in January', 'J', { status: 'started', date_started: '2025-11-01' }),
    kit('Worked then finished in June', 'J', { status: 'completed', date_started: '2025-11-01', date_completed: '2026-06-12' }),
    kit('Started before, idle in January', 'J', { status: 'started', date_started: '2025-11-01' }),
    kit('Finished last year', 'J', { status: 'completed', date_started: '2025-01-01', date_completed: '2025-03-01' })
  ];
  const sessions = [
    { project_id: kits[1].id, on: '2026-01-20', minutes: 45 },
    { project_id: kits[3].id, on: '2026-02-02', minutes: 45 },
    { project_id: kits[3].id, on: '2026-01-15', minutes: 0 }      // a timer started and stopped
  ];
  const progress = [{ project_id: kits[2].id, on: '2026-01-05', from: 10, to: 30 }];
  const days = activityDays(kits, sessions, progress);
  const r = evaluate(rule([is('artist', 'J')], { req: 'drills', from: '2026-01-01', to: '2026-01-31' }), kits, days);
  assert.deepEqual(names(r.eligible), ['Started before, idle in January', 'Untouched']);
  assert.deepEqual(names(r.going), ['Worked in January']);
  assert.deepEqual(names(r.done), ['Worked then finished in June']);
});

test('finish in the dates: started any time, finished inside', () => {
  const kits = [
    kit('Not started', 'J'),
    kit('Under way', 'J', { status: 'started', date_started: '2025-06-01' }),
    kit('On hold', 'J', { status: 'onHold', date_started: '2025-06-01' }),
    kit('Finished inside', 'J', { status: 'completed', date_started: '2024-01-01', date_completed: '2026-03-03' }),
    kit('Finished before', 'J', { status: 'completed', date_started: '2024-01-01', date_completed: '2025-12-31' }),
    kit('Given up', 'J', { status: 'abandoned', date_started: '2025-06-01' })
  ];
  const r = evaluate(rule([], { req: 'finish', from: '2026-01-01', to: '2026-12-31' }), kits);
  assert.deepEqual(names(r.eligible), ['Not started']);
  assert.deepEqual(names(r.going), ['On hold', 'Under way']);
  assert.deepEqual(names(r.done), ['Finished inside']);
});

test('start in the dates: finishing can come whenever', () => {
  const kits = [
    kit('Not started', 'J'),
    kit('Started inside', 'J', { status: 'started', date_started: '2026-02-01' }),
    kit('Started inside, finished after', 'J', { status: 'completed', date_started: '2026-02-01', date_completed: '2027-05-01' }),
    kit('Started before', 'J', { status: 'started', date_started: '2025-12-31' })
  ];
  const r = evaluate(rule([], { req: 'start', from: '2026-01-01', to: '2026-03-31' }), kits);
  assert.deepEqual(names(r.eligible), ['Not started']);
  assert.deepEqual(names(r.going), ['Started inside']);
  assert.deepEqual(names(r.done), ['Started inside, finished after']);
});

test('start and finish in the dates: both ends have to be inside', () => {
  const kits = [
    kit('Not started', 'J'),
    kit('Started inside', 'J', { status: 'started', date_started: '2026-02-01' }),
    kit('Both inside', 'J', { status: 'completed', date_started: '2026-02-01', date_completed: '2026-03-01' }),
    kit('Finished late', 'J', { status: 'completed', date_started: '2026-02-01', date_completed: '2026-04-02' }),
    kit('Started early', 'J', { status: 'started', date_started: '2025-12-31' })
  ];
  const r = evaluate(rule([], { req: 'both', from: '2026-01-01', to: '2026-03-31' }), kits);
  assert.deepEqual(names(r.eligible), ['Not started']);
  assert.deepEqual(names(r.going), ['Started inside']);
  assert.deepEqual(names(r.done), ['Both inside']);
});

test('artists in waiting: four or more owned, none finished when the challenge begins', () => {
  const four = (artist, more = []) => [0, 1, 2, 3].map((i) => kit(`${artist} ${i + 1}`, artist, more[i] || {}));
  const kits = [
    ...four('Waiting'),
    ...four('Tried', [{ status: 'completed', date_started: '2025-01-01', date_completed: '2025-05-01' }]),
    ...four('Finished during', [{ status: 'completed', date_started: '2027-01-02', date_completed: '2027-02-10' }]),
    kit('Few 1', 'Few'), kit('Few 2', 'Few'),
    kit('Wished', 'Waiting', { status: 'wishlist' })
  ];
  const c = rule([{ f: 'artistOwned', op: 'min', n: 4 }, { f: 'artistFinished', op: 'max', n: 0 }],
    { req: 'finish', from: '2027-01-01', to: '2027-12-31' });
  const r = evaluate(c, kits);
  // the artist finished during the challenge is still in it — that finish is the point
  assert.deepEqual(names(r.done), ['Finished during 1']);
  assert.deepEqual(names(r.eligible), [
    'Finished during 2', 'Finished during 3', 'Finished during 4',
    'Waiting 1', 'Waiting 2', 'Waiting 3', 'Waiting 4']);
});

test('canvas size adds length to width, and a kit with no size cannot qualify', () => {
  const kits = [
    kit('Mega', 'A', { width_in: 70 / 2.54, height_in: 130 / 2.54 }),
    kit('Small', 'A', { width_in: 40 / 2.54, height_in: 50 / 2.54 }),
    kit('Unknown', 'A')
  ];
  const r = evaluate(rule([{ f: 'size', op: 'min', n: 200 }]), kits);
  assert.deepEqual(names(r.eligible), ['Mega']);
  assert.deepEqual(names(evaluate(rule([{ f: 'size', op: 'max', n: 100 }]), kits).eligible), ['Small']);
});

test('the rule reads back in plain words', () => {
  assert.equal(describe(blank()), 'Every kit you own.');
  assert.equal(describe(rule([is('title', 'Onihime'), is('artist', 'MM')])),
    'Owned kits where Title is Onihime and Artist is MM.');
  assert.equal(describe(rule([{ f: 'artistOwned', op: 'min', n: 4 }, { f: 'artistFinished', op: 'max', n: 0 }])),
    'Owned kits where Artist has at least 4 kits owned and Artist has none finished.');
  assert.equal(describe({ ...blank(), picks: [1, 2] }), '2 picked by hand.');
  assert.equal(describe(rule([is('shop', 'dac')], { picks: [1] }), (f, v) => f === 'shop' ? 'Diamond Art Club' : v),
    'Owned kits where Shop is Diamond Art Club, plus 1 picked by hand.');
  assert.equal(conditionText(freshCondition('artist')), 'Artist: choose…');
});

test('whatever is handed in comes out as a challenge that can be trusted', () => {
  const c = normalise({
    name: '  Julia along  ', from: '2026-01-31', to: '2026-01-01', req: 'nonsense', join: 'all',
    groups: [{ mode: 'any', conds: [{ f: 'nope', vals: ['x'] }, { f: 'artist', vals: [' A ', 'A', ''] },
                                    { f: 'rating', op: 'min', n: 9 }] }],
    picks: ['3', 3, 'x']
  });
  assert.equal(c.name, 'Julia along');
  assert.equal(c.to, '2026-01-31', 'an end before the start is pulled up to it');
  assert.equal(c.req, 'finish');
  assert.deepEqual(c.groups, [{ mode: 'any', conds: [
    { f: 'artist', not: false, vals: ['A'] }, { f: 'rating', op: 'min', n: 5 }] }]);
  assert.deepEqual(c.picks, [3]);
  assert.deepEqual(normalise(null), blank());
});

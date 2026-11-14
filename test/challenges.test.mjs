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

test('artists in waiting: finishing one kit by an artist takes their other kits out', () => {
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
  let r = evaluate(c, kits);
  // the finish that met the challenge stays, as completed; the artist's other kits are no longer eligible
  assert.deepEqual(names(r.done), ['Finished during 1']);
  assert.deepEqual(names(r.eligible), ['Waiting 1', 'Waiting 2', 'Waiting 3', 'Waiting 4']);

  // a second finish by the same artist is not a second completion: the artist was already done
  const again = kits.map((p) => p.title === 'Finished during 2'
    ? { ...p, status: 'completed', date_started: '2027-03-01', date_completed: '2027-04-01' } : p);
  r = evaluate(c, again);
  assert.deepEqual(names(r.done), ['Finished during 1']);

  // one under way does not close the artist; finishing it does
  const under = kits.map((p) => p.title === 'Waiting 1' ? { ...p, status: 'started', date_started: '2027-05-01' } : p);
  r = evaluate(c, under);
  assert.deepEqual(names(r.going), ['Waiting 1']);
  assert.deepEqual(names(r.eligible), ['Waiting 2', 'Waiting 3', 'Waiting 4']);
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

test('bought before or after a date goes by the order date, then the delivery date', async () => {
  const kits = [
    kit('Old', 'A', { date_ordered: '2023-03-01' }),
    kit('Arrived old', 'A', { date_received: '2023-12-31' }),
    kit('New', 'A', { date_ordered: '2024-01-01' }),
    kit('Undated', 'A')
  ];
  assert.deepEqual(names(evaluate(rule([{ f: 'bought', op: 'before', d: '2024-01-01' }]), kits).eligible), ['Arrived old', 'Old']);
  assert.deepEqual(names(evaluate(rule([{ f: 'bought', op: 'after', d: '2024-01-01' }]), kits).eligible), ['New']);
  // a date not chosen yet rules nothing out
  assert.equal(evaluate(rule([{ f: 'bought', op: 'before', d: '' }]), kits).eligible.length, 4);
  assert.equal(conditionText({ f: 'bought', op: 'before', d: '2024-01-01' }), 'Bought before 1 Jan 2024');
  assert.equal(conditionText({ f: 'bought', op: 'after', d: '2024-01-01' }), 'Bought on or after 1 Jan 2024');
});

test('the oldest quarter of the stash is recalculated as kits are finished and bought', async () => {
  const { isComplete } = await import('../app/core/challenges.js');
  const stash = () => [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => kit(`Kit ${i}`, 'A', { date_ordered: `202${i < 5 ? 2 : 4}-0${i}-01` })),
    kit('Finished long ago', 'A', { status: 'completed', date_ordered: '2020-01-01', date_completed: '2021-01-01' }),
    kit('Wished', 'A', { status: 'wishlist', date_ordered: '2019-01-01' }),
    kit('Undated', 'A')
  ];
  const c = rule([{ f: 'rankAge', op: 'top', n: 25, unit: 'pct' }], { req: 'finish', from: '2026-01-01', to: '' });
  let kits = stash();
  let r = evaluate(c, kits);
  assert.deepEqual(names(r.eligible), ['Kit 1', 'Kit 2'], 'a quarter of the eight unfinished, dated kits');
  assert.equal(isComplete(r), false);

  // finishing one keeps it as completed, and the quarter is taken again from what is left
  kits = kits.map((p) => p.title === 'Kit 1' ? { ...p, status: 'completed', date_started: '2026-01-05', date_completed: '2026-02-01' } : p);
  r = evaluate(c, kits);
  assert.deepEqual(names(r.done), ['Kit 1']);
  assert.deepEqual(names(r.eligible), ['Kit 2', 'Kit 3'], 'a quarter of the seven left');

  // buying more grows the stash, and the quarter with it
  kits = [...kits, ...[1, 2, 3, 4].map((i) => kit(`Bought later ${i}`, 'A', { date_ordered: `2026-03-0${i}` }))];
  assert.deepEqual(names(evaluate(c, kits).eligible), ['Kit 2', 'Kit 3', 'Kit 4']);
  assert.deepEqual(names(evaluate(c, kits).done), ['Kit 1'], 'a later purchase does not undo a completion');

  // a fixed set comes from a date instead, and that one can be finished off
  const fixed = rule([{ f: 'bought', op: 'before', d: '2022-03-01' }], { req: 'finish', from: '2026-01-01', to: '' });
  assert.deepEqual(names(evaluate(fixed, kits).eligible), ['Kit 2']);
  kits = kits.map((p) => p.title === 'Kit 2' ? { ...p, status: 'completed', date_started: '2026-04-01', date_completed: '2027-08-01' } : p);
  r = evaluate(fixed, kits);
  assert.deepEqual(names(r.done), ['Kit 1', 'Kit 2'], 'no end date: a finish a year on still counts');
  assert.equal(isComplete(r), true);
  assert.equal(isComplete(evaluate(c, [])), false, 'a challenge with no kits in it is not a finished one');
});

test('newest, largest and smallest, by share or by number', () => {
  const kits = [
    kit('Tiny', 'A', { width_in: 8, height_in: 8, date_ordered: '2021-01-01' }),
    kit('Mid', 'A', { width_in: 16, height_in: 20, date_ordered: '2022-01-01' }),
    kit('Big', 'A', { width_in: 30, height_in: 40, date_ordered: '2023-01-01' }),
    kit('Huge', 'A', { width_in: 40, height_in: 50, date_ordered: '2024-01-01' }),
    kit('No size', 'A', { date_ordered: '2025-01-01' })
  ];
  const got = (cond) => names(evaluate(rule([cond]), kits).eligible);
  assert.deepEqual(got({ f: 'rankSize', op: 'top', n: 1, unit: 'count' }), ['Huge']);
  assert.deepEqual(got({ f: 'rankSize', op: 'bottom', n: 2, unit: 'count' }), ['Mid', 'Tiny']);
  assert.deepEqual(got({ f: 'rankSize', op: 'top', n: 50, unit: 'pct' }), ['Big', 'Huge']);
  assert.deepEqual(got({ f: 'rankAge', op: 'bottom', n: 2, unit: 'count' }), ['Huge', 'No size']);
  assert.equal(conditionText({ f: 'rankAge', op: 'top', n: 25, unit: 'pct' }), 'Among the oldest 25% of the stash');
  assert.equal(conditionText({ f: 'rankSize', op: 'bottom', n: 3, unit: 'count' }), 'Among the 3 smallest in the stash');
  assert.equal(conditionText({ f: 'rankSize', op: 'top', n: 1, unit: 'count' }), 'The largest in the stash');
});

test('notes are kept, and only a web address is kept as the link', () => {
  assert.equal(normalise({ notes: '  Hosted by someone  ', link: ' https://www.youtube.com/watch?v=abc ' }).link,
    'https://www.youtube.com/watch?v=abc');
  assert.equal(normalise({ notes: '  Hosted by someone  ' }).notes, 'Hosted by someone');
  for (const bad of ['javascript:alert(1)', 'youtube.com/x', 'https://a b', 'https://x"onclick="y'])
    assert.equal(normalise({ link: bad }).link, '', `${bad} was kept as a link`);
});

test('every preset is a challenge the app can open as it stands', async () => {
  const { PRESETS } = await import('../app/core/challenges.js');
  assert.ok(PRESETS.length >= 8);
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, PRESETS.length, 'two presets share a name');
  for (const p of PRESETS) {
    const c = normalise(p);
    for (const k of ['name', 'from', 'to', 'req', 'notes', 'link']) assert.equal(c[k], p[k], `${p.name}: ${k} did not survive`);
    assert.equal(c.groups[0].conds.length, p.groups[0].conds.length, `${p.name}: a condition was dropped`);
    assert.ok(c.notes.length > 20, `${p.name} says nothing about itself`);
    assert.doesNotThrow(() => { evaluate(c, [kit('X', 'Y')]); describe(c); });
  }
});

test('a challenge follows the stash: kits join as they arrive and leave as they go', () => {
  const c = rule([is('artist', 'Art by Julia')], { req: 'drills', from: '2026-01-01', to: '2026-01-31' });
  let kits = [kit('Panda Cafe', 'Art by Julia'), kit('Moonlit Tea', 'Art by Julia'),
              kit('Ramen Night', 'Art by Julia', { status: 'wishlist' })];
  assert.deepEqual(names(evaluate(c, kits).eligible), ['Moonlit Tea', 'Panda Cafe']);

  // a new Art by Julia kit is bought mid-challenge, and the wished-for one arrives
  kits = [...kits.map((p) => p.title === 'Ramen Night' ? { ...p, status: 'received' } : p),
          kit('Bubble Tea Bunny', 'Art by Julia', { status: 'notReceived' })];
  assert.deepEqual(names(evaluate(c, kits).eligible), ['Bubble Tea Bunny', 'Moonlit Tea', 'Panda Cafe', 'Ramen Night']);

  // one is sold unfinished, one is given up on, one is deleted from the logbook
  kits = kits.filter((p) => p.title !== 'Bubble Tea Bunny')
    .map((p) => p.title === 'Moonlit Tea' ? { ...p, sold_price: 20 }
      : p.title === 'Ramen Night' ? { ...p, status: 'abandoned' } : p);
  assert.deepEqual(names(evaluate(c, kits).eligible), ['Panda Cafe']);

  // and a kit that stops matching the rule leaves too
  kits = kits.map((p) => p.title === 'Panda Cafe' ? { ...p, artist: 'Someone Else' } : p);
  assert.deepEqual(evaluate(c, kits).eligible, []);

  // a painting finished for the challenge and sold afterwards is still a completion
  const finishedThenSold = [kit('Strawberry Picnic', 'Art by Julia',
    { status: 'completed', date_started: '2026-01-03', date_completed: '2026-02-01', sold_price: 60 })];
  assert.deepEqual(names(evaluate(c, finishedThenSold, activityDays(finishedThenSold)).done), ['Strawberry Picnic']);
});

test('the Tiffany Fan Art preset names the artist in full, so it finds the kit', async () => {
  const { PRESETS } = await import('../app/core/challenges.js');
  const preset = PRESETS.find((p) => p.name === 'Tiffany Fan Art');
  const kits = [kit('Onihime', 'Margaret Morales'), kit('Onihime', 'Somebody Else'), kit('Other', 'Margaret Morales')];
  const r = evaluate(preset, kits);
  assert.deepEqual(r.eligible.map((p) => p.artist), ['Margaret Morales']);
  assert.equal(r.eligible[0].title, 'Onihime');
});

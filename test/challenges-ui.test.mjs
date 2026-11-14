/**
 * Challenges, driven the way a finger drives them: switch the logbook over,
 * build a rule by tapping, and watch kits move between its sections as the
 * logbook underneath changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './mount.mjs';
import * as idbDirect from '../app/local/idb.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const broke = (m) => /Something went wrong/.test(m.text());

async function fresh(width = 390) {
  const m = await mount({ width });
  for (const p of await m.api('/projects')) await m.api('/projects/' + p.id, { method: 'DELETE' });
  await idbDirect.del('meta', 'challenges');
  return m;
}
const section = (m, k) => {
  const el = m.find(`.group[data-ch="${k}"]`);
  return el ? [...el.querySelectorAll('.card .name')].map((n) => n.textContent).sort() : [];
};
const setDate = async (m, id, value) => {
  const el = m.find('#' + id);
  el.value = value;
  await el.onchange({ target: el });
  await m.settle();
};

for (const width of [390, 1028]) {
  test(`a challenge is built by tapping and then read as three sections at ${width}px`, async () => {
    const m = await fresh(width);
    const panda = await m.seed({ title: 'Panda Cafe', artist: 'Art by Julia', status: 'started', date_started: '2025-11-01' });
    await m.seed({ title: 'Moonlit Tea', artist: 'Art by Julia', status: 'received' });
    await m.seed({ title: 'Ramen Night', artist: 'Art by Julia', status: 'wishlist' });
    await m.seed({ title: 'Onihime', artist: 'MM', status: 'received' });

    await m.go('#/');
    assert.equal(m.find('[data-act="mode"][data-k="stash"]').getAttribute('aria-pressed'), 'true');
    await m.tap('[data-act="mode"][data-k="challenges"]');
    assert.match(m.text(), /No challenges yet/);

    await m.tap('[data-go="#/challenge/new"]');
    assert.ok(!broke(m));
    assert.match(m.find('#chtotal').textContent, /^3 kits/, 'an empty rule is every owned kit');

    // saving without a name is refused, and nothing is created
    await m.tap('[data-act="cbsave"]');
    assert.deepEqual(await m.api('/challenges'), []);

    m.find('#chname').value = 'Art by Julia along';
    await m.tap('[data-act="cbaddcond"]');
    await m.tap('[data-act="cbfield"][data-k="artist"]');
    await m.tap('[data-act="cbval"][data-k="Art by Julia"]');
    assert.match(m.find('#chtotal').textContent, /^2 kits/, 'the wish-list kit is not owned');
    assert.equal(m.find('#chread').textContent, 'Owned kits where Artist is Art by Julia.');
    assert.equal(m.find('#chname').value, 'Art by Julia along', 'tapping wiped the name');
    await m.tap('[data-act="cbclose"]');

    await m.tap('[data-act="cbreq"][data-k="drills"]');
    await setDate(m, 'chfrom', '2026-01-01');
    await setDate(m, 'chto', '2026-01-31');
    await m.tap('[data-act="cbsave"]');

    /* Back on the logbook, already on the challenge that was just made. The
       app goes back through history, which this harness does not navigate, so
       the return is made here the way the phone would make it. */
    await m.go('#/');
    await m.until(() => m.find('.group[data-ch]'));
    assert.equal(m.find('[data-act="mode"][data-k="challenges"]').getAttribute('aria-pressed'), 'true');
    assert.match(m.find('.chip[data-act="chpick"]').textContent, /Art by Julia along\s*2/);
    assert.deepEqual(section(m, 'eligible'), ['Moonlit Tea', 'Panda Cafe']);
    assert.deepEqual(section(m, 'going'), []);

    // drills go down in January: the kit is in progress for the challenge
    await m.api(`/projects/${panda.id}/sessions`, json('POST', { on: '2026-01-12', minutes: 40 }));
    await m.go('#/');
    assert.deepEqual(section(m, 'eligible'), ['Moonlit Tea']);
    assert.deepEqual(section(m, 'going'), ['Panda Cafe']);

    // finished months after the dates, it is completed under the challenge all the same
    await m.api('/projects/' + panda.id, json('PATCH', { status: 'completed', date_completed: '2026-06-12' }));
    await m.go('#/');
    assert.deepEqual(section(m, 'done'), ['Panda Cafe']);
    assert.match(m.find('#chcount').textContent, /1 of 2 completed/);

    // and the stash is one tap away, untouched
    await m.tap('[data-act="mode"][data-k="stash"]');
    assert.ok(m.find('#q'), 'the stash did not come back');
    assert.equal(m.all('.group[data-ch]').length, 0);
    await m.tap('[data-act="mode"][data-k="stash"]');
  });
}

test('a challenge can be edited and deleted, and the kits are left alone', async () => {
  const m = await fresh();
  await m.seed({ title: 'Onihime', artist: 'MM', status: 'received' });
  await m.seed({ title: 'Kitsune', artist: 'MM', status: 'received' });
  const c = await m.api('/challenges', json('POST', { name: 'Tiffany challenge', req: 'finish',
    groups: [{ mode: 'all', conds: [{ f: 'artist', vals: ['MM'] }] }] }));

  await m.go('#/challenge/' + c.id);
  assert.equal(m.find('#chname').value, 'Tiffany challenge');
  assert.match(m.find('#chtotal').textContent, /^2 kits/);
  // narrow it to the one painting
  await m.tap('[data-act="cbaddcond"]');
  await m.tap('[data-act="cbfield"][data-k="title"]');
  await m.tap('[data-act="cbval"][data-k="Onihime"]');
  assert.match(m.find('#chtotal').textContent, /^1 kit /);
  // the same two conditions as "any of these" is both kits again
  await m.tap('[data-act="cbgmode"][data-k="any"]');
  assert.match(m.find('#chtotal').textContent, /^2 kits/);
  await m.tap('[data-act="cbgmode"][data-k="all"]');
  await m.tap('[data-act="cbsave"]');
  const saved = (await m.api('/challenges'))[0];
  assert.equal(saved.summary, 'Owned kits where Artist is MM and Title is Onihime.');
  assert.deepEqual(saved.sections.eligible.length, 1);

  await m.go('#/challenge/' + c.id);
  m.answerConfirms(false);
  await m.tap('[data-act="cbdelete"]');
  assert.equal((await m.api('/challenges')).length, 1, 'saying no deleted it anyway');
  m.answerConfirms(true);
  await m.tap('[data-act="cbdelete"]');
  assert.deepEqual(await m.api('/challenges'), []);
  assert.equal((await m.api('/projects')).length, 2, 'deleting a challenge deleted kits');
});

test('kits no rule can describe are picked by hand, and a number is set with the stepper', async () => {
  const m = await fresh();
  const a = await m.seed({ title: 'Starry Night', artist: 'Vincent van Gogh', status: 'received' });
  await m.seed({ title: 'Scorpio', artist: 'Auclair Studio', status: 'received',
                 width_in: 70 / 2.54, height_in: 130 / 2.54 });
  await m.seed({ title: 'Small One', artist: 'Auclair Studio', status: 'received',
                 width_in: 30 / 2.54, height_in: 40 / 2.54 });

  await m.go('#/challenge/new');
  m.find('#chname').value = 'Summer With the Masters';
  await m.tap('[data-act="cbpicks"]');
  await m.tap(`[data-act="cbpickkit"][data-k="${a.id}"]`);
  assert.match(m.find('#chtotal').textContent, /^1 kit /, 'hand-picks alone are the whole challenge');
  assert.equal(m.find('#chread').textContent, '1 picked by hand.');

  // length + width of at least 200 cm, then stepped down until the small one fits
  await m.tap('[data-act="cbaddcond"]');
  await m.tap('[data-act="cbfield"][data-k="size"]');
  assert.equal(m.find('#chnum').textContent, '200');
  assert.match(m.find('#chtotal').textContent, /^2 kits/);
  for (let i = 0; i < 13; i++) await m.tap('[data-act="cbstep"][data-k="-1"]');
  assert.equal(m.find('#chnum').textContent, '70');
  assert.match(m.find('#chtotal').textContent, /^3 kits/);
  await m.tap('[data-act="cbdel"]');
  await m.tap('[data-act="cbsave"]');

  const saved = (await m.api('/challenges'))[0];
  assert.deepEqual(saved.picks, [a.id]);
  // a kit that is deleted leaves the challenges it was picked into
  await m.api('/projects/' + a.id, { method: 'DELETE' });
  assert.deepEqual((await m.api('/challenges'))[0].picks, []);
});

test('challenges travel in the backup, and hand-picks find their kits on the other side', async () => {
  const m = await fresh();
  const p = await m.seed({ title: 'Starry Night', artist: 'Vincent van Gogh', status: 'received' });
  await m.api('/challenges', json('POST', { name: 'Masters', picks: [p.id] }));
  await m.go('#/settings');
  await m.tap('[data-act="backup"]');
  await m.until(() => m.downloads.some((d) => d.name === 'dazzle-diary-backup.json'));
  const file = JSON.parse(m.downloads.find((d) => d.name === 'dazzle-diary-backup.json').text);
  assert.equal(file.challenges.length, 1);
  assert.equal(file.challenges[0].sections, undefined, 'the backup carries the rule, not the working-out');

  // onto a phone where the same kit has a different id
  await m.api('/projects/' + p.id, { method: 'DELETE' });
  await idbDirect.del('meta', 'challenges');
  await m.seed({ title: 'In the way', status: 'received' });
  const r = await m.api('/restore', { method: 'POST', body: JSON.stringify(file) });
  assert.equal(r.challenges, 1);
  const back = (await m.api('/challenges'))[0];
  const kit = (await m.api('/projects')).find((x) => x.title === 'Starry Night');
  assert.notEqual(kit.id, p.id);
  assert.deepEqual(back.picks, [kit.id]);
  assert.deepEqual(back.sections.eligible, [kit.id]);
  // restoring the same file again does not make a second copy
  assert.equal((await m.api('/restore', { method: 'POST', body: JSON.stringify(file) })).challenges, 0);
  assert.equal((await m.api('/challenges')).length, 1);
});

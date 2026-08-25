/**
 * Walk the whole app the way a finger would, and check nothing falls over.
 *
 * Most of the bugs that reached the phone were not subtle: a route threw and
 * showed "Something went wrong", a form came back blank, a status that was not
 * one of the seven took the page down. None of them needed a clever test —
 * they needed *any* test that actually rendered the screen and looked at it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './mount.mjs';

const broke = (m) => /Something went wrong/.test(m.text());

async function app(width = 390) {
  const m = await mount({ width });
  await m.sync();
  const p = await m.seed({
    title: 'Moon Eater', artist: 'Yuumei Art', status: 'started',
    date_ordered: '2026-07-01', date_received: '2026-07-08', date_started: '2026-08-01',
    shop: 'dac', dac_handle: 'moon-eater', drills: 75433, colors: 42,
    price: 169, currency: 'USD', progress: 40, rating: 4
  });
  await m.seed({ title: 'Wanted one', status: 'wishlist', shop: 'dac' });
  await m.seed({ title: 'Given up', status: 'abandoned', shop: 'dac' });
  return { m, p };
}

for (const width of [390, 1028]) {
  const shape = width === 390 ? 'phone' : 'unfolded';

  test(`every screen renders on a ${shape}`, async () => {
    const { m, p } = await app(width);
    for (const hash of ['#/', `#/p/${p.id}`, `#/p/${p.id}/edit`, '#/new',
                        '#/browse', '#/import', '#/settings', '#/licences']) {
      await m.go(hash);
      assert.ok(!broke(m), `${hash} showed the error page on a ${shape}`);
      assert.ok(m.text().trim().length > 40, `${hash} rendered almost nothing`);
    }
  });

  test(`every control on every screen can be tapped on a ${shape}`, async () => {
    const { m, p } = await app(width);
    for (const hash of ['#/', `#/p/${p.id}`, '#/settings', '#/browse']) {
      await m.go(hash);
      const acts = [...new Set(m.all('[data-act]').map(el => el.getAttribute('data-act')))]
        // these leave the screen, delete something, or start a long job
        .filter(a => !['delete', 'delhold', 'delsession', 'delphoto', 'sync', 'syncone',
                       'export', 'backup', 'resetcover', 'commit'].includes(a));
      for (const act of acts) {
        await m.go(hash);
        const el = m.find(`[data-act="${act}"]`);
        if (!el) continue;
        el.dispatchEvent({ type: 'click' });
        await m.settle();
        assert.ok(!broke(m), `tapping ${act} on ${hash} broke the app (${shape})`);
      }
    }
  });
}

test('a project picked from the catalogue arrives with its picture', async () => {
  const m = await mount({ width: 1028 });
  await m.sync();
  await m.go('#/browse');
  await m.tap('[data-act="pickcat"]');
  assert.equal(globalThis.location.hash, '#/new');

  const box = m.find('#formshot');
  assert.ok(box, 'the form has no picture area at all');
  assert.ok(!box.hasAttribute('hidden'), 'the picture area is hidden');
  assert.match(m.find('#formshotimg').getAttribute('src'), /^https?:\/\//,
               'the picture area has no image in it');

  // and it survives the form being rendered again, which a fold does
  await m.go('#/new');
  assert.ok(!m.find('#formshot').hasAttribute('hidden'),
            'the picture went away when the form re-rendered');
  assert.match(m.find('input#title').getAttribute('value'), /Moon Eater/,
               'the details went away when the form re-rendered');
});

test('a status that is not one of the seven does not take the page down', async () => {
  const m = await mount();
  const p = await m.seed({ title: 'From a bad import', status: 'nonsense' });
  await m.go('#/p/' + p.id);
  assert.ok(!broke(m), 'an unknown status broke the project page');
  assert.match(m.text(), /From a bad import/);
});

test('the gallery opens from a cover and holds the photos too', async () => {
  const m = await mount();
  await m.sync();
  const p = await m.seed({ title: 'Moon Eater', status: 'started', shop: 'dac',
                           dac_handle: 'moon-eater' });
  await m.api(`/projects/${p.id}/photos`, { method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([7]).buffer });
  await m.go('#/p/' + p.id);

  const covers = m.all('.shots img').length;
  assert.ok(covers >= 1, 'the project page shows no cover');
  await m.tap('.shots img');
  assert.ok(m.find('.lb-strip'), 'tapping a cover opened no viewer');
  assert.equal(m.all('.lb-slide').length, covers + 1,
               'the viewer does not hold the covers and the photo');
});

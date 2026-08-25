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

test('removing a photo can be undone, and asks nothing first', async () => {
  const m = await mount();
  const p = await m.seed({ title: 'Moon Eater', status: 'started' });
  for (const n of [1, 2]) await m.api(`/projects/${p.id}/photos`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([n]).buffer });
  await m.go('#/p/' + p.id);
  assert.equal(m.all('.shot').length, 2);

  m.answerConfirms(false);                  // nothing should be asking
  await m.tap('[data-act="delphoto"]');
  assert.equal(m.confirms.length, 0, 'it asked before removing');
  assert.equal(m.all('.shot').length, 1, 'the photo is still on the page');
  assert.equal((await m.api('/projects/' + p.id)).photos.length, 2,
               'it deleted the photo before the offer to undo expired');

  await m.tap('.toast-action');
  assert.equal(m.all('.shot').length, 2, 'undo did not bring it back');
  assert.equal((await m.api('/projects/' + p.id)).photos.length, 2);
});

test('a double tap zooms the viewer and a second one restores it', async () => {
  const m = await mount();
  await m.sync();
  const p = await m.seed({ title: 'Moon Eater', status: 'started', shop: 'dac', dac_handle: 'moon-eater' });
  await m.go('#/p/' + p.id);
  await m.tap('.shots img');
  const slide = m.find('.lb-slide');
  const double = () => { slide.dispatchEvent({ type: 'click' }); slide.dispatchEvent({ type: 'click' }); };

  double();
  assert.ok(slide.classList.contains('zoomed'), 'a double tap did not zoom');
  assert.ok(m.find('.lightbox').classList.contains('has-zoom'), 'the strip still slides while zoomed');
  double();
  assert.ok(!slide.classList.contains('zoomed'), 'a second double tap did not restore it');
  assert.ok(m.find('.lb-strip'), 'zooming closed the viewer');
});

test('pulling the logbook down updates the catalogues', async () => {
  const m = await mount();
  await m.seed({ title: 'Moon Eater', status: 'started' });
  await m.go('#/');
  const scroll = m.find('.scroll');
  const text = () => m.find('#pulltext')?.textContent || '';
  const touch = (type, y) => scroll.dispatchEvent({ type, touches: y == null ? [] : [{ clientY: y }] });

  assert.ok(m.find('#pull'), 'there is nowhere for the pull to show');
  scroll.scrollTop = 0;
  touch('touchstart', 100);
  touch('touchmove', 160);
  assert.match(text(), /Pull to update/, 'a short pull says nothing');
  touch('touchmove', 260);
  assert.match(text(), /Release/, 'a long pull does not offer to update');
  touch('touchend');
  await m.settle();
  assert.notEqual(text(), '', 'releasing did not start an update');

  for (let i = 0; i < 40 && /…/.test(text()); i++) await m.settle();
  assert.equal(text(), '', 'the indicator never went away');

  // part way down the list, a downward drag is scrolling and nothing else
  scroll.scrollTop = 400;
  touch('touchstart', 100);
  touch('touchmove', 300);
  assert.equal(text(), '', 'it tried to refresh while the list was scrolled');
});

test('a progress photo can be shared, when the phone can share', async () => {
  const m = await mount();
  const shared = [];
  m.window.LogbookNative.sharePhoto = (path, title) => { shared.push({ path, title }); return true; };
  const p = await m.seed({ title: 'Moon Eater', status: 'started' });
  await m.api(`/projects/${p.id}/photos`, { method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([7]).buffer });

  await m.go('#/p/' + p.id);
  await m.tap('.shot .open');
  await m.tap('[data-act="sharephoto"]');
  assert.equal(shared.length, 1, 'nothing was handed to the phone to share');
  assert.match(shared[0].path, /^photos\//, 'it shared the wrong path');
  assert.equal(shared[0].title, 'Moon Eater', 'the photo went out unnamed');
});

test('no share button on a phone that cannot share', async () => {
  const m = await mount();
  delete m.window.LogbookNative.sharePhoto;
  const p = await m.seed({ title: 'Moon Eater', status: 'started' });
  await m.api(`/projects/${p.id}/photos`, { method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([7]).buffer });
  await m.go('#/p/' + p.id);
  await m.tap('.shot .open');
  assert.ok(m.find('.lb-strip'), 'the viewer did not open');
  assert.equal(m.find('[data-act="sharephoto"]'), null,
               'it offered to share on a build with no way to do it');
});

test('cost and dates are corrected where they are read', async () => {
  const m = await mount();
  const p = await m.seed({ title: 'Moon Eater', status: 'received',
                           date_ordered: '2026-07-01', date_received: '2026-07-08',
                           price: 169, currency: 'USD' });
  await m.go('#/p/' + p.id);

  m.find('#cost_price').value = '54.99';
  m.find('#cost_shipping').value = '4.50';
  m.find('#cost_currency .opt[data-k="GBP"]').dispatchEvent({ type: 'click' });
  await m.tap('[data-act="savecost"]');
  let row = await m.api('/projects/' + p.id);
  assert.equal(row.price, 54.99);
  assert.equal(row.shipping, 4.5);
  assert.equal(row.currency, 'GBP', 'the currency chips did nothing');
  assert.equal(row.price_source, 'you', 'a price typed by hand is still credited to the catalogue');

  await m.go('#/p/' + p.id);
  m.find('#tl_date_started').value = '2026-08-20';
  await m.tap('[data-act="savedates"]');
  row = await m.api('/projects/' + p.id);
  assert.equal(row.date_started, '2026-08-20');
  assert.equal(row.status, 'started', 'the status did not follow the dates');
});

test('the project leads with managing it, not with editing the record', async () => {
  const m = await mount();
  const p = await m.seed({ title: 'Moon Eater', status: 'started', date_started: '2026-08-01' });
  await m.go('#/p/' + p.id);
  const edit = m.find('[data-go$="/edit"]');
  assert.ok(edit, 'there is no way to the record at all');
  assert.ok(!edit.classList.contains('primary'), 'the record editor is still the loudest thing on the page');
  assert.match(edit.textContent, /Details/);
  await m.go(`#/p/${p.id}/edit`);
  assert.match(m.text(), /Project details/, 'the form still calls itself Edit project');
});

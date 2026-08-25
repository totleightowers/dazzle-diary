// At her real width, in the right-hand pane: does Settings stay one column?
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFor, parseHtml, computed, find } from '../tools/layout-probe.mjs';
const rules = rulesFor();
const ok = (name, cond, detail = '') => test(name, () => assert.ok(cond, String(detail)));
const at = (html, sel, width) => {
  const root = parseHtml(html);
  const el = find(root, sel);
  return el ? computed(el, width, rules) : null;
};
const settings = `<div id="app" class="two-pane"><main id="main"><div class="screen reading">
  <div class="topbar"></div><div class="scroll pad stack"><div class="tiles"></div><div><h3 class="label">x</h3></div></div>
</div></main></div>`;
const form = `<div id="app" class="two-pane"><main id="main"><div class="screen reading form">
  <div class="topbar"></div><div class="scroll pad stack"><div class="formshot"></div><div><label class="label">x</label></div></div>
</div></main></div>`;

for (const w of [1028, 1180]) {
  const st = at(settings, '.scroll.stack', w);
  const fm = at(form, '.scroll.stack', w);
  ok(`settings' stack is found at ${w}px`, !!st);
  ok(`settings stays a single column at ${w}px`,
     st && !st['grid-template-columns'], st && st['grid-template-columns'] ? st['grid-template-columns'].val : 'not found');
  ok(`the form uses columns at ${w}px`,
     fm && fm['grid-template-columns'] && /auto-fit/.test(fm['grid-template-columns'].val),
     fm && fm['grid-template-columns'] ? fm['grid-template-columns'].val : 'none');
}
/* Auto side margins on a flex item shrink it to its content instead of filling
   it to the cap, which had every section of Settings at a different width. */
for (const w of [1028, 1236]) {
  const sections = `<div id="app" class="two-pane"><main id="main"><div class="screen reading">
    <div class="scroll pad stack"><div class="tiles"></div><div><div class="panel"></div></div></div>
  </div></main></div>`;
  for (const sel of ['.tiles', '.scroll.stack > div']) {
    const c = at(sections, sel, w);
    ok(`${sel} takes the whole measure at ${w}px`,
       c && c.width && c.width.val === '100%', c && c.width ? c.width.val : 'no width set');
    ok(`${sel} is still capped at ${w}px`,
       c && c['max-width'] && /1080px/.test(c['max-width'].val),
       c && c['max-width'] ? c['max-width'].val : 'uncapped');
  }
}

// and on a phone neither does
const narrow = at(form, '.scroll.stack', 390);
ok('the form is a plain stack on a phone', narrow && !narrow['grid-template-columns'],
   narrow && narrow['grid-template-columns'] ? narrow['grid-template-columns'].val : 'not found');


/* The form's picture strip is the same component as the project page's, not a
   lookalike with only a height — which is why the picture sat hard left and no
   swipe ever moved it. Both must resolve to a scroll-snapping flex carousel,
   with each picture filling its slide and centred inside it. */
for (const w of [390, 1028]) {
  const strips = `<div id="app"><div class="screen reading form"><div class="scroll pad stack">
    <div class="formshot"><div class="shots"><img></div></div>
    <div class="hero"><div class="shots"><img></div></div>
  </div></div></div>`;
  for (const owner of ['.formshot', '.hero']) {
    const strip = at(strips, owner + ' .shots', w);
    ok(`${owner} strip scrolls sideways at ${w}px`,
       strip && strip['overflow-x'] && strip['overflow-x'].val === 'auto',
       strip && strip['overflow-x'] ? strip['overflow-x'].val : 'no overflow-x');
    ok(`${owner} strip snaps at ${w}px`,
       strip && strip['scroll-snap-type'] && /x mandatory/.test(strip['scroll-snap-type'].val),
       strip && strip['scroll-snap-type'] ? strip['scroll-snap-type'].val : 'no snapping');
    ok(`${owner} strip claims the sideways drag at ${w}px`,
       strip && strip['touch-action'] && strip['touch-action'].val === 'pan-x',
       strip && strip['touch-action'] ? strip['touch-action'].val : 'no touch-action');
    ok(`${owner} strip lays its pictures out in a row at ${w}px`,
       strip && strip.display && strip.display.val === 'flex',
       strip && strip.display ? strip.display.val : 'not flex');

    const img = at(strips, owner + ' .shots img', w);
    ok(`${owner} picture fills one slide at ${w}px`,
       img && img.flex && /0 0 100%/.test(img.flex.val), img && img.flex ? img.flex.val : 'no flex');
    ok(`${owner} picture is centred in its slide at ${w}px`,
       img && img['object-fit'] && img['object-fit'].val === 'contain',
       img && img['object-fit'] ? img['object-fit'].val : 'no object-fit');
  }
}

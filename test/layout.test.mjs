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


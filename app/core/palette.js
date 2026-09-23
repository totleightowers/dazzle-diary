/* The colours of a kit, read from its page on the shop.
 *
 * Diamond Art Club prints the whole drill list on every product page —
 * "Colors in this kit" — for anyone, signed in or not, whether or not the kit
 * has ever been bought. Each colour carries its DMC code, DMC's name for it
 * and the colour itself; the specialty diamonds also say what kind they are.
 *
 * So this reads the page rather than asking for permission. It is HTML from
 * somebody else's site, which changes without warning: nothing here trusts it
 * to be well formed, and a page it cannot make sense of gives nothing back
 * rather than half a legend.
 */

/* <li title="310 · Black"><span class="swatch" style="--shade:#000000"></span>…
   and for a specialty diamond:
   <li title="105 · Tan · Aurora Borealis">… <small>Aurora Borealis</small> */
const ITEM = /<li\b[^>]*\btitle="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;
const SHADE = /--shade:\s*(#?[0-9a-fA-F]{3,6})/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,15}$/;

/* The ampersand is unescaped LAST: "&amp;lt;" is the text "&lt;", and
   unescaping the ampersand first would turn it into a "<". */
const tidy = (s) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const hexOf = (s) => {
  const m = SHADE.exec(s || '');
  if (!m) return null;
  let hex = m[1].replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return hex.length === 6 ? '#' + hex.toLowerCase() : null;
};

/* The parts of the page that hold colour lists. DAC prints the same list
   twice — once on the page and once inside the dialog that opens when you tap
   "View full list" — and has reordered them before, so every block is read and
   the codes are de-duplicated rather than trusting one to come first. */
function paletteBlocks(html) {
  const page = String(html || '');
  const out = [];
  for (let i = page.indexOf('class="palette-body"'); i >= 0; i = page.indexOf('class="palette-body"', i + 1)) {
    const foot = page.indexOf('palette-foot', i);
    out.push(page.slice(i, foot > i ? foot : Math.min(page.length, i + 200000)));
  }
  return out;
}

/**
 * Read a kit's colours out of its product page.
 * Returns { sku, shape, colours: [{ code, name, hex, finish }] } — or null
 * when the page has no colour list, which is how DAC ships a kit whose
 * list it has not published (coasters, the MEGA Dazzles, some older kits).
 */
export function readPalette(html) {
  const page = String(html || '');
  const blocks = paletteBlocks(page);
  if (!blocks.length) return null;

  const head = page.slice(Math.max(0, page.indexOf('class="palette"') - 200),
                          page.indexOf('class="palette"') + 400);
  const shape = /data-shape="(round|square)"/.exec(head);
  const sku = /data-palette-sku="([^"]{1,60})"/.exec(head);

  const seen = new Set();
  const colours = [];
  for (const body of blocks) {
    let m;
    ITEM.lastIndex = 0;
    while ((m = ITEM.exec(body))) {
      const parts = tidy(m[1]).split('·').map((x) => x.trim()).filter(Boolean);
      const code = parts[0] || '';
      if (!CODE.test(code) || seen.has(code)) continue;
      seen.add(code);
      /* "310 · Black" is a standard drill; "105 · Tan · Aurora Borealis" is a
         specialty one, and the last part is the finish rather than the name. */
      const finish = parts.length > 2 ? parts[parts.length - 1] : null;
      const name = parts.length > 1 ? parts.slice(1, parts.length > 2 ? -1 : undefined).join(' · ') : null;
      colours.push({ code, name: name ? name.slice(0, 60) : null, hex: hexOf(m[2]),
                     finish: finish ? finish.slice(0, 40) : null });
    }
  }
  if (!colours.length) return null;
  return { sku: sku ? sku[1] : null, shape: shape ? shape[1] : null, colours };
}

/* The name of the section of the page that holds the colour list, so the
   next kit can be asked for just that section — about a tenth of the page.
   Shopify names sections after the theme ("template--25650457411777__60c6…"),
   and DAC publishing a new theme changes the number, so it is read off a real
   page rather than written down anywhere: the section whose wrapper comes
   last before the palette is the one it sits in. */
export function paletteSection(html) {
  const page = String(html || '');
  const at = page.indexOf('data-palette-sku');
  if (at < 0) return null;
  let found = null;
  const wrapper = /id="shopify-section-(template--\d+__[\w-]{1,120})"/g;
  let m;
  while ((m = wrapper.exec(page)) && m.index < at) found = m[1];
  return found;
}

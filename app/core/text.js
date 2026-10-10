/* Merchant text can contain HTML entities even inside JSON. Decode as plain
   text, never markup, and only once so literal entity names stay literal. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×' };

export function decodeHtml(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
      ? String.fromCodePoint(n) : entity;
  });
}

/* Just enough of an .xlsx reader to get rows out of a spreadsheet.
 *
 * An .xlsx file is a zip of XML: a workbook that names the sheets, a sheet per
 * tab, and sometimes a table of shared strings the cells point into. Nothing
 * here needs a library — the zip is read by hand, the compressed parts are
 * inflated by the browser's own DecompressionStream, and the XML is simple
 * and regular enough to read with patterns. Pictures, styles and drawings are
 * never unpacked at all.
 *
 * What comes back is plain: each sheet as rows of cells, keyed by column
 * letter, text as text and numbers as numbers. What the columns mean is for
 * whoever asked.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The files in a zip, by name, each able to hand over its bytes on demand. */
function entries(bytes) {
  // the end-of-directory record sits in the last 64 KB, behind any comment
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('That file is not a spreadsheet (no zip directory found).');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const out = new Map();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error('That spreadsheet is damaged.');
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLen = u16(bytes, at + 28), extraLen = u16(bytes, at + 30), noteLen = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    out.set(name, { method, size, local });
    at += 46 + nameLen + extraLen + noteLen;
  }
  return out;
}

async function inflate(data) {
  if (typeof DecompressionStream !== 'function')
    throw new Error('This phone cannot open spreadsheets (no DecompressionStream).');
  const stream = new Response(data).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes, e) {
  if (u32(bytes, e.local) !== 0x04034b50) throw new Error('That spreadsheet is damaged.');
  const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
  const data = bytes.subarray(start, start + e.size);
  if (e.method === 0) return data;
  if (e.method === 8) return inflate(data);
  throw new Error('That spreadsheet is compressed in a way this app cannot read.');
}

/* XML text back to what it says. The ampersand goes last: "&amp;lt;" is the
   text "&lt;", and unescaping the ampersand first would make it a "<". */
const unxml = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const attrs = (s) => {
  const out = {};
  for (const m of String(s).matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unxml(m[2]);
  return out;
};

// all the text runs inside one string item, joined — rich text splits them up
const textOf = (xml) => [...String(xml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

function readSheet(xml, shared) {
  const rows = [];
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = Number(attrs(r[1]).r) || rows.length + 1;
    const row = {};
    for (const c of String(r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1]);
      const col = (/^[A-Z]+/.exec(a.r || '') || [])[0];
      if (!col) continue;
      const inner = c[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let value;
      if (a.t === 'inlineStr') value = textOf(inner);
      else if (a.t === 's') value = v ? (shared[Number(v[1])] ?? '') : '';
      else if (a.t === 'str' || a.t === 'e') value = v ? unxml(v[1]) : '';
      else if (a.t === 'b') value = v ? v[1] === '1' : '';
      else value = v ? Number(v[1]) : '';
      if (value !== '') row[col] = value;
    }
    rows[at - 1] = row;
  }
  // rows the sheet skipped are empty rows, not missing ones
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = {};
  return rows;
}

/**
 * Every sheet in an .xlsx, by its tab name, as rows of { A: …, B: … }.
 * Row n of the spreadsheet is rows[n - 1]. Numbers stay numbers — a date is
 * the spreadsheet's day count, for the caller to read as a date.
 */
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = entries(bytes);
  const text = async (name) => {
    const e = files.get(name);
    return e ? new TextDecoder().decode(await readEntry(bytes, e)) : null;
  };
  const book = await text('xl/workbook.xml');
  if (!book) throw new Error('That file is not a spreadsheet (no workbook inside).');
  const links = new Map();
  for (const m of String(await text('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    links.set(a.Id, a.Target);
  }
  const sharedXml = await text('xl/sharedStrings.xml');
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const sheets = {};
  const order = [];
  for (const m of book.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const target = links.get(a['r:id']);
    if (!a.name || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await text(path);
    if (xml == null) continue;
    sheets[a.name] = readSheet(xml, shared);
    order.push(a.name);
  }
  return { names: order, sheets };
}

/** A spreadsheet's day count as a date, "2026-09-24". Excel counts from
    30 December 1899, and a time of day is the fraction, which a date drops. */
export function excelDate(n) {
  const days = Number(n);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(days) * 86400000).toISOString().slice(0, 10);
}

/** Is this the start of a zip — which an .xlsx is — rather than text? */
export const looksLikeXlsx = (bytes) => !!bytes && bytes.length > 4
  && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

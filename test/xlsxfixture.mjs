/* Real .xlsx files for the tests, built the way a spreadsheet program builds
 * them: a zip of XML, the parts deflated. Diamond Art Club's export writes its
 * text inline in each cell; `shared: true` writes it the other common way, into
 * a table of shared strings, so the reader is tested against both. */
import { deflateRawSync } from 'node:zlib';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; };

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, store] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = store ? data : deflateRawSync(data);
    const method = store ? 0 : 8;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/**
 * @param sheets  { 'Tab name': [ [cell, cell, …], … ] } — strings and numbers
 * @returns Buffer holding the .xlsx
 */
export function makeXlsx(sheets, { shared = false } = {}) {
  const names = Object.keys(sheets);
  const strings = [];
  const sIndex = (s) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = colName(c) + (r + 1);
      if (v == null || v === '') return `<c r="${ref}" s="1"/>`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return shared ? `<c r="${ref}" t="s"><v>${sIndex(String(v))}</v></c>`
                    : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const parts = names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[n])]);
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...parts,
    // a picture, stored rather than deflated, which the reader must step over
    ['xl/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), true]
  ];
  if (shared) files.push(['xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
    strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`]);
  return zip(files);
}

/* Diamond Art Club's order export, in its own layout: a title, a line of
   notes and a blank row above each table, and a Cover sheet in front. */
export function dacExport(orders) {
  const O = [['Orders'], ['Original purchase currencies · Times: Europe/London'], [],
    ['Order', 'Ordered', 'Payment status', 'Delivery status', 'Currency', 'Original item subtotal',
     'Subtotal after discounts', 'Discounts', 'Shipping', 'Tax', 'Duties', 'Order total', 'Refunds',
     'Total after refunds', 'Payments before refunds', 'Gift-card payments', 'Other payments',
     'Gift-card refunds', 'Other refunds', 'Net payments', 'Details available', 'Cancelled']];
  const I = [['Order items'], ['The items in each order, with their original amounts and allocated discounts.'], [],
    ['Artwork', 'Order', 'Item', 'Quantity', 'Item type', 'Currency', 'Original line price', 'Final line price', 'Allocated discounts']];
  for (const o of orders) {
    const items = o.items.reduce((n, i) => n + i.original - (i.discount || 0), 0);
    const total = o.total ?? Math.round((items + (o.shipping || 0)) * 100) / 100;
    O.push([o.ref, o.serial, o.payment || 'Paid', o.delivery || 'Unfulfilled', 'GBP', 0, 0, 0,
            o.shipping || 0, 0, 0, total, 0, total, total, 0, total, 0, 0, total, 'Available', o.cancelled || '']);
    for (const i of o.items)
      I.push(['', o.ref, i.name, i.qty || 1, 'Product', 'GBP', i.original,
              i.final ?? i.original, i.discount || 0]);
  }
  return makeXlsx({ Cover: [[], ['My orders']], Orders: O, 'Order items': I, Discounts: [['Discounts']], Payments: [['Payments']] });
}

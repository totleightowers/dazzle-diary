/* Diamond Art Club's order export, the spreadsheet kind ("Diamond-Art-Club-
 * Orders-<date>.xlsx"). It replaced the CSV, and it is better: one row per
 * item rather than a comma-joined list of titles, each item with the variant
 * it was (size, colours, drill count) and what it cost after discounts.
 *
 * Read into the same orders the CSV gives, plus a `lines` list that carries
 * what the CSV never could — the exact price of each item.
 *
 * Columns are found by their headings, never by position, so a column added
 * or moved in a later export does not shift everything after it.
 */
import { excelDate } from './xlsx.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

/* The heading row: the first row that has every one of these, by name. The
   rows above it are a title and a line of notes. */
function table(rows, need) {
  const want = need.map((n) => n.toLowerCase());
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || {};
    const at = {};
    for (const [col, v] of Object.entries(row)) at[clean(v).toLowerCase()] = col;
    if (want.every((n) => at[n])) return { at, body: rows.slice(i + 1) };
  }
  return null;
}

/* "A Little Bit of Magic - 19.5" x 19.5" (49.6cm x 49.6cm) / Square with 62
   Colors … / 39,601" is the product title, then the variant. The title can
   itself hold " - " ("Coasters - Blooms", "Old Masters - MEGA Dazzles™"), so
   the split is at the " - " that the canvas size follows, not the first one.
   A pen or a tray has no variant, and its whole name is the title. */
const SIZE = /\s[-–]\s(?=[\d.]+\s*["″”]\s*x\s*[\d.]+)/g;
export function splitItem(name) {
  const s = clean(name);
  let cut = -1;
  for (const m of s.matchAll(SIZE)) cut = m.index;
  if (cut < 0) return { title: s, variant: null, drills: null };
  const variant = s.slice(cut).replace(/^\s[-–]\s/, '');
  const count = /\/\s*([\d,]+)\s*$/.exec(variant);
  return { title: s.slice(0, cut), variant, drills: count ? Number(count[1].replace(/,/g, '')) : null };
}

/** Is this workbook Diamond Art Club's order export? */
export const isDacWorkbook = (book) => !!(book && book.sheets
  && findSheet(book, 'orders') && findSheet(book, 'order items'));

function findSheet(book, name) {
  const key = Object.keys(book.sheets || {}).find((k) => k.trim().toLowerCase() === name);
  return key ? book.sheets[key] : null;
}

/**
 * @param book  what readXlsx gave back
 * @returns { orders, warnings } — the shape parseOrders gives for a CSV, and
 *          each order also has `lines`: [{ title, variant, drills, qty, paid }]
 *          where `paid` is what one of that item cost, discounts taken off.
 */
export function parseDacWorkbook(book) {
  const warnings = [];
  const ordersSheet = findSheet(book, 'orders');
  const itemsSheet = findSheet(book, 'order items');
  if (!ordersSheet || !itemsSheet)
    return { orders: [], warnings: ['That spreadsheet is not a Diamond Art Club order export (no Orders and Order items sheets).'] };

  const O = table(ordersSheet, ['Order', 'Ordered', 'Order total']);
  const I = table(itemsSheet, ['Order', 'Item', 'Original line price']);
  if (!O || !I) return { orders: [], warnings: ['The Orders or Order items sheet has no heading row this app recognises.'] };

  const cell = (t, row, name) => { const col = t.at[name.toLowerCase()]; return col ? row[col] : undefined; };

  /* Each item's price is its original line price less the discount allocated
     to it. Not the "final" price: DAC's export has that already discounted on
     some orders and not on others, while original-less-discount adds up to
     the order total to the penny on every one. */
  const byOrder = new Map();
  for (const row of I.body) {
    const ref = clean(cell(I, row, 'Order'));
    const name = clean(cell(I, row, 'Item'));
    if (!ref || !name) continue;
    const qty = Math.max(1, Math.round(num(cell(I, row, 'Quantity')) || 1));
    const original = num(cell(I, row, 'Original line price'));
    const discount = num(cell(I, row, 'Allocated discounts')) || 0;
    const paidLine = original == null ? null : original - discount;
    const { title, variant, drills } = splitItem(name);
    if (!byOrder.has(ref)) byOrder.set(ref, []);
    byOrder.get(ref).push({ title, variant, drills, qty, raw: name,
                            paidLine, paid: paidLine == null ? null : round2(paidLine / qty) });
  }

  const orders = [];
  for (const row of O.body) {
    const ref = clean(cell(O, row, 'Order'));
    if (!ref) continue;
    const cancelled = clean(cell(O, row, 'Cancelled'));
    if (cancelled && !/^(no|false|0)$/i.test(cancelled)) continue;     // a cancelled order was never bought
    const lines = byOrder.get(ref) || [];
    if (!lines.length) { warnings.push(`Order ${ref} has no items listed.`); continue; }

    /* Shipping, tax and duty belong to the whole order. Shared out over its
       items in proportion to what each cost, so a kit's price is what it
       really came to — which is what the CSV import gave a kit bought alone. */
    const extra = ['Shipping', 'Tax', 'Duties'].reduce((n, k) => n + (num(cell(O, row, k)) || 0), 0);
    const itemsTotal = lines.reduce((n, l) => n + (l.paidLine || 0), 0);
    if (extra && itemsTotal > 0) {
      for (const l of lines) if (l.paidLine != null)
        l.paid = round2((l.paidLine + extra * l.paidLine / itemsTotal) / l.qty);
    }
    const refunds = num(cell(O, row, 'Refunds')) || 0;
    orders.push({
      ref,
      date: excelDate(cell(O, row, 'Ordered')),
      paymentStatus: clean(cell(O, row, 'Payment status')).toLowerCase(),
      fulfillmentStatus: clean(cell(O, row, 'Delivery status')).toLowerCase(),
      total: num(cell(O, row, 'Order total')),
      refunds,
      currency: clean(cell(O, row, 'Currency')).toUpperCase() || 'GBP',
      fragments: lines.map((l) => l.title),
      lines
    });
  }
  if (!orders.length && !warnings.length) warnings.push('No orders found in that spreadsheet.');
  return { orders, warnings };
}

// Order-history CSV parsing.
//
// Two traps in the Diamond Art Club export, both silent if you split naively:
//   1. the Products column is itself a comma-joined list inside ONE quoted field
//   2. product titles can contain commas ("Frejya, Goddess of Beauty & War")
// (2) is unrecoverable from the CSV alone — it is resolved later against the
// catalogue in lib/dac.js by re-joining fragments that only match when combined.

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\r') {
      // ignore
    } else if (c === '\n') {
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

const money = (s) => {
  const n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const currencyOf = (s) => {
  const t = String(s || '');
  if (t.includes('£')) return 'GBP';
  if (t.includes('$')) return 'USD';
  if (t.includes('€')) return 'EUR';
  return 'GBP';
};

// "2026/08/18" | "2026-08-18" | "18/08/2026" -> "2026-08-18"
export function normaliseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Parse an order-history export into { orders, warnings }. Column order is
 *  taken from the header row, so a reordered or extra-column export still works. */
export function parseOrders(text) {
  const rows = parseCsv(text);
  const warnings = [];
  if (!rows.length) return { orders: [], warnings: ['The file is empty.'] };

  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iOrder = col('order', 'order number', 'name', '#');
  const iDate = col('date', 'created at', 'order date');
  const iPay = col('payment status', 'financial status', 'payment');
  const iFul = col('fulfillment status', 'fulfilment status', 'fulfillment');
  const iTotal = col('total', 'total price', 'order total');
  const iProd = col('products', 'lineitem name', 'line items', 'items');

  if (iProd < 0) {
    return { orders: [], warnings: ['No "Products" column found. Expected a header row with Order, Date, Total and Products.'] };
  }

  const orders = [];
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    const productsRaw = (f[iProd] || '').trim();
    if (!productsRaw) continue;
    const total = iTotal >= 0 ? money(f[iTotal]) : null;
    orders.push({
      ref: iOrder >= 0 ? (f[iOrder] || '').trim() : '',
      date: iDate >= 0 ? normaliseDate(f[iDate]) : null,
      paymentStatus: iPay >= 0 ? (f[iPay] || '').trim() : '',
      fulfillmentStatus: iFul >= 0 ? (f[iFul] || '').trim() : '',
      total,
      currency: iTotal >= 0 ? currencyOf(f[iTotal]) : 'GBP',
      // fragments, not final titles — comma-in-title is repaired against the catalogue
      fragments: productsRaw.split(',').map(s => s.trim()).filter(Boolean)
    });
  }
  if (!orders.length) warnings.push('No order rows found below the header.');
  return { orders, warnings };
}

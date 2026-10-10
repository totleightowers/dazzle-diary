// Synthetic examples of DAC's version-1 order export JSON (amounts in pennies).
export const orderLine = (title = 'Moon Eater', extra = {}) => ({
  title, quantity: 1, original_line_price: 5000, discount_count: 1,
  discount_allocations: [{ amount: 1000 }], ...extra
});
export const dacOrder = (extra = {}) => ({
  id: '123', name: '#123', created_at: '2026-09-24T12:00:00+01:00', cancelled: false,
  financial_status: 'paid', fulfillment_status: 'fulfilled', formatted_total: '£44.00 GBP',
  total_price: 4400, total_refunded_amount: 0, shipping_price: 400, tax_price: 0,
  total_duties: null, line_count: 1, lines: [orderLine()], ...extra
});
export const orderPage = (orders, extra = {}) => ({
  version: 1, authenticated: true, customer_id: '77', page: 1, pages: 1,
  total: orders.length, orders_count: orders.length, orders, ...extra
});
export const scanResult = orders => ({ version: 1, done: true, orders });

/** Quote arithmetic, shared by the server and the quote form so both show the same totals. Pure: no database. */

/** GST slabs in use (0, 5 and 18 since Sept 2025; 12 and 28 still appear on older rate cards; 40 for luxury items). */
export const GST_RATES = [0, 5, 12, 18, 28, 40] as const;

export interface PricedQuote {
  lines: { amount: number; gst: number }[];
  subtotal: number;
  tax: number;
  total: number;
}

/** Line and quote totals worked out in whole paise, so rounding is exact and matches on every screen. */
export function priceLines(
  items: { quantity: number; rate: number; gstRate: number }[],
): PricedQuote {
  let subtotal = 0;
  let tax = 0;
  const lines = items.map((i) => {
    const q = Number.isFinite(i.quantity) ? i.quantity : 0;
    const r = Number.isFinite(i.rate) ? i.rate : 0;
    const amount = Math.round(q * Math.round(r * 100));
    const gst = Math.round(
      (amount * (Number.isFinite(i.gstRate) ? i.gstRate : 0)) / 100,
    );
    subtotal += amount;
    tax += gst;
    return { amount: amount / 100, gst: gst / 100 };
  });
  return {
    lines,
    subtotal: subtotal / 100,
    tax: tax / 100,
    total: (subtotal + tax) / 100,
  };
}

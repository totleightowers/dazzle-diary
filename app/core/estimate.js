/**
 * Estimating a diamond count from canvas size.
 *
 * Some shops publish drill counts (Diamond Art Club does); most do not. But a
 * canvas is a regular grid, so the count is just area × density — and the
 * density is fixed by the drill size, not the design.
 *
 * These two figures are not guesses: they are the medians measured across
 * 3,595 kits that publish BOTH a size and a real count. They also match the
 * physical drill sizes — square drills are 2.5 mm, which is exactly 16 per cm².
 *
 *   Round   12.78 /cm²   (n=1218, p10 12.53 – p90 13.16)   98% within 5%
 *   Square  16.08 /cm²   (n=2377, p10 15.87 – p90 16.13)   95% within 5%
 */
export const DRILL_DENSITY = { Round: 12.78, Square: 16.08 };

/** Round to something that reads as an estimate rather than a measurement. */
const coarse = (n) => n >= 20000 ? Math.round(n / 500) * 500 : Math.round(n / 100) * 100;

/**
 * @returns {number|null} estimated drills, or null when we cannot say
 */
export function estimateDrills(width_in, height_in, shape) {
  if (width_in == null || height_in == null) return null;
  const density = DRILL_DENSITY[shape];
  if (!density) return null;                       // unknown drill shape: no estimate
  const cm2 = (width_in * 2.54) * (height_in * 2.54);
  if (!(cm2 > 20)) return null;
  return coarse(cm2 * density);
}

/** Fill in a missing count, flagging it so nothing pretends to be measured. */
export function withEstimatedDrills(row) {
  if (!row || row.drills != null) return row;
  const est = estimateDrills(row.width_in, row.height_in, row.shape);
  return est == null ? row : { ...row, drills: est, drills_estimated: 1 };
}

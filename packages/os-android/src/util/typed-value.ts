import type { DisplayMetrics } from '../content/context';

/**
 * android.util.TypedValue's dimension units. Mimicry's views measure in dp
 * (see View.ts), so applyDimension converts *to dp*, not to pixels:
 * COMPLEX_UNIT_DIP is the identity, SP multiplies by the font scale, PX
 * divides by the density. Code that feeds the result to setPadding,
 * setTextSize(COMPLEX_UNIT_PX…) or a layout param keeps working, because
 * every one of those takes Mimicry units too.
 */
export const TypedValue = {
  COMPLEX_UNIT_PX: 0,
  COMPLEX_UNIT_DIP: 1,
  COMPLEX_UNIT_SP: 2,
  COMPLEX_UNIT_PT: 3,
  COMPLEX_UNIT_IN: 4,
  COMPLEX_UNIT_MM: 5,

  /** `value` in `unit` → dp, for a display with these metrics. */
  applyDimension(unit: number, value: number, metrics: DisplayMetrics): number {
    const density = metrics.density;
    switch (unit) {
      case TypedValue.COMPLEX_UNIT_PX:
        return value / density;
      case TypedValue.COMPLEX_UNIT_DIP:
        return value;
      case TypedValue.COMPLEX_UNIT_SP:
        return value * (metrics.scaledDensity / density);
      case TypedValue.COMPLEX_UNIT_PT:
        return (value * metrics.xdpi * (1 / 72)) / density;
      case TypedValue.COMPLEX_UNIT_IN:
        return (value * metrics.xdpi) / density;
      case TypedValue.COMPLEX_UNIT_MM:
        return (value * metrics.xdpi * (1 / 25.4)) / density;
      default:
        return 0;
    }
  },

  /** dp → `unit` (the inverse of applyDimension). */
  deriveDimension(unit: number, dp: number, metrics: DisplayMetrics): number {
    const one = TypedValue.applyDimension(unit, 1, metrics);
    return one === 0 ? 0 : dp / one;
  },
} as const;

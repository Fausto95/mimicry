/**
 * SVG lengths as react-native-svg passes them natively: numbers (user units)
 * or strings with a unit or a percentage. Percentages resolve against the
 * nearest viewport — its width for x-like values, height for y-like values,
 * and the normalized diagonal for everything else (radii, stroke width).
 */
export type LengthAxis = 'x' | 'y' | 'other';

export interface SvgViewport {
  width: number;
  height: number;
}

/** User units per unit, as in react-native-svg's native PropHelper (90 dpi). */
const UNITS: Record<string, number> = { px: 1, pt: 1.25, pc: 15, mm: 3.543307, cm: 35.43307, in: 90 };
const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i;

export function resolveLength(value: unknown, axis: LengthAxis, viewport: SvgViewport, fontSize = 12, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const m = LENGTH.exec(value);
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === '%') {
    const base = axis === 'x' ? viewport.width : axis === 'y' ? viewport.height : Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
    return (n / 100) * base;
  }
  if (unit === 'em') return n * fontSize;
  if (unit === 'ex') return (n * fontSize) / 2;
  return n * (UNITS[unit] ?? 1);
}

/**
 * Gradient and pattern coordinates in objectBoundingBox units: fractions of
 * the box, where "50%" and 0.5 mean the same thing.
 */
export function resolveFraction(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const m = LENGTH.exec(value);
  if (!m) return fallback;
  const n = Number(m[1]);
  return m[2] === '%' ? n / 100 : n;
}

/** A list prop (`x`, `dx`, `strokeDasharray`…): a single value or an array. */
export function lengthList(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.trim().split(/[\s,]+/).filter(Boolean);
  return [value];
}

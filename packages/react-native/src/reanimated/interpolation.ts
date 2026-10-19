import { parseColor } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';
import { rgbaComponents, rgbaString } from './values';

/** interpolate / interpolateColor / Extrapolation, with Reanimated's semantics. */
export const Extrapolation = { IDENTITY: 'identity', CLAMP: 'clamp', EXTEND: 'extend' } as const;
export type ExtrapolationType = (typeof Extrapolation)[keyof typeof Extrapolation];
export type ExtrapolationConfig = { extrapolateLeft?: ExtrapolationType; extrapolateRight?: ExtrapolationType };
/** @deprecated Reanimated's old name */
export const Extrapolate = Extrapolation;

function extrapolationOf(type: ExtrapolationType | ExtrapolationConfig | undefined): { left: ExtrapolationType; right: ExtrapolationType } {
  if (!type) return { left: 'extend', right: 'extend' };
  if (typeof type === 'string') return { left: type, right: type };
  return { left: type.extrapolateLeft ?? 'extend', right: type.extrapolateRight ?? 'extend' };
}

export function interpolate(
  x: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  type?: ExtrapolationType | ExtrapolationConfig,
): number {
  if (inputRange.length < 2 || outputRange.length < 2) throw new Error('Reanimated: interpolate needs at least two input and output values.');
  const { left, right } = extrapolationOf(type);
  const n = inputRange.length;
  let i = 1;
  while (i < n - 1 && x > inputRange[i]!) i++;
  const inLo = inputRange[i - 1]!;
  const inHi = inputRange[i]!;
  const outLo = outputRange[i - 1]!;
  const outHi = outputRange[i]!;
  if (x < inputRange[0]! && i === 1) {
    if (left === 'clamp') return outputRange[0]!;
    if (left === 'identity') return x;
  }
  if (x > inputRange[n - 1]!) {
    if (right === 'clamp') return outputRange[n - 1]!;
    if (right === 'identity') return x;
  }
  if (inHi === inLo) return x <= inLo ? outLo : outHi;
  return outLo + ((x - inLo) / (inHi - inLo)) * (outHi - outLo);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── colors ─────────────────────────────────────────────────────────────────

const colorContext = () => maybeEngine()?.colorContext;

function toPacked(color: unknown): number {
  const c = parseColor(color, colorContext());
  return c ?? 0;
}

export function isColor(value: unknown): boolean {
  return (typeof value === 'string' || typeof value === 'number') && parseColor(value, colorContext()) != null;
}

/** [r, g, b, a] all in 0..1 (Reanimated's ParsedColorArray). */
export function convertToRGBA(color: unknown): [number, number, number, number] {
  const [r, g, b, a] = rgbaComponents(toPacked(color));
  return [r / 255, g / 255, b / 255, a];
}

export function contrastColor(color: string | number): 'white' | 'black' {
  const [r, g, b] = convertToRGBA(color);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 * 0.05 >= (luminance + 0.05) ** 2 ? 'white' : 'black';
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export interface InterpolationOptions {
  gamma?: number;
  useCorrectedHSVInterpolation?: boolean;
}

/** Interpolates colors in RGB (gamma-corrected, Reanimated's default) or HSV; returns an rgba() string. */
export function interpolateColor(
  value: number,
  inputRange: readonly number[],
  outputRange: readonly (string | number)[],
  colorSpace: 'RGB' | 'HSV' | 'LAB' = 'RGB',
  options: InterpolationOptions = {},
): string {
  const colors = outputRange.map(convertToRGBA);
  const channel = (i: number, map: (c: [number, number, number, number]) => number) =>
    interpolate(value, inputRange, colors.map(map), 'clamp');
  if (colorSpace === 'HSV') {
    const hsv = colors.map((c) => [...rgbToHsv(c[0], c[1], c[2]), c[3]] as [number, number, number, number]);
    if (options.useCorrectedHSVInterpolation !== false) {
      // Take the short way around the hue circle.
      for (let i = 1; i < hsv.length; i++) {
        const d = hsv[i]![0] - hsv[i - 1]![0];
        if (Math.abs(d) > 0.5) hsv[i]![0] -= Math.sign(d);
      }
    }
    const h = interpolate(value, inputRange, hsv.map((c) => c[0]), 'clamp');
    const s = interpolate(value, inputRange, hsv.map((c) => c[1]), 'clamp');
    const v = interpolate(value, inputRange, hsv.map((c) => c[2]), 'clamp');
    const a = interpolate(value, inputRange, hsv.map((c) => c[3]), 'clamp');
    const [r, g, b] = hsvToRgb(((h % 1) + 1) % 1, s, v);
    return rgbaString(r * 255, g * 255, b * 255, a);
  }
  const gamma = options.gamma ?? 2.2;
  const lin = (c: number) => Math.pow(c, gamma);
  const out = (c: number) => Math.pow(Math.max(0, c), 1 / gamma) * 255;
  return rgbaString(
    out(channel(0, (c) => lin(c[0]))),
    out(channel(1, (c) => lin(c[1]))),
    out(channel(2, (c) => lin(c[2]))),
    channel(3, (c) => c[3]),
  );
}

/** Colors travel as packed RGBA uint32: 0xRRGGBBAA. */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export const rgba = (r: number, g: number, b: number, a = 1): number =>
  (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (Math.round(clamp01(a) * 255) & 255)) >>> 0;

export const TRANSPARENT = 0;
export const BLACK = rgba(0, 0, 0, 1);
export const WHITE = rgba(255, 255, 255, 1);

export const red = (c: number) => (c >>> 24) & 255;
export const green = (c: number) => (c >>> 16) & 255;
export const blue = (c: number) => (c >>> 8) & 255;
export const alphaByte = (c: number) => c & 255;
export const alphaOf = (c: number) => (c & 255) / 255;

/** Multiply a color's alpha. */
export const withAlpha = (c: number, factor: number): number =>
  ((c & 0xffffff00) | (Math.round(alphaByte(c) * clamp01(factor)) & 255)) >>> 0;

export const isTransparent = (c: number) => (c & 255) === 0;

/** Linear interpolation in sRGB space (what UIKit/Android animators do). */
export function mixColor(a: number, b: number, t: number): number {
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (
    ((lerp(red(a), red(b)) << 24) |
      (lerp(green(a), green(b)) << 16) |
      (lerp(blue(a), blue(b)) << 8) |
      lerp(alphaByte(a), alphaByte(b))) >>>
    0
  );
}

const cssCache = new Map<number, string>();

/** CSS string for Canvas2D. Cached because hosts call this per command. */
export function toCss(c: number): string {
  let s = cssCache.get(c);
  if (s === undefined) {
    s = `rgba(${red(c)},${green(c)},${blue(c)},${Math.round(alphaOf(c) * 1000) / 1000})`;
    if (cssCache.size > 4096) cssCache.clear();
    cssCache.set(c, s);
  }
  return s;
}

export function toHex(c: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const a = alphaByte(c);
  return '#' + hex(red(c)) + hex(green(c)) + hex(blue(c)) + (a === 255 ? '' : hex(a));
}

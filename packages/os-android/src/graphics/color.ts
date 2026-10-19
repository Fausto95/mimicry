import { parseColorString } from '@mimicry/os-core';

/**
 * android.graphics.Color: colors are packed ARGB ints (0xAARRGGBB), as on
 * Android. The render server speaks RGBA; `Color.toRgba` converts at the
 * drawing boundary.
 */
export const Color = {
  BLACK: 0xff000000 | 0,
  DKGRAY: 0xff444444 | 0,
  GRAY: 0xff888888 | 0,
  LTGRAY: 0xffcccccc | 0,
  WHITE: 0xffffffff | 0,
  RED: 0xffff0000 | 0,
  GREEN: 0xff00ff00 | 0,
  BLUE: 0xff0000ff | 0,
  YELLOW: 0xffffff00 | 0,
  CYAN: 0xff00ffff | 0,
  MAGENTA: 0xffff00ff | 0,
  TRANSPARENT: 0,

  argb(alpha: number, red: number, green: number, blue: number): number {
    return ((alpha & 255) << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
  },

  rgb(red: number, green: number, blue: number): number {
    return Color.argb(255, red, green, blue);
  },

  alpha(color: number): number {
    return (color >>> 24) & 255;
  },

  red(color: number): number {
    return (color >> 16) & 255;
  },

  green(color: number): number {
    return (color >> 8) & 255;
  },

  blue(color: number): number {
    return color & 255;
  },

  /** '#RRGGBB', '#AARRGGBB' or a color name; throws on anything else, like Android. */
  parseColor(value: string): number {
    if (/^#[0-9a-fA-F]{8}$/.test(value)) {
      const n = parseInt(value.slice(1), 16);
      return n | 0;
    }
    const rgba = parseColorString(value);
    if (rgba == null) throw new Error(`Unknown color: ${value}`);
    return Color.fromRgba(rgba);
  },

  /** ARGB int → the render server's packed RGBA */
  toRgba(argb: number): number {
    return (((argb << 8) | ((argb >>> 24) & 255)) >>> 0);
  },

  /** packed RGBA → ARGB int */
  fromRgba(rgba: number): number {
    return ((rgba >>> 8) | ((rgba & 255) << 24)) | 0;
  },
} as const;

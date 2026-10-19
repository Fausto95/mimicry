import { rgba, type Appearance } from '@mimicry/protocol';

/**
 * Color parsing with React Native semantics: CSS named colors, hex (3/4/6/8),
 * rgb()/rgba()/hsl()/hsla()/hwb(), processed ints (0xAARRGGBB), plus the
 * platform color objects produced by PlatformColor() and DynamicColorIOS().
 */
const NAMED =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,' +
  'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
  'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,' +
  'lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,' +
  'mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,' +
  'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
  'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,' +
  'peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,' +
  'royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
  'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,' +
  'steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,' +
  'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

const named = new Map<string, number>();
for (const pair of NAMED.split(',')) {
  const [name, hex] = pair.split(':') as [string, string];
  named.set(name, (parseInt(hex, 16) * 256 + 255) >>> 0);
}
named.set('transparent', 0);

const cache = new Map<string, number | null>();

/** Resolves platform color objects. Supplied by the active platform kit. */
export interface ColorContext {
  appearance: Appearance;
  semantic(name: string): number | null;
}

export function parseColor(value: unknown, ctx?: ColorContext): number | null {
  if (value == null || value === false) return null;
  if (typeof value === 'number') {
    // processColor() output: 0xAARRGGBB
    const n = value >>> 0;
    return (((n & 0x00ffffff) << 8) | (n >>> 24)) >>> 0;
  }
  if (typeof value === 'string') return parseColorString(value);
  if (typeof value === 'object') {
    const v = value as Record<string, any>;
    if (Array.isArray(v.semantic) && ctx) {
      for (const name of v.semantic) {
        const c = ctx.semantic(String(name));
        if (c != null) return c;
      }
      return null;
    }
    if (Array.isArray(v.resource_paths) && ctx) {
      for (const name of v.resource_paths) {
        const c = ctx.semantic(String(name));
        if (c != null) return c;
      }
      return null;
    }
    if (v.dynamic && typeof v.dynamic === 'object') {
      const appearance = ctx?.appearance ?? 'light';
      return parseColor(appearance === 'dark' ? v.dynamic.dark : v.dynamic.light, ctx);
    }
  }
  return null;
}

export function parseColorString(input: string): number | null {
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  const result = parseUncached(input.trim().toLowerCase());
  if (cache.size > 2048) cache.clear();
  cache.set(input, result);
  return result;
}

function parseUncached(s: string): number | null {
  const n = named.get(s);
  if (n !== undefined) return n;
  if (s.startsWith('#')) return parseHex(s.slice(1));
  const fn = /^(rgba?|hsla?|hwb)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] !== undefined ? parseAlpha(parts[3]) : 1;
  if (fn[1]!.startsWith('rgb')) {
    const ch = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    return rgba(clamp255(ch(parts[0]!)), clamp255(ch(parts[1]!)), clamp255(ch(parts[2]!)), alpha);
  }
  const h = parseHue(parts[0]!);
  const a = parseFloat(parts[1]!) / 100;
  const b = parseFloat(parts[2]!) / 100;
  if (fn[1] === 'hwb') {
    const [r, g, bl] = hwbToRgb(h, a, b);
    return rgba(r, g, bl, alpha);
  }
  const [r, g, bl] = hslToRgb(h, a, b);
  return rgba(r, g, bl, alpha);
}

const clamp255 = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
const parseAlpha = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));

function parseHue(p: string): number {
  if (p.endsWith('deg')) return parseFloat(p);
  if (p.endsWith('rad')) return (parseFloat(p) * 180) / Math.PI;
  if (p.endsWith('turn')) return parseFloat(p) * 360;
  return parseFloat(p);
}

function parseHex(hex: string): number | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length === 6) return (parseInt(hex, 16) * 256 + 255) >>> 0;
  if (hex.length === 8) return parseInt(hex, 16) >>> 0;
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [clamp255(conv(h + 1 / 3) * 255), clamp255(conv(h) * 255), clamp255(conv(h - 1 / 3) * 255)];
}

function hwbToRgb(h: number, w: number, b: number): [number, number, number] {
  if (w + b >= 1) {
    const gray = clamp255((w / (w + b)) * 255);
    return [gray, gray, gray];
  }
  const [r, g, bl] = hslToRgb(h, 1, 0.5);
  const f = (c: number) => clamp255((c / 255) * (1 - w - b) * 255 + w * 255);
  return [f(r), f(g), f(bl)];
}

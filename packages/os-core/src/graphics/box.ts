import { alphaOf, withAlpha, type CommandWriter, type Radii } from '@mimicry/protocol';
import type { PlatformName } from '@mimicry/protocol';
import { parseColor, type ColorContext } from './color';
import type { CSSStyle } from './css';
import type { Rect } from '../geometry/matrix';
import { parseLinearGradients } from './gradient';

/**
 * Box decoration: shadows, background, gradients and borders, with React
 * Native's per-corner radii and per-side border widths/colors.
 */
export interface BoxGeometry extends Rect {
  radii: Radii;
}

function pct(value: unknown, basis: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.endsWith('%')) return (parseFloat(value) / 100) * basis;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function resolveRadii(style: CSSStyle, w: number, h: number): Radii {
  const basis = Math.min(w, h);
  const all = style.borderRadius != null ? pct(style.borderRadius, basis) : 0;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (style[k] != null) return pct(style[k], basis);
    return all;
  };
  let tl = pick('borderTopLeftRadius', 'borderTopStartRadius', 'borderStartStartRadius');
  let tr = pick('borderTopRightRadius', 'borderTopEndRadius', 'borderStartEndRadius');
  let br = pick('borderBottomRightRadius', 'borderBottomEndRadius', 'borderEndEndRadius');
  let bl = pick('borderBottomLeftRadius', 'borderBottomStartRadius', 'borderEndStartRadius');
  // CSS-style proportional reduction when radii overlap
  const f = Math.min(
    1,
    tl + tr > 0 ? w / (tl + tr) : 1,
    bl + br > 0 ? w / (bl + br) : 1,
    tl + bl > 0 ? h / (tl + bl) : 1,
    tr + br > 0 ? h / (tr + br) : 1,
  );
  if (f < 1) {
    tl *= f;
    tr *= f;
    br *= f;
    bl *= f;
  }
  return [Math.max(0, tl), Math.max(0, tr), Math.max(0, br), Math.max(0, bl)];
}

export const hasRadii = (r: Radii) => r[0] > 0 || r[1] > 0 || r[2] > 0 || r[3] > 0;

export interface Borders {
  top: number;
  right: number;
  bottom: number;
  left: number;
  colors: [number, number, number, number];
  style: 'solid' | 'dashed' | 'dotted';
}

export function resolveBorders(style: CSSStyle, colors: ColorContext, fallbackColor: number): Borders | null {
  const all = num(style.borderWidth);
  const top = num(style.borderTopWidth) ?? all ?? 0;
  const right = num(style.borderRightWidth) ?? num(style.borderEndWidth) ?? all ?? 0;
  const bottom = num(style.borderBottomWidth) ?? all ?? 0;
  const left = num(style.borderLeftWidth) ?? num(style.borderStartWidth) ?? all ?? 0;
  if (top <= 0 && right <= 0 && bottom <= 0 && left <= 0) return null;
  const base = parseColor(style.borderColor, colors) ?? fallbackColor;
  const c = (k1: string, k2?: string) => parseColor(style[k1], colors) ?? (k2 ? parseColor(style[k2], colors) : null) ?? base;
  return {
    top, right, bottom, left,
    colors: [c('borderTopColor', 'borderBlockStartColor'), c('borderRightColor', 'borderEndColor'), c('borderBottomColor', 'borderBlockEndColor'), c('borderLeftColor', 'borderStartColor')],
    style: style.borderStyle === 'dashed' ? 'dashed' : style.borderStyle === 'dotted' ? 'dotted' : 'solid',
  };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface ShadowSpec {
  color: number;
  blur: number;
  dx: number;
  dy: number;
  spread: number;
  inset: boolean;
}

/** boxShadow (both platforms), iOS shadow* props, Android elevation. */
export function resolveShadows(style: CSSStyle, platform: PlatformName, colors: ColorContext): ShadowSpec[] {
  const out: ShadowSpec[] = [];
  if (style.boxShadow) out.push(...parseBoxShadow(style.boxShadow, colors));
  if (platform === 'ios' && style.shadowColor != null || platform === 'ios' && style.shadowOpacity) {
    const color = parseColor(style.shadowColor ?? 'black', colors);
    const opacity = typeof style.shadowOpacity === 'number' ? style.shadowOpacity : 0;
    if (color != null && opacity > 0) {
      const offset = style.shadowOffset ?? { width: 0, height: -3 };
      out.push({
        color: withAlpha(color, opacity),
        blur: (typeof style.shadowRadius === 'number' ? style.shadowRadius : 3) * 2,
        dx: offset.width ?? 0,
        dy: offset.height ?? 0,
        spread: 0,
        inset: false,
      });
    }
  }
  if (platform === 'android' && typeof style.elevation === 'number' && style.elevation > 0) {
    const e = style.elevation;
    const tint = parseColor(style.shadowColor, colors);
    const key = tint != null ? withAlpha(tint, 0.24 * alphaOf(tint)) : withAlpha(0x000000ff, 0.24);
    const ambient = tint != null ? withAlpha(tint, 0.12 * alphaOf(tint)) : withAlpha(0x000000ff, 0.12);
    // Material's two light sources: a soft ambient shadow and a directional key shadow.
    out.push({ color: ambient, blur: e * 1.1, dx: 0, dy: e * 0.15, spread: 0, inset: false });
    out.push({ color: key, blur: e * 0.9, dx: 0, dy: e * 0.55, spread: -e * 0.1, inset: false });
  }
  return out;
}

function parseBoxShadow(value: unknown, colors: ColorContext): ShadowSpec[] {
  if (Array.isArray(value)) {
    return value
      .map((v: any) => {
        const color = parseColor(v.color ?? 'black', colors);
        if (color == null) return null;
        return {
          color,
          blur: v.blurRadius ?? 0,
          dx: v.offsetX ?? 0,
          dy: v.offsetY ?? 0,
          spread: v.spreadDistance ?? 0,
          inset: !!v.inset,
        };
      })
      .filter((s): s is ShadowSpec => s !== null);
  }
  if (typeof value !== 'string') return [];
  return splitTopLevel(value, ',').map((part) => {
    const tokens = splitTopLevel(part.trim(), ' ').filter(Boolean);
    let inset = false;
    const lengths: number[] = [];
    let color: number | null = null;
    for (const t of tokens) {
      if (t === 'inset') inset = true;
      else if (/^-?[\d.]+(px)?$/.test(t)) lengths.push(parseFloat(t));
      else color = parseColor(t, colors);
    }
    return {
      color: color ?? parseColor('black')!,
      dx: lengths[0] ?? 0,
      dy: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      inset,
    };
  });
}

/** split on a separator, ignoring separators inside parentheses */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}

export function shadowExtent(shadows: ShadowSpec[]): number {
  let m = 0;
  for (const s of shadows) {
    if (s.inset) continue;
    m = Math.max(m, s.blur + Math.abs(s.dx) + Math.abs(s.dy) + Math.max(0, s.spread));
  }
  return m;
}

export function drawShadows(w: CommandWriter, box: BoxGeometry, shadows: ShadowSpec[], inset: boolean): void {
  for (const s of shadows) {
    if (s.inset !== inset) continue;
    w.boxShadow(box.x, box.y, box.w, box.h, box.radii, s.color, s.blur, s.dx, s.dy, s.spread, s.inset);
  }
}

export function drawBackground(w: CommandWriter, box: BoxGeometry, style: CSSStyle, colors: ColorContext): void {
  const bg = parseColor(style.backgroundColor, colors);
  if (bg != null && bg !== 0) {
    if (hasRadii(box.radii)) w.fillRRect(box.x, box.y, box.w, box.h, box.radii, bg);
    else w.fillRect(box.x, box.y, box.w, box.h, bg);
  }
  const image = style.experimental_backgroundImage ?? style.backgroundImage;
  if (image) {
    for (const g of parseLinearGradients(image, box.w, box.h, colors)) {
      w.linearGradientRRect(box.x, box.y, box.w, box.h, box.radii, box.x + g.x0, box.y + g.y0, box.x + g.x1, box.y + g.y1, g.stops);
    }
  }
}

export function drawBorders(w: CommandWriter, box: BoxGeometry, b: Borders): void {
  const uniformWidth = b.top === b.right && b.right === b.bottom && b.bottom === b.left;
  const uniformColor = b.colors.every((c) => c === b.colors[0]);
  const dash = b.style === 'dashed' ? 1 : b.style === 'dotted' ? 2 : 0;
  if (uniformWidth && uniformColor) {
    const half = b.top / 2;
    const r = box.radii.map((v) => Math.max(0, v - half)) as unknown as Radii;
    w.strokeRRect(box.x + half, box.y + half, box.w - b.top, box.h - b.top, r, b.top, b.colors[0], dash);
    return;
  }
  const inner = {
    x: box.x + b.left,
    y: box.y + b.top,
    w: Math.max(0, box.w - b.left - b.right),
    h: Math.max(0, box.h - b.top - b.bottom),
  };
  const innerRadii: Radii = [
    Math.max(0, box.radii[0] - Math.max(b.left, b.top)),
    Math.max(0, box.radii[1] - Math.max(b.right, b.top)),
    Math.max(0, box.radii[2] - Math.max(b.right, b.bottom)),
    Math.max(0, box.radii[3] - Math.max(b.left, b.bottom)),
  ];
  if (uniformColor) {
    w.fillRing(box.x, box.y, box.w, box.h, box.radii, inner.x, inner.y, inner.w, inner.h, innerRadii, b.colors[0]);
    return;
  }
  // Per-side colors: clip the ring to each side's trapezoid.
  const cx = box.x;
  const cy = box.y;
  const ix = inner.x;
  const iy = inner.y;
  const ir = inner.x + inner.w;
  const ib = inner.y + inner.h;
  const r = box.x + box.w;
  const bt = box.y + box.h;
  const sides: Array<[number, number[]]> = [
    [b.colors[0], [cx, cy, r, cy, ir, iy, ix, iy]],
    [b.colors[1], [r, cy, r, bt, ir, ib, ir, iy]],
    [b.colors[2], [r, bt, cx, bt, ix, ib, ir, ib]],
    [b.colors[3], [cx, bt, cx, cy, ix, iy, ix, ib]],
  ];
  sides.forEach(([color, p], i) => {
    const width = [b.top, b.right, b.bottom, b.left][i]!;
    if (width <= 0) return;
    w.save();
    w.pathBegin().moveTo(p[0]!, p[1]!).lineTo(p[2]!, p[3]!).lineTo(p[4]!, p[5]!).lineTo(p[6]!, p[7]!).closePath().clipPath(0);
    w.fillRing(box.x, box.y, box.w, box.h, box.radii, inner.x, inner.y, inner.w, inner.h, innerRadii, color);
    w.restore();
  });
}

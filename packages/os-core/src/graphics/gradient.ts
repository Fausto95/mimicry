import { parseColor, type ColorContext } from './color';

/**
 * CSS linear-gradient() for `experimental_backgroundImage` (React Native
 * 0.76+) and the expo-linear-gradient shim.
 */
export interface LinearGradient {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: Array<[number, number]>;
}

const SIDES: Record<string, number> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315,
};

export function parseLinearGradients(value: unknown, w: number, h: number, colors: ColorContext): LinearGradient[] {
  const items = Array.isArray(value) ? value : [value];
  const out: LinearGradient[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const re = /linear-gradient\(((?:[^()]|\([^()]*\))*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(item))) {
        const g = fromCss(m[1]!, w, h, colors);
        if (g) out.push(g);
      }
    } else if (item && typeof item === 'object' && (item as any).type === 'linear-gradient') {
      const obj = item as { direction?: string; colorStops: Array<{ color: string; positions?: string[] }> };
      const css = [obj.direction, ...obj.colorStops.map((s) => `${s.color} ${(s.positions ?? []).join(' ')}`)].filter(Boolean).join(',');
      const g = fromCss(css, w, h, colors);
      if (g) out.push(g);
    }
  }
  return out;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function fromCss(body: string, w: number, h: number, colors: ColorContext): LinearGradient | null {
  const args = splitArgs(body);
  let angle = 180;
  const first = args[0]?.toLowerCase() ?? '';
  if (first.startsWith('to ')) {
    angle = SIDES[first.replace(/\s+/g, ' ')] ?? 180;
    args.shift();
  } else if (/^-?[\d.]+(deg|rad|turn|grad)$/.test(first)) {
    const n = parseFloat(first);
    angle = first.endsWith('rad') ? (n * 180) / Math.PI : first.endsWith('turn') ? n * 360 : first.endsWith('grad') ? n * 0.9 : n;
    args.shift();
  }
  const raw = args.map((a) => {
    const m = /^(.*?)(?:\s+(-?[\d.]+%))?(?:\s+(-?[\d.]+%))?$/.exec(a)!;
    return { color: parseColor(m[1]!.trim(), colors), positions: [m[2], m[3]].filter(Boolean).map((p) => parseFloat(p!) / 100) };
  }).filter((s) => s.color != null);
  if (raw.length < 1) return null;
  const stops: Array<[number, number]> = [];
  raw.forEach((s, i) => {
    if (s.positions.length) for (const p of s.positions) stops.push([p, s.color!]);
    else stops.push([raw.length === 1 ? 0 : i / (raw.length - 1), s.color!]);
  });
  const rad = (angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const length = Math.abs(w * sin) + Math.abs(h * cos);
  const cx = w / 2;
  const cy = h / 2;
  return {
    x0: cx - (sin * length) / 2,
    y0: cy + (cos * length) / 2,
    x1: cx + (sin * length) / 2,
    y1: cy - (cos * length) / 2,
    stops: stops.map(([o, c]) => [Math.max(0, Math.min(1, o)), c] as [number, number]),
  };
}

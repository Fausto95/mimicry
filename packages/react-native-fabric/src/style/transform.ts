import { identity, multiply, rotation, scaling, skewing, translation, type Matrix } from '@mimicry/os-core';

/**
 * React Native `transform` → 2D affine matrix around `transformOrigin`.
 * Accepts the array form ([{ rotate: '45deg' }, { scale: 2 }]) and the
 * string form ('rotate(45deg) scale(2)'). 3D rotations are projected
 * orthographically (rotateX(θ) scales Y by cos θ), which matches the
 * silhouette without perspective; `perspective` is ignored.
 */
export function transformMatrix(transform: unknown, width: number, height: number, origin?: unknown): Matrix | null {
  const ops = normalize(transform);
  if (!ops.length) return null;
  let m = identity();
  for (const [name, raw] of ops) {
    m = multiply(m, single(name, raw, width, height));
  }
  const [ox, oy] = resolveOrigin(origin, width, height);
  return multiply(multiply(translation(ox, oy), m), translation(-ox, -oy));
}

type TransformOp = [string, unknown];

function normalize(transform: unknown): TransformOp[] {
  if (!transform) return [];
  if (typeof transform === 'string') {
    const out: TransformOp[] = [];
    const re = /(\w+)\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(transform))) {
      const args = match[2]!.split(/[\s,]+/).filter(Boolean);
      const name = match[1]!;
      if ((name === 'translate' || name === 'scale') && args.length > 1) {
        out.push([name + 'X', args[0]], [name + 'Y', args[1]]);
      } else if (name === 'matrix') {
        out.push([name, args.map(Number)]);
      } else {
        out.push([name, args[0]]);
      }
    }
    return out;
  }
  if (!Array.isArray(transform)) return [];
  const out: TransformOp[] = [];
  for (const entry of transform) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [k, v] of Object.entries(entry)) out.push([k, v]);
  }
  return out;
}

export function angle(value: unknown): number {
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  const n = parseFloat(s);
  if (s.endsWith('rad')) return n;
  if (s.endsWith('turn')) return n * Math.PI * 2;
  return (n * Math.PI) / 180;
}

function length(value: unknown, basis: number): number {
  if (typeof value === 'number') return value;
  const s = String(value);
  const n = parseFloat(s);
  return s.endsWith('%') ? (n / 100) * basis : n;
}

function single(name: string, v: unknown, w: number, h: number): Matrix {
  switch (name) {
    case 'translateX': return translation(length(v, w), 0);
    case 'translateY': return translation(0, length(v, h));
    case 'translate': {
      const [x, y] = Array.isArray(v) ? v : [v, 0];
      return translation(length(x, w), length(y ?? 0, h));
    }
    case 'scale': return scaling(Number(v), Number(v));
    case 'scaleX': return scaling(Number(v), 1);
    case 'scaleY': return scaling(1, Number(v));
    case 'rotate':
    case 'rotateZ': return rotation(angle(v));
    case 'rotateX': return scaling(1, Math.cos(angle(v)));
    case 'rotateY': return scaling(Math.cos(angle(v)), 1);
    case 'skewX': return skewing(angle(v), 0);
    case 'skewY': return skewing(0, angle(v));
    case 'matrix': {
      const a = v as number[];
      if (a.length === 6) return [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
      if (a.length === 16) return [a[0]!, a[1]!, a[4]!, a[5]!, a[12]!, a[13]!];
      return identity();
    }
    default:
      return identity(); // perspective and unknown entries
  }
}

function resolveOrigin(origin: unknown, w: number, h: number): [number, number] {
  if (origin == null) return [w / 2, h / 2];
  const parts = Array.isArray(origin) ? origin : String(origin).split(/\s+/);
  const keyword = (p: unknown, basis: number, axis: 'x' | 'y'): number => {
    if (p === 'left' || p === 'top') return 0;
    if (p === 'right' && axis === 'x') return basis;
    if (p === 'bottom' && axis === 'y') return basis;
    if (p === 'center') return basis / 2;
    return length(p, basis);
  };
  return [keyword(parts[0] ?? 'center', w, 'x'), keyword(parts[1] ?? 'center', h, 'y')];
}

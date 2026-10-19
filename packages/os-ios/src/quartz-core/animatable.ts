import { rgba } from '@mimicry/protocol';
import { IDENTITY, multiply, type Matrix } from '@mimicry/os-core';

/**
 * The animatable properties of a CALayer, as the render server sees them:
 * a flat state record (the model's values, then each running animation
 * applied in order) and, per key path, how to read a value out of it, write
 * one back and interpolate between two.
 *
 * Values travel as number vectors: a point is [x, y], a rect
 * [x, y, w, h], a color [r, g, b, a] (bytes), a transform the affine
 * [a, b, c, d, tx, ty] — interpolated through its decomposition
 * (translation, rotation, skew, scale) the way Core Animation interpolates
 * transforms.
 */
export interface LayerState {
  positionX: number;
  positionY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  affine: Matrix;
  opacity: number;
  zPosition: number;
  backgroundColor: number | null;
  cornerRadius: number;
  borderWidth: number;
  borderColor: number;
  shadowColor: number;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetWidth: number;
  shadowOffsetHeight: number;
}

export type ValueKind = 'vector' | 'color' | 'transform';

export interface KeyPathSpec {
  kind: ValueKind;
  get(s: LayerState): number[];
  set(s: LayerState, v: number[]): void;
}

// ── colors ───────────────────────────────────────────────────────────────

const unpack = (c: number | null): number[] => {
  const n = (c ?? 0) >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
};
const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const pack = (v: number[]): number => rgba(clampByte(v[0]!), clampByte(v[1]!), clampByte(v[2]!), clampByte(v[3]!) / 255);

// ── transforms ───────────────────────────────────────────────────────────

export interface Decomposed {
  tx: number;
  ty: number;
  angle: number;
  skew: number;
  sx: number;
  sy: number;
}

/** translate · rotate · skewX · scale (the decomposition CSS and Core Animation interpolate). */
export function decompose(m: Readonly<Matrix>): Decomposed {
  const [a, b, c, d, tx, ty] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-12) return { tx, ty, angle: 0, skew: 0, sx: 0, sy: Math.hypot(c, d) };
  const cos = a / sx;
  const sin = b / sx;
  const k = c * cos + d * sin;
  const rx = c - k * cos;
  const ry = d - k * sin;
  const det = a * d - b * c;
  const sy = Math.hypot(rx, ry) * (det < 0 ? -1 : 1);
  return { tx, ty, angle: Math.atan2(b, a), skew: sy !== 0 ? k / sy : 0, sx, sy };
}

export function recompose(p: Decomposed): Matrix {
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  return [p.sx * cos, p.sx * sin, p.sy * (p.skew * cos - sin), p.sy * (p.skew * sin + cos), p.tx, p.ty];
}

function interpolateTransform(from: number[], to: number[], t: number): number[] {
  const a = decompose(from as Matrix);
  const b = decompose(to as Matrix);
  let delta = b.angle - a.angle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return recompose({
    tx: lerp(a.tx, b.tx),
    ty: lerp(a.ty, b.ty),
    angle: a.angle + delta * t,
    skew: lerp(a.skew, b.skew),
    sx: lerp(a.sx, b.sx),
    sy: lerp(a.sy, b.sy),
  });
}

/** A key path that edits one component of the transform's decomposition (transform.scale…). */
function transformPart(read: (p: Decomposed) => number[], write: (p: Decomposed, v: number[]) => void): KeyPathSpec {
  return {
    kind: 'vector',
    get: (s) => read(decompose(s.affine)),
    set: (s, v) => {
      const p = decompose(s.affine);
      write(p, v);
      s.affine = recompose(p);
    },
  };
}

// ── the table ────────────────────────────────────────────────────────────

const scalar = (key: keyof LayerState): KeyPathSpec => ({
  kind: 'vector',
  get: (s) => [s[key] as number],
  set: (s, v) => {
    (s as unknown as Record<string, number>)[key] = v[0]!;
  },
});

const color = (key: 'backgroundColor' | 'borderColor' | 'shadowColor'): KeyPathSpec => ({
  kind: 'color',
  get: (s) => unpack(s[key]),
  set: (s, v) => {
    s[key] = pack(v);
  },
});

export const KEY_PATHS: Readonly<Record<string, KeyPathSpec>> = {
  position: { kind: 'vector', get: (s) => [s.positionX, s.positionY], set: (s, v) => { s.positionX = v[0]!; s.positionY = v[1]!; } },
  'position.x': scalar('positionX'),
  'position.y': scalar('positionY'),
  bounds: {
    kind: 'vector',
    get: (s) => [s.originX, s.originY, s.width, s.height],
    set: (s, v) => { s.originX = v[0]!; s.originY = v[1]!; s.width = Math.max(0, v[2]!); s.height = Math.max(0, v[3]!); },
  },
  'bounds.origin': { kind: 'vector', get: (s) => [s.originX, s.originY], set: (s, v) => { s.originX = v[0]!; s.originY = v[1]!; } },
  'bounds.origin.x': scalar('originX'),
  'bounds.origin.y': scalar('originY'),
  'bounds.size': { kind: 'vector', get: (s) => [s.width, s.height], set: (s, v) => { s.width = Math.max(0, v[0]!); s.height = Math.max(0, v[1]!); } },
  'bounds.size.width': { kind: 'vector', get: (s) => [s.width], set: (s, v) => { s.width = Math.max(0, v[0]!); } },
  'bounds.size.height': { kind: 'vector', get: (s) => [s.height], set: (s, v) => { s.height = Math.max(0, v[0]!); } },
  anchorPoint: { kind: 'vector', get: (s) => [s.anchorX, s.anchorY], set: (s, v) => { s.anchorX = v[0]!; s.anchorY = v[1]!; } },
  opacity: { kind: 'vector', get: (s) => [s.opacity], set: (s, v) => { s.opacity = Math.max(0, Math.min(1, v[0]!)); } },
  zPosition: scalar('zPosition'),
  transform: { kind: 'transform', get: (s) => [...s.affine], set: (s, v) => { s.affine = v.slice(0, 6) as Matrix; } },
  'transform.scale': transformPart((p) => [(p.sx + p.sy) / 2], (p, v) => { p.sx = v[0]!; p.sy = v[0]!; }),
  'transform.scale.x': transformPart((p) => [p.sx], (p, v) => { p.sx = v[0]!; }),
  'transform.scale.y': transformPart((p) => [p.sy], (p, v) => { p.sy = v[0]!; }),
  'transform.rotation': transformPart((p) => [p.angle], (p, v) => { p.angle = v[0]!; }),
  'transform.rotation.z': transformPart((p) => [p.angle], (p, v) => { p.angle = v[0]!; }),
  'transform.translation': transformPart((p) => [p.tx, p.ty], (p, v) => { p.tx = v[0]!; p.ty = v[1]!; }),
  'transform.translation.x': transformPart((p) => [p.tx], (p, v) => { p.tx = v[0]!; }),
  'transform.translation.y': transformPart((p) => [p.ty], (p, v) => { p.ty = v[0]!; }),
  backgroundColor: color('backgroundColor'),
  borderColor: color('borderColor'),
  shadowColor: color('shadowColor'),
  cornerRadius: scalar('cornerRadius'),
  borderWidth: scalar('borderWidth'),
  shadowOpacity: scalar('shadowOpacity'),
  shadowRadius: scalar('shadowRadius'),
  shadowOffset: {
    kind: 'vector',
    get: (s) => [s.shadowOffsetWidth, s.shadowOffsetHeight],
    set: (s, v) => { s.shadowOffsetWidth = v[0]!; s.shadowOffsetHeight = v[1]!; },
  },
};

/** Key paths that move or resize the layer (the render server composites it while they run). */
export const GEOMETRY_KEYS = new Set([
  'position', 'position.x', 'position.y', 'bounds', 'bounds.origin', 'bounds.origin.x', 'bounds.origin.y', 'bounds.size',
  'bounds.size.width', 'bounds.size.height', 'anchorPoint',
]);

export function keyPathSpec(keyPath: string): KeyPathSpec {
  const spec = KEY_PATHS[keyPath];
  if (!spec) throw new Error(`CALayer: "${keyPath}" is not an animatable key path in Mimicry (supported: ${Object.keys(KEY_PATHS).join(', ')})`);
  return spec;
}

// ── values ───────────────────────────────────────────────────────────────

/**
 * An animation value (fromValue, toValue, keyframe values) as a vector:
 * numbers, CGPoint, CGSize, CGRect, CGAffineTransform, packed RGBA colors
 * (CGColor) or anything with a `cgColor` / `rgba` (UIColor, a resolved color).
 */
export function toVector(value: unknown, kind: ValueKind): number[] {
  if (kind === 'color') {
    if (typeof value === 'number') return unpack(value);
    if (value && typeof value === 'object') {
      const v = value as { cgColor?: unknown; rgba?: unknown };
      if (typeof v.cgColor === 'number') return unpack(v.cgColor);
      if (typeof v.rgba === 'number') return unpack(v.rgba);
    }
    if (value === null) return unpack(0);
    throw new Error(`Core Animation: ${String(value)} is not a color (pass a CGColor number or a UIColor)`);
  }
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.map(Number);
  if (value && typeof value === 'object') {
    const v = value as Record<string, any>;
    if ('a' in v && 'd' in v && 'tx' in v) return [v.a, v.b, v.c, v.d, v.tx, v.ty];
    if ('origin' in v && 'size' in v) return [v.origin.x, v.origin.y, v.size.width, v.size.height];
    if ('x' in v && 'y' in v) return [v.x, v.y];
    if ('width' in v && 'height' in v) return [v.width, v.height];
  }
  throw new Error(`Core Animation: cannot animate to ${JSON.stringify(value)}`);
}

export function interpolate(kind: ValueKind, from: number[], to: number[], t: number): number[] {
  if (kind === 'transform') return interpolateTransform(from, to, t);
  const out = new Array<number>(Math.max(from.length, to.length));
  for (let i = 0; i < out.length; i++) {
    const a = from[i] ?? 0;
    const b = to[i] ?? 0;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** `base` + `delta` (additive animations; transforms concatenate). */
export function addValues(kind: ValueKind, base: number[], delta: number[]): number[] {
  if (kind === 'transform') return [...multiply(delta as Matrix, base as Matrix)];
  return base.map((b, i) => b + (delta[i] ?? 0));
}

export function subtractValues(kind: ValueKind, a: number[], b: number[]): number[] {
  if (kind === 'transform') {
    // a = d · b  →  d = a · b⁻¹
    const [ba, bb, bc, bd, btx, bty] = b;
    const det = ba! * bd! - bb! * bc!;
    if (Math.abs(det) < 1e-12) return [...IDENTITY];
    const inv: Matrix = [bd! / det, -bb! / det, -bc! / det, ba! / det, (bc! * bty! - bd! * btx!) / det, (bb! * btx! - ba! * bty!) / det];
    return [...multiply(a as Matrix, inv)];
  }
  return a.map((x, i) => x - (b[i] ?? 0));
}

/** The additive identity of a kind (what an additive animation settles on). */
export function zeroValue(kind: ValueKind, length: number): number[] {
  return kind === 'transform' ? [...IDENTITY] : new Array<number>(length).fill(0);
}

/** A vector back into a typed value for the key path's API (presentation(), delegates). */
export function packColor(v: number[]): number {
  return pack(v);
}

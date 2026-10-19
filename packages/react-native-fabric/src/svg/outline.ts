import type { CommandWriter } from '@mimicry/protocol';
import { parsePath } from '@mimicry/os-core';
import { apply, type Matrix, type Rect } from '@mimicry/os-core';

/**
 * The geometry of an SVG shape in its own user space: a list of path
 * segments. The same outline is written to the frame, measured for
 * objectBoundingBox units and getBBox(), flattened for hit testing, and
 * walked for getTotalLength()/getPointAtLength().
 */
export type Segment =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'Q'; cx: number; cy: number; x: number; y: number }
  | { op: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { op: 'Z' };

export class Outline {
  readonly segments: Segment[] = [];

  moveTo(x: number, y: number): void {
    this.segments.push({ op: 'M', x, y });
  }
  lineTo(x: number, y: number): void {
    this.segments.push({ op: 'L', x, y });
  }
  quadTo(cx: number, cy: number, x: number, y: number): void {
    this.segments.push({ op: 'Q', cx, cy, x, y });
  }
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.segments.push({ op: 'C', c1x, c1y, c2x, c2y, x, y });
  }
  close(): void {
    this.segments.push({ op: 'Z' });
  }

  get empty(): boolean {
    return this.segments.length === 0;
  }

  static fromPathData(d: string): Outline {
    const o = new Outline();
    parsePath(d, o);
    return o;
  }

  /** Appends the outline to the writer's current path (no PathBegin). */
  write(w: CommandWriter): void {
    for (const s of this.segments) {
      switch (s.op) {
        case 'M': w.moveTo(s.x, s.y); break;
        case 'L': w.lineTo(s.x, s.y); break;
        case 'Q': w.quadTo(s.cx, s.cy, s.x, s.y); break;
        case 'C': w.cubicTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y); break;
        case 'Z': w.closePath(); break;
      }
    }
  }

  /**
   * Polylines approximating the outline (curves subdivided), optionally
   * mapped through `m`. Each subpath records whether it was closed.
   */
  flatten(m?: Readonly<Matrix>, steps = 16): Array<{ points: Array<[number, number]>; closed: boolean }> {
    const out: Array<{ points: Array<[number, number]>; closed: boolean }> = [];
    const map = (x: number, y: number): [number, number] => (m ? apply(m, x, y) : [x, y]);
    let current: { points: Array<[number, number]>; closed: boolean } | null = null;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    const ensure = () => {
      if (!current) {
        current = { points: [map(x, y)], closed: false };
        out.push(current);
      }
      return current;
    };
    for (const s of this.segments) {
      switch (s.op) {
        case 'M':
          x = startX = s.x;
          y = startY = s.y;
          current = { points: [map(x, y)], closed: false };
          out.push(current);
          break;
        case 'L':
          ensure().points.push(map(s.x, s.y));
          x = s.x;
          y = s.y;
          break;
        case 'Q': {
          const path = ensure();
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const u = 1 - t;
            path.points.push(map(u * u * x + 2 * u * t * s.cx + t * t * s.x, u * u * y + 2 * u * t * s.cy + t * t * s.y));
          }
          x = s.x;
          y = s.y;
          break;
        }
        case 'C': {
          const path = ensure();
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const u = 1 - t;
            const a = u * u * u;
            const b = 3 * u * u * t;
            const c = 3 * u * t * t;
            const d = t * t * t;
            path.points.push(map(a * x + b * s.c1x + c * s.c2x + d * s.x, a * y + b * s.c1y + c * s.c2y + d * s.y));
          }
          x = s.x;
          y = s.y;
          break;
        }
        case 'Z':
          if (current) {
            (current as { closed: boolean }).closed = true;
            current = null;
          }
          x = startX;
          y = startY;
          break;
      }
    }
    return out.filter((p) => p.points.length > 0);
  }

  /** Bounding box of the outline (curves flattened), mapped through `m` if given. */
  bounds(m?: Readonly<Matrix>): Rect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const path of this.flatten(m, 8)) {
      for (const [px, py] of path.points) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Point-in-fill with the given rule (0 nonzero, 1 evenodd), in the outline's space. */
  contains(px: number, py: number, rule: number, m?: Readonly<Matrix>): boolean {
    let winding = 0;
    let crossings = 0;
    for (const { points } of this.flatten(m)) {
      // Fill treats every subpath as closed.
      for (let i = 0, n = points.length; i < n; i++) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[(i + 1) % n]!;
        if (y1 <= py !== y2 <= py) {
          const xi = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
          if (xi > px) {
            crossings++;
            winding += y2 > y1 ? 1 : -1;
          }
        }
      }
    }
    return rule === 1 ? crossings % 2 === 1 : winding !== 0;
  }

  /** Whether the point lies within `halfWidth` of the outline. */
  nearStroke(px: number, py: number, halfWidth: number, m?: Readonly<Matrix>): boolean {
    for (const { points, closed } of this.flatten(m)) {
      const n = points.length;
      const last = closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[(i + 1) % n]!;
        if (distanceToSegment(px, py, x1, y1, x2, y2) <= halfWidth) return true;
      }
      if (n === 1 && Math.hypot(px - points[0]![0], py - points[0]![1]) <= halfWidth) return true;
    }
    return false;
  }

  /** Total length along the outline (closing segments included). */
  length(): number {
    let total = 0;
    for (const { points, closed } of this.flatten(undefined, 32)) {
      for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
      if (closed && points.length > 1) total += Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]);
    }
    return total;
  }

  /** The point `distance` along the outline and the tangent angle there (degrees). */
  pointAt(distance: number): { x: number; y: number; angle: number } {
    let remaining = Math.max(0, distance);
    let last = { x: 0, y: 0, angle: 0 };
    for (const { points, closed } of this.flatten(undefined, 32)) {
      const pts = closed && points.length > 1 ? [...points, points[0]!] : points;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1]!;
        const [x2, y2] = pts[i]!;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        if (remaining <= len && len > 0) {
          const t = remaining / len;
          return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, angle };
        }
        remaining -= len;
        last = { x: x2, y: y2, angle };
      }
    }
    return last;
  }
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Rectangle with SVG rx/ry rules (one radius implies the other; clamped to half the size). */
export function rectOutline(x: number, y: number, w: number, h: number, rx: number, ry: number): Outline {
  const o = new Outline();
  if (w <= 0 || h <= 0) return o;
  rx = Math.min(Math.max(0, rx), w / 2);
  ry = Math.min(Math.max(0, ry), h / 2);
  if (!rx || !ry) {
    o.moveTo(x, y);
    o.lineTo(x + w, y);
    o.lineTo(x + w, y + h);
    o.lineTo(x, y + h);
    o.close();
    return o;
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  o.moveTo(x + rx, y);
  o.lineTo(x + w - rx, y);
  o.cubicTo(x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry);
  o.lineTo(x + w, y + h - ry);
  o.cubicTo(x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h);
  o.lineTo(x + rx, y + h);
  o.cubicTo(x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry);
  o.lineTo(x, y + ry);
  o.cubicTo(x, y + ry - ky, x + rx - kx, y, x + rx, y);
  o.close();
  return o;
}

/** Four cubic quarter arcs, starting at 3 o'clock and running clockwise like SVG. */
export function ellipseOutline(cx: number, cy: number, rx: number, ry: number): Outline {
  const o = new Outline();
  if (rx <= 0 || ry <= 0) return o;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  o.moveTo(cx + rx, cy);
  o.cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
  o.cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
  o.cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
  o.cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
  o.close();
  return o;
}

export function lineOutline(x1: number, y1: number, x2: number, y2: number): Outline {
  const o = new Outline();
  o.moveTo(x1, y1);
  o.lineTo(x2, y2);
  return o;
}

/** Control-point distance that makes a cubic approximate a quarter circle. */
const KAPPA = 0.5522847498307936;

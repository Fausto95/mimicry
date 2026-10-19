import type { PathGradient } from '@mimicry/protocol';
import { rgba, withAlpha } from '@mimicry/protocol';
import { parseColor, type ColorContext } from '@mimicry/os-core';
import { IDENTITY, multiply, translation, type Matrix, type Rect } from '@mimicry/os-core';
import type { HostNode } from '../tree/node';
import { ellipseOutline, lineOutline, Outline, rectOutline } from './outline';
import { lengthList, resolveFraction, resolveLength, type SvgViewport } from './units';

/**
 * How react-native-svg's native props become drawable state.
 *
 * The library's JavaScript does the parsing (colors → brushes, transforms →
 * matrices, `propList` = which presentation attributes the element set
 * itself); this module applies the native semantics on top: inheritance of
 * presentation attributes, paint-server lookup by `name`, objectBoundingBox
 * units and viewBox mapping.
 */

/** A paint as react-native-svg sends it: 0 color, 1 reference (gradient/pattern), 2 currentColor, 3/4 context paint. */
export type Brush = { type?: number; payload?: unknown; brushRef?: string } | null;

export interface Font {
  fontSize?: number | string;
  fontWeight?: number | string;
  fontStyle?: string;
  fontFamily?: string | null;
  textAnchor?: string;
  letterSpacing?: number | string;
  [key: string]: unknown;
}

/** Resolved presentation attributes for one element. */
export interface Attrs {
  fill: Brush;
  fillOpacity: number;
  /** react-native-svg's encoding: 0 evenodd, 1 nonzero */
  fillRule: number;
  stroke: Brush;
  strokeOpacity: number;
  strokeWidth: unknown;
  strokeLinecap: number;
  strokeLinejoin: number;
  strokeDasharray: unknown[] | null;
  strokeDashoffset: number;
  strokeMiterlimit: number;
  color: unknown;
  font: Font;
}

const INHERITED = [
  'fill', 'fillOpacity', 'fillRule', 'stroke', 'strokeOpacity', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
  'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit',
] as const;

/** black, as an ARGB number (react-native-svg's payload encoding) */
const BLACK_ARGB = 0xff000000;

export function rootAttrs(color: unknown): Attrs {
  return {
    fill: { type: 0, payload: BLACK_ARGB },
    fillOpacity: 1,
    fillRule: 1,
    stroke: null,
    strokeOpacity: 1,
    strokeWidth: 1,
    strokeLinecap: 0,
    strokeLinejoin: 0,
    strokeDasharray: null,
    strokeDashoffset: 0,
    strokeMiterlimit: 4,
    color,
    font: {},
  };
}

/**
 * Native inheritance: an element uses its own value for every attribute in
 * its `propList` and its parent's for the rest.
 */
export function inheritAttrs(parent: Attrs, node: HostNode): Attrs {
  const p = node.props;
  const own: readonly string[] = Array.isArray(p.propList) ? p.propList : [];
  const out: Attrs = { ...parent };
  const target = out as unknown as Record<string, unknown>;
  for (const key of INHERITED) {
    if (own.includes(key)) target[key] = key === 'strokeDasharray' ? (p[key] == null ? null : lengthList(p[key])) : p[key];
  }
  if (p.color != null) out.color = p.color;
  if (p.font && typeof p.font === 'object') out.font = { ...parent.font, ...p.font };
  return out;
}

export interface SvgContext {
  colors: ColorContext;
  viewport: SvgViewport;
  /** elements with an `id` (react-native-svg sends it as `name`) */
  defs: Map<string, HostNode>;
}

/** Index of referenceable elements under an SVG root (first definition wins). */
export function collectDefs(root: HostNode): Map<string, HostNode> {
  const defs = new Map<string, HostNode>();
  root.walk((n) => {
    if (n !== root && n.kind === 'svg-node' && typeof n.props.name === 'string' && !defs.has(n.props.name)) defs.set(n.props.name, n);
  });
  return defs;
}

/** react-native-svg colors are ARGB numbers (processColor); Mimicry packs RGBA. */
export function argbToRgba(argb: number): number {
  return ((argb << 8) | ((argb >>> 24) & 255)) >>> 0;
}

export function solidColor(brush: Brush, attrs: Attrs, colors: ColorContext): number | null {
  if (!brush) return null;
  if (typeof brush !== 'object') return parseColor(brush, colors);
  switch (brush.type ?? 0) {
    case 0:
      return typeof brush.payload === 'number' ? argbToRgba(brush.payload) : parseColor(brush.payload, colors);
    case 2:
      return parseColor(attrs.color ?? 'black', colors);
    default:
      return null;
  }
}

export function fontSize(attrs: Attrs, viewport: SvgViewport): number {
  return resolveLength(attrs.font.fontSize ?? 12, 'other', viewport, 12, 12);
}

/** The node's own transform (`matrix`, column-major a b c d e f). */
export function nodeMatrix(node: HostNode): Matrix | null {
  const m = node.props.matrix;
  return Array.isArray(m) && m.length >= 6 ? [m[0], m[1], m[2], m[3], m[4], m[5]] : null;
}

const ALIGN: Record<string, [number, number]> = {
  xMinYMin: [0, 0], xMidYMin: [0.5, 0], xMaxYMin: [1, 0],
  xMinYMid: [0, 0.5], xMidYMid: [0.5, 0.5], xMaxYMid: [1, 0.5],
  xMinYMax: [0, 1], xMidYMax: [0.5, 1], xMaxYMax: [1, 1],
};

/**
 * The viewBox → viewport transform (SVG's preserveAspectRatio algorithm).
 * `meetOrSlice`: 0 meet, 1 slice, 2 none (stretch).
 */
export function viewBoxMatrix(
  minX: number, minY: number, vbWidth: number, vbHeight: number, align: string | undefined, meetOrSlice: number | undefined,
  width: number, height: number,
): Matrix {
  if (!(vbWidth > 0) || !(vbHeight > 0)) return [...IDENTITY] as Matrix;
  let sx = width / vbWidth;
  let sy = height / vbHeight;
  if (align === 'none' || meetOrSlice === 2) return [sx, 0, 0, sy, -minX * sx, -minY * sy];
  const s = meetOrSlice === 1 ? Math.max(sx, sy) : Math.min(sx, sy);
  sx = sy = s;
  const [ax, ay] = ALIGN[align ?? 'xMidYMid'] ?? [0.5, 0.5];
  const tx = (width - vbWidth * s) * ax - minX * s;
  const ty = (height - vbHeight * s) * ay - minY * s;
  return [s, 0, 0, s, tx, ty];
}

/** An element that has geometry of its own. */
export function isShape(type: string): boolean {
  return type === 'path' || type === 'rect' || type === 'circle' || type === 'ellipse' || type === 'line';
}

/** Elements that are only drawn when referenced (or never: gradient stops, filters). */
export function isDefinition(type: string): boolean {
  return (
    type === 'defs' || type === 'clipPath' || type === 'mask' || type === 'pattern' || type === 'marker' || type === 'symbol' ||
    type === 'linearGradient' || type === 'radialGradient' || type === 'filter' || type.startsWith('fe')
  );
}

/** A shape's outline in its own user space. */
export function shapeOutline(node: HostNode, ctx: SvgContext, attrs: Attrs): Outline {
  const p = node.props;
  const vp = ctx.viewport;
  const fs = fontSize(attrs, vp);
  const len = (v: unknown, axis: 'x' | 'y' | 'other') => resolveLength(v, axis, vp, fs);
  switch (p.svgType) {
    case 'path':
      return typeof p.d === 'string' ? Outline.fromPathData(p.d) : new Outline();
    case 'rect': {
      const rx = p.rx != null ? len(p.rx, 'x') : null;
      const ry = p.ry != null ? len(p.ry, 'y') : null;
      return rectOutline(len(p.x, 'x'), len(p.y, 'y'), len(p.width, 'x'), len(p.height, 'y'), rx ?? ry ?? 0, ry ?? rx ?? 0);
    }
    case 'circle': {
      const r = len(p.r, 'other');
      return ellipseOutline(len(p.cx, 'x'), len(p.cy, 'y'), r, r);
    }
    case 'ellipse':
      return ellipseOutline(len(p.cx, 'x'), len(p.cy, 'y'), len(p.rx, 'x'), len(p.ry, 'y'));
    case 'line':
      return lineOutline(len(p.x1, 'x'), len(p.y1, 'y'), len(p.x2, 'x'), len(p.y2, 'y'));
    default:
      return new Outline();
  }
}

/**
 * A gradient paint server for a shape whose user-space bounding box is
 * `bbox`. Returns null when it cannot be drawn (missing, degenerate box).
 */
export function gradientPaint(ref: HostNode, bbox: Rect | null, ctx: SvgContext, opacity: number): PathGradient | null {
  const p = ref.props;
  const flat: unknown[] = Array.isArray(p.gradient) ? p.gradient : [];
  const stops: Array<[number, number]> = [];
  let last = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    // Offsets never go backwards (SVG clamps each to the previous).
    const offset = Math.max(last, Math.min(1, Math.max(0, Number(flat[i]) || 0)));
    last = offset;
    stops.push([offset, withAlpha(argbToRgba(Number(flat[i + 1]) >>> 0), opacity)]);
  }
  if (!stops.length) return null;
  const objectBox = p.gradientUnits !== 1;
  if (objectBox && (!bbox || bbox.w <= 0 || bbox.h <= 0)) return null;
  let m: Matrix = objectBox ? [bbox!.w, 0, 0, bbox!.h, bbox!.x, bbox!.y] : [...IDENTITY] as Matrix;
  const t = p.gradientTransform;
  if (Array.isArray(t) && t.length >= 6) m = multiply(m, [t[0], t[1], t[2], t[3], t[4], t[5]]);
  const coord = (v: unknown, axis: 'x' | 'y' | 'other', fallback: string) =>
    objectBox ? resolveFraction(v ?? fallback, resolveFraction(fallback, 0)) : resolveLength(v ?? fallback, axis, ctx.viewport);
  if (p.svgType === 'linearGradient') {
    return {
      kind: 'linear',
      x0: coord(p.x1, 'x', '0%'), y0: coord(p.y1, 'y', '0%'), r0: 0,
      x1: coord(p.x2, 'x', '100%'), y1: coord(p.y2, 'y', '0%'), r1: 0,
      matrix: m, stops,
    };
  }
  const cx = coord(p.cx, 'x', '50%');
  const cy = coord(p.cy, 'y', '50%');
  const rx = coord(p.rx, 'x', '50%');
  const ry = coord(p.ry, 'y', '50%');
  const fx = coord(p.fx ?? p.cx, 'x', '50%');
  const fy = coord(p.fy ?? p.cy, 'y', '50%');
  if (!(rx > 0) || !(ry > 0)) return null;
  // Canvas radial gradients are circular: draw in a space squashed to ry/rx.
  const squash: Matrix = multiply(multiply(translation(cx, cy), [1, 0, 0, ry / rx, 0, 0]), translation(-cx, -cy));
  return {
    kind: 'radial',
    x0: fx, y0: cy + ((fy - cy) * rx) / ry, r0: 0,
    x1: cx, y1: cy, r1: rx,
    matrix: multiply(m, squash), stops,
  };
}

/** Last-resort solid color for a paint server Mimicry cannot draw in a given place (patterns, text). */
export function fallbackColor(ref: HostNode | undefined): number {
  const flat: unknown[] = Array.isArray(ref?.props.gradient) ? ref!.props.gradient : [];
  return flat.length >= 2 ? argbToRgba(Number(flat[1]) >>> 0) : rgba(0, 0, 0, 0);
}

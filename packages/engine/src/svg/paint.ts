import { alphaOf, withAlpha, type CommandWriter } from '@mimicry/protocol';
import type { Engine } from '../engine';
import { fitImage, resolveSource } from '../paint/image-fit';
import type { Rect } from '../style/matrix';
import type { HostNode } from '../tree/node';
import {
  collectDefs, fallbackColor, fontSize, gradientPaint, inheritAttrs, isDefinition, isShape, nodeMatrix, rootAttrs, shapeOutline,
  solidColor, viewBoxMatrix, type Attrs, type Brush, type SvgContext,
} from './model';
import { Outline } from './outline';
import { lengthList, resolveLength } from './units';

/**
 * Paints an SVG viewport (`m-svg`) and its element tree into a command
 * writer. Element transforms, group opacity and clip paths map onto canvas
 * state (Save/Transform/Alpha/ClipPath … Restore), so strokes scale with
 * their transforms exactly as SVG specifies.
 */
export interface SvgPaintContext extends SvgContext {
  engine: Engine;
  /** guards against <Use> cycles */
  depth: number;
}

/** Context for an SVG root laid out at `box` (its viewBox mapped into the box). */
export function svgContext(engine: Engine, root: HostNode): SvgPaintContext {
  const p = root.props;
  const viewport = p.vbWidth > 0 && p.vbHeight > 0 ? { width: p.vbWidth, height: p.vbHeight } : { width: root.w, height: root.h };
  return { engine, colors: engine.colorContext, viewport, defs: collectDefs(root), depth: 0 };
}

/** The transform from the SVG root's user space into its border box. */
export function rootMatrix(root: HostNode) {
  const p = root.props;
  return viewBoxMatrix(p.minX ?? 0, p.minY ?? 0, p.vbWidth ?? 0, p.vbHeight ?? 0, p.align, p.meetOrSlice, root.w, root.h);
}

export function paintSvg(w: CommandWriter, root: HostNode, box: Rect, engine: Engine): void {
  const ctx = svgContext(engine, root);
  const m = rootMatrix(root);
  w.save();
  w.clipRect(box.x, box.y, box.w, box.h);
  w.transform(1, 0, 0, 1, box.x, box.y);
  w.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const attrs = rootAttrs(root.props.color);
  for (const child of root.children) paintElement(w, child, attrs, ctx);
  w.restore();
}

function paintElement(w: CommandWriter, node: HostNode, parent: Attrs, ctx: SvgPaintContext): void {
  if (node.kind !== 'svg-node' || node.hidden) return;
  const p = node.props;
  const type: string = p.svgType ?? '';
  if (p.display === 'none' || isDefinition(type)) return;
  const attrs = inheritAttrs(parent, node);
  const opacity = typeof p.opacity === 'number' ? Math.max(0, Math.min(1, p.opacity)) : 1;
  if (opacity <= 0) return;
  w.save();
  const m = nodeMatrix(node);
  if (m) w.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (opacity < 1) w.alpha(opacity);
  applyClip(w, node, attrs, ctx);
  switch (type) {
    case 'g':
      for (const child of node.children) paintElement(w, child, attrs, ctx);
      break;
    case 'use':
      paintUse(w, node, attrs, ctx);
      break;
    case 'image':
      paintImage(w, node, ctx);
      break;
    case 'text':
      paintText(w, node, attrs, ctx);
      break;
    default:
      if (isShape(type)) paintShape(w, shapeOutline(node, ctx, attrs), attrs, ctx);
      // foreignObject (React Native views inside SVG) is not drawn yet.
      break;
  }
  w.restore();
}

/** Fill then stroke, as SVG's default paint order. */
export function paintShape(w: CommandWriter, outline: Outline, attrs: Attrs, ctx: SvgContext): void {
  if (outline.empty) return;
  const rule = attrs.fillRule === 0 ? 1 : 0;
  let bbox: Rect | null | undefined;
  const box = () => (bbox === undefined ? (bbox = outline.bounds()) : bbox);
  const fillOpacity = clamp01(attrs.fillOpacity);
  if (attrs.fill && fillOpacity > 0) {
    const gradient = paintServer(attrs.fill, ctx);
    if (gradient) {
      const g = gradientPaint(gradient, box(), ctx, fillOpacity);
      if (g) {
        w.pathBegin();
        outline.write(w);
        w.fillPathGradient(rule, g);
      }
    } else {
      const color = solidColor(attrs.fill, attrs, ctx.colors);
      if (color != null && alphaOf(color) > 0) {
        w.pathBegin();
        outline.write(w);
        w.fillPath(withAlpha(color, fillOpacity), rule);
      }
    }
  }
  const strokeWidth = resolveLength(attrs.strokeWidth, 'other', ctx.viewport, fontSize(attrs, ctx.viewport), 1);
  const strokeOpacity = clamp01(attrs.strokeOpacity);
  if (attrs.stroke && strokeWidth > 0 && strokeOpacity > 0) {
    const dashes = (attrs.strokeDasharray ?? []).map((d) => resolveLength(d, 'other', ctx.viewport));
    w.strokeStyle(attrs.strokeMiterlimit || 4, Number(attrs.strokeDashoffset) || 0, dashes.some((d) => d > 0) ? dashes : []);
    const gradient = paintServer(attrs.stroke, ctx);
    if (gradient) {
      const g = gradientPaint(gradient, box(), ctx, strokeOpacity);
      if (g) {
        w.pathBegin();
        outline.write(w);
        w.strokePathGradient(strokeWidth, attrs.strokeLinecap, attrs.strokeLinejoin, g);
      }
    } else {
      const color = solidColor(attrs.stroke, attrs, ctx.colors);
      if (color != null && alphaOf(color) > 0) {
        w.pathBegin();
        outline.write(w);
        w.strokePath(withAlpha(color, strokeOpacity), strokeWidth, attrs.strokeLinecap, attrs.strokeLinejoin);
      }
    }
  }
}

/** The gradient element a reference brush points at (patterns are not drawn). */
function paintServer(brush: Brush, ctx: SvgContext): HostNode | null {
  if (!brush || typeof brush !== 'object' || brush.type !== 1 || !brush.brushRef) return null;
  const ref = ctx.defs.get(brush.brushRef);
  return ref && (ref.props.svgType === 'linearGradient' || ref.props.svgType === 'radialGradient') ? ref : null;
}

/**
 * `clipPath` clips to the union of the clip path's shapes. `mask` is
 * approximated the same way (its shapes' coverage, ignoring luminance).
 */
function applyClip(w: CommandWriter, node: HostNode, attrs: Attrs, ctx: SvgPaintContext): void {
  for (const key of ['clipPath', 'mask'] as const) {
    const name = node.props[key];
    if (typeof name !== 'string') continue;
    const ref = ctx.defs.get(name);
    if (!ref || ref.props.svgType !== key) continue;
    w.pathBegin();
    // One canvas clip holds the union; it is even-odd if any clip shape asks for it.
    let evenOdd = false;
    const own = nodeMatrix(ref);
    collectClipShapes(ref, attrs, ctx, (outline, matrix, clipRule) => {
      w.save();
      if (own) w.transform(own[0], own[1], own[2], own[3], own[4], own[5]);
      if (matrix) w.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      outline.write(w);
      w.restore();
      if (clipRule === 0) evenOdd = true;
    });
    w.clipPath(evenOdd ? 1 : 0);
  }
}

function collectClipShapes(
  container: HostNode, attrs: Attrs, ctx: SvgPaintContext,
  visit: (outline: Outline, matrix: ReturnType<typeof nodeMatrix>, clipRule: number) => void,
): void {
  for (const child of container.children) {
    if (child.kind !== 'svg-node' || child.props.display === 'none') continue;
    const type = child.props.svgType;
    const childAttrs = inheritAttrs(attrs, child);
    if (isShape(type)) visit(shapeOutline(child, ctx, childAttrs), nodeMatrix(child), child.props.clipRule ?? 1);
    else if (type === 'g') collectClipShapes(child, childAttrs, ctx, visit);
  }
}

function paintUse(w: CommandWriter, node: HostNode, attrs: Attrs, ctx: SvgPaintContext): void {
  const p = node.props;
  const target = typeof p.href === 'string' ? ctx.defs.get(p.href) : undefined;
  if (!target || ctx.depth > 8 || isAncestor(target, node)) return;
  const fs = fontSize(attrs, ctx.viewport);
  w.transform(1, 0, 0, 1, resolveLength(p.x, 'x', ctx.viewport, fs), resolveLength(p.y, 'y', ctx.viewport, fs));
  const inner = { ...ctx, depth: ctx.depth + 1 };
  if (target.props.svgType === 'symbol') {
    const t = target.props;
    const width = resolveLength(p.width ?? '100%', 'x', ctx.viewport, fs);
    const height = resolveLength(p.height ?? '100%', 'y', ctx.viewport, fs);
    if (t.vbWidth > 0 && t.vbHeight > 0) {
      const m = viewBoxMatrix(t.minX ?? 0, t.minY ?? 0, t.vbWidth, t.vbHeight, t.align, t.meetOrSlice, width, height);
      w.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    }
    for (const child of target.children) paintElement(w, child, attrs, inner);
    return;
  }
  // A referenced element renders as if it were the <Use>'s child, even from inside <Defs>.
  paintElement(w, target, attrs, inner);
}

function isAncestor(candidate: HostNode, node: HostNode): boolean {
  for (let n: HostNode | null = node; n; n = n.parent) if (n === candidate) return true;
  return false;
}

function paintImage(w: CommandWriter, node: HostNode, ctx: SvgPaintContext): void {
  const p = node.props;
  const source = resolveSource(p.src);
  if (!source) return;
  const image = ctx.engine.images.get(source.uri, node);
  if (image.state !== 'loaded') return;
  const vp = ctx.viewport;
  const x = resolveLength(p.x, 'x', vp);
  const y = resolveLength(p.y, 'y', vp);
  const width = p.width != null ? resolveLength(p.width, 'x', vp) : image.width;
  const height = p.height != null ? resolveLength(p.height, 'y', vp) : image.height;
  if (width <= 0 || height <= 0) return;
  const m = viewBoxMatrix(0, 0, image.width, image.height, p.align, p.meetOrSlice, width, height);
  w.save();
  w.clipRect(x, y, width, height);
  const fit = fitImage('stretch', image.width, image.height, { x: x + m[4], y: y + m[5], w: image.width * m[0], h: image.height * m[3] });
  w.image(fit.dx, fit.dy, fit.dw, fit.dh, fit.sx, fit.sy, fit.sw, fit.sh, 0, source.uri);
  w.restore();
}

// ── text ────────────────────────────────────────────────────────────────

interface Run {
  text: string;
  css: string;
  letterSpacing: number;
  color: number;
  /** explicit absolute position for the run's first glyph, when given */
  x: number | null;
  y: number | null;
  dx: number;
  dy: number;
  anchor: string;
  width: number;
}

/**
 * Text and TSpan: positioned runs drawn with the platform font stack.
 * Each absolute `x` starts a new chunk, anchored with `textAnchor`.
 * Per-glyph positions, rotate, textPath and decorations are not drawn.
 */
function paintText(w: CommandWriter, node: HostNode, attrs: Attrs, ctx: SvgPaintContext): void {
  const runs: Run[] = [];
  collectRuns(node, attrs, ctx, runs, true);
  let cx = 0;
  let cy = 0;
  let i = 0;
  while (i < runs.length) {
    // A chunk: runs up to (not including) the next one with an absolute x.
    let j = i + 1;
    while (j < runs.length && runs[j]!.x == null) j++;
    const chunk = runs.slice(i, j);
    const total = chunk.reduce((s, r) => s + r.dx + r.width, 0);
    const first = chunk[0]!;
    if (first.x != null) cx = first.x;
    const anchor = first.anchor;
    cx -= anchor === 'middle' ? total / 2 : anchor === 'end' ? total : 0;
    let font = '';
    for (const run of chunk) {
      if (run.x != null && run !== first) cx = run.x;
      if (run.y != null) cy = run.y;
      cx += run.dx;
      cy += run.dy;
      if (run.css !== font) {
        w.font(run.css);
        font = run.css;
      }
      if (alphaOf(run.color) > 0) w.text(cx, cy, run.color, run.letterSpacing, run.text);
      cx += run.width;
    }
    i = j;
  }
}

function collectRuns(node: HostNode, parent: Attrs, ctx: SvgPaintContext, out: Run[], isRoot: boolean): void {
  const p = node.props;
  if (p.display === 'none') return;
  const attrs = isRoot ? parent : inheritAttrs(parent, node);
  const vp = ctx.viewport;
  const fs = fontSize(attrs, vp);
  const xs = lengthList(p.x).map((v) => resolveLength(v, 'x', vp, fs));
  const ys = lengthList(p.y).map((v) => resolveLength(v, 'y', vp, fs));
  const dx = lengthList(p.dx).map((v) => resolveLength(v, 'x', vp, fs));
  const dy = lengthList(p.dy).map((v) => resolveLength(v, 'y', vp, fs));
  let positioned = false;
  const position = () => {
    if (positioned) return { x: null, y: null, dx: 0, dy: 0 };
    positioned = true;
    return { x: xs[0] ?? null, y: ys[0] ?? null, dx: dx[0] ?? 0, dy: dy[0] ?? 0 };
  };
  if (typeof p.content === 'string' && p.content) {
    out.push(makeRun(p.content, attrs, ctx, fs, position()));
  }
  let pending = position();
  for (const child of node.children) {
    if (child.kind !== 'svg-node' || (child.props.svgType !== 'tspan' && child.props.svgType !== 'textPath')) continue;
    const start = out.length;
    collectRuns(child, attrs, ctx, out, false);
    // The parent's own position applies to its first descendant run.
    const run = out[start];
    if (run && (pending.x != null || pending.y != null || pending.dx || pending.dy)) {
      run.x ??= pending.x;
      run.y ??= pending.y;
      run.dx += pending.dx;
      run.dy += pending.dy;
      pending = { x: null, y: null, dx: 0, dy: 0 };
    }
  }
}

function makeRun(text: string, attrs: Attrs, ctx: SvgPaintContext, size: number, pos: { x: number | null; y: number | null; dx: number; dy: number }): Run {
  const engine = ctx.engine;
  const f = attrs.font;
  const weight = f.fontWeight == null || f.fontWeight === 'normal' ? '400' : f.fontWeight === 'bold' ? '700' : String(f.fontWeight);
  const family = typeof f.fontFamily === 'string' && f.fontFamily ? f.fontFamily : undefined;
  const css = `${f.fontStyle === 'italic' ? 'italic ' : ''}${weight} ${Math.round(size * 100) / 100}px ${engine.kit.fontStack(family, engine.bundledFonts)}`;
  const letterSpacing = resolveLength(f.letterSpacing ?? 0, 'other', ctx.viewport, size);
  const fillRef = paintServer(attrs.fill, ctx);
  const solid = fillRef ? fallbackColor(fillRef) : solidColor(attrs.fill, attrs, ctx.colors);
  const color = solid == null ? 0 : withAlpha(solid, clamp01(attrs.fillOpacity));
  return { text, css, letterSpacing, color, ...pos, anchor: String(f.textAnchor ?? 'start'), width: engine.measurer.width(text, css, letterSpacing) };
}

const clamp01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);


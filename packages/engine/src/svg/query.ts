import type { Engine } from '../engine';
import { windowMatrix } from '../geometry';
import { apply, invert, multiply, transformRect, type Matrix, type Rect } from '@mimicry/os-core';
import type { HostNode } from '../tree/node';
import { inheritAttrs, isDefinition, isShape, nodeMatrix, rootAttrs, shapeOutline, type Attrs } from './model';
import { rootMatrix, svgContext, type SvgPaintContext } from './paint';
import { resolveLength } from './units';

/**
 * Geometry questions about SVG elements: where they are (measure, getBBox,
 * getCTM), what is under a point (hit testing) and path measurement. The
 * answers use the same outlines and transforms the painter draws.
 */

export function svgRootOf(node: HostNode): HostNode | null {
  let n: HostNode | null = node;
  while (n && n.kind === 'svg-node') n = n.parent;
  return n && n.kind === 'svg' ? n : null;
}

/** Ancestors from the root's first child down to `node`, with the attributes they resolve to. */
function chain(node: HostNode, root: HostNode): HostNode[] {
  const out: HostNode[] = [];
  for (let n: HostNode | null = node; n && n !== root; n = n.parent) out.unshift(n);
  return out;
}

function attrsFor(node: HostNode, root: HostNode): Attrs {
  let attrs = rootAttrs(root.props.color);
  for (const n of chain(node, root)) attrs = inheritAttrs(attrs, n);
  return attrs;
}

/** Matrix from the element's user space (inside its own transform) to the SVG root's border box. */
export function elementCTM(node: HostNode, root: HostNode): Matrix {
  let m: Matrix = rootMatrix(root);
  for (const n of chain(node, root)) {
    const own = nodeMatrix(n);
    if (own) m = multiply(m, own);
  }
  return m;
}

/** Bounding box of an element's content in its own user space (getBBox). */
export function elementBBox(node: HostNode, ctx: SvgPaintContext, attrs: Attrs): Rect | null {
  const type: string = node.props.svgType ?? '';
  if (isShape(type)) return shapeOutline(node, ctx, attrs).bounds();
  if (type === 'image' || type === 'use') {
    const p = node.props;
    const x = resolveLength(p.x, 'x', ctx.viewport);
    const y = resolveLength(p.y, 'y', ctx.viewport);
    return { x, y, w: resolveLength(p.width, 'x', ctx.viewport), h: resolveLength(p.height, 'y', ctx.viewport) };
  }
  let union: Rect | null = null;
  for (const child of node.children) {
    if (child.kind !== 'svg-node' || isDefinition(child.props.svgType ?? '')) continue;
    const inner = elementBBox(child, ctx, inheritAttrs(attrs, child));
    if (!inner) continue;
    const m = nodeMatrix(child);
    const r = m ? transformRect(m, inner) : inner;
    union = union ? unionRect(union, r) : r;
  }
  return union;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Window rectangle of an SVG element (measure / measureInWindow). */
export function svgElementWindowRect(engine: Engine, node: HostNode): Rect {
  const root = svgRootOf(node);
  if (!root) return { x: 0, y: 0, w: 0, h: 0 };
  const bbox = elementBBox(node, svgContext(engine, root), attrsFor(node, root)) ?? { x: 0, y: 0, w: 0, h: 0 };
  return transformRect(multiply(windowMatrix(root), elementCTM(node, root)), bbox);
}

/**
 * The SVG elements under a point given in the root's border-box space,
 * topmost first: [outermost ancestor … hit element]. Shapes hit on their
 * fill or stroke; `pointerEvents="none"` removes an element and its subtree.
 */
export function hitTestSvg(engine: Engine, root: HostNode, x: number, y: number): HostNode[] | null {
  const ctx = svgContext(engine, root);
  const visit = (node: HostNode, parentAttrs: Attrs, parentMatrix: Matrix): HostNode[] | null => {
    if (node.kind !== 'svg-node' || node.hidden) return null;
    const p = node.props;
    const type: string = p.svgType ?? '';
    if (p.display === 'none' || isDefinition(type) || p.pointerEvents === 'none') return null;
    const attrs = inheritAttrs(parentAttrs, node);
    const own = nodeMatrix(node);
    const m = own ? multiply(parentMatrix, own) : parentMatrix;
    if (type === 'g' || type === 'text') {
      for (const child of node.children.slice().reverse()) {
        const hit = visit(child, attrs, m);
        if (hit) return [node, ...hit];
      }
      if (type === 'g') return null;
    }
    const inv = invert(m);
    if (!inv) return null;
    const [ux, uy] = apply(inv, x, y);
    if (isShape(type)) {
      const outline = shapeOutline(node, ctx, attrs);
      const fillRule = attrs.fillRule === 0 ? 1 : 0;
      if (attrs.fill && outline.contains(ux, uy, fillRule)) return [node];
      if (attrs.stroke) {
        const width = Math.max(1, resolveLength(attrs.strokeWidth, 'other', ctx.viewport, 12, 1));
        if (outline.nearStroke(ux, uy, width / 2)) return [node];
      }
      return null;
    }
    const box = elementBBox(node, ctx, attrs);
    return box && ux >= box.x && uy >= box.y && ux <= box.x + box.w && uy <= box.y + box.h ? [node] : null;
  };
  const attrs = rootAttrs(root.props.color);
  const m = rootMatrix(root);
  for (const child of root.children.slice().reverse()) {
    const hit = visit(child, attrs, m);
    if (hit) return hit;
  }
  return null;
}

/** react-native-svg's RNSVGRenderableModule, answered from the engine's tree. */
export const svgQueries = {
  bbox(engine: Engine, node: HostNode): Rect | null {
    const root = svgRootOf(node);
    return root ? elementBBox(node, svgContext(engine, root), attrsFor(node, root)) : null;
  },
  ctm(_engine: Engine, node: HostNode): Matrix | null {
    const root = svgRootOf(node);
    return root ? elementCTM(node, root) : null;
  },
  screenCTM(_engine: Engine, node: HostNode): Matrix | null {
    const root = svgRootOf(node);
    return root ? multiply(windowMatrix(root), elementCTM(node, root)) : null;
  },
  isPointInFill(engine: Engine, node: HostNode, x: number, y: number): boolean {
    const root = svgRootOf(node);
    if (!root || !isShape(node.props.svgType)) return false;
    const attrs = attrsFor(node, root);
    return shapeOutline(node, svgContext(engine, root), attrs).contains(x, y, attrs.fillRule === 0 ? 1 : 0);
  },
  isPointInStroke(engine: Engine, node: HostNode, x: number, y: number): boolean {
    const root = svgRootOf(node);
    if (!root || !isShape(node.props.svgType)) return false;
    const ctx = svgContext(engine, root);
    const attrs = attrsFor(node, root);
    const width = resolveLength(attrs.strokeWidth, 'other', ctx.viewport, 12, 1);
    return shapeOutline(node, ctx, attrs).nearStroke(x, y, width / 2);
  },
  totalLength(engine: Engine, node: HostNode): number {
    const root = svgRootOf(node);
    if (!root || !isShape(node.props.svgType)) return 0;
    return shapeOutline(node, svgContext(engine, root), attrsFor(node, root)).length();
  },
  pointAtLength(engine: Engine, node: HostNode, length: number): { x: number; y: number; angle: number } {
    const root = svgRootOf(node);
    if (!root || !isShape(node.props.svgType)) return { x: 0, y: 0, angle: 0 };
    return shapeOutline(node, svgContext(engine, root), attrsFor(node, root)).pointAt(length);
  },
};

import { IDENTITY, apply, invert, multiply, transformRect, translation, type Matrix, type Rect } from './style/matrix';
import { transformMatrix } from './style/transform';
import type { HostNode } from './tree/node';

/**
 * One definition of "where is this node", shared by the painter, hit testing,
 * measure() and the inspector so they can never disagree.
 */

/** Maps a node's border-box coordinates into its parent's border-box coordinates. */
export function localMatrix(node: HostNode): Matrix {
  let m = translation(node.x, node.y);
  const parent = node.parent;
  if (parent && parent.kind === 'scroll' && parent.scroll) {
    m = multiply(translation(-parent.scroll.x, -parent.scroll.y), m);
  }
  const own = ownTransform(node);
  return own ? multiply(m, own) : m;
}

/** The node's own transform (style transform, presentation, Animated). */
export function ownTransform(node: HostNode): Matrix | null {
  const style = node.computed;
  let m: Matrix | null = style.transform ? transformMatrix(style.transform, node.w, node.h, style.transformOrigin) : null;
  const presentation: Matrix | undefined = node.native.presentation;
  if (presentation) m = m ? multiply(presentation, m) : presentation;
  return m;
}

/** Node border box → window coordinates. */
export function windowMatrix(node: HostNode): Matrix {
  let m: Matrix = localMatrix(node);
  // Modals are laid out against the window, not their React parent.
  let n = node.kind === 'modal' ? null : node.parent;
  while (n) {
    m = multiply(localMatrix(n), m);
    n = n.kind === 'modal' ? null : n.parent;
  }
  return m;
}

export class Geometry {
  windowRect(node: HostNode): Rect {
    return transformRect(windowMatrix(node), { x: 0, y: 0, w: node.w, h: node.h });
  }

  /** window point → node local point */
  toLocal(node: HostNode, x: number, y: number): [number, number] {
    const inv = invert(windowMatrix(node));
    return inv ? apply(inv, x, y) : [x, y];
  }
}

export { IDENTITY };

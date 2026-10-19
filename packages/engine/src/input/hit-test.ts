import type { Engine } from '../engine';
import { localMatrix, stickyOffset } from '../geometry';
import { apply, invert } from '../style/matrix';
import type { HostNode } from '../tree/node';

/**
 * Hit testing in paint order (topmost first), honoring transforms, scroll
 * offsets, clipping, pointerEvents, hitSlop and zIndex. Returns the path from
 * the root to the deepest target. Taps on nested <Text> resolve to the span's
 * own node, so `onPress` on inline text works.
 */
export function hitTest(engine: Engine, x: number, y: number): HostNode[] | null {
  for (const node of engine.systemRoot.root.children.slice().reverse()) {
    const path = hitNode(engine, node, ...toLocal(node, x, y));
    if (path) return [engine.systemRoot.root, ...path];
  }
  for (const modal of engine.visibleModals().slice().reverse()) {
    const [lx, ly] = toLocal(modal, x, y);
    for (const child of modal.children.slice().reverse()) {
      const path = hitNode(engine, child, ...toLocal(child, lx, ly));
      if (path) return [...ancestors(modal), modal, ...path];
    }
    // Modals swallow touches that hit nothing inside them.
    return [...ancestors(modal), modal];
  }
  const root = engine.appRoot.root;
  for (const child of paintOrderReversed(engine, root)) {
    if (child.kind === 'modal') continue;
    const path = hitNode(engine, child, ...toLocal(child, x, y));
    if (path) return [root, ...path];
  }
  return null;
}

function ancestors(node: HostNode): HostNode[] {
  const out: HostNode[] = [];
  let n = node.parent;
  while (n) {
    out.unshift(n);
    n = n.parent;
  }
  return out;
}

function toLocal(node: HostNode, px: number, py: number): [number, number] {
  const inv = invert(localMatrix(node));
  return inv ? apply(inv, px, py) : [px, py];
}

function paintOrderReversed(engine: Engine, node: HostNode): HostNode[] {
  const android = engine.kit.platform === 'android';
  const withZ = node.children.map((c, i) => ({
    c, i, z: Number(c.computed.zIndex ?? 0), e: android ? Number(c.computed.elevation ?? 0) : 0,
  }));
  withZ.sort((a, b) => b.z - a.z || b.e - a.e || b.i - a.i);
  // pinned sticky headers are painted last, so they are hit first
  withZ.sort((a, b) => Number(stickyOffset(b.c) > 0) - Number(stickyOffset(a.c) > 0));
  return withZ.map((x) => x.c);
}

function slop(node: HostNode): { top: number; left: number; bottom: number; right: number } {
  const s = node.props.hitSlop;
  if (s == null) return { top: 0, left: 0, bottom: 0, right: 0 };
  if (typeof s === 'number') return { top: s, left: s, bottom: s, right: s };
  return { top: s.top ?? 0, left: s.left ?? 0, bottom: s.bottom ?? 0, right: s.right ?? 0 };
}

function hitNode(engine: Engine, node: HostNode, lx: number, ly: number): HostNode[] | null {
  // An exiting node is already gone for React; its exit animation is not interactive.
  if (node.hidden || node.exiting || !node.laidOut || node.computed.display === 'none') return null;
  const pe = node.props.pointerEvents ?? node.computed.pointerEvents ?? 'auto';
  if (pe === 'none') return null;
  const hs = slop(node);
  const inside = lx >= -hs.left && ly >= -hs.top && lx < node.w + hs.right && ly < node.h + hs.bottom;
  const clips = node.computed.overflow === 'hidden' || node.kind === 'scroll';
  if (!inside && (clips || !engine.kit.hitTestOutsideBounds)) return null;
  if (pe !== 'box-only' && node.kind !== 'text') {
    for (const child of paintOrderReversed(engine, node)) {
      if (child.kind === 'modal') continue;
      const path = hitNode(engine, child, ...toLocal(child, lx, ly));
      if (path) return [node, ...path];
    }
  }
  if (inside && pe !== 'box-none') {
    if (node.kind === 'text') return [node, ...spanPath(engine, node, lx, ly)];
    return [node];
  }
  return null;
}

/** Nested <Text> nodes under the point, from the outer text down to the span. */
function spanPath(engine: Engine, text: HostNode, lx: number, ly: number): HostNode[] {
  const i = text.insets;
  const layout = engine.textLayoutFor(text, Math.max(0, text.w - i.left - i.right));
  const cx = lx - i.left;
  const cy = ly - i.top;
  const align = String(text.computed.textAlign ?? 'auto');
  const contentW = text.w - i.left - i.right;
  for (const line of layout.lines) {
    if (cy < line.y || cy >= line.y + line.height) continue;
    const offset = align === 'center' ? (contentW - line.width) / 2 : align === 'right' ? contentW - line.width : 0;
    for (const run of line.runs) {
      if (cx >= offset + run.x && cx < offset + run.x + run.width) {
        const source = run.style.source as HostNode;
        if (!source || source === text) return [];
        const chain: HostNode[] = [];
        let n: HostNode | null = source;
        while (n && n !== text) {
          chain.unshift(n);
          n = n.parent;
        }
        return chain;
      }
    }
  }
  return [];
}

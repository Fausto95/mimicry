import { Direction, Edge } from 'yoga-layout/load';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';

export interface LayoutChange {
  node: HostNode;
  layout: { x: number; y: number; width: number; height: number };
}

/**
 * Runs Yoga for every root (app, system, each presented modal) and copies
 * the results into the retained tree. Returns the nodes whose frame changed
 * and that listen to onLayout.
 */
export function runLayout(engine: Engine): LayoutChange[] {
  const v = engine.viewport;
  const changes: LayoutChange[] = [];
  for (const container of [engine.appRoot, engine.systemRoot]) {
    const yoga = container.root.yoga!;
    yoga.setWidth(v.width);
    yoga.setHeight(v.height);
    yoga.calculateLayout(v.width, v.height, Direction.LTR);
    sync(container.root, changes, true);
  }
  for (const modal of engine.modals) {
    if (!modal.mounted || !modal.yoga) continue;
    const frame = engine.behaviors.modalFrame(modal);
    modal.yoga.setWidth(frame.w);
    modal.yoga.setHeight(frame.h);
    modal.yoga.calculateLayout(frame.w, frame.h, Direction.LTR);
    sync(modal, changes, true, frame);
  }
  return changes;
}

function sync(node: HostNode, changes: LayoutChange[], root: boolean, frame?: { x: number; y: number }): void {
  const yoga = node.yoga;
  if (yoga && (yoga.hasNewLayout() || !node.laidOut)) {
    const l = yoga.getComputedLayout();
    const x = root ? frame?.x ?? 0 : l.left;
    const y = root ? frame?.y ?? 0 : l.top;
    const changed = !node.laidOut || x !== node.x || y !== node.y || l.width !== node.w || l.height !== node.h;
    const previous = node.laidOut ? { x: node.x, y: node.y, w: node.w, h: node.h } : null;
    node.x = x;
    node.y = y;
    node.w = l.width;
    node.h = l.height;
    node.insets = {
      left: yoga.getComputedPadding(Edge.Left) + yoga.getComputedBorder(Edge.Left),
      top: yoga.getComputedPadding(Edge.Top) + yoga.getComputedBorder(Edge.Top),
      right: yoga.getComputedPadding(Edge.Right) + yoga.getComputedBorder(Edge.Right),
      bottom: yoga.getComputedPadding(Edge.Bottom) + yoga.getComputedBorder(Edge.Bottom),
    };
    node.laidOut = true;
    yoga.markLayoutSeen();
    if (changed) {
      // A layout transition (Reanimated `layout`) animates from where the node is drawn now.
      if (previous && node.layoutTransition) node.layoutTransition(previous, { x, y, w: l.width, h: l.height });
      if (typeof node.props.onLayout === 'function') {
        changes.push({ node, layout: { x, y, width: l.width, height: l.height } });
      }
    }
  }
  for (const child of node.children) {
    if (child.kind === 'modal') continue;
    if (child.yoga) sync(child, changes, false);
    else child.laidOut = true;
  }
}

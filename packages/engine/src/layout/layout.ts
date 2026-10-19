import { Direction, Edge } from 'yoga-layout/load';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';
import { blockOffset, lineOffset, verticalAlignOf } from '../text/text-block';

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
  measureInlineViews(engine);
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
  const moved = root && !!frame && (frame.x !== node.x || frame.y !== node.y);
  if (yoga && (yoga.hasNewLayout() || !node.laidOut || moved)) {
    const l = yoga.getComputedLayout();
    const x = root ? frame?.x ?? 0 : l.left;
    const y = root ? frame?.y ?? 0 : l.top;
    const changed = !node.laidOut || x !== node.x || y !== node.y || l.width !== node.w || l.height !== node.h;
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
      if (typeof node.props.onLayout === 'function') {
        changes.push({ node, layout: { x, y, width: l.width, height: l.height } });
      }
    }
  }
  if (node.kind === 'text') {
    placeInlineViews(node.engine, node, changes);
    return;
  }
  for (const child of node.children) {
    if (child.kind === 'modal') continue;
    if (child.yoga) sync(child, changes, false);
    else child.laidOut = true;
  }
}

/**
 * Views nested in <Text> are separate Yoga roots: each is laid out on its own
 * (unconstrained, like an RN inline view) before the text measures, and its
 * size becomes the attachment box the text reserves in a line.
 */
function measureInlineViews(engine: Engine): void {
  for (const node of engine.inlineViews) {
    const yoga = node.yoga;
    if (!node.mounted || !yoga) continue;
    const before = node.native.inlineSize as { width: number; height: number } | undefined;
    if (before && !yoga.isDirty()) continue;
    yoga.calculateLayout(undefined, undefined, Direction.LTR);
    const size = { width: yoga.getComputedWidth(), height: yoga.getComputedHeight() };
    node.native.inlineSize = size;
    if (!before || before.width !== size.width || before.height !== size.height) node.textRoot?.invalidateText();
  }
}

/** Position a text's inline views where its line layout put their boxes, then lay out their subtrees. */
function placeInlineViews(engine: Engine, text: HostNode, changes: LayoutChange[]): void {
  let hasInline = false;
  text.walk((n) => {
    if (n === text) return;
    if (n.kind === 'raw-text' || n.kind === 'virtual-text') {
      n.laidOut = true;
      return;
    }
    hasInline = true;
    return false;
  });
  if (!hasInline) return;
  const i = text.insets;
  const contentW = Math.max(0, text.w - i.left - i.right);
  const contentH = Math.max(0, text.h - i.top - i.bottom);
  const layout = engine.textLayoutFor(text, contentW);
  const top = i.top + blockOffset(textVerticalAlign(engine, text), contentH, layout);
  const align = String(text.computed.textAlign ?? 'auto');
  for (const line of layout.lines) {
    const left = i.left + lineOffset(align, contentW, line);
    for (const run of line.runs) {
      const node = run.attachment?.node as HostNode | undefined;
      if (!node) continue;
      // positions are relative to the text (nested virtual texts sit at its origin)
      sync(node, changes, true, { x: left + run.x, y: top + line.baseline - run.attachment!.height });
    }
  }
  // Inline views cut off by numberOfLines have no run: painting and hit testing go by runs.
}

/** Android draws text at `textAlignVertical`; iOS always top-aligns a <Text>'s lines. */
export function textVerticalAlign(engine: Engine, node: HostNode) {
  return engine.kit.platform === 'android' ? verticalAlignOf(node.computed) : null;
}

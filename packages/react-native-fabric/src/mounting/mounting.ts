import { NO_RADII } from '@mimicry/protocol';
import type { Engine } from '../engine';
import { ownTransform, stickyOffset } from '../geometry';
import type { HostNode } from '../tree/node';
import { nodeRadii } from './draw';
import type { HostContainer, HostView, HostViewFactory } from './host-view';

/**
 * The mounting layer (Fabric's MountingManager): keeps the OS view tree in
 * step with React Native's shadow tree. Structure (which view is a subview
 * of which, in what order) is reconciled when the tree changed; geometry
 * and layer properties (frame, transform, opacity, visibility, z order,
 * clipping) are pushed before every frame, so Animated values and layout
 * animations show up without a React commit.
 *
 * The surface holds, bottom to top: the app's root view, the visible
 * modals, and the root system UI renders into.
 */
const PINNED = 1e9;

export class Mounting {
  private structureDirty = true;

  constructor(private readonly engine: Engine, readonly factory: HostViewFactory) {}

  /** The view for a new shadow node (none for inline text and SVG elements). */
  createView(node: HostNode, root: 'app' | 'system' | null): HostView | null {
    if (node.kind === 'virtual-text' || node.kind === 'raw-text' || node.kind === 'svg-node') return null;
    const view = root ? this.factory.createRoot(node, root === 'app') : this.factory.create(node);
    view.updateProps();
    return view;
  }

  structureChanged(): void {
    this.structureDirty = true;
  }

  /** Bring the view tree up to date with the shadow tree. */
  sync(): void {
    const engine = this.engine;
    if (this.structureDirty) {
      this.structureDirty = false;
      this.reconcileStructure();
    }
    const app = engine.appRoot.root;
    this.syncRoot(app);
    for (const modal of engine.modals) this.syncModal(modal);
    this.syncNode(engine.systemRoot.root);
  }

  // ── structure ─────────────────────────────────────────────────────────

  private reconcileStructure(): void {
    const engine = this.engine;
    const surface: HostView[] = [];
    const app = engine.appRoot.root.hostView!;
    surface.push(app);
    for (const modal of engine.modals) if (modal.mounted && modal.hostView) surface.push(modal.hostView);
    surface.push(engine.systemRoot.root.hostView!);
    reconcile(this.factory.surface, surface);
    this.reconcileChildren(engine.appRoot.root);
    for (const modal of engine.modals) if (modal.mounted) this.reconcileChildren(modal);
    this.reconcileChildren(engine.systemRoot.root);
  }

  private reconcileChildren(node: HostNode): void {
    const view = node.hostView;
    if (!view) return;
    const desired: HostView[] = [];
    if (node.kind !== 'svg') collect(node.children, desired);
    reconcile(view, desired);
    for (const child of desired) this.reconcileChildren(child.node);
  }

  // ── properties ────────────────────────────────────────────────────────

  private syncRoot(node: HostNode): void {
    const view = node.hostView!;
    this.syncNode(node);
    // While a page sheet is presented, the app scales back into a rounded card.
    const p = this.engine.presentation;
    if (p) {
      view.setTransform(p.matrix);
      view.setComposited(true);
      const r = p.radius;
      view.setClip(r > 0, r > 0 ? [r, r, r, r] : NO_RADII);
    } else {
      view.setComposited(false);
    }
  }

  private syncModal(node: HostNode): void {
    const view = node.hostView;
    if (!view) return;
    const shown = node.mounted && this.engine.behaviors.isModalShown(node) && displayed(node);
    view.setHidden(!shown);
    if (!shown) return;
    view.mountFrame(node.x, node.y, node.w, node.h);
    view.setTransform(ownTransform(node));
    view.setOpacity(node.native.opacity ?? 1);
    view.setComposited(true);
    const radius: number = node.native.radius ?? 0;
    view.setClip(radius > 0, radius > 0 ? [radius, radius, 0, 0] : NO_RADII);
    view.setZIndex(0);
    this.syncChildren(node);
  }

  private syncNode(node: HostNode): void {
    const view = node.hostView;
    if (!view) return;
    const style = node.computed;
    const shown = displayed(node);
    view.setHidden(!shown);
    if (!shown) return;
    const pinned = stickyOffset(node);
    view.mountFrame(node.x, node.y + pinned, node.w, node.h);
    view.setTransform(ownTransform(node));
    view.setOpacity(typeof style.opacity === 'number' ? Math.max(0, Math.min(1, style.opacity)) : 1);
    view.setComposited(node.native.layer === true || !!node.props.shouldRasterizeIOS || !!node.props.renderToHardwareTextureAndroid);
    view.setZIndex(pinned > 0 ? PINNED : Number(style.zIndex ?? 0) || 0);
    if (node.kind === 'scroll') {
      this.engine.scrolls.ensure(node);
      view.setClip(true, nodeRadii(node));
    } else {
      const clip = style.overflow === 'hidden' && node.kind !== 'text' && node.kind !== 'svg';
      view.setClip(clip, clip ? nodeRadii(node) : NO_RADII);
    }
    this.syncChildren(node);
  }

  private syncChildren(node: HostNode): void {
    const view = node.hostView!;
    if (node.kind === 'text') {
      // Inline views show only where the line layout placed them (numberOfLines cuts the rest).
      const i = node.insets;
      const layout = this.engine.textLayoutFor(node, Math.max(0, node.w - i.left - i.right));
      const placed = new Set<unknown>();
      for (const line of layout.lines) for (const run of line.runs) if (run.attachment?.node) placed.add(run.attachment.node);
      for (const child of view.mountedChildren) {
        if (placed.has(child.node)) this.syncNode(child.node);
        else child.setHidden(true);
      }
      return;
    }
    for (const child of view.mountedChildren) this.syncNode(child.node);
  }
}

/** Views of a node's children, flattening nested <Text> (its inline views belong to the outer text). */
function collect(children: readonly HostNode[], out: HostView[]): void {
  for (const child of children) {
    if (child.kind === 'modal') continue; // mounted in the surface
    if (child.hostView) out.push(child.hostView);
    else if (child.kind === 'virtual-text') collect(child.children, out);
  }
}

function reconcile(container: HostContainer, desired: readonly HostView[]): void {
  const current = container.mountedChildren;
  if (current.length === desired.length && current.every((v, i) => v === desired[i])) return;
  const keep = new Set(desired);
  for (const child of current.slice()) if (!keep.has(child)) container.unmountChild(child);
  desired.forEach((child, index) => {
    if (container.mountedChildren[index] !== child) container.mountChild(child, index);
  });
}

function displayed(node: HostNode): boolean {
  return !node.hidden && node.computed.display !== 'none' && node.laidOut;
}

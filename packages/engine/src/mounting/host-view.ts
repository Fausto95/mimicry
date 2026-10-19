import type { Radii } from '@mimicry/protocol';
import type { Matrix, RenderLayer } from '@mimicry/os-core';
import type { HostNode } from '../tree/node';

/**
 * The native view behind a React Native host component, seen from the
 * mounting layer: React Native's component views on iOS
 * (RCTViewComponentView, RCTScrollViewComponentView, …) and its view
 * managers' views on Android (ReactViewGroup, ReactScrollView, …). Each
 * platform implements it with that OS's own API (UIView / android.view.View);
 * the mounting manager only ever talks to this interface.
 */
export interface HostContainer {
  /** the render-tree node of the platform view (CALayer / RenderNode) */
  readonly layer: RenderLayer;
  /** subviews mounted by React Native, in order */
  readonly mountedChildren: HostView[];
  mountChild(child: HostView, index: number): void;
  unmountChild(child: HostView): void;
}

export interface HostView extends HostContainer {
  readonly node: HostNode;
  /** the platform view's parent, as mounted */
  mountedParent: HostContainer | null;

  /** frame in the parent's content coordinates */
  mountFrame(x: number, y: number, w: number, h: number): void;
  /** the full 2D transform about the view's top-left corner */
  setTransform(m: Matrix | null): void;
  setOpacity(opacity: number): void;
  setHidden(hidden: boolean): void;
  setZIndex(z: number): void;
  setClip(clip: boolean, radii: Radii): void;
  setComposited(composited: boolean): void;
  /** props or style changed (controls update their native state) */
  updateProps(): void;
  /** controls: a finger is down on it (UIControl highlight / View pressed state) */
  setControlPressed?(pressed: boolean): void;
  /** controls: stop tracking the current touch (a gesture handler took it) */
  cancelControlTouch?(): void;
  /** the node is gone for good */
  destroy(): void;
}

/** A platform's factory for host views (one per OS). */
export interface HostViewFactory {
  create(node: HostNode): HostView;
  /** the root of a React surface: the app's, or the one system UI renders into */
  createRoot(node: HostNode, app: boolean): HostView;
  /** the surface: a full-screen container holding the app root, modals and system root */
  readonly surface: HostContainer;
}

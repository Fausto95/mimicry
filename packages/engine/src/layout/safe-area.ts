import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';

/**
 * UIKit's safe area model, which react-native-safe-area-context and
 * react-native-screens rely on.
 *
 * The window's safe area is the device's insets (status bar / Dynamic Island,
 * home indicator, notch sides). Containers can push it further in for their
 * descendants — a tab bar controller adds its tab bar, a navigation
 * controller with a translucent bar adds the bar — through the
 * `additionalSafeAreaInsets` host prop, exactly like
 * `UIViewController.additionalSafeAreaInsets`. A view's safe area insets are
 * the overlap between its frame and the unsafe region around the nearest
 * container's safe rect.
 *
 * Views opt in to being padded by their insets with the `safeAreaEdges` host
 * prop (what RNCSafeAreaView does natively); scroll views opt in to
 * adjusting their content inset with `contentInsetAdjustmentBehavior`.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SafeAreaEdgeMode = 'off' | 'additive' | 'maximum';
export interface SafeAreaEdges {
  top?: SafeAreaEdgeMode;
  right?: SafeAreaEdgeMode;
  bottom?: SafeAreaEdgeMode;
  left?: SafeAreaEdgeMode;
}

export const ZERO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Layout frame in window coordinates (transforms are ignored, as layout is). */
function windowFrame(engine: Engine, node: HostNode): Rect {
  let x = node.x;
  let y = node.y;
  for (let p = node.parent; p; p = p.parent) {
    if (p.kind === 'modal') {
      const f = engine.behaviors.modalFrame(p);
      x += f.x;
      y += f.y;
      break;
    }
    x += p.x;
    y += p.y;
    if (p.kind === 'scroll' && p.scroll) {
      x -= p.scroll.x;
      y -= p.scroll.y;
    }
  }
  return { x, y, w: node.w, h: node.h };
}

function overlap(safe: Rect, frame: Rect): Insets {
  return {
    top: Math.max(0, Math.min(frame.h, safe.y - frame.y)),
    left: Math.max(0, Math.min(frame.w, safe.x - frame.x)),
    bottom: Math.max(0, Math.min(frame.h, frame.y + frame.h - (safe.y + safe.h))),
    right: Math.max(0, Math.min(frame.w, frame.x + frame.w - (safe.x + safe.w))),
  };
}

function inset(r: Rect, i: Insets): Rect {
  return { x: r.x + i.left, y: r.y + i.top, w: Math.max(0, r.w - i.left - i.right), h: Math.max(0, r.h - i.top - i.bottom) };
}

/** The safe rect (window coordinates) that applies to `node`'s descendants. */
function safeRect(engine: Engine, node: HostNode | null): Rect {
  if (!node || !node.parent || node.kind === 'root') {
    const v = engine.viewport;
    return inset({ x: 0, y: 0, w: v.width, h: v.height }, v.safeArea);
  }
  const parentRect = safeRect(engine, node.parent);
  const additional = node.props.additionalSafeAreaInsets as Partial<Insets> | undefined;
  if (!additional) return parentRect;
  const frame = windowFrame(engine, node);
  const base = overlap(parentRect, frame);
  return inset(frame, {
    top: base.top + (additional.top ?? 0),
    right: base.right + (additional.right ?? 0),
    bottom: base.bottom + (additional.bottom ?? 0),
    left: base.left + (additional.left ?? 0),
  });
}

/**
 * A container's insets before its own `additionalSafeAreaInsets`: where a
 * navigation bar or tab bar it adds should itself be placed.
 */
export function containerSafeAreaInsets(engine: Engine, node: HostNode): Insets {
  if (!node.laidOut) return ZERO_INSETS;
  return overlap(safeRect(engine, node.parent), windowFrame(engine, node));
}

/** A view's safe area insets (UIView.safeAreaInsets). */
export function safeAreaInsetsOf(engine: Engine, node: HostNode): Insets {
  if (!node.laidOut) return ZERO_INSETS;
  const container = node.props.additionalSafeAreaInsets ? node : node.parent;
  return overlap(safeRect(engine, container), windowFrame(engine, node));
}

const sameInsets = (a: Insets | undefined, b: Insets) =>
  !!a && a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * After a Yoga pass: give every `safeAreaEdges` view its current insets.
 * Returns true when any changed, in which case layout must run again.
 */
export function resolveSafeAreaPadding(engine: Engine): boolean {
  let changed = false;
  for (const node of engine.safeAreaNodes) {
    if (!node.mounted || !node.laidOut) continue;
    const insets = safeAreaInsetsOf(engine, node);
    if (!sameInsets(node.native.safeAreaInsets, insets)) {
      node.native.safeAreaInsets = insets;
      node.refreshLayoutStyle();
      changed = true;
    }
  }
  return changed;
}

/** Normalize RNCSafeAreaView-style `edges` (array or per-edge modes). */
export function normalizeEdges(edges: unknown): Required<SafeAreaEdges> {
  const all: Required<SafeAreaEdges> = { top: 'additive', right: 'additive', bottom: 'additive', left: 'additive' };
  if (Array.isArray(edges)) {
    return {
      top: edges.includes('top') ? 'additive' : 'off',
      right: edges.includes('right') ? 'additive' : 'off',
      bottom: edges.includes('bottom') ? 'additive' : 'off',
      left: edges.includes('left') ? 'additive' : 'off',
    };
  }
  if (edges && typeof edges === 'object') {
    // RNCSafeAreaView takes modes; RNSSafeAreaView takes booleans
    const mode = (v: unknown): SafeAreaEdgeMode => (v === true ? 'additive' : v === 'additive' || v === 'maximum' ? v : 'off');
    const e = edges as Record<string, unknown>;
    return { top: mode(e.top), right: mode(e.right), bottom: mode(e.bottom), left: mode(e.left) };
  }
  return all;
}

const EDGE_KEYS = {
  top: ['Top', 'Vertical'],
  bottom: ['Bottom', 'Vertical'],
  left: ['Left', 'Horizontal', 'Start'],
  right: ['Right', 'Horizontal', 'End'],
} as const;

/** The style a `safeAreaEdges` view lays out with: its own padding/margin combined with its insets. */
export function safeAreaStyle(style: Record<string, any>, edgesProp: unknown, mode: unknown, insets: Insets | undefined): Record<string, any> {
  if (!insets) return style;
  const edges = normalizeEdges(edgesProp);
  const prop = mode === 'margin' ? 'margin' : 'padding';
  const out: Record<string, any> = { ...style };
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const how = edges[edge];
    if (how === 'off') continue;
    let base = 0;
    for (const suffix of EDGE_KEYS[edge]) {
      const v = style[prop + suffix];
      if (typeof v === 'number') {
        base = v;
        break;
      }
    }
    if (base === 0 && typeof style[prop] === 'number') base = style[prop];
    const value = how === 'maximum' ? Math.max(base, insets[edge]) : base + insets[edge];
    out[prop + edge[0]!.toUpperCase() + edge.slice(1)] = value;
  }
  return out;
}

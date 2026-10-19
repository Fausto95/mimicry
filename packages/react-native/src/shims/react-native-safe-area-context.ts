import React, { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { safeAreaInsetsOf, type HostNode } from '@mimicry/engine';
import { View } from '../components/primitives';
import { useWindowDimensions } from '../apis/core';
import { maybeEngine } from '../engine-ref';

/**
 * react-native-safe-area-context on the engine's UIKit-style safe area model
 * (engine/src/layout/safe-area.ts). As on device, a provider reports the
 * safe area of its own view — the window insets at the root, less inside a
 * tab bar or below a navigation bar — and SafeAreaView pads itself by its
 * own insets during layout, so there is no frame of wrong padding.
 */
type Insets = { top: number; right: number; bottom: number; left: number };
type Frame = { x: number; y: number; width: number; height: number };

export type Edge = 'top' | 'right' | 'bottom' | 'left';
export type EdgeMode = 'off' | 'additive' | 'maximum';
export type EdgeRecord = Partial<Record<Edge, EdgeMode>>;
export type Edges = readonly Edge[] | Readonly<EdgeRecord>;
export interface Metrics {
  insets: Insets;
  frame: Frame;
}

export const SafeAreaInsetsContext = createContext<Insets | null>(null);
SafeAreaInsetsContext.displayName = 'SafeAreaInsetsContext';
export const SafeAreaFrameContext = createContext<Frame | null>(null);
SafeAreaFrameContext.displayName = 'SafeAreaFrameContext';

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const same = (a: Insets, b: Insets) => a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

function windowInsets(): Insets {
  return maybeEngine()?.viewport.safeArea ?? ZERO;
}

export function SafeAreaProvider({ children, style, initialMetrics, initialSafeAreaInsets, ...rest }: {
  children?: React.ReactNode;
  style?: unknown;
  initialMetrics?: Metrics | null;
  initialSafeAreaInsets?: Insets | null;
  [key: string]: unknown;
}) {
  const parentInsets = useContext(SafeAreaInsetsContext);
  const { width, height } = useWindowDimensions();
  const host = useRef<HostNode | null>(null);
  const [insets, setInsets] = useState<Insets>(initialMetrics?.insets ?? initialSafeAreaInsets ?? parentInsets ?? windowInsets());
  const [frame, setFrame] = useState<Frame>(initialMetrics?.frame ?? { x: 0, y: 0, width, height });

  const measure = useCallback(() => {
    const node = host.current;
    const engine = maybeEngine();
    if (!node || !engine || !node.laidOut) return;
    const next = safeAreaInsetsOf(engine, node);
    setInsets((prev) => (same(prev, next) ? prev : next));
    setFrame((prev) => (prev.x === node.x && prev.y === node.y && prev.width === node.w && prev.height === node.h ? prev : { x: node.x, y: node.y, width: node.w, height: node.h }));
  }, []);
  // Layout runs before layout effects, so the provider knows its insets before paint.
  useLayoutEffect(measure);
  useLayoutEffect(() => maybeEngine()?.env.subscribe(measure), [measure]);

  return React.createElement(
    SafeAreaInsetsContext.Provider,
    { value: insets },
    React.createElement(
      SafeAreaFrameContext.Provider,
      { value: frame },
      React.createElement(View as any, { ...rest, ref: host, style: [{ flex: 1 }, style], onLayout: measure, children }),
    ),
  );
}

export function useSafeAreaInsets(): Insets {
  return useContext(SafeAreaInsetsContext) ?? windowInsets();
}

export function useSafeAreaFrame(): Frame {
  const { width, height } = useWindowDimensions();
  return useContext(SafeAreaFrameContext) ?? { x: 0, y: 0, width, height };
}

/** RNCSafeAreaView: pads (or margins) itself by its own safe area insets. */
export const SafeAreaView = forwardRef<any, any>(function SafeAreaView(props, ref) {
  const { edges, mode = 'padding', ...rest } = props;
  return React.createElement(View as any, { ...rest, ref, safeAreaEdges: edges ?? ALL_EDGES, safeAreaMode: mode });
});

const ALL_EDGES = ['top', 'right', 'bottom', 'left'];

export const SafeAreaConsumer = SafeAreaInsetsContext.Consumer;
export const SafeAreaContext = SafeAreaInsetsContext;

/** Metrics before the first layout: the window's. Libraries pass this to SafeAreaProvider. */
export const initialWindowMetrics: Metrics | null = null;

export function useSafeArea(): Insets {
  return useSafeAreaInsets();
}

export function withSafeAreaInsets<P>(Component: React.ComponentType<P & { insets: Insets }>) {
  return forwardRef<any, P>((props, ref) => React.createElement(Component as any, { ...props, insets: useSafeAreaInsets(), ref }));
}


import React, { createContext, forwardRef, useContext } from 'react';
import { View, useSafeAreaInsetsInternal } from '../components/primitives';
import { useWindowDimensions } from '../apis/core';

/**
 * react-native-safe-area-context backed by the device descriptor. Unlike
 * React Native's own SafeAreaView this works on Android too, as on device.
 */
type Insets = { top: number; right: number; bottom: number; left: number };
type Edge = 'top' | 'right' | 'bottom' | 'left';

export const SafeAreaInsetsContext = createContext<Insets | null>(null);
export const SafeAreaFrameContext = createContext<{ x: number; y: number; width: number; height: number } | null>(null);

export function SafeAreaProvider({ children, style }: { children?: React.ReactNode; style?: unknown; initialMetrics?: unknown }) {
  const insets = useSafeAreaInsetsInternal();
  const { width, height } = useWindowDimensions();
  return React.createElement(
    SafeAreaInsetsContext.Provider,
    { value: insets },
    React.createElement(
      SafeAreaFrameContext.Provider,
      { value: { x: 0, y: 0, width, height } },
      React.createElement(View as any, { style: [{ flex: 1 }, style] }, children),
    ),
  );
}

export function useSafeAreaInsets(): Insets {
  const fromContext = useContext(SafeAreaInsetsContext);
  const live = useSafeAreaInsetsInternal();
  return fromContext ?? live;
}

export function useSafeAreaFrame() {
  const { width, height } = useWindowDimensions();
  return useContext(SafeAreaFrameContext) ?? { x: 0, y: 0, width, height };
}

export const SafeAreaView = forwardRef<any, any>(function SafeAreaView(props, ref) {
  const { edges, mode = 'padding', style, ...rest } = props;
  const insets = useSafeAreaInsets();
  const list: Edge[] = Array.isArray(edges) ? edges : edges && typeof edges === 'object' ? (Object.keys(edges).filter((k) => edges[k] !== 'off') as Edge[]) : ['top', 'right', 'bottom', 'left'];
  const prop = mode === 'margin' ? 'margin' : 'padding';
  const extra: Record<string, number> = {};
  for (const edge of list) extra[prop + edge[0]!.toUpperCase() + edge.slice(1)] = insets[edge];
  return React.createElement(View as any, { ...rest, ref, style: [style, extra] });
});

export const SafeAreaConsumer = SafeAreaInsetsContext.Consumer;
export const initialWindowMetrics = null;
export function withSafeAreaInsets<P>(Component: React.ComponentType<P & { insets: Insets }>) {
  return forwardRef<any, P>((props, ref) => React.createElement(Component as any, { ...props, insets: useSafeAreaInsets(), ref }));
}

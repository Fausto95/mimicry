import React, { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { containerSafeAreaInsets, type HostNode } from '@mimicry/engine';
import { Animated } from '../../animated';
import { maybeEngine } from '../../engine-ref';
import { mergeRefs } from '../../components/pressability';
import { StackContext, StackItemContext, type ScreenRegistration } from './stack';

/**
 * RNSScreen / RNSModalScreen: one screen of a stack or of a ScreenContainer
 * (the containers @react-navigation/bottom-tabs and drawer use).
 *
 * A screen is a view-controller-like container: it fills its parent, it
 * moves when its stack transitions, and a navigation bar it shows adds to
 * the safe area of its content (`additionalSafeAreaInsets`) the way
 * UINavigationController does for a child view controller.
 */
export interface ScreenApi {
  /**
   * A navigation bar occupies `height` at the top of the screen: it adds to
   * the content's safe area, and with `offsetContent` (Android's opaque
   * toolbar) the content is laid out below it.
   */
  setTopBar(height: number, offsetContent: boolean): void;
  /** the screen's insets before the bar's own contribution, i.e. where the bar sits */
  baseInsets: { top: number; right: number; bottom: number; left: number };
  presentation: string;
  /** whether the screen sits inside a stack (has a navigation bar at all) */
  inStack: boolean;
}

export const ScreenContext = createContext<ScreenApi | null>(null);

const EVENTS = [
  'onAppear', 'onDisappear', 'onWillAppear', 'onWillDisappear', 'onDismissed', 'onHeaderBackButtonClicked',
  'onNativeDismissCancelled', 'onGestureCancel', 'onTransitionProgress', 'onHeaderHeightChange', 'onSheetDetentChanged',
] as const;

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

/** Measure a container's own safe area insets after each layout (cheap, and needed before paint). */
export function useContainerInsets(host: React.RefObject<HostNode | null>) {
  const [insets, setInsets] = useState(ZERO);
  const measure = useCallback(() => {
    const node = host.current;
    const engine = maybeEngine();
    if (!node || !engine || !node.laidOut) return;
    const next = containerSafeAreaInsets(engine, node);
    setInsets((prev) => (prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom && prev.left === next.left ? prev : next));
  }, [host]);
  useLayoutEffect(measure);
  useLayoutEffect(() => maybeEngine()?.env.subscribe(measure), [measure]);
  return { insets, measure };
}

export const Screen = forwardRef<any, any>(function Screen(props, ref) {
  const {
    children, style, activityState, stackPresentation = 'push', stackAnimation, replaceAnimation, transitionDuration,
    gestureEnabled, fullScreenSwipeEnabled, pointerEvents, ...rest
  } = props;
  const item = useContext(StackItemContext);
  const stack = useContext(StackContext);
  const host = useRef<HostNode | null>(null);
  const [bar, setBar] = useState({ height: 0, offset: false });
  const topBar = bar.height;
  const { insets, measure } = useContainerInsets(host);

  // Tell the stack about this screen on every commit; it reads it when a transition starts.
  useLayoutEffect(() => {
    if (!item || !stack) return;
    const callbacks: ScreenRegistration['callbacks'] = {};
    for (const name of EVENTS) callbacks[name] = props[name];
    stack.register(item.key, { stackPresentation, stackAnimation, replaceAnimation, transitionDuration, gestureEnabled, fullScreenSwipeEnabled, callbacks });
  });

  // onHeaderHeightChange: native-stack's useHeaderHeight()
  const reportedHeader = useRef(-1);
  useLayoutEffect(() => {
    const total = topBar ? topBar + insets.top : 0;
    if (total !== reportedHeader.current) {
      reportedHeader.current = total;
      props.onHeaderHeightChange?.({ nativeEvent: { headerHeight: total } });
    }
  });

  const api = useMemo<ScreenApi>(() => ({
    setTopBar: (height, offset) => setBar((b) => (b.height === height && b.offset === offset ? b : { height, offset })),
    baseInsets: insets,
    presentation: stackPresentation,
    inStack: !!item,
  }), [insets, stackPresentation, item]);

  const hidden = item ? !item.visible : activityState === 0;
  const interactive = !item || (!item.exiting && pointerEvents !== 'none');
  return React.createElement(
    ScreenContext.Provider,
    { value: api },
    React.createElement(Animated.View as any, {
      ...rest,
      ref: mergeRefs(ref, host),
      onLayout: (e: unknown) => {
        measure();
        rest.onLayout?.(e);
      },
      pointerEvents: interactive ? pointerEvents ?? 'auto' : 'none',
      additionalSafeAreaInsets: topBar ? { top: topBar } : undefined,
      style: [FILL, style, bar.offset ? { paddingTop: insets.top + bar.height } : null, item?.style, hidden ? { display: 'none' } : null],
      children,
    }),
  );
});

/** RNSScreenContainer / RNSScreenNavigationContainer: screens stacked in place, one visible. */
export const ScreenContainer = forwardRef<any, any>(function ScreenContainer(props, ref) {
  const { children, style, ...rest } = props;
  return React.createElement(Animated.View as any, { ...rest, ref, style: [{ flex: 1, overflow: 'hidden' }, style], children });
});

import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Animated } from '../animated';
import { View } from '../components/primitives';
import { GestureDetector } from './detector';
import { Gesture } from './gestures';
import { sharedAnimatedValue, type SharedAnimatedValue } from './shared-value';

/**
 * ReanimatedSwipeable (and the legacy `Swipeable`): a row that reveals
 * actions when dragged horizontally. Driven by a pan gesture and Animated
 * springs; progress and translation are handed to the render callbacks as
 * shared-value-like Animated values.
 */
export enum SwipeDirection {
  LEFT = 'left',
  RIGHT = 'right',
}

export interface SwipeableMethods {
  close(): void;
  openLeft(): void;
  openRight(): void;
  reset(): void;
}

type AnyProps = Record<string, any>;

export const Swipeable = forwardRef<SwipeableMethods, AnyProps>(function Swipeable(props, ref) {
  const {
    children, friction = 1, overshootFriction = 1, leftThreshold, rightThreshold, overshootLeft, overshootRight,
    renderLeftActions, renderRightActions, containerStyle, childrenContainerStyle, enabled = true, hitSlop,
    dragOffsetFromLeftEdge, dragOffsetFromRightEdge, dragOffsetFromLeft = dragOffsetFromLeftEdge ?? 10,
    dragOffsetFromRight = dragOffsetFromRightEdge ?? 10, testID, simultaneousWith, requireToFail, block, animationOptions,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const translation = useMemo(() => sharedAnimatedValue(0), []);
  const leftProgress = useMemo(() => sharedAnimatedValue(0), []);
  const rightProgress = useMemo(() => sharedAnimatedValue(0), []);
  // Measured sizes only feed gesture math, so they live in a ref (no re-render on layout).
  const w = useRef({ row: 0, left: 0, right: 0 });
  const state = useRef({ rest: 0, start: 0 });

  const syncProgress = (x: number) => {
    leftProgress.setValue(w.current.left ? Math.max(0, x) / w.current.left : 0);
    rightProgress.setValue(w.current.right ? Math.max(0, -x) / w.current.right : 0);
  };
  const update = (x: number) => {
    translation.setValue(x);
    syncProgress(x);
  };

  const animateTo = (to: number, velocity = 0) => {
    const p = latest.current;
    const from = state.current.rest;
    const direction = to > 0 ? SwipeDirection.LEFT : to < 0 ? SwipeDirection.RIGHT : from > 0 ? SwipeDirection.LEFT : SwipeDirection.RIGHT;
    if (to !== 0) p.onSwipeableWillOpen?.(direction);
    else if (from !== 0) p.onSwipeableWillClose?.(direction);
    state.current.rest = to;
    const anim = Animated.spring(translation, { toValue: to, velocity, bounciness: 0, useNativeDriver: false, ...animationOptions });
    const id = translation.addListener(({ value }) => syncProgress(value));
    anim.start(({ finished }) => {
      translation.removeListener(id);
      if (!finished) return;
      update(to);
      if (to !== 0) p.onSwipeableOpen?.(direction, methods);
      else if (from !== 0) p.onSwipeableClose?.(direction, methods);
    });
  };

  const methods: SwipeableMethods = {
    close: () => animateTo(0),
    openLeft: () => animateTo(w.current.left),
    openRight: () => animateTo(-w.current.right),
    reset: () => {
      state.current.rest = 0;
      update(0);
    },
  };
  useImperativeHandle(ref, () => methods);

  /** Drag position with friction, clamped to the actions unless overshooting is allowed. */
  const positionFor = (dx: number) => {
    const p = latest.current;
    const { left, right } = w.current;
    const raw = state.current.start + dx / friction;
    const max = p.renderLeftActions ? left : 0;
    const min = p.renderRightActions ? -right : 0;
    const allowLeft = p.overshootLeft ?? left > 0;
    const allowRight = p.overshootRight ?? right > 0;
    if (raw > max) return allowLeft ? max + (raw - max) / overshootFriction : max;
    if (raw < min) return allowRight ? min + (raw - min) / overshootFriction : min;
    return raw;
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-dragOffsetFromRight, dragOffsetFromLeft])
    .onStart(() => {
      const p = latest.current;
      state.current.start = state.current.rest;
      const opening = state.current.rest === 0;
      const direction = state.current.rest > 0 ? SwipeDirection.LEFT : SwipeDirection.RIGHT;
      if (opening) p.onSwipeableOpenStartDrag?.(direction);
      else p.onSwipeableCloseStartDrag?.(direction);
    })
    .onUpdate((e: { translationX: number }) => update(positionFor(e.translationX)))
    .onEnd((e: { translationX: number; velocityX: number }) => {
      const { left, right } = w.current;
      const projected = positionFor(e.translationX) + e.velocityX * 0.05;
      const lt = leftThreshold ?? left / 2;
      const rt = rightThreshold ?? right / 2;
      let to = 0;
      if (state.current.start === 0) {
        if (projected > lt && renderLeftActions) to = left;
        else if (-projected > rt && renderRightActions) to = -right;
      } else if (state.current.start > 0) {
        to = projected > left - lt ? left : 0;
      } else {
        to = -projected > right - rt ? -right : 0;
      }
      animateTo(to, e.velocityX / 1000);
    });
  if (hitSlop) pan.hitSlop(hitSlop);
  if (simultaneousWith) pan.simultaneousWithExternalGesture(...[simultaneousWith].flat());
  if (requireToFail) pan.requireExternalGestureToFail(...[requireToFail].flat());
  if (block) pan.blocksExternalGesture(...[block].flat());

  const actions = (render: ((p: SharedAnimatedValue, t: SharedAnimatedValue, m: SwipeableMethods) => React.ReactNode) | undefined, progress: SharedAnimatedValue, side: 'left' | 'right') =>
    render ? (
      <View
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: side === 'left' ? 'row' : 'row-reverse' }}
        pointerEvents="box-none"
      >
        <View onLayout={(e: any) => {
          w.current[side] = e.nativeEvent.layout.width;
        }}>
          {render(progress, translation, methods)}
        </View>
      </View>
    ) : null;

  return (
    <GestureDetector gesture={pan}>
      <View
        testID={testID}
        style={[{ overflow: 'hidden' }, containerStyle]}
        onLayout={(e: any) => {
          w.current.row = e.nativeEvent.layout.width;
        }}
      >
        {actions(renderLeftActions, leftProgress, 'left')}
        {actions(renderRightActions, rightProgress, 'right')}
        <Animated.View style={[{ transform: [{ translateX: translation }] }, childrenContainerStyle]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
});

export default Swipeable;

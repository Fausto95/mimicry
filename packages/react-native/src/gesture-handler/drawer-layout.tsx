import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated } from '../animated';
import { Keyboard } from '../apis/core';
import { Pressable, View } from '../components/primitives';
import { GestureDetector } from './detector';
import { Gesture } from './gestures';
import { sharedAnimatedValue } from './shared-value';

/**
 * ReanimatedDrawerLayout: a side drawer opened by dragging from the screen
 * edge (or imperatively). Front, back and slide drawer types, overlay, lock
 * modes and the open/close/state callbacks follow RNGH's component.
 */
export enum DrawerPosition {
  LEFT,
  RIGHT,
}
export enum DrawerState {
  IDLE,
  DRAGGING,
  SETTLING,
}
export enum DrawerType {
  FRONT,
  BACK,
  SLIDE,
}
export enum DrawerLockMode {
  UNLOCKED,
  LOCKED_CLOSED,
  LOCKED_OPEN,
}
export enum DrawerKeyboardDismissMode {
  NONE,
  ON_DRAG,
}

export interface DrawerMovementOption {
  initialVelocity?: number;
  animationSpeed?: number;
}

export interface DrawerLayoutMethods {
  openDrawer(options?: DrawerMovementOption): void;
  closeDrawer(options?: DrawerMovementOption): void;
}

type AnyProps = Record<string, any>;

export const DrawerLayout = forwardRef<DrawerLayoutMethods, AnyProps>(function DrawerLayout(props, ref) {
  const {
    children, renderNavigationView, drawerPosition = DrawerPosition.LEFT, drawerWidth = 200, drawerBackgroundColor,
    drawerType = DrawerType.FRONT, edgeWidth = 20, minSwipeDistance = 3, overlayColor = 'rgba(0, 0, 0, 0.7)',
    drawerLockMode = DrawerLockMode.UNLOCKED, keyboardDismissMode, contentContainerStyle, drawerContainerStyle,
    rootContainerStyle, testID, animationSpeed,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const openValue = useMemo(() => sharedAnimatedValue(drawerLockMode === DrawerLockMode.LOCKED_OPEN ? 1 : 0), []);
  const [open, setOpen] = useState(drawerLockMode === DrawerLockMode.LOCKED_OPEN);
  const openRef = useRef(open);
  const start = useRef(0);
  const left = drawerPosition === DrawerPosition.LEFT;

  const settle = (toOpen: boolean, velocity = 0, speed?: number) => {
    const p = latest.current;
    p.onDrawerStateChanged?.(DrawerState.SETTLING, toOpen);
    Animated.spring(openValue, { toValue: toOpen ? 1 : 0, velocity, bounciness: 0, speed: speed ?? p.animationSpeed ?? 12, useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      openRef.current = toOpen;
      setOpen(toOpen);
      p.onDrawerStateChanged?.(DrawerState.IDLE, toOpen);
      if (toOpen) p.onDrawerOpen?.();
      else p.onDrawerClose?.();
    });
  };

  useImperativeHandle(ref, () => ({
    openDrawer: (o = {}) => settle(true, o.initialVelocity ?? 0, o.animationSpeed),
    closeDrawer: (o = {}) => settle(false, o.initialVelocity ?? 0, o.animationSpeed),
  }));

  const locked = drawerLockMode !== DrawerLockMode.UNLOCKED;
  const sign = left ? 1 : -1;
  const pan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-minSwipeDistance, minSwipeDistance])
    .failOffsetY([-15, 15])
    .onStart(() => {
      start.current = openValue.__getValue();
      latest.current.onDrawerStateChanged?.(DrawerState.DRAGGING, !openRef.current);
      if (keyboardDismissMode === DrawerKeyboardDismissMode.ON_DRAG) Keyboard.dismiss();
    })
    .onUpdate((e: { translationX: number }) => {
      const next = Math.min(1, Math.max(0, start.current + (sign * e.translationX) / drawerWidth));
      openValue.setValue(next);
      latest.current.onDrawerSlide?.(next);
    })
    .onEnd((e: { velocityX: number }) => {
      const v = (sign * e.velocityX) / drawerWidth;
      const projected = openValue.__getValue() + v * 0.2;
      settle(projected > 0.5, v);
    });
  // Closed, only the edge strip starts a drag; open, the whole screen does.
  if (!open) pan.hitSlop(left ? { left: 0, width: edgeWidth } : { right: 0, width: edgeWidth });

  const drawerTranslate = openValue.interpolate({ inputRange: [0, 1], outputRange: [left ? -drawerWidth : drawerWidth, 0] });
  const contentTranslate = drawerType === DrawerType.FRONT
    ? 0
    : openValue.interpolate({ inputRange: [0, 1], outputRange: [0, sign * drawerWidth] });
  const overlayOpacity = openValue.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const drawerFixed = drawerType === DrawerType.BACK;

  return (
    <GestureDetector gesture={pan}>
      <View testID={testID} style={[{ flex: 1, overflow: 'hidden' }, rootContainerStyle]}>
        {drawerFixed ? (
          <View style={[{ position: 'absolute', top: 0, bottom: 0, width: drawerWidth, backgroundColor: drawerBackgroundColor }, left ? { left: 0 } : { right: 0 }, drawerContainerStyle]}>
            {renderNavigationView?.(openValue)}
          </View>
        ) : null}
        <Animated.View style={[{ flex: 1, transform: [{ translateX: contentTranslate }] }, contentContainerStyle]}>
          {typeof children === 'function' ? children(openValue) : children}
        </Animated.View>
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: overlayColor, opacity: overlayOpacity }}
        >
          <Pressable testID="drawer-overlay" style={{ flex: 1 }} onPress={() => drawerLockMode !== DrawerLockMode.LOCKED_OPEN && settle(false)} />
        </Animated.View>
        {drawerFixed ? null : (
          <Animated.View
            style={[
              { position: 'absolute', top: 0, bottom: 0, width: drawerWidth, backgroundColor: drawerBackgroundColor, transform: [{ translateX: drawerTranslate }] },
              left ? { left: 0 } : { right: 0 },
              drawerContainerStyle,
            ]}
          >
            {renderNavigationView?.(openValue)}
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
});

export default DrawerLayout;

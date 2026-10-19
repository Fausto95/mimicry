import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { maybeEngine } from '../engine-ref';
import { FlatList as RNFlatList, ScrollView as RNScrollView } from '../components/lists';
import { Switch as RNSwitch, TextInput as RNTextInput, View, Text as RNText, RefreshControl as RNRefreshControl, Pressable as RNPressable } from '../components/primitives';
import { Platform } from '../apis/core';
import { State } from './constants';
import { createNativeWrapper, NativeViewGestureHandler } from './legacy';

/**
 * RNGH's components: the root view, native-gesture-wrapped scrollables and
 * controls, and the buttons. Buttons are a View with a native gesture: they
 * press on touch down, call `onPress` on release inside, and are cancelled by
 * scrolling or by any other gesture that activates — like RNGH's native buttons.
 */
type AnyProps = Record<string, any>;

export const GestureHandlerRootView = forwardRef<any, AnyProps>(function GestureHandlerRootView(props, ref) {
  return <View {...props} ref={ref} />;
});

export function gestureHandlerRootHOC<P extends object>(Component: React.ComponentType<P>, containerStyles?: unknown) {
  function Wrapper(props: P) {
    return (
      <GestureHandlerRootView style={[{ flex: 1 }, containerStyles]}>
        <Component {...props} />
      </GestureHandlerRootView>
    );
  }
  Wrapper.displayName = `gestureHandlerRootHOC(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Wrapper;
}

export const ScrollView = createNativeWrapper(RNScrollView, { disallowInterruption: true, shouldCancelWhenOutside: false });
export const FlatList = createNativeWrapper(RNFlatList, { disallowInterruption: true, shouldCancelWhenOutside: false });
export const Switch = createNativeWrapper(RNSwitch, { shouldCancelWhenOutside: false, shouldActivateOnStart: true, disallowInterruption: true });
export const TextInput = createNativeWrapper(RNTextInput);
export const RefreshControl = createNativeWrapper(RNRefreshControl, { disallowInterruption: true, shouldCancelWhenOutside: false });
/** Android-only in React Native; Mimicry renders its content without a drawer. */
export const DrawerLayoutAndroid = createNativeWrapper(
  forwardRef<any, AnyProps>(function DrawerLayoutAndroid({ renderNavigationView: _nav, ...props }, ref) {
    return <View {...props} ref={ref} />;
  }),
  { disallowInterruption: true },
);

// ── Buttons ────────────────────────────────────────────────────────────

/**
 * RawButton: the native button view with its gesture. BaseButton adds the
 * press logic (`onPress(pointerInside)`, `onLongPress`, `onActiveStateChange`).
 */
export const RawButton = forwardRef<any, AnyProps>(function RawButton(props, ref) {
  const { onHandlerStateChange, onGestureEvent, enabled, exclusive = true, rippleColor, rippleRadius, borderless, foreground, testID, ...rest } = props;
  return (
    <NativeViewGestureHandler
      enabled={enabled}
      shouldActivateOnStart={false}
      disallowInterruption={exclusive}
      onHandlerStateChange={onHandlerStateChange}
      onGestureEvent={onGestureEvent}
    >
      <View accessible accessibilityRole="button" testID={testID} {...rest} ref={ref} />
    </NativeViewGestureHandler>
  );
});

export const BaseButton = forwardRef<any, AnyProps>(function BaseButton(props, ref) {
  // Press callbacks are read from `latest` when events arrive; the rest goes to the view.
  const { onPress: _onPress, onLongPress: _onLongPress, onActiveStateChange: _onActive, delayLongPress: _delay, onBegin: _onBegin, onActivate: _onActivate, onDeactivate: _onDeactivate, onFinalize: _onFinalize, ...rest } = props;
  const latest = useRef(props);
  latest.current = props;
  const longTimer = useRef<unknown>(null);
  const longPressed = useRef(false);

  const clearLong = () => {
    if (longTimer.current != null) maybeEngine()?.clock.clearTimeout(longTimer.current);
    longTimer.current = null;
  };
  useEffect(() => clearLong, []);

  const onHandlerStateChange = ({ nativeEvent }: { nativeEvent: AnyProps }) => {
    const p = latest.current;
    const { state, oldState, pointerInside } = nativeEvent;
    if (state === State.BEGAN) {
      longPressed.current = false;
      p.onBegin?.(nativeEvent);
      p.onActiveStateChange?.(true);
      if (p.onLongPress) {
        longTimer.current = maybeEngine()?.clock.setTimeout(() => {
          longTimer.current = null;
          longPressed.current = true;
          latest.current.onLongPress?.();
        }, p.delayLongPress ?? 600);
      }
    } else if (state === State.ACTIVE) {
      p.onActivate?.(nativeEvent);
    } else if (state === State.END || state === State.FAILED || state === State.CANCELLED) {
      clearLong();
      p.onActiveStateChange?.(false);
      if (oldState === State.ACTIVE) p.onDeactivate?.(nativeEvent);
      if (state === State.END && !longPressed.current) p.onPress?.(pointerInside !== false);
      p.onFinalize?.(nativeEvent);
    }
  };
  return <RawButton {...rest} ref={ref} onHandlerStateChange={onHandlerStateChange} />;
});

/** RectButton: a rectangular underlay appears while pressed (iOS) / ripple (Android). */
export const RectButton = forwardRef<any, AnyProps>(function RectButton(props, ref) {
  const { underlayColor = 'black', activeOpacity = 0.105, onActiveStateChange, style, children, ...rest } = props;
  const [active, setActive] = useState(false);
  const radius = (Array.isArray(style) ? Object.assign({}, ...style.flat()) : style ?? {}).borderRadius;
  return (
    <BaseButton
      {...rest}
      ref={ref}
      style={style}
      onActiveStateChange={(a: boolean) => {
        if (Platform.OS !== 'android') setActive(a);
        onActiveStateChange?.(a);
      }}
    >
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: active ? activeOpacity : 0, backgroundColor: underlayColor, borderRadius: radius }}
      />
      {children}
    </BaseButton>
  );
});

/** BorderlessButton: dims its content while pressed (iOS). */
export const BorderlessButton = forwardRef<any, AnyProps>(function BorderlessButton(props, ref) {
  const { activeOpacity = 0.3, onActiveStateChange, style, ...rest } = props;
  const [active, setActive] = useState(false);
  return (
    <BaseButton
      {...rest}
      ref={ref}
      style={[style, Platform.OS !== 'android' && active ? { opacity: activeOpacity } : null]}
      onActiveStateChange={(a: boolean) => {
        setActive(a);
        onActiveStateChange?.(a);
      }}
    />
  );
});

/**
 * v3's Touchable: a button whose underlay and opacity animate between their
 * default and active values while pressed. Animation timing is not modeled;
 * the pressed look switches with the press.
 */
export const Touchable = forwardRef<any, AnyProps>(function Touchable(props, ref) {
  const {
    underlayColor = 'transparent', defaultUnderlayOpacity = 0, activeUnderlayOpacity = 0.105, defaultOpacity = 1, activeOpacity,
    onPress, onPressIn, onPressOut, onLongPress, delayLongPress = 600, disabled = false, style, children, animationDuration: _d,
    androidRipple: _r, cancelOnLeave: _c, onHoverIn: _hi, onHoverOut: _ho, ...rest
  } = props;
  const [active, setActive] = useState(false);
  const event = () => ({ pointerInside: true, x: 0, y: 0, absoluteX: 0, absoluteY: 0, numberOfPointers: 1, pointerType: 0 });
  const opacity = active ? activeOpacity ?? defaultOpacity : defaultOpacity;
  const radius = (Array.isArray(style) ? Object.assign({}, ...style.flat()) : style ?? {}).borderRadius;
  return (
    <BaseButton
      {...rest}
      ref={ref}
      enabled={!disabled}
      delayLongPress={delayLongPress}
      style={[style, opacity !== 1 ? { opacity } : null]}
      onActiveStateChange={(a: boolean) => {
        setActive(a);
        (a ? onPressIn : onPressOut)?.(event());
      }}
      onPress={(inside: boolean) => inside && onPress?.(event())}
      onLongPress={onLongPress ? () => onLongPress(event()) : undefined}
    >
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: underlayColor, opacity: active ? activeUnderlayOpacity : defaultUnderlayOpacity, borderRadius: radius }}
      />
      {children}
    </BaseButton>
  );
});

/** RNGH's Pressable and Text behave like React Native's on Mimicry's responder system. */
export const Pressable = RNPressable;
export const Text = RNText;

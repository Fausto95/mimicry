import React, { Children, cloneElement, forwardRef, isValidElement, useEffect, useRef } from 'react';
import { HostType, flattenStyle } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';
import { Platform } from '../apis/core';
import { AnimatedValue, timing } from '../animated/animated';
import { createAnimatedComponent } from '../animated/component';
import { Easing } from '../animated/easing';
import { mergeRefs, usePressability } from './pressability';
import { Text, View } from './primitives';

const h = React.createElement as (...args: any[]) => React.ReactElement;
type AnyProps = Record<string, any>;

const AnimatedHostView = createAnimatedComponent(View);

/** TouchableOpacity: dims to activeOpacity immediately on press, fades back over 250ms. */
export const TouchableOpacity = forwardRef<any, AnyProps>(function TouchableOpacity(props, ref) {
  const { activeOpacity = 0.2, style, children, onPress, onPressIn, onPressOut, onLongPress, delayLongPress, disabled, ...rest } = props;
  const opacity = useRef(new AnimatedValue(1)).current;
  const host = useRef<any>(null);
  const own = flattenStyle(style).opacity;
  const flatOpacity = typeof own === 'number' ? own : 1;
  const { handlers } = usePressability(
    {
      disabled,
      onPress,
      onLongPress,
      delayLongPress,
      onPressIn: (e) => {
        timing(opacity, { toValue: activeOpacity, duration: 0, easing: Easing.inOut(Easing.quad) }).start();
        onPressIn?.(e);
      },
      onPressOut: (e) => {
        timing(opacity, { toValue: 1, duration: 250, easing: Easing.inOut(Easing.quad) }).start();
        onPressOut?.(e);
      },
    },
    host,
  );
  useEffect(() => {
    if (disabled) opacity.setValue(1);
  }, [disabled, opacity]);
  return h(
    AnimatedHostView,
    {
      accessible: rest.accessible !== false,
      accessibilityRole: rest.accessibilityRole ?? 'button',
      ...rest,
      ...handlers,
      style: [style, { opacity: flatOpacity === 1 ? opacity : opacity.interpolate({ inputRange: [0, 1], outputRange: [0, flatOpacity] }) }],
      ref: mergeRefs(ref, host),
      children,
    },
  );
});

/** TouchableHighlight: shows underlayColor behind a dimmed child while pressed. */
export const TouchableHighlight = forwardRef<any, AnyProps>(function TouchableHighlight(props, ref) {
  const { activeOpacity = 0.85, underlayColor = 'black', style, children, onShowUnderlay, onHideUnderlay, disabled, onPress, onPressIn, onPressOut, onLongPress, delayLongPress, ...rest } = props;
  const host = useRef<any>(null);
  const { pressed, handlers } = usePressability(
    {
      disabled, onPress, onLongPress, delayLongPress,
      onPressIn: (e) => {
        onShowUnderlay?.();
        onPressIn?.(e);
      },
      onPressOut: (e) => {
        onHideUnderlay?.();
        onPressOut?.(e);
      },
    },
    host,
  );
  const child = Children.only(children);
  return h(
    HostType.View,
    {
      accessible: rest.accessible !== false,
      accessibilityRole: rest.accessibilityRole ?? 'button',
      ...rest,
      ...handlers,
      style: [style, pressed ? { backgroundColor: underlayColor } : null],
      ref: mergeRefs(ref, host),
    },
    isValidElement(child) ? cloneElement(child as React.ReactElement<any>, {
      style: [(child as React.ReactElement<any>).props.style, pressed ? { opacity: activeOpacity } : null],
    }) : child,
  );
});

/** Clones its only child with the responder handlers, like React Native does. */
export const TouchableWithoutFeedback = forwardRef<any, AnyProps>(function TouchableWithoutFeedback(props, ref) {
  const host = useRef<any>(null);
  const { handlers } = usePressability(props, host);
  const child = Children.only(props.children) as React.ReactElement<any>;
  return cloneElement(child, {
    ...handlers,
    testID: props.testID ?? child.props.testID,
    accessibilityLabel: props.accessibilityLabel ?? child.props.accessibilityLabel,
    hitSlop: props.hitSlop,
    ref: mergeRefs(ref, host, (child as any).ref),
  });
});

type NativeFeedbackBackground = { type: 'RippleAndroid'; color?: unknown; borderless?: boolean; rippleRadius?: number } | { type: 'ThemeAttrAndroid'; attribute: string };

const TouchableNativeFeedbackImpl = forwardRef<any, AnyProps>(function TouchableNativeFeedback(props, ref) {
  const host = useRef<any>(null);
  const bg = props.background as NativeFeedbackBackground | undefined;
  const ripple = bg && bg.type === 'RippleAndroid'
    ? { color: bg.color, borderless: bg.borderless, radius: bg.rippleRadius, foreground: !!props.useForeground }
    : { foreground: !!props.useForeground };
  const { handlers } = usePressability({ ...props, android_ripple: Platform.OS === 'android' ? ripple : null }, host);
  const child = Children.only(props.children) as React.ReactElement<any>;
  return cloneElement(child, { ...handlers, testID: props.testID ?? child.props.testID, ref: mergeRefs(ref, host, (child as any).ref) });
});

export const TouchableNativeFeedback = Object.assign(TouchableNativeFeedbackImpl, {
  SelectableBackground: (rippleRadius?: number): NativeFeedbackBackground => ({ type: 'ThemeAttrAndroid', attribute: 'selectableItemBackground', ...(rippleRadius ? {} : {}) }),
  SelectableBackgroundBorderless: (rippleRadius?: number): NativeFeedbackBackground => ({ type: 'RippleAndroid', borderless: true, rippleRadius }),
  Ripple: (color: unknown, borderless: boolean, rippleRadius?: number): NativeFeedbackBackground => ({ type: 'RippleAndroid', color, borderless, rippleRadius }),
  canUseNativeForeground: () => true,
});

/** React Native's <Button>, platform styles taken from its source. */
export const Button = forwardRef<any, AnyProps>(function Button(props, ref) {
  const { title, onPress, color, disabled, accessibilityLabel, testID, touchSoundDisabled, ...rest } = props;
  const android = Platform.OS === 'android';
  const engine = maybeEngine();
  const tokens = (engine?.kit.tokens ?? {}) as Record<string, any>;
  const scheme = engine?.env.appearance === 'dark' ? 1 : 0;
  if (android) {
    const buttonStyle = [{ elevation: 4, backgroundColor: color ?? tokens.buttonColor?.[scheme] ?? '#2196F3', borderRadius: 2 }, disabled && { elevation: 0, backgroundColor: '#dfdfdf' }];
    const textStyle = [{ textAlign: 'center', margin: 8, color: 'white', fontWeight: '500' }, disabled && { color: '#a1a1a1' }];
    return h(
      TouchableNativeFeedbackImpl,
      { onPress, disabled, testID, accessibilityLabel, ref, ...rest },
      h(View, { style: buttonStyle, accessibilityRole: 'button' }, h(Text, { style: textStyle }, String(title).toUpperCase())),
    );
  }
  const textStyle = [{ color: color ?? '#007AFF', textAlign: 'center', margin: 8, fontSize: 18 }, disabled && { color: '#cdcdcd' }];
  return h(
    TouchableOpacity,
    { onPress, disabled, testID, accessibilityLabel, accessibilityRole: 'button', ref, ...rest },
    h(View, null, h(Text, { style: textStyle }, title)),
  );
});

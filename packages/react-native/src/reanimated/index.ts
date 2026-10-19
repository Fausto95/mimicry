import React from 'react';
import { DynamicColorIOS, PlatformColor, processColor } from '../apis/core';
import { createWorkletRuntime, executeOnUIRuntimeSync, isWorkletFunction, makeShareableCloneRecursive, runOnJS, runOnRuntime, runOnUI } from '../worklets';
import {
  AnimatedFlatList, AnimatedImage, AnimatedScrollView, AnimatedText, AnimatedView, createAnimatedComponent, LayoutAnimationConfig,
} from './component';
import { Mapper } from './runtime';

/**
 * react-native-reanimated (v4 API) on Mimicry's engine. See runtime.ts for
 * the threading model, updater.ts for animated styles, timeline.ts for
 * layout/CSS animations.
 */
export {
  cancelAnimation, isSharedValue, makeMutable, type SharedValue,
} from './mutable';
export {
  defineAnimation, GentleSpringConfig, GentleSpringConfigWithDuration, ReduceMotion, Reanimated3DefaultSpringConfig,
  Reanimated3DefaultSpringConfigWithDuration, SnappySpringConfig, SnappySpringConfigWithDuration, WigglySpringConfig,
  WigglySpringConfigWithDuration, withClamp, withDecay, withDelay, withRepeat, withSequence, withSpring, withTiming,
  type AnimationCallback, type AnimationObject, type WithDecayConfig, type WithSpringConfig, type WithTimingConfig,
} from './animations';
export { Easing, type EasingFunction, type EasingFunctionFactory } from './easing';
export {
  clamp, contrastColor, convertToRGBA, Extrapolate, Extrapolation, interpolate, interpolateColor, isColor,
  type ExtrapolationConfig, type ExtrapolationType, type InterpolationOptions,
} from './interpolation';
export {
  InterfaceOrientation, IOSReferenceFrame, KeyboardState, SensorType, useAnimatedKeyboard, useAnimatedProps, useAnimatedReaction,
  useAnimatedRef, useAnimatedScrollHandler, useAnimatedSensor, useAnimatedStyle, useComposedEventHandler, useDerivedValue, useEvent,
  useFrameCallback, useHandler, useReducedMotion, useScrollOffset, useScrollOffset as useScrollViewOffset, useSharedValue,
  useTimestamp, type AnimatedRef, type FrameInfo,
} from './hooks';
export {
  BaseAnimationBuilder, BounceIn, BounceInDown, BounceInLeft, BounceInRight, BounceInUp, BounceOut, BounceOutDown, BounceOutLeft,
  BounceOutRight, BounceOutUp, ComplexAnimationBuilder, CurvedTransition, enableLayoutAnimations, EntryExitTransition, FadeIn,
  FadeInDown, FadeInLeft, FadeInRight, FadeInUp, FadeOut, FadeOutDown, FadeOutLeft, FadeOutRight, FadeOutUp, FadingTransition,
  FlipInEasyX, FlipInEasyY, FlipInXDown, FlipInXUp, FlipInYLeft, FlipInYRight, FlipOutEasyX, FlipOutEasyY, FlipOutXDown, FlipOutXUp,
  FlipOutYLeft, FlipOutYRight, JumpingTransition, Keyframe, Layout, LightSpeedInLeft, LightSpeedInRight, LightSpeedOutLeft,
  LightSpeedOutRight, LinearTransition, PinwheelIn, PinwheelOut, RollInLeft, RollInRight, RollOutLeft, RollOutRight, RotateInDownLeft,
  RotateInDownRight, RotateInUpLeft, RotateInUpRight, RotateOutDownLeft, RotateOutDownRight, RotateOutUpLeft, RotateOutUpRight,
  SequencedTransition, SharedTransition, SlideInDown, SlideInLeft, SlideInRight, SlideInUp, SlideOutDown, SlideOutLeft, SlideOutRight,
  SlideOutUp, StretchInX, StretchInY, StretchOutX, StretchOutY, ZoomIn, ZoomInDown, ZoomInEasyDown, ZoomInEasyUp, ZoomInLeft,
  ZoomInRight, ZoomInRotate, ZoomInUp, ZoomOut, ZoomOutDown, ZoomOutEasyDown, ZoomOutEasyUp, ZoomOutLeft, ZoomOutRight,
  ZoomOutRotate, ZoomOutUp,
} from './layout-animations';
export { css, cubicBezier, linear, steps } from './css';
export { dispatchCommand, getRelativeCoords, getViewProp, measure, scrollTo, setGestureState, setNativeProps, type MeasuredDimensions } from './platform';
export { createAnimatedComponent, LayoutAnimationConfig };
export { DynamicColorIOS, PlatformColor, processColor };
export { createWorkletRuntime, executeOnUIRuntimeSync, isWorkletFunction, makeShareableCloneRecursive, runOnJS, runOnRuntime, runOnUI };

/** Reanimated 4 renamed this; both names point at the CSS-capable component factory. */
export const createCSSAnimatedComponent = createAnimatedComponent;

// ── configuration & logging ────────────────────────────────────────────────

export const ReanimatedLogLevel = { warn: 1, error: 2 } as const;
export function configureReanimatedLogger(_config: { level?: number; strict?: boolean }): void {}
export const isConfigured = () => true;
export const isReanimated3 = () => false;
export const reanimatedVersion = '4.7.1';
const flags = new Map<string, unknown>();
export const getStaticFeatureFlag = (name: string) => flags.get(name) ?? false;
export const getDynamicFeatureFlag = (name: string) => flags.get(name) ?? false;
export const setDynamicFeatureFlag = (name: string, value: unknown) => void flags.set(name, value);

// ── low-level mappers ──────────────────────────────────────────────────────

const mappers = new Map<number, Mapper>();
let nextMapper = 1;
/** Run `worklet` now and whenever the shared values it reads change. */
export function startMapper(worklet: () => void, _inputs?: unknown[], _outputs?: unknown[]): number {
  const id = nextMapper++;
  const mapper = new Mapper(worklet);
  mappers.set(id, mapper);
  mapper.run();
  return id;
}
export function stopMapper(id: number): void {
  mappers.get(id)?.stop();
  mappers.delete(id);
}

// ── components and helpers kept for API compatibility ─────────────────────

/** Children animate normally; reduced motion is never on in Mimicry. */
export function ReducedMotionConfig(_props: { mode?: string }) {
  return null;
}
/** Shared element transitions are not drawn; the boundary renders its children. */
export function SharedTransitionBoundary({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}
export function PerformanceMonitor(_props: unknown) {
  return null;
}
export class NativeEventsManager {
  attachEvents(): void {}
  detachEvents(): void {}
  updateEvents(): void {}
}
export const createAnimatedPropAdapter = <T>(adapter: T, _nativeProps?: string[]): T => adapter;
export const getUseOfValueInStyleWarning = () =>
  "It looks like you might be using shared value's .value inside reanimated inline style. Mimicry tracks it anyway.";

/** react-native-screens custom screen transitions are not simulated. */
export const ScreenTransition = { SwipeRight: {}, SwipeLeft: {}, SwipeDown: {}, SwipeUp: {}, Horizontal: {}, Vertical: {}, TwoDimensional: {} };
export function startScreenTransition(_config: unknown): void {}
export function finishScreenTransition(_config: unknown): void {}

/** Jest helpers: Mimicry tests drive time with its own virtual clock (session.advance). */
export function setUpTests(): void {}
export function withReanimatedTimer(test: () => void): void {
  test();
}
export function advanceAnimationByTime(_ms: number): void {
  throw new Error('Mimicry: advance time with session.advance(ms) from @mimicry/testing.');
}
export const advanceAnimationByFrame = advanceAnimationByTime;
export function getAnimatedStyle(component: { props?: { style?: unknown } }): unknown {
  return component?.props?.style;
}

const Animated = {
  View: AnimatedView,
  Text: AnimatedText,
  Image: AnimatedImage,
  ScrollView: AnimatedScrollView,
  FlatList: AnimatedFlatList,
  createAnimatedComponent,
  /** Reanimated 2 leftovers some code still touches */
  addWhitelistedNativeProps: (_props: Record<string, boolean>) => {},
  addWhitelistedUIProps: (_props: Record<string, boolean>) => {},
};

export default Animated;

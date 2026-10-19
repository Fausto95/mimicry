import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HostType, parseColor } from '@mimicry/engine';
import { getEngine, maybeEngine } from '../engine-ref';
import { Platform } from '../apis/core';
import { mergeRefs, usePressability } from './pressability';

const h = React.createElement as (...args: any[]) => React.ReactElement;

type AnyProps = Record<string, any>;

/** RN 0.71+ web-style aliases → the props the engine understands. */
function normalizeAccessibility(props: AnyProps): AnyProps {
  if (!('aria-label' in props) && !('role' in props) && !('id' in props) && !('aria-hidden' in props)) return props;
  const out = { ...props };
  if (out['aria-label'] != null && out.accessibilityLabel == null) out.accessibilityLabel = out['aria-label'];
  if (out.role != null && out.accessibilityRole == null) out.accessibilityRole = out.role;
  if (out.id != null && out.nativeID == null) out.nativeID = out.id;
  return out;
}

// ── View ───────────────────────────────────────────────────────────────────

export const View = forwardRef<any, AnyProps>(function View(props, ref) {
  return h(HostType.View, { ...normalizeAccessibility(props), ref });
});

// ── Text ───────────────────────────────────────────────────────────────────

export const Text = forwardRef<any, AnyProps>(function Text(props, ref) {
  const host = useRef<any>(null);
  const pressable = !!(props.onPress || props.onLongPress || props.onPressIn || props.onPressOut);
  const { handlers } = usePressability(
    {
      disabled: props.disabled || !pressable,
      onPress: props.onPress,
      onLongPress: props.onLongPress,
      onPressIn: props.onPressIn,
      onPressOut: props.onPressOut,
    },
    host,
  );
  return h(HostType.Text, {
    ...normalizeAccessibility(props),
    ...(pressable ? handlers : null),
    ref: mergeRefs(ref, host),
  });
});

// ── Image ──────────────────────────────────────────────────────────────────

function normalizeSource(props: AnyProps) {
  if (props.source != null) return props.source;
  if (props.src) return { uri: props.src };
  return undefined;
}

const ImageImpl = forwardRef<any, AnyProps>(function Image(props, ref) {
  const { width, height, style, ...rest } = props;
  const sized = width != null || height != null ? [{ width, height }, style] : style;
  return h(HostType.Image, { ...normalizeAccessibility(rest), source: normalizeSource(props), style: sized, ref });
});

type ImageStatics = {
  getSize(uri: string, success: (w: number, h: number) => void, failure?: (e: unknown) => void): void;
  getSizeWithHeaders(uri: string, headers: unknown, success: (w: number, h: number) => void, failure?: (e: unknown) => void): void;
  prefetch(uri: string): Promise<boolean>;
  queryCache(uris: string[]): Promise<Record<string, string>>;
  resolveAssetSource(source: unknown): unknown;
};

export const Image = ImageImpl as typeof ImageImpl & ImageStatics;
Object.assign(Image, {
  getSize(uri: string, success: (w: number, h: number) => void, failure?: (e: unknown) => void) {
    const engine = getEngine();
    const entry = engine.images.get(uri);
    if (entry.state === 'loaded') return success(entry.width, entry.height);
    const poll = () => {
      const e = engine.images.get(uri);
      if (e.state === 'loaded') success(e.width, e.height);
      else if (e.state === 'error') failure?.(new Error(e.error));
      else engine.clock.setTimeout(poll, 16);
    };
    poll();
  },
  getSizeWithHeaders(uri: string, _headers: unknown, success: (w: number, h: number) => void, failure?: (e: unknown) => void) {
    (Image as any).getSize(uri, success, failure);
  },
  async prefetch(uri: string) {
    getEngine().images.get(uri);
    return true;
  },
  async queryCache() {
    return {};
  },
  resolveAssetSource(source: unknown) {
    return source;
  },
} satisfies ImageStatics);

export const ImageBackground = forwardRef<any, AnyProps>(function ImageBackground(props, ref) {
  const { children, style, imageStyle, imageRef, source, resizeMode, ...rest } = props;
  return h(
    View,
    { style, ref, ...rest },
    h(Image, {
      source,
      resizeMode,
      ref: imageRef,
      style: [{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, imageStyle],
    }),
    children,
  );
});

// ── Pressable ──────────────────────────────────────────────────────────────

export const Pressable = forwardRef<any, AnyProps>(function Pressable(props, ref) {
  const host = useRef<any>(null);
  const {
    children, style, onPress, onPressIn, onPressOut, onLongPress, delayLongPress, disabled,
    pressRetentionOffset, android_ripple, unstable_pressDelay, testOnly_pressed, ...rest
  } = props;
  const { pressed, handlers } = usePressability(
    { disabled, onPress, onPressIn, onPressOut, onLongPress, delayLongPress, pressRetentionOffset, android_ripple, delayPressIn: unstable_pressDelay },
    host,
  );
  const state = { pressed: testOnly_pressed ?? pressed };
  return h(
    HostType.View,
    {
      accessible: rest.accessible !== false,
      accessibilityRole: rest.accessibilityRole ?? 'button',
      accessibilityState: { disabled: !!disabled, ...rest.accessibilityState },
      ...normalizeAccessibility(rest),
      ...handlers,
      style: typeof style === 'function' ? style(state) : style,
      ref: mergeRefs(ref, host),
    },
    typeof children === 'function' ? children(state) : children,
  );
});

// ── Switch ─────────────────────────────────────────────────────────────────

export const Switch = forwardRef<any, AnyProps>(function Switch(props, ref) {
  const { onValueChange, onChange, value, style, ...rest } = props;
  return h(HostType.Switch, {
    accessibilityRole: 'switch',
    accessibilityState: { checked: !!value, disabled: !!rest.disabled },
    ...rest,
    value: !!value,
    style,
    onChange: (e: any) => {
      onChange?.(e);
      onValueChange?.(e.nativeEvent.value);
    },
    ref,
  });
});

// ── ActivityIndicator ──────────────────────────────────────────────────────

export const ActivityIndicator = forwardRef<any, AnyProps>(function ActivityIndicator(props, ref) {
  const { size = 'small', style, animating = true, hidesWhenStopped = true, color, ...rest } = props;
  const box = typeof size === 'number' ? size : size === 'large' ? 36 : 20;
  return h(
    HostType.View,
    { style: [{ alignItems: 'center', justifyContent: 'center' }, style], ref, ...rest },
    h(HostType.ActivityIndicator, { size, animating, hidesWhenStopped, color, style: { width: box, height: box } }),
  );
});

// ── TextInput ──────────────────────────────────────────────────────────────

export const TextInput = forwardRef<any, AnyProps>(function TextInput(props, ref) {
  const { onChange, onChangeText, ...rest } = props;
  return h(HostType.TextInput, {
    allowFontScaling: true,
    ...normalizeAccessibility(rest),
    onChange: (e: any) => {
      onChange?.(e);
      onChangeText?.(e.nativeEvent.text);
    },
    ref,
  });
});

(TextInput as any).State = {
  currentlyFocusedInput: () => maybeEngine()?.focus.focused ?? null,
  currentlyFocusedField: () => maybeEngine()?.focus.focused?.id ?? null,
  focusTextInput: (node: any) => node?.focus?.(),
  blurTextInput: (node: any) => node?.blur?.(),
};

// ── SafeAreaView, KeyboardAvoidingView ─────────────────────────────────────

/** iOS-only in React Native: on Android it is a plain View. */
export const SafeAreaView = forwardRef<any, AnyProps>(function SafeAreaView(props, ref) {
  const insets = useSafeAreaInsetsInternal();
  if (Platform.OS !== 'ios') return h(View, { ...props, ref });
  const { style, ...rest } = props;
  return h(View, {
    ...rest,
    ref,
    style: [style, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }],
  });
});

export function useSafeAreaInsetsInternal() {
  const engine = maybeEngine();
  const [, force] = useState(0);
  useEffect(() => engine?.env.subscribe(() => force((x) => x + 1)), [engine]);
  return engine?.viewport.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

export const KeyboardAvoidingView = forwardRef<any, AnyProps>(function KeyboardAvoidingView(props, ref) {
  const { behavior, keyboardVerticalOffset, contentContainerStyle, enabled, ...rest } = props;
  return h(View, { ...rest, ref });
});

// ── StatusBar ──────────────────────────────────────────────────────────────

type BarProps = { barStyle?: string; hidden?: boolean; backgroundColor?: unknown; translucent?: boolean; animated?: boolean };
const barStack: Array<{ props: BarProps }> = [];

function applyStatusBar(): void {
  const engine = maybeEngine();
  if (!engine) return;
  const merged: BarProps = {};
  for (const entry of barStack) Object.assign(merged, Object.fromEntries(Object.entries(entry.props).filter(([, v]) => v !== undefined)));
  const bar = engine.env.statusBar;
  bar.barStyle = merged.barStyle ?? imperative.barStyle ?? 'default';
  bar.hidden = merged.hidden ?? imperative.hidden ?? false;
  const bg = merged.backgroundColor ?? imperative.backgroundColor;
  bar.backgroundColor = bg != null ? parseColor(bg, engine.colorContext) : null;
  engine.markPaint();
}

const imperative: BarProps = {};

export function StatusBar(props: BarProps) {
  const entry = useRef({ props });
  entry.current.props = props;
  useLayoutEffect(() => {
    barStack.push(entry.current);
    applyStatusBar();
    return () => {
      barStack.splice(barStack.indexOf(entry.current), 1);
      applyStatusBar();
    };
  }, []);
  useLayoutEffect(() => {
    applyStatusBar();
  });
  return null;
}

Object.assign(StatusBar, {
  setBarStyle(style: string) {
    imperative.barStyle = style;
    applyStatusBar();
  },
  setHidden(hidden: boolean) {
    imperative.hidden = hidden;
    applyStatusBar();
  },
  setBackgroundColor(color: unknown) {
    imperative.backgroundColor = color;
    applyStatusBar();
  },
  setTranslucent() {},
  setNetworkActivityIndicatorVisible() {},
  pushStackEntry(props: BarProps) {
    const e = { props };
    barStack.push(e);
    applyStatusBar();
    return e;
  },
  popStackEntry(e: { props: BarProps }) {
    barStack.splice(barStack.indexOf(e), 1);
    applyStatusBar();
  },
  replaceStackEntry(e: { props: BarProps }, props: BarProps) {
    e.props = props;
    applyStatusBar();
    return e;
  },
  get currentHeight() {
    const e = maybeEngine();
    return e?.platform === 'android' ? e.viewport.statusBarHeight : undefined;
  },
});

export function RefreshControl(_props: AnyProps) {
  return null;
}

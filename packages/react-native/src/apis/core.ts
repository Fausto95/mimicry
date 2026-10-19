import { useSyncExternalStore } from 'react';
import { flattenStyle, parseColor } from '@mimicry/engine';
import { getEngine, maybeEngine } from '../engine-ref';

// ── Platform ───────────────────────────────────────────────────────────────

type OS = 'ios' | 'android';
const os = (): OS => (maybeEngine()?.platform ?? 'ios') as OS;

export const Platform = {
  get OS(): OS {
    return os();
  },
  get Version(): number | string {
    const v = maybeEngine()?.env.device.osVersion ?? '26.0';
    return os() === 'android' ? Number(v) : v;
  },
  get isPad(): boolean {
    const e = maybeEngine();
    return !!e && e.platform === 'ios' && e.env.device.idiom === 'tablet';
  },
  get isTV(): boolean {
    return false;
  },
  get isVision(): boolean {
    return false;
  },
  get isTesting(): boolean {
    return false;
  },
  get constants() {
    const e = maybeEngine();
    const device = e?.env.device;
    return {
      isTesting: false,
      reactNativeVersion: { major: 0, minor: 82, patch: 0, prerelease: null },
      osVersion: device?.osVersion ?? '26.0',
      systemName: os() === 'ios' ? 'iOS' : 'Android',
      interfaceIdiom: device?.idiom === 'tablet' ? 'pad' : 'phone',
      Model: device?.name ?? 'Mimicry',
      Brand: os() === 'android' ? 'google' : 'Apple',
      Manufacturer: os() === 'android' ? 'Google' : 'Apple',
      Release: device?.osVersion ?? '',
      forceTouchAvailable: false,
      uiMode: 'normal',
    };
  },
  select<T>(spec: { ios?: T; android?: T; native?: T; default?: T; web?: T }): T | undefined {
    const o = os();
    if (o in spec) return spec[o];
    if ('native' in spec) return spec.native;
    return spec.default;
  },
};

// ── StyleSheet ─────────────────────────────────────────────────────────────

const absoluteFill = Object.freeze({ position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 });

export const StyleSheet = {
  create<T extends Record<string, any>>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): Record<string, any> {
    const flat = flattenStyle(style);
    return Array.isArray(style) ? flat : { ...flat };
  },
  compose(a: unknown, b: unknown) {
    return a && b ? [a, b] : a || b;
  },
  get hairlineWidth(): number {
    const scale = maybeEngine()?.viewport.scale ?? 3;
    return Math.round(0.4 * scale) / scale || 1 / scale;
  },
  absoluteFill,
  absoluteFillObject: absoluteFill,
  setStyleAttributePreprocessor() {},
};

// ── Dimensions & PixelRatio ────────────────────────────────────────────────

export interface ScaledSize {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

type DimensionsHandler = (dims: { window: ScaledSize; screen: ScaledSize }) => void;
const dimensionHandlers = new Set<DimensionsHandler>();
let subscribedEngine: unknown = null;

function ensureDimensionSubscription(): void {
  const engine = maybeEngine();
  if (!engine || subscribedEngine === engine) return;
  subscribedEngine = engine;
  engine.env.subscribe((env, changed) => {
    if (!changed.dimensions) return;
    const dims = { window: env.window, screen: env.screen };
    for (const h of Array.from(dimensionHandlers)) h(dims);
  });
}

export const Dimensions = {
  get(dim: 'window' | 'screen'): ScaledSize {
    const e = maybeEngine();
    if (!e) return { width: 402, height: 874, scale: 3, fontScale: 1 };
    return dim === 'screen' ? e.env.screen : e.env.window;
  },
  addEventListener(_type: 'change', handler: DimensionsHandler) {
    ensureDimensionSubscription();
    dimensionHandlers.add(handler);
    return { remove: () => dimensionHandlers.delete(handler) };
  },
  removeEventListener(_type: 'change', handler: DimensionsHandler) {
    dimensionHandlers.delete(handler);
  },
  set() {},
};

export const PixelRatio = {
  get: () => maybeEngine()?.viewport.scale ?? 3,
  getFontScale: () => maybeEngine()?.viewport.fontScale ?? 1,
  getPixelSizeForLayoutSize: (size: number) => Math.round(size * PixelRatio.get()),
  roundToNearestPixel: (size: number) => Math.round(size * PixelRatio.get()) / PixelRatio.get(),
  startDetecting() {},
};

function subscribeEnv(cb: () => void): () => void {
  const engine = maybeEngine();
  if (!engine) return () => {};
  return engine.env.subscribe(() => cb());
}

export function useWindowDimensions(): ScaledSize {
  const version = useSyncExternalStore(subscribeEnv, () => maybeEngine()?.env.version ?? 0);
  void version;
  return Dimensions.get('window');
}

// ── Appearance ─────────────────────────────────────────────────────────────

export type ColorSchemeName = 'light' | 'dark' | null | undefined;
let override: ColorSchemeName = null;

export const Appearance = {
  getColorScheme(): ColorSchemeName {
    return override ?? maybeEngine()?.env.appearance ?? 'light';
  },
  setColorScheme(scheme: ColorSchemeName | 'unspecified') {
    override = scheme === 'unspecified' ? null : scheme;
    const e = maybeEngine();
    if (e && override) e.env.update({ appearance: override });
  },
  addChangeListener(listener: (p: { colorScheme: ColorSchemeName }) => void) {
    const engine = getEngine();
    const unsubscribe = engine.env.subscribe((env, changed) => {
      if (changed.appearance) listener({ colorScheme: env.appearance });
    });
    return { remove: unsubscribe };
  },
};

export function useColorScheme(): ColorSchemeName {
  return useSyncExternalStore(subscribeEnv, () => Appearance.getColorScheme());
}

// ── Colors ─────────────────────────────────────────────────────────────────

export function PlatformColor(...names: string[]): any {
  return os() === 'android' ? { resource_paths: names } : { semantic: names };
}

export function DynamicColorIOS(tuple: { light: unknown; dark: unknown; highContrastLight?: unknown; highContrastDark?: unknown }): any {
  return { dynamic: tuple };
}

/** processColor() returns 0xAARRGGBB like React Native. */
export function processColor(color: unknown): number | null | undefined {
  if (color == null) return color as null | undefined;
  const e = maybeEngine();
  const c = parseColor(color, e?.colorContext);
  if (c == null) return null;
  return (((c & 255) << 24) | (c >>> 8)) >>> 0;
}

// ── misc small modules ─────────────────────────────────────────────────────

export const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: true,
  allowRTL() {},
  forceRTL() {},
  swapLeftAndRightInRTL() {},
  getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true }),
};

export const Vibration = { vibrate() {}, cancel() {} };

export const LayoutAnimation = {
  configureNext(_config?: unknown, onEnd?: () => void) {
    // Layout transitions are not animated yet (docs/fidelity.md); finish immediately.
    if (onEnd) queueMicrotask(onEnd);
  },
  create: (duration: number, type?: string, property?: string) => ({ duration, create: { type, property }, update: { type }, delete: { type, property } }),
  Types: { spring: 'spring', linear: 'linear', easeInEaseOut: 'easeInEaseOut', easeIn: 'easeIn', easeOut: 'easeOut', keyboard: 'keyboard' },
  Properties: { opacity: 'opacity', scaleX: 'scaleX', scaleY: 'scaleY', scaleXY: 'scaleXY' },
  Presets: { easeInEaseOut: {}, linear: {}, spring: {} },
  easeInEaseOut(onEnd?: () => void) {
    LayoutAnimation.configureNext(undefined, onEnd);
  },
  linear(onEnd?: () => void) {
    LayoutAnimation.configureNext(undefined, onEnd);
  },
  spring(onEnd?: () => void) {
    LayoutAnimation.configureNext(undefined, onEnd);
  },
};

export const InteractionManager = {
  runAfterInteractions(task?: (() => void) | { gen?: () => Promise<void> }) {
    const promise = Promise.resolve().then(() => {
      if (typeof task === 'function') task();
      else task?.gen?.();
    });
    return { then: promise.then.bind(promise), done: () => {}, cancel: () => {} };
  },
  createInteractionHandle: () => 0,
  clearInteractionHandle() {},
  setDeadline() {},
};

export const NativeModules: Record<string, unknown> = new Proxy({}, {
  get(_t, name) {
    return undefined;
  },
});

export const UIManager = {
  getViewManagerConfig: () => null,
  hasViewManagerConfig: () => false,
  setLayoutAnimationEnabledExperimental() {},
  measure(node: any, cb: any) {
    node?.measure?.(cb);
  },
};

export function findNodeHandle(ref: any): number | null {
  if (ref == null) return null;
  if (typeof ref === 'number') return ref;
  return ref.id ?? ref.getScrollableNode?.()?.id ?? null;
}

export const LogBox = { ignoreLogs() {}, ignoreAllLogs() {}, install() {}, uninstall() {} };

export const DevSettings = {
  reload() {
    maybeEngine()?.send({ type: 'reloadRequested' });
  },
  addMenuItem() {},
};

export const AppState = {
  currentState: 'active' as const,
  isAvailable: true,
  addEventListener(_type: string, _handler: (state: string) => void) {
    return { remove() {} };
  },
};

export const Share = {
  async share(content: { message?: string; url?: string; title?: string }) {
    maybeEngine()?.send({ type: 'log', level: 'info', message: `[Share] ${JSON.stringify(content)}` });
    return { action: 'sharedAction' };
  },
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
};

export const AccessibilityInfo = {
  isScreenReaderEnabled: async () => false,
  isReduceMotionEnabled: async () => false,
  isBoldTextEnabled: async () => false,
  isGrayscaleEnabled: async () => false,
  isInvertColorsEnabled: async () => false,
  isReduceTransparencyEnabled: async () => false,
  addEventListener: () => ({ remove() {} }),
  announceForAccessibility() {},
  setAccessibilityFocus() {},
};

export const Linking = {
  async openURL(url: string) {
    getEngine().send({ type: 'openURL', url });
    return true;
  },
  canOpenURL: async () => true,
  getInitialURL: async () => null,
  addEventListener: () => ({ remove() {} }),
  openSettings: async () => {},
  sendIntent: async () => {},
};

export const Keyboard = {
  dismiss() {
    maybeEngine()?.focus.dismiss();
  },
  addListener(_event: string, _handler: (e: unknown) => void) {
    return { remove() {} };
  },
  removeAllListeners() {},
  isVisible: () => !!maybeEngine()?.focus.focused,
  metrics: () => undefined,
  scheduleLayoutAnimation() {},
};

type BackHandlerFn = () => boolean | null | undefined;
const backHandlers: BackHandlerFn[] = [];
export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', handler: BackHandlerFn) {
    backHandlers.push(handler);
    return { remove: () => backHandlers.splice(backHandlers.indexOf(handler), 1) };
  },
  exitApp() {},
  /** called by the engine when the host presses back */
  __dispatch(): boolean {
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]!()) return true;
    return false;
  },
};

export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  TOP: 0,
  BOTTOM: 1,
  CENTER: 2,
  show(message: string) {
    maybeEngine()?.send({ type: 'log', level: 'info', message: `[Toast] ${message}` });
  },
  showWithGravity(message: string) {
    ToastAndroid.show(message);
  },
};

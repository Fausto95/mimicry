import React, { useSyncExternalStore } from 'react';
import type { EngineError } from '@mimicry/protocol';
import { maybeEngine } from '../engine-ref';
import { Image, Pressable, Text, View } from '../components/primitives';
import { splash, splashConfig } from '../native/splash';
import { ScrollView } from '../components/lists';

const h = React.createElement as (...args: any[]) => React.ReactElement;

/**
 * System UI, written with the same components apps use and rendered into the
 * engine's system root above the app and its modals: native alert dialogs
 * (UIAlertController / AppCompat AlertDialog) and a LogBox-style error screen.
 */
export interface AlertButton {
  text?: string;
  onPress?: (value?: string) => void;
  style?: 'default' | 'cancel' | 'destructive';
  isPreferred?: boolean;
}

interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: { cancelable?: boolean; onDismiss?: () => void; userInterfaceStyle?: string };
}

class Store<T> {
  private listeners = new Set<() => void>();
  constructor(public value: T) {}
  set(value: T) {
    this.value = value;
    for (const l of Array.from(this.listeners)) l();
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.value;
}

const alerts = new Store<AlertRequest[]>([]);
const errors = new Store<EngineError[]>([]);
let nextAlert = 1;

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertRequest['options']) {
    const list = buttons?.length ? buttons.slice(0, maybeEngine()?.platform === 'android' ? 3 : 8) : [{ text: 'OK' }];
    alerts.set([...alerts.value, { id: nextAlert++, title: String(title ?? ''), message, buttons: list, options }]);
  },
  prompt(title: string, message?: string, callbackOrButtons?: ((text: string) => void) | AlertButton[]) {
    const buttons = typeof callbackOrButtons === 'function'
      ? [{ text: 'Cancel', style: 'cancel' as const }, { text: 'OK', onPress: () => callbackOrButtons('') }]
      : callbackOrButtons;
    Alert.alert(title, message, buttons);
  },
};

export function showError(error: EngineError): void {
  errors.set([...errors.value, error]);
}

export function clearErrors(): void {
  errors.set([]);
}

function dismissAlert(id: number) {
  alerts.set(alerts.value.filter((a) => a.id !== id));
}

const pick = (pair: unknown, dark: boolean) => (Array.isArray(pair) ? pair[dark ? 1 : 0] : pair);
const rgbaOf = (c: number) => `rgba(${(c >>> 24) & 255}, ${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${(c & 255) / 255})`;
const color = (value: unknown) => (typeof value === 'number' ? rgbaOf(value) : (value as string));

function IOSAlert({ alert, dark, tokens }: { alert: AlertRequest; dark: boolean; tokens: Record<string, any> }) {
  const tint = color(pick(tokens.alertTint, dark));
  const destructive = color(pick(tokens.alertDestructive, dark));
  const separator = color(pick(tokens.alertSeparator, dark));
  const press = (b: AlertButton) => {
    dismissAlert(alert.id);
    b.onPress?.();
  };
  const sideBySide = alert.buttons.length === 2;
  const ordered = sideBySide
    ? [...alert.buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0))
    : [...alert.buttons].sort((a, b) => (a.style === 'cancel' ? 1 : b.style === 'cancel' ? -1 : 0));
  const button = (b: AlertButton, i: number) =>
    h(Pressable, {
      key: i,
      onPress: () => press(b),
      testID: `alert-button-${i}`,
      style: ({ pressed }: { pressed: boolean }) => ({
        flex: sideBySide ? 1 : undefined,
        height: tokens.alertButtonHeight,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
        borderLeftWidth: sideBySide && i === 1 ? 1 / 3 : 0,
        borderTopWidth: !sideBySide && i > 0 ? 1 / 3 : 0,
        borderColor: separator,
      }),
    }, h(Text, {
      style: {
        fontSize: tokens.alertButtonSize,
        color: b.style === 'destructive' ? destructive : tint,
        fontWeight: b.style === 'cancel' || b.isPreferred ? '600' : '400',
      },
    }, b.text ?? 'OK'));
  return h(View, { style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color(tokens.alertDim), alignItems: 'center', justifyContent: 'center' } },
    h(View, { testID: 'alert', style: { width: tokens.alertWidth, borderRadius: tokens.alertRadius, backgroundColor: color(pick(tokens.alertBackground, dark)), overflow: 'hidden' } },
      h(View, { style: { paddingTop: 19, paddingBottom: 17, paddingHorizontal: 16, alignItems: 'center', gap: 3 } },
        h(Text, { style: { fontSize: tokens.alertTitleSize, fontWeight: '600', textAlign: 'center', color: color(pick(tokens.alertText, dark)) } }, alert.title),
        alert.message ? h(Text, { style: { fontSize: tokens.alertMessageSize, textAlign: 'center', lineHeight: 18, color: color(pick(tokens.alertText, dark)) } }, alert.message) : null),
      h(View, { style: { flexDirection: sideBySide ? 'row' : 'column', borderTopWidth: 1 / 3, borderColor: separator } }, ordered.map(button))));
}

function AndroidAlert({ alert, dark, tokens }: { alert: AlertRequest; dark: boolean; tokens: Record<string, any> }) {
  const engine = maybeEngine();
  const width = Math.min((engine?.viewport.width ?? 400) - 48, tokens.alertMaxWidth ?? 560);
  const tint = color(pick(tokens.alertTint, dark));
  const press = (b?: AlertButton) => {
    dismissAlert(alert.id);
    b?.onPress?.();
  };
  // neutral · negative · positive, the AlertDialog button order
  const [neutral, negative, positive] =
    alert.buttons.length === 1 ? [undefined, undefined, alert.buttons[0]]
      : alert.buttons.length === 2 ? [undefined, alert.buttons[0], alert.buttons[1]]
        : alert.buttons;
  const button = (b: AlertButton | undefined, key: string) =>
    b ? h(Pressable, {
      key,
      onPress: () => press(b),
      android_ripple: { color: 'rgba(0,0,0,0.12)' },
      testID: `alert-button-${key}`,
      style: { minWidth: 64, height: 36, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
    }, h(Text, { style: { color: tint, fontSize: 14, fontWeight: '500', letterSpacing: 0.5 } }, (b.text ?? 'OK').toUpperCase())) : null;
  return h(Pressable, {
    accessibilityRole: 'none',
    onPress: () => {
      if (alert.options?.cancelable) {
        dismissAlert(alert.id);
        alert.options.onDismiss?.();
      }
    },
    style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color(tokens.alertDim), alignItems: 'center', justifyContent: 'center' },
  },
    h(Pressable, { onPress: () => {}, testID: 'alert', style: { width, borderRadius: tokens.alertRadius, backgroundColor: color(pick(tokens.alertBackground, dark)), elevation: 24, paddingTop: 24 } },
      alert.title ? h(Text, { style: { fontSize: tokens.alertTitleSize, fontWeight: '500', color: color(pick(tokens.alertText, dark)), paddingHorizontal: 24, marginBottom: alert.message ? 12 : 20 } }, alert.title) : null,
      alert.message ? h(Text, { style: { fontSize: tokens.alertMessageSize, lineHeight: 22, color: color(pick(tokens.alertMessageText, dark)), paddingHorizontal: 24, marginBottom: 20 } }, alert.message) : null,
      h(View, { style: { flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' } },
        button(neutral, 'neutral'), h(View, { style: { flex: 1 } }), button(negative, 'negative'), button(positive, 'positive'))));
}

function ErrorOverlay({ error, count }: { error: EngineError; count: number }) {
  const engine = maybeEngine();
  const insets = engine?.viewport.safeArea ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const title = error.kind === 'render' ? 'Render Error' : error.kind === 'syntax' ? 'Syntax Error' : error.kind === 'module' ? 'Module Error' : 'Uncaught Error';
  const mono = engine?.platform === 'android' ? 'monospace' : 'Menlo';
  const stack = (error.componentStack || error.stack || '').trim().split('\n').slice(0, 30).join('\n');
  return h(View, { testID: 'redbox', style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#1c1c1e' } },
    h(View, { style: { backgroundColor: '#d63a4a', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16 } },
      h(Text, { style: { color: 'white', fontSize: 15, fontWeight: '600' } }, count > 1 ? `${title}  (1 of ${count})` : title)),
    h(ScrollView, { style: { flex: 1 }, contentContainerStyle: { padding: 16, gap: 16 } },
      h(Text, { style: { color: 'white', fontSize: 18, fontWeight: '600', lineHeight: 24 } }, error.message),
      stack ? h(Text, { style: { color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 17, fontFamily: mono } }, stack) : null),
    h(View, { style: { flexDirection: 'row', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingBottom: insets.bottom } },
      h(Pressable, { testID: 'redbox-dismiss', onPress: () => errors.set(errors.value.slice(1)), style: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' } },
        h(Text, { style: { color: 'white', fontSize: 15 } }, 'Dismiss')),
      h(Pressable, { testID: 'redbox-reload', onPress: () => maybeEngine()?.send({ type: 'reloadRequested' }), style: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.1)' } },
        h(Text, { style: { color: 'white', fontSize: 15, fontWeight: '600' } }, 'Reload'))));
}

/** The launch screen from the expo-splash-screen config, until the app hides it. */
function SplashOverlay() {
  const visible = useSyncExternalStore((cb) => splash.subscribe(cb), () => splash.visible);
  const engine = maybeEngine();
  if (!visible || !engine) return null;
  const config = splashConfig(engine.env.appearance);
  if (!config) return null;
  const image = config.image;
  const width = config.resizeMode === 'native' && image ? image.width : config.imageWidth;
  const height = image && image.width ? (width * image.height) / image.width : width;
  return h(View, {
    testID: 'splash-screen',
    style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: config.backgroundColor, alignItems: 'center', justifyContent: 'center' },
  }, image ? h(Image, { source: { uri: image.uri, width: image.width, height: image.height }, style: { width, height }, resizeMode: 'contain' }) : null);
}

export function SystemUI() {
  const pendingAlerts = useSyncExternalStore(alerts.subscribe, alerts.get);
  const pendingErrors = useSyncExternalStore(errors.subscribe, errors.get);
  const engine = maybeEngine();
  const dark = engine?.env.appearance === 'dark';
  const tokens = (engine?.kit.tokens ?? {}) as Record<string, any>;
  const alert = pendingAlerts[0];
  return h(React.Fragment, null,
    h(SplashOverlay, null),
    alert ? h(engine?.platform === 'android' ? AndroidAlert : IOSAlert, { key: alert.id, alert, dark, tokens }) : null,
    pendingErrors[0] ? h(ErrorOverlay, { error: pendingErrors[0], count: pendingErrors.length }) : null);
}

export function resetSystemUI(): void {
  alerts.set([]);
  errors.set([]);
  splash.reset();
}

import React from 'react';
import type { Engine } from '@mimicry/engine';
import type { CapabilityLevel } from '@mimicry/protocol';
import { getEngine, setActiveEngine } from '../engine-ref';
import { BackHandler } from './core';
import { clearErrors, resetSystemUI, showError, SystemUI } from '../system/system-ui';
import { View } from '../components/primitives';

const h = React.createElement as (...args: any[]) => React.ReactElement;

type Provider = () => React.ComponentType<any>;
const registry = new Map<string, Provider>();
let lastKey: string | null = null;
let wrapper: ((props: { children: React.ReactNode }) => React.ReactNode) | null = null;

export const AppRegistry = {
  registerComponent(appKey: string, provider: Provider): string {
    registry.set(appKey, provider);
    lastKey = appKey;
    return appKey;
  },
  registerRunnable(appKey: string, run: (params: unknown) => void): string {
    registry.set(appKey, () => {
      run({});
      return () => null;
    });
    return appKey;
  },
  registerConfig(configs: Array<{ appKey: string; component: Provider }>) {
    for (const c of configs) AppRegistry.registerComponent(c.appKey, c.component);
  },
  getAppKeys: () => Array.from(registry.keys()),
  getRunnable: (key: string) => registry.get(key),
  setWrapperComponentProvider(provider: () => (props: { children: React.ReactNode }) => React.ReactNode) {
    wrapper = provider();
  },
  runApplication(appKey: string, params?: { initialProps?: Record<string, unknown> }): void {
    const provider = registry.get(appKey);
    if (!provider) throw new Error(`"${appKey}" has not been registered. Call AppRegistry.registerComponent('${appKey}', () => App) or Expo's registerRootComponent(App).`);
    const App = provider();
    const content = h(App, params?.initialProps ?? {});
    getEngine().render(h(View, { style: { flex: 1 }, pointerEvents: 'box-none' }, wrapper ? h(wrapper as any, null, content) : content));
  },
  unmountApplicationComponentAtRootTag(): void {
    getEngine().render(null);
  },
  registerHeadlessTask() {},
  registerCancellableHeadlessTask() {},
  startHeadlessTask() {},
  cancelHeadlessTask() {},
  /** @internal the app key the runtime should mount */
  get __lastKey() {
    return lastKey;
  },
  /** @internal */
  __reset() {
    registry.clear();
    lastKey = null;
    wrapper = null;
  },
};

/** Expo's registerRootComponent. */
export function registerRootComponent(component: React.ComponentType<any>): void {
  AppRegistry.registerComponent('main', () => component);
}

export const CAPABILITIES: Record<string, CapabilityLevel> = {
  View: 'supported', Text: 'supported', Image: 'supported', ImageBackground: 'supported',
  ScrollView: 'supported', FlatList: 'approximate', SectionList: 'approximate', VirtualizedList: 'approximate',
  Pressable: 'supported', TouchableOpacity: 'supported', TouchableHighlight: 'supported',
  TouchableWithoutFeedback: 'supported', TouchableNativeFeedback: 'approximate', Button: 'supported',
  Switch: 'approximate', ActivityIndicator: 'approximate', TextInput: 'approximate', Modal: 'approximate',
  SafeAreaView: 'supported', StatusBar: 'supported', KeyboardAvoidingView: 'stub', RefreshControl: 'stub',
  StyleSheet: 'supported', Platform: 'supported', Dimensions: 'supported', PixelRatio: 'supported',
  Appearance: 'supported', PlatformColor: 'supported', DynamicColorIOS: 'supported', Alert: 'approximate',
  Animated: 'supported', Easing: 'supported', PanResponder: 'supported', LayoutAnimation: 'stub',
  Keyboard: 'stub', Linking: 'approximate', BackHandler: 'supported', AppState: 'stub', Share: 'stub',
  Vibration: 'stub', AccessibilityInfo: 'stub', I18nManager: 'stub', NativeModules: 'unsupported',
  stickyHeaderIndices: 'supported', 'inline views in Text': 'unsupported', 'multi-touch': 'unsupported',
};

/** Connects the React Native surface to an engine and mounts system UI. */
export function installReactNative(engine: Engine): void {
  setActiveEngine(engine);
  resetSystemUI();
  engine.hooks.onError = (error) => showError(error);
  engine.hooks.onBack = () => BackHandler.__dispatch();
  engine.hooks.capabilities = () => CAPABILITIES;
  engine.renderSystem(h(SystemUI));
}

/** Mount whatever the entry module registered. */
export function runRegisteredApp(): void {
  clearErrors();
  const key = AppRegistry.__lastKey;
  if (!key) throw new Error('No component was registered. The entry file should call registerRootComponent(App) or AppRegistry.registerComponent(...).');
  AppRegistry.runApplication(key);
}

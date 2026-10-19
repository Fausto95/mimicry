/**
 * @mimicry/react-native — the `react-native` module apps import, implemented
 * on Mimicry's engine instead of UIKit / Android Views.
 */
export {
  View, Text, Image, ImageBackground, Pressable, Switch, ActivityIndicator, TextInput,
  SafeAreaView, KeyboardAvoidingView, StatusBar, RefreshControl,
} from './components/primitives';
export { TouchableOpacity, TouchableHighlight, TouchableWithoutFeedback, TouchableNativeFeedback, Button } from './components/touchables';
export { ScrollView, FlatList, SectionList, VirtualizedList } from './components/lists';
export { Modal } from './components/modal';
export {
  Platform, StyleSheet, Dimensions, PixelRatio, useWindowDimensions, Appearance, useColorScheme,
  PlatformColor, DynamicColorIOS, processColor, I18nManager, Vibration, LayoutAnimation, InteractionManager,
  NativeModules, UIManager, findNodeHandle, LogBox, DevSettings, AppState, Share, AccessibilityInfo, Linking,
  Keyboard, BackHandler, ToastAndroid,
} from './apis/core';
export type { ScaledSize, ColorSchemeName } from './apis/core';
export { PanResponder } from './apis/pan-responder';
export { Animated, Easing, useAnimatedValue } from './animated';
export { Alert, clearErrors } from './system/system-ui';
export { AppRegistry, registerRootComponent, installReactNative, runRegisteredApp, CAPABILITIES } from './apis/app-registry';
export { setActiveEngine, getEngine } from './engine-ref';
export { setAppConfig, getAppConfig } from './app-context';
export { resetNativeModules } from './native/registry';

import { getNativeModule, nativeComponent, nativeCommands } from './native/registry';
import './native/expo-modules';
import './native/svg';
export { DeviceEventEmitter, NativeEventEmitter } from './native/events';
export {
  registerNativeComponent, registerNativeComponents, registerNativeModule, registerNativeModules,
  getNativeModule, hasNativeComponent, hasNativeModule,
} from './native/registry';

/** Native modules: implemented in JS by Mimicry (see native/registry.ts). */
export const TurboModuleRegistry = {
  get: <T = any>(name: string): T | null => getNativeModule<T>(name),
  getEnforcing: <T = any>(name: string): T => {
    const module = getNativeModule<T>(name);
    if (module == null) {
      throw new Error(`TurboModuleRegistry.getEnforcing(...): '${name}' could not be found. Mimicry has no implementation of this native module.`);
    }
    return module;
  },
};
export const requireNativeComponent = (name: string) => nativeComponent(name);
export const codegenNativeComponent = (name: string, _options?: unknown) => nativeComponent(name);
export const codegenNativeCommands = nativeCommands;
export const unstable_batchedUpdates = <A, R>(fn: (a: A) => R, a: A): R => fn(a);

import * as Primitives from './components/primitives';
import * as Touchables from './components/touchables';
import * as Lists from './components/lists';
import { Modal as ModalComponent } from './components/modal';
// Bundlers rename functions (View → View2); name components explicitly for the inspector and devtools.
for (const [name, component] of Object.entries({ ...Primitives, ...Touchables, ...Lists, Modal: ModalComponent })) {
  if (component && (typeof component === 'function' || typeof component === 'object') && /^[A-Z]/.test(name)) {
    try {
      (component as { displayName?: string }).displayName = name;
    } catch {
      // frozen exotic component; ignore
    }
  }
}

/** `NativeComponentRegistry.get(name, viewConfig)`: same lookup as codegenNativeComponent. */
export const NativeComponentRegistry = {
  get: (name: string, _viewConfigProvider?: unknown) => nativeComponent(name),
  getWithFallback_DEPRECATED: (name: string, _viewConfigProvider?: unknown) => nativeComponent(name),
  setRuntimeConfigProvider() {},
  unstable_hasStaticViewConfig: (name: string) => hasNativeComponentInternal(name),
};
import { hasNativeComponent as hasNativeComponentInternal } from './native/registry';

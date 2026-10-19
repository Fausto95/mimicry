import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import * as ReactNative from '@mimicry/react-native';
import { resolveReactNativeDeep } from '@mimicry/react-native/internals/deep';
import * as AssetRegistry from '@mimicry/react-native/internals/asset-registry';
import * as Expo from '@mimicry/react-native/shims/expo';
import * as ExpoModulesCore from '@mimicry/react-native/shims/expo-modules-core';
import * as ExpoStatusBar from '@mimicry/react-native/shims/expo-status-bar';
import * as SafeArea from '@mimicry/react-native/shims/react-native-safe-area-context';
import * as LinearGradient from '@mimicry/react-native/shims/expo-linear-gradient';
import * as MetroRuntime from '@mimicry/react-native/shims/expo-metro-runtime';
import * as GestureHandler from '@mimicry/react-native/gesture-handler';
import * as GestureHandlerSwipeable from '@mimicry/react-native/gesture-handler/swipeable-module';
import * as GestureHandlerDrawerLayout from '@mimicry/react-native/gesture-handler/drawer-layout-module';
import * as Reanimated from '@mimicry/react-native/reanimated';
import * as Worklets from '@mimicry/react-native/worklets';

/**
 * Modules the base provides to every app. App code and vendored packages link
 * against these instead of bundling their own copy: one React, one
 * react-native, and the native side of libraries implemented by Mimicry.
 */
/**
 * A module with a default export, shaped for both CommonJS interop modes:
 * Babel-style (`__esModule` → `.default`) and Node-style ESM packages, where
 * `import Animated from 'react-native-reanimated'` is the whole exports
 * object — so the default's members are on the exports object as well.
 */
function withDefault(ns: Record<string, unknown>): Record<string, unknown> {
  const fallback = ns.default && typeof ns.default === 'object' ? (ns.default as Record<string, unknown>) : {};
  return { ...fallback, ...ns, __esModule: true };
}

export const PROVIDED_MODULES: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': JSXRuntime,
  'react/jsx-dev-runtime': JSXDevRuntime,
  'react-native': ReactNative,
  expo: Expo,
  'expo-modules-core': ExpoModulesCore,
  'expo-status-bar': ExpoStatusBar,
  'react-native-safe-area-context': SafeArea,
  'expo-linear-gradient': LinearGradient,
  '@expo/metro-runtime': MetroRuntime,
  '@react-native/assets-registry/registry': AssetRegistry,
  'react-native-gesture-handler': GestureHandler,
  'react-native-gesture-handler/ReanimatedSwipeable': GestureHandlerSwipeable,
  'react-native-gesture-handler/ReanimatedDrawerLayout': GestureHandlerDrawerLayout,
  'react-native-gesture-handler/Swipeable': GestureHandlerSwipeable,
  'react-native-gesture-handler/DrawerLayout': GestureHandlerDrawerLayout,
  'react-native-reanimated': withDefault(Reanimated),
  'react-native-worklets': withDefault(Worklets),
};

export const PROVIDED_SPECIFIERS = Object.keys(PROVIDED_MODULES);

const deepCache = new Map<string, unknown>();

/** Resolve a provided specifier, including deep paths like `react-native/Libraries/…`. */
export function resolveProvided(specifier: string): unknown {
  if (specifier in PROVIDED_MODULES) return PROVIDED_MODULES[specifier];
  if (deepCache.has(specifier)) return deepCache.get(specifier);
  let module: unknown;
  if (specifier.startsWith('react-native/')) module = resolveReactNativeDeep(specifier.slice('react-native/'.length));
  else {
    // Deep imports into other provided packages resolve to the package itself.
    const root = Object.keys(PROVIDED_MODULES).find((id) => specifier.startsWith(id + '/'));
    if (root) module = PROVIDED_MODULES[root];
  }
  if (module !== undefined) deepCache.set(specifier, module);
  return module;
}

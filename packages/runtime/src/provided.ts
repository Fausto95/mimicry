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

/**
 * Modules the base provides to every app. App code and vendored packages link
 * against these instead of bundling their own copy: one React, one
 * react-native, and the native side of libraries implemented by Mimicry.
 */
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

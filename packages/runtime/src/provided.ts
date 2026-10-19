import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import * as ReactNative from '@mimicry/react-native';
import * as Expo from '@mimicry/react-native/shims/expo';
import * as ExpoStatusBar from '@mimicry/react-native/shims/expo-status-bar';
import * as SafeArea from '@mimicry/react-native/shims/react-native-safe-area-context';
import * as LinearGradient from '@mimicry/react-native/shims/expo-linear-gradient';

/**
 * Modules the base provides to every app. App code links against these
 * instead of bundling its own copy — one React, one react-native.
 */
export const PROVIDED_MODULES: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': JSXRuntime,
  'react/jsx-dev-runtime': JSXDevRuntime,
  'react-native': ReactNative,
  expo: Expo,
  'expo-status-bar': ExpoStatusBar,
  'react-native-safe-area-context': SafeArea,
  'expo-linear-gradient': LinearGradient,
};

export const PROVIDED_SPECIFIERS = Object.keys(PROVIDED_MODULES);

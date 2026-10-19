import React from 'react';
import * as RN from '../index';
import { getAssetByID, registerAsset, resolveAssetSource } from './asset-registry';

/**
 * Deep imports into React Native (`react-native/Libraries/…`). Libraries reach
 * for a handful of internals; the ones with a meaningful Mimicry equivalent
 * are mapped here, and anything else under `Libraries/` falls back to the
 * public export with the same name (`…/Components/View/View` → `View`).
 */
const esm = (value: unknown, named: Record<string, unknown> = {}) => ({ __esModule: true, default: value, ...named });

const viewConfigs = new Map<string, unknown>();

const DEEP: Record<string, () => unknown> = {
  'Libraries/Utilities/codegenNativeComponent': () => esm(RN.codegenNativeComponent),
  'Libraries/Utilities/codegenNativeCommands': () => esm(RN.codegenNativeCommands),
  'Libraries/TurboModule/TurboModuleRegistry': () => esm(RN.TurboModuleRegistry, RN.TurboModuleRegistry),
  'Libraries/ReactNative/requireNativeComponent': () => esm(RN.requireNativeComponent),
  'Libraries/Image/AssetRegistry': () => esm({ registerAsset, getAssetByID }, { registerAsset, getAssetByID }),
  '@react-native/assets-registry/registry': () => esm({ registerAsset, getAssetByID }, { registerAsset, getAssetByID }),
  'Libraries/Image/resolveAssetSource': () => esm(resolveAssetSource),
  'Libraries/Image/AssetSourceResolver': () =>
    esm(class AssetSourceResolver {
      constructor(_serverUrl: unknown, _jsbundleUrl: unknown, private readonly asset: { uri?: string; width: number; height: number; scale: number }) {}
      defaultAsset() {
        return { __packager_asset: true, uri: this.asset.uri, width: this.asset.width, height: this.asset.height, scale: this.asset.scale };
      }
      isLoadedFromServer() {
        return true;
      }
      isLoadedFromFileSystem() {
        return false;
      }
    }),
  'Libraries/Renderer/shims/ReactNativeViewConfigRegistry': () => ({
    register: (name: string, callback: () => unknown) => {
      viewConfigs.set(name, callback);
      return name;
    },
    get: (name: string) => (viewConfigs.get(name) as (() => unknown) | undefined)?.() ?? null,
  }),
  'Libraries/ReactNative/AppContainer': () => esm(({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)),
  'Libraries/Pressability/PressabilityDebug': () => ({ PressabilityDebugView: () => null, isEnabled: () => false, setEnabled() {} }),
  'Libraries/Components/View/ReactNativeStyleAttributes': () => esm(STYLE_ATTRIBUTES),
  'Libraries/EventEmitter/NativeEventEmitter': () => esm(RN.NativeEventEmitter),
  'Libraries/EventEmitter/RCTDeviceEventEmitter': () => esm(RN.DeviceEventEmitter),
  'Libraries/Utilities/Platform': () => esm(RN.Platform),
  'Libraries/StyleSheet/processColor': () => esm(RN.processColor),
  'Libraries/StyleSheet/flattenStyle': () => esm(RN.StyleSheet.flatten),
  'Libraries/Animated/NativeAnimatedHelper': () =>
    esm({ API: { flushQueue() {} }, shouldUseNativeDriver: () => false, transformDataType: (v: unknown) => v }),
  'Libraries/Core/ReactNativeVersion': () => ({ version: { major: 0, minor: 88, patch: 0, prerelease: null } }),
  'Libraries/Utilities/useMergeRefs': () =>
    esm((...refs: any[]) => (value: unknown) => {
      for (const ref of refs) {
        if (typeof ref === 'function') ref(value);
        else if (ref) ref.current = value;
      }
    }),
  'package.json': () => ({ name: 'react-native', version: '0.88.0' }),
  'unstable-internals-do-not-use': () => ({}),
};

const STYLE_ATTRIBUTES = Object.fromEntries(
  ('alignContent alignItems alignSelf aspectRatio backfaceVisibility backgroundColor borderBottomColor borderBottomLeftRadius ' +
    'borderBottomRightRadius borderBottomWidth borderColor borderCurve borderLeftColor borderLeftWidth borderRadius borderRightColor ' +
    'borderRightWidth borderStyle borderTopColor borderTopLeftRadius borderTopRightRadius borderTopWidth borderWidth bottom boxShadow ' +
    'color columnGap direction display elevation end filter flex flexBasis flexDirection flexGrow flexShrink flexWrap fontFamily ' +
    'fontSize fontStyle fontVariant fontWeight gap height justifyContent left letterSpacing lineHeight margin marginBottom ' +
    'marginEnd marginHorizontal marginLeft marginRight marginStart marginTop marginVertical maxHeight maxWidth minHeight minWidth ' +
    'opacity overflow padding paddingBottom paddingEnd paddingHorizontal paddingLeft paddingRight paddingStart paddingTop ' +
    'paddingVertical position right rowGap shadowColor shadowOffset shadowOpacity shadowRadius start textAlign textDecorationLine ' +
    'textShadowColor textShadowOffset textShadowRadius textTransform tintColor top transform transformOrigin width zIndex')
    .split(' ')
    .map((k) => [k, true]),
);

/** Resolve `react-native/<path>`, or undefined when Mimicry has nothing for it. */
export function resolveReactNativeDeep(path: string): unknown {
  const clean = path.replace(/\.(js|ts|tsx)$/, '');
  const exact = DEEP[clean];
  if (exact) return exact();
  if (clean.startsWith('Libraries/')) {
    const name = clean.split('/').pop()!;
    const value = (RN as Record<string, unknown>)[name];
    if (value !== undefined) return esm(value, typeof value === 'object' && value ? (value as Record<string, unknown>) : {});
  }
  return undefined;
}

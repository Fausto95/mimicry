import { getAppConfig } from '../app-context';
import { maybeEngine, getEngine } from '../engine-ref';
import { NativeModule } from '../shims/expo-modules-core';
import { registerNativeModules } from './registry';
import { splash } from './splash';

/**
 * Native halves of the Expo SDK modules apps use most, so their published
 * JavaScript runs unmodified. Values come from the device descriptor and the
 * app config; effects with no browser equivalent (haptics, keep-awake) are
 * accepted and do nothing, as on a simulator.
 */
const device = () => maybeEngine()?.env.device;
const platform = () => maybeEngine()?.platform ?? 'ios';
const resolved = <T>(value: T) => Promise.resolve(value);

class ExpoLinkingModule extends NativeModule {
  getLinkingURL(): string | null {
    const scheme = getAppConfig().scheme;
    const first = Array.isArray(scheme) ? scheme[0] : scheme;
    return first ? `${first}://` : null;
  }
  clearInitialURL(): void {}
}

class ExpoWebBrowserModule extends NativeModule {
  async openBrowserAsync(url: string) {
    getEngine().send({ type: 'openURL', url });
    return { type: 'opened' };
  }
  async openAuthSessionAsync(url: string) {
    getEngine().send({ type: 'openURL', url });
    return { type: 'cancel' };
  }
  dismissBrowser() {
    return resolved({ type: 'dismiss' });
  }
  dismissAuthSession() {}
  warmUpAsync = () => resolved({});
  coolDownAsync = () => resolved({});
  mayInitWithUrlAsync = () => resolved({});
  getCustomTabsSupportingBrowsers = () => resolved({ browserPackages: [], defaultBrowserPackage: null, servicePackages: [], preferredBrowserPackage: null });
}

let systemBackground: string | null = null;

registerNativeModules({
  // React Native's own modules libraries reach for through spec imports
  SourceCode: () => ({ getConstants: () => ({ scriptURL: 'http://localhost:8081/index.bundle?platform=' + platform() }) }),
  PlatformConstants: () => ({ getConstants: () => ({ isTesting: false, reactNativeVersion: { major: 0, minor: 88, patch: 0 }, osVersion: device()?.osVersion, systemName: platform() === 'ios' ? 'iOS' : 'Android', interfaceIdiom: device()?.idiom === 'tablet' ? 'pad' : 'phone' }) }),
  DeviceInfo: () => ({ getConstants: () => ({ Dimensions: { window: maybeEngine()?.env.window, screen: maybeEngine()?.env.screen } }) }),

  ExponentConstants: () => {
    const config = getAppConfig();
    const d = device();
    return {
      name: 'ExponentConstants',
      manifest: config,
      appOwnership: null,
      executionEnvironment: 'bare',
      debugMode: true,
      deviceName: d?.name ?? 'Mimicry',
      deviceYearClass: null,
      isDevice: false,
      isHeadless: false,
      installationId: 'mimicry-installation',
      sessionId: 'mimicry-session',
      linkingUri: config.scheme ? `${Array.isArray(config.scheme) ? config.scheme[0] : config.scheme}://` : '',
      experienceUrl: '',
      statusBarHeight: maybeEngine()?.viewport.statusBarHeight ?? 0,
      systemFonts: [],
      systemVersion: d?.osVersion,
      platform: platform() === 'ios' ? { ios: { buildNumber: config.ios?.buildNumber ?? '1', platform: 'iPhone', model: d?.name, userInterfaceIdiom: d?.idiom === 'tablet' ? 'tablet' : 'handset', systemVersion: d?.osVersion } } : { android: { versionCode: config.android?.versionCode ?? 1 } },
      nativeAppVersion: config.version ?? '1.0.0',
      nativeBuildVersion: '1',
      getWebViewUserAgentAsync: () => resolved('Mozilla/5.0 (Mimicry)'),
    };
  },

  ExpoDevice: () => {
    const d = device();
    const ios = platform() === 'ios';
    return {
      isDevice: false,
      brand: ios ? 'Apple' : 'google',
      manufacturer: ios ? 'Apple' : 'Google',
      modelName: d?.name ?? null,
      modelId: d?.id ?? null,
      designName: ios ? null : d?.id ?? null,
      productName: ios ? null : d?.id ?? null,
      deviceYearClass: 2025,
      totalMemory: 8 * 1024 ** 3,
      supportedCpuArchitectures: ['arm64'],
      osName: ios ? (d?.idiom === 'tablet' ? 'iPadOS' : 'iOS') : 'Android',
      osVersion: d?.osVersion ?? null,
      osBuildId: null,
      osInternalBuildId: null,
      osBuildFingerprint: null,
      platformApiLevel: ios ? null : Number(d?.osVersion ?? 36),
      deviceName: d?.name ?? null,
      deviceType: d?.idiom === 'tablet' ? 2 : 1,
      getDeviceTypeAsync: () => resolved(d?.idiom === 'tablet' ? 2 : 1),
      getUptimeAsync: () => resolved(Math.round(performance.now())),
      getMaxMemoryAsync: () => resolved(512 * 1024 ** 2),
      isRootedExperimentalAsync: () => resolved(false),
      isSideLoadingEnabledAsync: () => resolved(false),
      getPlatformFeaturesAsync: () => resolved([]),
      hasPlatformFeatureAsync: () => resolved(false),
    };
  },

  ExpoSplashScreen: () => ({
    preventAutoHideAsync: () => resolved(splash.preventAutoHide()),
    hide: () => splash.hide(),
    hideAsync: () => resolved(splash.hide()),
    setOptions: (options: { duration?: number; fade?: boolean }) => splash.setOptions(options),
    internalPreventAutoHideAsync: () => resolved(splash.preventAutoHide()),
    internalMaybeHideAsync: () => resolved(splash.hide()),
  }),

  ExpoLinking: () => new ExpoLinkingModule(),
  ExpoWebBrowser: () => new ExpoWebBrowserModule(),

  ExpoSystemUI: () => ({
    setBackgroundColorAsync: async (color: string | null) => {
      systemBackground = color;
      const engine = maybeEngine();
      if (engine) {
        engine.setRootBackground(color);
      }
    },
    getBackgroundColorAsync: async () => systemBackground,
  }),

  // en-US with the device's settings, like a freshly reset simulator
  ExpoLocalization: () => ({
    getLocales: () => [{
      languageTag: 'en-US', languageCode: 'en', regionCode: 'US', languageRegionCode: 'US', currencyCode: 'USD', currencySymbol: '$',
      languageCurrencyCode: 'USD', languageCurrencySymbol: '$', decimalSeparator: '.', digitGroupingSeparator: ',', textDirection: 'ltr',
      measurementSystem: 'us', temperatureUnit: 'fahrenheit', languageScriptCode: null,
    }],
    getCalendars: () => [{ calendar: 'gregorian', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', uses24hourClock: false, firstWeekday: 1 }],
    addListener: () => {},
    removeListeners: () => {},
  }),

  ExpoKeepAwake: () => ({
    activate: () => resolved(undefined),
    deactivate: () => resolved(undefined),
    isAvailableAsync: () => resolved(true),
  }),

  ExpoHaptics: () => ({
    impactAsync: () => resolved(undefined),
    notificationAsync: () => resolved(undefined),
    selectionAsync: () => resolved(undefined),
    performHapticsAsync: () => resolved(undefined),
  }),

  ExpoGlassEffect: () => ({
    isLiquidGlassAvailable: () => platform() === 'ios' && Number(device()?.osVersion ?? 0) >= 26,
    isGlassEffectAPIAvailable: () => platform() === 'ios' && Number(device()?.osVersion ?? 0) >= 26,
  }),

  ExpoAsset: () => ({
    // Assets are already served by the dev server (or inlined); the URI is the local URI.
    downloadAsync: (uri: string) => resolved(uri),
  }),

  ExpoFontLoader: () => ({
    customNativeFonts: [],
    loadAsync: (family: string, uri: string) => getEngine().loadFont(family, uri),
    loadFontFamilyAsync: (family: string, faces: Array<{ localUri: string; weight?: string; style?: string }>) =>
      Promise.all(faces.map((f) => getEngine().loadFont(family, f.localUri, { weight: f.weight, style: f.style }))).then(() => undefined),
    getLoadedFonts: () => getEngine().loadedFonts(),
    isLoaded: (family: string) => getEngine().loadedFonts().includes(family),
    unloadAsync: async () => {},
    unloadAllAsync: async () => {},
  }),

  ExpoImage: () => ({
    prefetch: async (urls: string[]) => {
      for (const url of urls) getEngine().images.get(url);
      return true;
    },
    clearMemoryCache: async () => true,
    clearDiskCache: async () => true,
    getCachePathAsync: async () => null,
    configureCache: () => {},
    generateBlurhashAsync: async () => null,
    generateThumbhashAsync: async () => '',
  }),
});

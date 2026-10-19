# Mimicry

**Run an Expo app inside an iOS- or Android-like simulator implemented entirely in the browser.**

Mimicry is a Dactyl-inspired browser-native UI project. The goal is to reimplement the key behaviors and appearance of UIKit, SwiftUI, Android Views and Jetpack Compose **on the web**, with no iOS Simulator, Android Emulator, Mac or native device required to run the preview.

> **Alpha:** Today's implementation runs an actual **Expo JavaScript application via Metro's web bundle**. Its React Native host views are provided by React Native Web and supported Expo UI controls are replaced with Mimicry's own platform-styled components. The simulator shell (status bar, safe areas, device presets, rotation, appearance) is entirely browser-rendered. This is **not** an iOS binary, an APK, Apple UIKit or actual Compose running under WebAssembly; native fidelity is incomplete.

## Run the included Expo demo

Requires Node 22.13+ and npm. **No Xcode or Android SDK.**

```sh
git clone https://github.com/Fausto95/mimicry.git
cd mimicry
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Mimicry starts Expo/Metro on **http://localhost:8081** automatically. The demo uses a standard Expo SDK 58 `App.tsx`, React Native components and the official `@expo/ui` imports. It supports counters, text input, app navigation, sliders, switches, buttons and a simulated sheet.

Use the platform tabs to switch between Cupertino-inspired and Material3-inspired controls. Change device presets and appearance, rotate, or reload. Inspect events and build output on the right. Metro provides Fast Refresh when editing the Expo app.

### How the Expo UI emulation works

The demo has a Metro resolver extension:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withMimicry } = require('../../packages/runtime/metro.cjs');

module.exports = withMimicry(getDefaultConfig(__dirname));
```

When Metro targets **web**, Mimicry redirects `@expo/ui`, `@expo/ui/swift-ui`, and `@expo/ui/jetpack-compose` imports into its own components. When Metro targets **ios/android**, these imports still resolve normally to real Expo UI native implementations. The rest of the Expo app is unchanged. This is a deliberately limited adapter, not comprehensive native API compatibility.

### Preview another Expo application

1. Install `react-dom`, `react-native-web`, and `@expo/metro-runtime` in the app if web support isn't configured.
2. Add the `withMimicry` resolver extension to its `metro.config.js` (update the require path).
3. Run Mimicry pointing to its Expo app folder:

```sh
MIMICRY_EXPO_PROJECT=/absolute/path/to/my-expo-app npm run dev
```

Or launch Expo's web server yourself and run only the Studio:

```sh
MIMICRY_APP_URL=http://localhost:8081 npm run dev:studio
```

Browser-compatible modules work. App code that depends on native-only APIs or iOS/Android-only source resolution needs corresponding Mimicry shims.

### Development

```sh
npm run check
npm test
npm run typecheck --workspace @mimicry/expo-demo
npm run export:web --workspace @mimicry/expo-demo
```

Environment options: `MIMICRY_PORT` (default `5173`), `MIMICRY_EXPO_PORT` (default `8081`), `MIMICRY_EXPO_PROJECT` (demo by default), `MIMICRY_APP_URL` (external browser app URL, disables auto-start).

## The vision beyond this MVP

A framework reimplementation with semantic retained trees, platform-specific layout systems, draw-command generation, Canvas/Wasm rendering, gesture/animation simulation, runtime native-module shims, and visual diffs against real OS screenshots collected *offline*. The **real simulator is a test oracle, never a runtime dependency**.

[Read the architecture and fidelity roadmap](docs/architecture.md).

License: not yet selected.

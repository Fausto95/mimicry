# Mimicry

**A browser-native simulator for React Native apps.** Mimicry runs your Expo / React Native app in a browser tab and draws it as an iPhone or an Android phone. It needs no Mac, Xcode, Android Studio or VM.

Mimicry takes the architecture [Dactyl](https://dactyl.dev/blog/how-dactyl-works/) built for SwiftUI and applies it to React Native:

- A **reimplementation of the platform**, not a stream from a real simulator. Mimicry models the operating systems themselves — UIKit, Core Animation and Foundation on iOS; the View system, widgets and app components on Android — on a small kernel, and runs frameworks on them through **adapters**. React Native's adapter is its Fabric: React reconciles into a shadow tree, [Yoga](https://yogalayout.dev) lays it out, and it mounts into `UIView`s and Android `View`s. Lynx, NativeScript and Vector can plug in the same way ([docs/adapters.md](docs/adapters.md)).
- A **binary draw-command stream**. Layout and text are fully resolved before a single command is written. A thin host paints the stream on Canvas2D and caches each chunk's raster by content hash, so scrolling and transform or opacity animations cost compositing, not painting.
- A **base/side module split**. The engine, React and `react-native` form one content-addressed base module that the browser loads once. Your app compiles per file into a small side module, and edits hot-swap under the running app with Fast Refresh, so state survives.
- **Native controls at resolved rectangles.** Like Dactyl's Compose host mounting real Material widgets, the browser host mounts real `<input>`s exactly where the engine laid out each `TextInput`, so IME, selection and autofill are native.
- **A deterministic test loop.** The same engine runs headless in Node on a virtual clock, which gives you golden images, filmstrips with synthetic taps, and layout-tree diffs. Real simulator screenshots are used only as an offline oracle.

```
App.tsx ──compile──▶ side module ──link──▶ base module (Web Worker)
                                            React → shadow tree → Yoga → mount (adapter)
                                            UIKit / Android View system (OS models)
                                            kernel: layers → render server
                                                        │ binary frame (chunks + layers + overlays)
                                                        ▼
                                            host: Canvas2D compositor + raster cache + native inputs
```

![Showcase on iOS and Android](docs/images/showcase.png)

## Quick start

Requires Node 22.13+.

```sh
git clone https://github.com/Fausto95/mimicry.git
cd mimicry
npm install
npm run dev            # Studio for examples/showcase at http://127.0.0.1:5173
```

To point it at your own app (a classic Expo entry: `index.ts` with `registerRootComponent`, or `App.tsx`):

```sh
node packages/cli/bin/mimicry.js dev path/to/your-app
```

You don't need to add anything to the app. `react-native`, `react`, `expo`, `expo-status-bar`, `react-native-safe-area-context` and `expo-linear-gradient` come from the base module. Other packages are prebundled with esbuild.

## What the Studio gives you

- Switch iOS ↔ Android (each platform compiles its own module graph, so `*.ios.tsx` and `*.android.tsx` resolve like Metro). The modern profiles include **iPhone 18 Pro/Max, iPhone 17 and 16 families, iPad Pro M5 and iPad Air M4, Pixel 11 Pro/XL and Galaxy S26**, on iOS/iPadOS 27 and Android 17 respectively. Choose hardware colors, toggle light/dark, rotate, use Android back, slow animations 10× and take device-resolution screenshots. [Device support and fidelity](docs/devices-2026.md).
- **Inspect**: the React component tree with host types and test IDs. Hover a row to outline the element on the device, or pick an element on screen.
- **Engine**: per-frame layout and encode time, raster time, chunk cache hit rate, composited layers, frame stream size.
- **Logs**: the app's console output, build errors and runtime errors. Render errors also appear in the device as a LogBox-style screen.

## Headless testing

```ts
import { launch } from '@mimicry/testing';

const { session } = await launch('examples/showcase', { device: 'pixel-9', appearance: 'dark' });
session.tap({ testID: 'tab-motion' });
session.scroll({ testID: 'motion-scroll' }, { dy: 300 }).settle();
const png = session.screenshot();              // device resolution, deterministic
const frames = session.filmstrip({ duration: 600, every: 100 });
const tree = session.layout();                 // compact layout tree for snapshot diffs
```

From the command line:

```sh
mimicry render examples/showcase --scene examples/showcase/scenes/components-dark.json --out shot.png
mimicry filmstrip examples/showcase --scene examples/showcase/scenes/spring.json --out film/
mimicry oracle examples/showcase --scenes examples/showcase/scenes --reference oracle/ios --out report/
mimicry diff a.png b.png --out diff.png
```

`scripts/capture-oracle.mjs` captures the reference screenshots on a real iOS Simulator (macOS) from the same scene files.

## Repository layout

| Package | Role |
| --- | --- |
| `@mimicry/protocol` | Frame format, opcodes, writer/reader, engine↔host messages, device descriptors |
| `@mimicry/os-core` | The kernel: frame loop, render layers and render server, text layout, fonts, images, storage, keyboard, scroll kinetics, the framework adapter contract |
| `@mimicry/os-ios` | iOS: UIKit, Core Animation, Foundation ([docs/os-ios.md](docs/os-ios.md)) |
| `@mimicry/os-android` | Android: android.view, widget, app, animation, androidx ([docs/os-android.md](docs/os-android.md)) |
| `@mimicry/device` | Boots a kernel with the OS a device descriptor names |
| `@mimicry/react-native-fabric` | React Native's native side: React host config, shadow tree, Yoga, mounting into OS views, touch handling, gesture arena, SVG |
| `@mimicry/react-native` | The `react-native` API surface (components, Animated, Alert, …) plus Expo/community shims |
| `@mimicry/runtime` | Module linker with Fast Refresh, app runtime, the React Native adapter, the Web Worker entry (base module) |
| `@mimicry/host-web` | Canvas2D executor + compositor with raster cache, native input overlays, `EngineHost` |
| `@mimicry/compiler` | Base module build, per-file side module compiler (SWC), resolver, vendor prebundle |
| `@mimicry/studio` | The browser UI around the device |
| `@mimicry/cli` | `mimicry dev / render / filmstrip / oracle / diff` and the dev server |
| `@mimicry/testing` | Headless sessions, bare devices (`createDevice`), filmstrips, pixel diffs |

Read more in [docs/architecture.md](docs/architecture.md), [docs/adapters.md](docs/adapters.md), [docs/protocol.md](docs/protocol.md) and [docs/fidelity.md](docs/fidelity.md).

## Development

```sh
npm test               # unit, e2e, golden and filmstrip tests (Vitest)
npm run typecheck
npm run goldens:update # after an intentional visual change
npm run test:browser   # Studio smoke test in Chromium (needs `npm run dev` on :5180, see the file)
```

## Status

Alpha. It renders and runs real Expo apps built from core React Native components, with both platform kits, Animated, scrolling, modals, alerts and Fast Refresh. The 2026 device profiles and shells are available, but **iOS 27 / Android 17 OS fidelity is not complete**: new safe areas and Liquid Glass / Material 3 Expressive components require oracle comparison. The fidelity table in [docs/fidelity.md](docs/fidelity.md) lists what is approximate and what is missing (virtualized lists, sticky headers, multi-touch, inline views in text, native modules, expo-router, among others).

License: not yet selected.

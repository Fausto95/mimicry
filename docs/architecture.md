# Mimicry browser-native runtime

The emulator is **in the browser**, not on a Mac or Android host.

## Code path

```
Expo app: App.tsx
     |
     v
Expo / Metro web JS bundle ────────────────> React state and effects
     |                                      (real application code)
     +--> react-native ─────────────────────> React Native Web base views (MVP)
     |
     +--> @expo/ui import ──────────────────> Metro resolver (web only)
                                               |
                  +----------------------------+
                  v
       Mimicry component registry
       ├─ SwiftUI-inspired controls (iOS target)
       ├─ Material 3 / Compose controls (Android target)
       ├─ platform colors, geometry, accessibility props
       └─ input handling and inspector telemetry
                  |
                  v
               Browser DOM
                  |
                  v
           Mimicry device shell
         viewport, safe area, status bar,
         home indicator, appearance, rotation
```

### What is actually running?

The **same Expo/React application source**, compiled by Metro for browser execution. It is **not** an iOS Mach-O app or Android APK running in a browser. Native binary code and direct native module calls are not executable by the JS browser runtime. To get native-target-only libraries working, Mimicry must reimplement or mock those interfaces.

### What is mimicked now?

The browser-side adapter supplies a first subset of `@expo/ui`: `Host`, `Column`, `Row`, `Text`, `Button`, `Switch`, `Slider`, `Checkbox`, `TextInput`, `Spacer`, `Icon`, `FieldGroup`, `List`, `Collapsible`.

The iOS target uses Cupertino-inspired colors, proportions, radii and toggles; Android uses Material3-inspired variants. App state, event handlers, async code, RN layout and Metro Fast Refresh are genuine browser execution of the Expo app.

The base `react-native` primitives still use React Native Web; `Platform.OS` remains `'web'` in ordinary application and third-party code. The example detects Mimicry's selected target separately. Existing apps with `*.ios.tsx`, `*.android.tsx`, platform-specific `Platform.OS` conditionals, native-only package imports or complex `@expo/ui` modifiers are not automatically equivalent to their native builds.

### Dactyl-inspired next steps

1. **Full RN host compatibility**: expose `Platform.OS` as emulated platform to app-level code without breaking RNW internals, resolve `*.ios.tsx` / `*.android.tsx` while still using JS-compatible output. This requires a dedicated module graph/resolver boundary.
2. **View-tree protocol**: expose semantic nodes (type, props, accessibility, layout, event handlers), inspect them, preserve identity, and update incrementally. Host `@expo/ui` descriptors separately from RN primitives.
3. **Native-semantic layout engine**: implement SwiftUI layout proposal/ideal size (stacks, layout priorities, alignment), UIKit auto layout and Compose measurement separately. Canvas or WASM is a future optimization, not the first correctness mechanism.
4. **Renderer separation**: produce stable draw commands from computed views, cache them by value and paint to Canvas2D/WebGPU, overlay true inputs for IME/accessibility.
5. **Framework surface expansion**: sheets, lists, pickers, keyboard, navigation, animations, gestures, safe areas, dynamic type, localization, accessibility. Explicit 'supported/approximate/mocked/unsupported' labels.
6. **Reference comparisons**: keep real iOS/Android screenshots solely as *offline test oracles*, not runtime dependencies. Generate scene/state manifests, compare visual diff and event timelines, then refine the browser framework.
7. **Deterministic frame clock**: virtual time, reproducible animation frames, gesture injection, screenshot golden tests and event-trace comparisons.

Unlike Dactyl, Mimicry cannot simply link native Expo apps into Wasm: Expo's app logic is JS, React Native's native renderer and Expo modules are implemented in C++/Obj-C/Swift/Kotlin. It needs a compatible browser host implementation, not just a visual shell.

## Honest guarantees

| Part | Status |
| --- | --- |
| Metro compiles Expo TSX for browser | Expo-supported |
| App state, events, render updates | Real JS execution |
| RN Views/Text/ScrollView/TextInput | React Native Web approximation |
| Expo UI controls covered by shim | Mimicry approximations |
| iOS/Android device chrome, sizing, rotation | Simulated |
| UIKit/SwiftUI binary execution | Not supported |
| Native-only Expo modules | Not supported without adapters |
| Native geometry/typography pixel parity | Not established |
| WASM layout / Canvas retained renderer | Not implemented |

This distinction is core to Mimicry: browser preview is fast and scalable; native-device screenshots are validation inputs, not execution infrastructure.

# Fidelity

Mimicry is useful only to the extent it is honest about what matches a device. This page is that ledger. Mimicry reimplements React Native's surface on its own engine, so "supported" means *behaves like React Native on device*. It does not mean *runs Apple's or Google's code*.

## How fidelity improves: the oracle loop

1. Write a scene (`examples/showcase/scenes/*.json`): device, appearance, and steps by `testID` or text.
2. Capture the reference on a real simulator with `scripts/capture-oracle.mjs`. It pins the status bar to 9:41 with full bars, sets the appearance, and drives the steps through Maestro.
3. Run `mimicry oracle <project> --scenes … --reference … --out report/` to get a per-scene diff ratio and an HTML report with Mimicry, simulator and difference side by side.
4. Fix the cause, usually a token in `packages/engine/src/platform/{ios,android}.ts` or a device descriptor in `packages/protocol/src/devices.ts`.
5. Regenerate goldens (`npm run goldens:update`) so the improvement is locked in.

The simulator is a test oracle only and never a runtime dependency.

## Current status

| Area | Status | Notes |
| --- | --- | --- |
| Flexbox layout | Device-equivalent | Yoga with React Native's config (pixel grid, errata). |
| Text layout | Close | Engine line breaking, ellipsis, mixed spans. Fonts: Inter stands in for SF Pro when SF isn't on the machine, Roboto is real. Hyphenation, `adjustsFontSizeToFit`, `textAlignVertical` and inline views in `<Text>` aren't implemented. |
| View drawing | Close | Radii, per-side borders, `boxShadow`, iOS `shadow*`, Android `elevation` (approximated as two Material shadow layers), `experimental_backgroundImage` linear gradients, group opacity, transforms (3D rotations are projected flat). |
| ScrollView | Close | Rubber banding, `UIScrollView` deceleration, paging, snapping, indicators, `onScroll` and momentum events, `scrollTo`. Android uses a decay approximation without the stretch overscroll effect. `stickyHeaderIndices` and `RefreshControl` aren't implemented. |
| FlatList / SectionList | Approximate | Not virtualized: every item renders (painting is still culled and tiled). `scrollToIndex` uses measured or `getItemLayout` offsets. |
| Touch | Close | Responder system, Pressable/Touchables, `PanResponder`, nested-text presses, hit slop, scroll takeover. Single touch only. |
| TextInput | Close in the browser | A real `<input>`/`<textarea>` at the engine's rectangle. Headless sessions draw the text and caret. The software keyboard isn't simulated (no keyboard events, no `KeyboardAvoidingView` behavior). |
| Switch | Approximate | iOS 18 `UISwitch` metrics. iOS 26 Liquid Glass shapes aren't modeled yet. Android uses SwitchCompat with AppCompat colors. |
| ActivityIndicator | Approximate | iOS 8-spoke stepping, Android Material indeterminate arc. |
| Modal | Approximate | Slide, fade, transparent, iOS `pageSheet`/`formSheet` card over the scaled-back app, Android back via `onRequestClose`. Swipe-to-dismiss isn't implemented. |
| Alert | Approximate | `UIAlertController` (side-by-side and stacked buttons, cancel/destructive styles) and AppCompat `AlertDialog` (neutral/negative/positive order). |
| Animated | Device-equivalent API | Timing, spring (React Native's analytical solver and config conversions), decay, composition, interpolation (numbers, colors, units), `Animated.event`. All run like the native driver. |
| LayoutAnimation | Stub | Completes immediately. |
| Platform APIs | Mixed | `Platform`, `Dimensions`, `PixelRatio`, `Appearance`, `PlatformColor`, `DynamicColorIOS`, `StatusBar`, `BackHandler` work. `Linking.openURL` opens a tab. `Keyboard`, `AppState`, `Share`, `Vibration` and `AccessibilityInfo` are stubs. |
| Status bar and chrome | Approximate | Drawn by the kits so screenshots compare to simulator captures. iOS 26 status bar layout details are approximate. |
| Devices | Mixed | iPhone 17 Pro, 17 Pro Max, SE and iPad Air 11" use published metrics. 16e, Pixel 9, Galaxy S25 and Pixel Tablet are marked approximate in their descriptors. |
| Libraries | Limited | `expo`, `expo-status-bar`, `react-native-safe-area-context` and `expo-linear-gradient` are provided. Pure-JS packages are prebundled. Packages that need native modules, ship Flow source, or deep-import `react-native/Libraries/...` won't work without a Mimicry implementation. |
| Navigation | Not yet | expo-router (file routes) isn't supported. React Navigation needs `react-native-screens` and `react-native-gesture-handler` shims. |
| Accessibility | Not yet | No accessibility tree is mirrored to the DOM yet (the inspector has the data). |
| Multi-touch | Not yet | — |

## Known differences that are intentional

- `Platform.OS` is really `'ios'` or `'android'`, and file extensions resolve per platform, so iOS and Android are two separate builds, as on device.
- On iOS, Text defaults to black even in dark mode. On Android it follows the theme's `textColorPrimary`. That is React Native's own behavior.
- `SafeAreaView` from `react-native` pads only on iOS. The `react-native-safe-area-context` shim pads on both platforms, as on device.

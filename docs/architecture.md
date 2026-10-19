# Architecture

Mimicry reimplements iOS and Android — their view systems, input, animation and services — as operating-system models on a small kernel, runs UI frameworks on top of them in a Web Worker, and streams pixels-to-be as binary draw commands to a thin host. The simulator is never in the loop at runtime.

![Studio](images/studio.png)

## Layers

Mimicry is built like a phone: a kernel and hardware at the bottom, an operating system on it, and UI frameworks as apps of that OS. Nothing below a layer knows about the layer above.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ framework adapters    React Native today · Lynx, NativeScript, Vector next   │
│   @mimicry/react-native-fabric  shadow tree, Yoga, mounting, touch handling  │
│   @mimicry/react-native         the `react-native` API, native modules       │
│   @mimicry/runtime              module linker, app runtime, adapter registry │
├──────────────────────────────────────────────────────────────────────────────┤
│ operating systems                                                            │
│   @mimicry/os-ios      UIKit · QuartzCore · Foundation                       │
│   @mimicry/os-android  android.view · widget · app · animation · androidx    │
├──────────────────────────────────────────────────────────────────────────────┤
│ @mimicry/os-core   kernel: frame loop, run loop, display & render server,     │
│                    render layers, text layout, fonts, images, storage,        │
│                    keyboard (text input), scroll kinetics, theme contract     │
├──────────────────────────────────────────────────────────────────────────────┤
│ @mimicry/protocol  the "GPU": binary frames of draw commands and layers       │
│ hosts              browser (Web Worker + canvas compositor) · Node headless   │
└──────────────────────────────────────────────────────────────────────────────┘
```

`@mimicry/device` boots a kernel with the OS its device descriptor names; a framework adapter then boots on that OS (see [adapters.md](adapters.md)).

### Kernel (`os-core`)

The kernel is what every simulated phone has regardless of its OS:

- **Frame loop.** Anything that changes the screen calls `setNeedsDisplay()` / `setNeedsLayout()`, which ask the host for a frame (`requestFrame`). The host's vsync replies with `frame(time)`; the kernel runs frame callbacks and animations (`Animator` frame tasks), the registered layout passes (UIKit's layoutSubviews pass, Android's traversals, React Native's Yoga), the before-paint hooks (mounting), then the **render server**, and transfers the frame. When nothing is live it stops asking.
- **Run loop.** `defer()` is "after this task" (main-queue async, a posted Handler message): a microtask in the browser, drained on virtual time by headless hosts.
- **Render layers.** `RenderLayer` is the retained tree both OSes draw through — CALayer on iOS, the RenderNode behind every Android View. A layer has a frame, a bounds origin (scroll offset), transform, opacity, z order, clip, and draws through `drawContent` / `drawOverlay` into a `LayerContext`.
- **Render server.** Walks the windows of the display. A layer with a transform, group opacity, `composited`, or scrolled content gets its own composited layer; everything else is recorded as self-contained items into the enclosing layer's chunks (tiled when large and the visible region is known). Chunks are hashed by content, so the host rasterizes only what changed and animating a layer property never re-rasters.
- **Services**: text layout (tokenizing, wrapping, ellipsis, hyphenation) over a `TextMeasurer`, fonts, the image decoder (the host decodes; consumers get sizes and load events), persistent storage, the keyboard (the host's editors bound to text fields by id), environment (device, orientation, appearance, font scale), and scroll kinetics shared by UIScrollView and ScrollView.
- **Input.** The digitizer's samples (`pointer`, `wheel`) go to whichever OS registered for them.

### Operating systems (`os-ios`, `os-android`)

Each OS models its platform's real API on the kernel, with the real names and behaviors, so a framework's native side can be written against it the way it is written against the real one:

- **iOS**: `CALayer` (background, corner radius / masked corners, border, shadow, contents, anchor point), `UIView` (frames, transforms, subviews, `draw(_:)`, `layoutSubviews`, hit testing, coordinate conversion, safe area, trait collections), `UIWindow` event delivery to gesture recognizers then the hit view, the gesture environment (should-begin, failure requirements, simultaneity, prevention, `cancelsTouchesInView`), the concrete recognizers, `UIScrollView`, `UIControl` and controls, `UIViewController` with containment and presentation, `UIApplication`, `UIScreen`, and SpringBoard's status bar window. See [os-ios.md](os-ios.md).
- **Android**: `View` (measure/layout, RenderNode properties, drawables, click and long click), `ViewGroup` (drawing order, `onInterceptTouchEvent`, touch targets, `requestDisallowInterceptTouchEvent`), `MotionEvent`, `Canvas`/`Paint`/`Path`, drawables including `RippleDrawable`, `WindowManager` and `ViewRootImpl` (input routing, traversals, insets), `Activity` with its window and `OnBackPressedDispatcher`, `ScrollView`, `SwitchCompat`, `ProgressBar`, `SharedPreferences`, and SystemUI's bars. Views measure in dp. See [os-android.md](os-android.md).

Look-and-feel tables — semantic colors, font stacks, control drawing, scroll physics, chrome — are each OS's theme (`theme.ts`), behind the `PlatformKit` contract in os-core; the fidelity loop edits those tables.

### React Native on the OS

`@mimicry/react-native-fabric` is React Native's native side, as Fabric is on device:

**Shadow tree and layout.** A `react-reconciler` host config in mutation mode. Every host element (`m-view`, `m-text`, `m-scroll`, …) becomes a `HostNode` with a Yoga node. Yoga is configured like React Native's (point scale factor = device scale, non-web defaults, compatibility errata). Layout runs in `resetAfterCommit`, before layout effects, so `ref.measure()` in `useLayoutEffect` sees real geometry; `onLayout` fires afterwards. Nested `<Text>` becomes attributed spans; inline views are laid out by the text.

**Mounting.** Each host node mounts as a view of the OS it runs on — on iOS `RCTViewComponentView` (a `UIView`), `RCTScrollViewComponentView` (a `UIScrollView`), `RCTSwitchComponentView` (a `UISwitch`), `RCTActivityIndicatorViewComponentView`, inside an `RCTSurfaceView` that is the root view controller's view; on Android `ReactViewGroup`, `ReactScrollView` / `ReactHorizontalScrollView`, `ReactSwitch` (a `SwitchCompat`) and a ProgressBar container inside a `ReactRootView` that is a `ReactActivity`'s content view. The mounting layer (`mounting/mounting.ts`) reconciles view structure after commits and pushes frames, transforms, opacity, z order and clipping before every frame, so Animated values and layout animations show without a commit. Component views draw React Native's box (shadows, backdrop materials, background, borders) and their kind's content (`mounting/draw.ts`).

**Touches.** On iOS, `RCTSurfaceTouchHandler` is a gesture recognizer on the surface that runs the Gesture Responder System; when a scroll view's pan begins, UIKit asks whether it can be prevented and it cancels the JS touches instead, as React Native does. The surface hit-tests with React Native's rules (pointerEvents, hitSlop, zIndex, overflow, text spans), so UIKit delivers each touch to the right view and its recognizers. On Android, the root view feeds gesture-handler's arena, lets the native views dispatch (a `ScrollView` intercepts past the slop and notifies the native gesture start), then runs the JS touch dispatcher. Switches press and toggle by their own touch tracking.

**Scrolling** belongs to the OS scroll views: their kinetics (drag, rubber band, momentum with the platform's deceleration, paging and snapping, indicators) move the bounds origin; React Native reads its props into them and turns their delegate callbacks into `onScroll` & co.

**Safe areas** follow UIKit's model (`layout/safe-area.ts`): the window's insets come from the device descriptor; containers add theirs with `additionalSafeAreaInsets`; views that pad themselves by their insets are resolved inside layout with an extra Yoga pass. Scroll views with `contentInsetAdjustmentBehavior` adjust their content inset the same way.

**Gestures.** `input/gestures/` implements react-native-gesture-handler's orchestrator: recognizers attached to host nodes run RNGH's state machine in an arena with simultaneous / require-to-fail / blocks relations. The arena sees every sample before a native scroll decides whether it may start, and an active gesture keeps scroll views from starting.

**Animation.** Animated values, Reanimated shared values, spinners and modal presentation are frame tasks on the kernel's animator. Animated writes resolved values onto host nodes as style overrides (like `useNativeDriver: true` for every animation), so React doesn't re-render per frame.

## Libraries: their JavaScript, Mimicry's native side

Real apps are mostly libraries. Mimicry runs each library's own published JavaScript (prebundled from the app's `node_modules`) and implements what that JavaScript expects from the platform:

```
 app code ─▶ expo-router ─▶ @react-navigation/native-stack ─▶ react-native-screens (JS)
                                                                 │ codegenNativeComponent('RNSScreenStack')
                                                                 ▼
                          @mimicry/react-native  native/registry ─▶ native/screens/stack.tsx
 expo-constants (JS) ── requireNativeModule('ExponentConstants') ─▶ native/expo-modules.ts
```

- **Native components** (`codegenNativeComponent`, `requireNativeComponent`, Expo's `requireNativeView`) resolve through `native/registry.ts` to React components written against Mimicry's primitives and the fabric: react-native-screens' stack, screens, navigation bars and tabs; react-native-svg's RNSVG* elements (`m-svg` nodes painted by `react-native-fabric/src/svg`); expo-image, expo-symbols, expo-blur and expo-glass-effect. An unknown native view renders its children in a plain view and logs one warning.
- **Native modules** (`TurboModuleRegistry`, `NativeModules`, Expo's `requireNativeModule`) are plain objects: Constants from the resolved app config, Device from the device descriptor, SplashScreen, FontLoader (custom fonts reach the worker, the host canvas and headless Node), Linking, WebBrowser, SystemUI and others. `expo-modules-core` itself is implemented natively.
- **Libraries whose native half is the point** — Reanimated (JSI worklets), react-native-worklets and Gesture Handler — are provided modules reimplemented on the fabric: shared values and animations run on the kernel's frame clock and write styles onto host nodes like the native driver; layout animations keep exiting nodes painted until they finish (`tree/exit.ts`).
- The compiler supplies what Metro would: expo-router's `require.context` over the app directory, `react-native/Libraries/…` deep imports, Flow stripping, assets registered with numeric ids, CSS as empty modules, and the app config.

## Frame loop

1. A React commit, an input event or an animation asks the kernel for a frame. The kernel sends one `requestFrame` message.
2. The host's `requestAnimationFrame` replies with `frame(time)`. The host's vsync is the clock.
3. The kernel runs app `requestAnimationFrame` callbacks and steps frame tasks — Animated, Reanimated, scroll kinetics (and so `onScroll` and `Animated.event`), control transitions, ripples, presentations — all in the same frame. It runs the layout passes if anything is dirty (the OS's, then Yoga), mounts, renders the layer tree and transfers the frame buffer.
4. The host composites. Chunks with known hashes are drawn from cached rasters, new ones are rasterized once. Native inputs are re-synced to their rectangles.

## Base and side modules

| | Base module | Side module |
| --- | --- | --- |
| Contains | kernel, OS models, React Native's fabric, React (dev), react-reconciler, react-refresh, Yoga (wasm), `react-native`, shims, linker | the app's files, one CommonJS record per file, plus a vendor bundle for third-party packages |
| Built by | esbuild, once per server start | SWC per file, cached by mtime |
| Identity | `base.<sha256>.js`, served immutable | records with dependency maps |
| On edit | untouched | changed records only, over SSE |

Each side-module record carries a dependency map (`'./Button' → 'src/Button.ios.tsx'`, `'react-native' → 'provided:react-native'`), so linking is a table lookup. Like Dactyl binding a side module's imports to the base's exports, `provided:*` resolves to the base's own instances: one React, one `react-native`. A hot update re-executes the changed modules up to the nearest React Refresh boundary, then `performReactRefresh()` swaps component implementations under the running tree with hook state preserved. If an update reaches the entry with no boundary, the app reloads. A successful refresh after an error dismisses the RedBox, as React Native does.

Switching between iOS and Android re-boots the worker with the other platform's module graph, because `*.ios.tsx` and `*.android.tsx` are different programs. Device, orientation and appearance changes are live.

## Testing loop

- **Headless sessions** (`@mimicry/testing`): `createDevice()` boots a bare device (kernel + OS) for tests that drive UIKit or the View system directly; `render(<App/>)` or `launch(projectDir)` on a virtual clock. Use `tap`, `drag`, `scroll`, `type`, `back` and `setEnvironment` to drive the app, `advance` and `settle` to move time, `screenshot` (device resolution) to capture, `layout()` for tree dumps, and `filmstrip()` for frame sequences with timed actions. Same inputs give the same pixels.
- **Goldens** (`tests/golden`) cover iOS, Android and iPad in light and dark.
- **Oracle** (`mimicry oracle`): renders scene files and diffs them against screenshots captured on real simulators and emulators by `scripts/capture-oracle.mjs`, then writes an HTML report. This is the Dactyl development loop: render, diff against the platform, fix the kit, repeat. `.github/workflows/oracle.yml` runs it for every example on an iOS simulator (macOS runner) and an Android emulator (Linux, KVM).
- **Motion oracle** (`mimicry oracle --motion`): `scripts/capture-motion.mjs` screen-records a scene's trigger on the device; Mimicry replays it at 60 fps on the virtual clock; both recordings are reduced to progress curves (how far each frame is from the motion's start to its end), which compares easing and timing independently of how the pixels look.
- Callbacks React Native delivers asynchronously (onLayout, cached image loads) go through the kernel's `defer()`: a microtask in the browser, drained inside `act()` by headless sessions so they land on virtual time.

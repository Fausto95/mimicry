# Framework adapters

A UI framework on a phone has two halves: JavaScript that runs in an engine (Hermes, PrimJS, V8, QuickJS…) and a native side written against the OS — UIKit and Core Animation on iOS, the View system on Android. Mimicry runs the first half unmodified and replaces the second: an **adapter** is a framework's native side re-written against Mimicry's OS models (`@mimicry/os-ios`, `@mimicry/os-android`) plus the runtime that loads the framework's JavaScript.

Because the OS models expose the platforms' own APIs, an adapter looks like the framework's real native code: React Native's adapter has an `RCTViewComponentView` that subclasses `UIView` and a `ReactScrollView` that extends `android.widget.ScrollView`. Nothing in `os-core`, `os-ios` or `os-android` knows about any framework.

## The contract

```ts
// @mimicry/os-core — adapter.ts
interface FrameworkAdapter<Bundle, Update> {
  id: string;                       // 'react-native' | 'lynx' | 'nativescript' | 'vector'
  displayName: string;
  platforms: readonly ('ios' | 'android')[];
  boot(os: OperatingSystem, host: AdapterHost): Promise<FrameworkInstance<Bundle, Update>>;
}

interface FrameworkInstance<Bundle, Update> {
  start(bundle: Bundle): void;
  reload(bundle?: Bundle): void;
  hotUpdate(update: Update): 'refreshed' | 'reload';
  capabilities(): Record<string, CapabilityLevel>;
  destroy(): void;
}
```

A host boots a device and hands it to the adapter the app's bundle names:

```ts
const { kernel, os } = bootDevice({ measurer, clock, environment, send, … }); // @mimicry/device
const adapter = adapters.get(bundle.framework ?? 'react-native');
const app = await adapter.boot(os, { timers });
app.start(bundle);
```

`os` is an `IOS` (with `application: UIApplication`, `statusBar`) or an `Android` (with `windowManager`, `context`, `systemUI`). Everything an adapter needs beyond the OS APIs comes from the kernel (`os.kernel`): the frame loop (`addLayoutPass`, `addBeforePaint`, `addBeforeInput`, `requestFrame`, `defer`), the animator and clock, fonts, images, storage, the keyboard (`textInput`), the environment, and host messages (`on('inspect' | 'query' | …)`) for inspection and test queries.

An adapter is usually three packages' worth of code:

| Piece | What it is | React Native's |
| --- | --- | --- |
| native side | the framework's renderer / UI manager / view managers, written against UIKit and the View system | `@mimicry/react-native-fabric` |
| runtime | loads the compiled app, provides the framework's JS modules and native modules, hot updates | `@mimicry/runtime` (`AppRuntime`, module linker), `@mimicry/react-native` |
| compiler preset | how app sources become a bundle (entry, resolution, transforms, assets) | `@mimicry/compiler` (Metro's job: platform extensions, Flow, require.context, assets) |

## React Native (implemented)

- **Shadow tree → views.** React's reconciler builds `HostNode`s laid out by Yoga; the mounting layer mounts them as OS views and pushes geometry and layer properties every frame (`mounting/`). iOS: `RCTSurfaceView` (root view controller's view) holding `RCTViewComponentView`, `RCTScrollViewComponentView` (`UIScrollView`), `RCTSwitchComponentView` (`UISwitch`), `RCTActivityIndicatorViewComponentView`. Android: `ReactActivity` → `ReactRootView` holding `ReactViewGroup`, `ReactScrollView` / `ReactHorizontalScrollView`, `ReactSwitch` (`SwitchCompat`), ProgressBar container.
- **Touches.** iOS: `RCTSurfaceTouchHandler`, a `UIGestureRecognizer` that drives the responder system and cancels JS touches when a scroll view's pan begins (`canBePreventedByGestureRecognizer`). Android: the root view's `dispatchTouchEvent` feeds the gesture-handler arena, lets native views dispatch (ScrollView intercepts), then runs the JS touch dispatcher; `notifyNativeGestureStarted` cancels JS.
- **Native modules / components** of libraries (screens, SVG, Expo modules, Reanimated, Gesture Handler) are implemented in `@mimicry/react-native` and the fabric.

## Lynx (sketch)

Lynx's JavaScript (ReactLynx on the background thread, the main-thread script) talks to its engine through the **Element PAPI**: `__CreatePage`, `__CreateView` / `__CreateText` / `__CreateImage` / `__CreateScrollView`, `__AppendElement`, `__InsertElementBefore`, `__RemoveElement`, `__SetAttribute`, `__SetInlineStyles`, `__AddClass` / `__SetClasses` with CSS, `__AddEvent`, `__FlushElementTree`.

- **Native side**: an element tree (like `HostNode`) with Lynx's CSS cascade and its layout engine (Starlight: flex, grid, linear, relative) — Yoga covers the flex subset to start with. On flush, mount elements as `LynxUI` views: `UIView` / `android.view.ViewGroup` subclasses drawing Lynx's box model (the shared CSS box painter in os-core already draws backgrounds, borders, radii, shadows, gradients), `<text>` with os-core text layout, `<image>` through the kernel's image service, `<scroll-view>` / `<list>` on `UIScrollView` / `ScrollView`.
- **Events**: Lynx's touch model (`bindtap`, `catchtap`, `bindtouchstart`, …, capture/bubble with `catch` stopping propagation) on top of the OS's delivery — an iOS gesture recognizer on the root view like React Native's, the Android root's `dispatchTouchEvent`.
- **Runtime**: two JS contexts (main thread and background thread) — two module scopes in the worker, with Lynx's cross-thread calls as queued messages.
- **Compiler preset**: rspeedy/rspack's output (a `.lynx.bundle` of templates, CSS and JS) or compiling the app sources with the same transforms.

## NativeScript (sketch)

NativeScript has almost no native side of its own: its JavaScript calls the platform APIs directly through metadata-generated bindings (`UIView.alloc().initWithFrame(CGRectMake(…))`, `new android.widget.TextView(context)`, `NSObject.extend({...})`, `java.lang.Object.extend(...)`). `@nativescript/core` builds its views (`Label`, `Button`, `ListView`, layouts) out of those calls.

- **Native side**: a binding layer that exposes `os-ios` and `os-android` classes under their native names — ObjC selector-style methods (`initWithFrame`, `setTitleForState`, `addSubview`), Java-style classes in the `android.*` / `androidx.*` namespaces, `interop` types, `NSObject.extend` / `.extend()` subclassing with protocol and interface implementations. This is why the OS models keep the platforms' real names, behaviors and units.
- **Layout**: NativeScript measures and lays out its own layouts (`StackLayout`, `GridLayout`, …) through `onMeasure` / `onLayout` on Android and `UIView` frames on iOS — the OS models' measure and layout passes are what it drives.
- **Runtime**: `@nativescript/core` and the app bundled by its webpack preset, run with the bindings installed as globals.
- **Gaps to close first**: the API surface `@nativescript/core` touches (UIKit/Android classes listed in its `ui/` and `utils/` modules) must exist in the OS models.

## Vector (sketch)

Vector's kernel (TypeScript on Hermes) never touches views: it sends **one typed batch per job** through `__vectorHostCommit` — an `ArrayBuffer` of mutation records addressing views by number (create view of kind, set prop, insert child, remove, layout results) — and receives events as `(handle, event, payload)` with a JSON payload. Its C++ host decodes the batch, lays out with a Taffy port, and the per-platform renderers (`VectorIOSRenderer` on UIKit, the Android Views renderer) apply props through per-concern property tables generated from `src/protocol/manifest.ts`.

- **Native side**: implement `__vectorHostCommit` and the other host functions (`__vectorHostLog`, timers, modules, motion bindings) in the adapter: decode the mutation batch exactly as Vector's C++ does (validated once), keep a view table by handle, and apply records with renderers written against `os-ios` / `os-android` — mirroring `native/ios/Renderer` and Vector's Android renderer one-to-one, property table by property table.
- **Layout**: Vector's layout runs natively (a Taffy flexbox port with Taffy's fixture suite); the adapter would port it (or start with Yoga behind the same records).
- **Motion**: Vector runs motion bindings on the UI thread; the adapter registers them as kernel frame tasks driving view properties, which is what the UI-thread kernel does on device.
- **Runtime**: the kernel's `dist/kernel/bootstrap.js` plus the app bundle (Rolldown output), evaluated in a scope with the host functions installed, with Live Patch mapped onto hot updates.

## Writing a new adapter

1. Read the framework's native code for one platform and list the OS APIs it uses. Missing ones go into the OS models first (with tests in `packages/os-*/test` using `createDevice()`), not into the adapter.
2. Implement the native side against the OS models, keeping the framework's own class names and structure, so its native code is the reference.
3. Implement `FrameworkAdapter` and register it with the host's `AdapterRegistry` (the browser worker in `@mimicry/runtime`, `launch()` in `@mimicry/testing`), and give the compiler a preset that tags bundles with the adapter's `framework` id.
4. Add the framework's examples to `examples/` with scenes, so the oracle compares them against real simulators.

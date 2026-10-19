# os-android

`@mimicry/os-android` is a simulated Android framework written in TypeScript: the
`android.*`, `androidx.*` and Material Components classes an app (or React Native's
Android renderer) drives, running on the os-core kernel. Views draw into os-core
`RenderLayer`s through `onDraw(Canvas)` / `ctx.item`, time comes from the kernel's
animator and virtual clock, and storage, images and fonts come from kernel services.
There is no Java, no Skia and no real timer anywhere: everything is deterministic on
the virtual clock, so a test can `advance(ms)` and screenshot pixel-exact frames.

`packages/os-android/test/screens.test.ts` composes two whole Material 3 screens (an
inbox, and a dark settings screen with a dialog) and writes them to
`artifacts/os-android/*.png` for review.

## What is modeled

- **Views.** `View` / `ViewGroup` with measure/layout/draw, RenderNode-backed
  transforms, touch dispatch, drawable state, outlines and elevation shadows,
  `ViewPropertyAnimator`, window insets and fits-system-windows padding. `FrameLayout`
  and `LinearLayout` (gravity, margins, weights, dividers) follow the framework's
  measuring rules.
- **Animation.** The `android.animation` package on a per-kernel `AnimationHandler`
  driven by kernel frames, with the framework's timing (start delay, repeat, reverse,
  float fractions), every platform interpolator plus Material motion tokens, and
  AndroidX `SpringAnimation` / `FlingAnimation`.
- **Text.** `Typeface` with Roboto metrics, `TextPaint`, spans, `StaticLayout`
  (line breaking, ellipsizing, include-pad, spacing, alignment), `TextUtils`,
  `TextView` with M3 text appearances, links and compound drawables.
- **Images.** `Bitmap`, `BitmapFactory`, `BitmapDrawable`, `Matrix`, `ImageView`
  (every `ScaleType`, image matrix, `adjustViewBounds`, tint), Material Symbols icons
  as drawables, and simple `VectorDrawable` paths.
- **Material 3.** Theme color roles (light and dark), shape, ripples and state layers,
  and the components listed below, measured and colored per the M3 specs.
- **App structure.** `Activity` lifecycle, `PhoneWindow` / decor view, edge to edge,
  `OnBackPressedDispatcher`, `Fragment` / `FragmentManager` with back stack and Material
  transitions, `Dialog` / `AlertDialog` windows.
- **System.** `SharedPreferences` on kernel storage, `WindowInsets` and the AndroidX
  compat layer, `WindowInsetsController` driving SystemUI's bars, configuration
  changes, `Build`, `Vibrator`, `ClipboardManager`.
- **Accessibility.** Property plumbing only: values are stored and resolved like the
  framework does, but no accessibility service reads them.

## Implemented APIs

| Area | Classes |
| --- | --- |
| `android.view` | `View` (+ `ALPHA`, `TRANSLATION_X`... properties, `animate()`, outlines, elevation, layer types, insets, haptics, accessibility properties, `onConfigurationChanged`), `ViewGroup`, `MeasureSpec`, `LayoutParams`, `MarginLayoutParams`, `Gravity`, `ViewOutlineProvider`, `Outline`, `MotionEvent`, `ViewConfiguration`, `WindowInsets`, `WindowManager`, `Menu` / `MenuItem`, `HapticFeedbackConstants` |
| `android.widget` | `FrameLayout`, `LinearLayout`, `TextView`, `ImageView`, `CompoundButton`, `ProgressBar` (circular and horizontal), `SeekBar`, `ScrollView`, `HorizontalScrollView`, `Toast`, `PopupMenu`, `RadioGroup` |
| `android.animation` / `android.view.animation` | `ValueAnimator`, `ObjectAnimator`, `AnimatorSet` (+ `Builder`), `TimeAnimator`, `PropertyValuesHolder`, `Keyframe`, `IntEvaluator`, `FloatEvaluator`, `ArgbEvaluator`, `AnimatorListenerAdapter`, all platform interpolators, `PathInterpolator`, `AnimationUtils`, `ViewPropertyAnimator` |
| `androidx.dynamicanimation` | `SpringAnimation`, `SpringForce`, `FlingAnimation`, `FloatValueHolder` |
| `androidx.interpolator`, Material motion | `FastOutSlowInInterpolator`, `LinearOutSlowInInterpolator`, `FastOutLinearInInterpolator`, `MaterialMotion` easing and duration tokens |
| `android.graphics` | `Canvas`, `Paint`, `Path` (recorded segments), `RectF`, `Color`, `Matrix`, `Bitmap`, `BitmapFactory`, drawables (`ColorDrawable`, `GradientDrawable`, `BitmapDrawable`, `RippleDrawable`, `VectorDrawable`, `MaterialIconDrawable`) |
| `android.text` / `android.util` | `Typeface`, `TextPaint`, `SpannableString`, `SpannableStringBuilder`, character and paragraph spans, `StaticLayout` (+ `Builder`), `Layout.Alignment`, `TextUtils`, `TypedValue`, `Property` / `FloatProperty` |
| `android.content` | `Context`, `Resources`, `Configuration`, `ActivityInfo` (config bits), `Theme`, `ColorStateList`, `SharedPreferences`, `PreferenceManager`, `ClipboardManager`, `ClipData` |
| `android.os` | `Looper`, `Build`, `Build.VERSION`, `VERSION_CODES`, `Vibrator`, `VibratorManager`, `VibrationEffect` |
| `android.app` | `Activity` (lifecycle, `recreate`, `configChanges`), `PhoneWindow`, `WindowInsetsController`, `Dialog`, `AlertDialog` (+ `Builder`) |
| `androidx.fragment` | `Fragment`, `FragmentManager`, `FragmentTransaction`, `FragmentContainerView` |
| `androidx.core` / `androidx.activity` | `ViewCompat`, `WindowCompat`, `WindowInsetsCompat`, `WindowInsetsControllerCompat`, `ContextCompat`, `ResourcesCompat`, `EdgeToEdge`, `AppCompatDelegate` |
| `androidx.recyclerview` | `RecyclerView`, `Adapter`, `ViewHolder`, `RecycledViewPool`, `LinearLayoutManager`, `GridLayoutManager`, `DividerItemDecoration`, `MaterialDividerItemDecoration` |
| `androidx.coordinatorlayout` | `CoordinatorLayout`, `Behavior`, `ScrollingViewBehavior`, FAB behavior (moves above snackbars) |
| Material buttons and selection | `Button`, `MaterialButton` (filled, tonal, elevated, outlined, text, icon styles), `ImageButton`, `CheckBox`, `RadioButton`, `MaterialSwitch`, `SwitchCompat`, `Chip`, `ChipGroup`, `Slider` |
| Material containers and feedback | `MaterialCardView`, `CardView`, `MaterialDivider`, `FloatingActionButton`, `ExtendedFloatingActionButton`, `LinearProgressIndicator`, `CircularProgressIndicator`, `Snackbar`, `MaterialAlertDialogBuilder` |
| Material app bars | `Toolbar`, `MaterialToolbar` (navigation, title, actions, overflow menu), `AppBarLayout` (lift on scroll), `BottomNavigationView` / `NavigationBarView` (badges, active indicator) |
| Theme | M3 baseline light and dark color roles, theme overlays (`applyColors`), `TextAppearance` type scale, `MaterialColors`, shape corner tokens |

## Behavior notes

- **Edge to edge by default.** As on Android 15, the decor view does not fit system
  windows: content draws under the bars and reads them from insets.
  `WindowCompat.setDecorFitsSystemWindows(window, true)` pads the content instead.
  Hidden bars (`WindowInsetsControllerCompat.hide`) drop their insets and SystemUI
  stops drawing them.
- **Bar appearance.** SystemUI follows the top application window: an explicit
  light-status-bar / light-navigation-bar appearance wins; otherwise the window theme
  decides (light icons in night mode), unless React Native's `StatusBar` set a bar
  style on the kernel.
- **SharedPreferences** live in kernel storage under the namespace
  `shared_prefs:<name>`, one key per preference, stored as `{"type","value"}` JSON so
  types survive a reload. Reading a value as the wrong type throws
  `ClassCastException`. `apply()` and `commit()` both write straight away.
- **Configuration changes** (night mode from the system or `AppCompatDelegate`,
  orientation, screen size, font scale) reach `Activity.onConfigurationChanged` and
  every view's `onConfigurationChanged`. An activity handles every change by default,
  as React Native's `MainActivity` declares in `android:configChanges`; one that narrows
  `configChanges` is recreated, with `onSaveInstanceState` handed back to `onCreate`.
- **Build** reads `SDK_INT` from the device descriptor's `osVersion` (36 on Pixel 9).

## Deliberate deviations

- **Units are dp.** Layout, drawing and `MotionEvent` coordinates are in
  density-independent pixels, not physical pixels. `DisplayMetrics` reports the real
  density, `Resources.getDimensionPixelSize` returns whole pixels, and
  `TypedValue.applyDimension` converts to dp (the unit views use) rather than to px.
- **No item animations in RecyclerView.** Changes rebind in place. Children are laid
  out in content coordinates and the scroll is a translation of the content layer, so
  `getTop()` of a child is relative to the content, not to the visible viewport.
- **3D rotation.** `rotationX` / `rotationY` are stored and animatable but draw as 2D
  (the compositor is affine).
- **Text.** `ScaleXSpan`, `SuperscriptSpan` and `SubscriptSpan` are recorded but do not
  change rendering (os-core text has no baseline shift); middle ellipsis falls back to
  end ellipsis; `BREAK_STRATEGY_HIGH_QUALITY` uses balanced greedy breaking rather than
  Minikin's optimal breaker.
- **Bitmaps decode asynchronously.** `BitmapFactory` returns a bitmap whose pixels
  arrive when the kernel's image store loads them (`device.ready()` in tests).
- **Toast** has no app icon; **Snackbar** has no swipe to dismiss.
- **Recreate** reruns `onCreate` on the same activity instance with a new window, and
  fragments are not restored from saved state.
- **Vibrator** records requests in `history`; nothing vibrates. **ClipboardManager** is in
  memory, one per device, and never touches the host clipboard.
- **Accessibility** is properties only: `importantForAccessibility` (with ancestors
  hiding descendants), content and state descriptions (compound buttons default to
  "Checked" / "Not checked", switches to "On" / "Off"), heading, pane title, live
  region, `labelFor`, tooltip and class names. `announceForAccessibility` is dropped.

## Not modeled yet

`DrawerLayout`, `TabLayout`, `CollapsingToolbarLayout`, `BottomSheetDialog`, `EditText`
(text input belongs to the React Native layer and the kernel's text input service),
`ViewPager2`, and RecyclerView `ItemAnimator` / `ItemTouchHelper`.

## Tests

`packages/os-android/test` covers each area against `createDevice({ device: 'pixel-9' })`
with behavior and pixel assertions: `animation`, `layout`, `text`, `images`, `widgets`,
`recycler-view`, `dialogs`, `fragments`, `app-bars`, `system` and `screens`.

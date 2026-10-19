import type { Kernel } from '@mimicry/os-core';
import { ActivityInfo, Context, type Configuration } from '../content/context';
import { AppCompatDelegate } from '../content/theme';
import { Color } from '../graphics/color';
import { ColorDrawable } from '../graphics/drawable';
import { LayoutParams, View } from '../view/view';
import { FrameLayout } from '../view/view-group';
import { WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';
import { WindowInsetsType, type WindowInsets } from '../view/window-insets';
import { FragmentManager } from './fragment';

/**
 * android.app.Activity and its PhoneWindow: the decor view (a FrameLayout
 * whose content frame, android.R.id.content, holds setContentView's view),
 * window colors and system bar appearance, lifecycle callbacks and the
 * OnBackPressedDispatcher.
 */
export const R_ID_CONTENT = 0x01020002;

export class OnBackPressedCallback {
  constructor(public isEnabled: boolean, private readonly handler: () => void) {}
  handleOnBackPressed(): void {
    this.handler();
  }
  remove(): void {
    this.dispatcher?.remove(this);
  }
  /** @internal */
  dispatcher: OnBackPressedDispatcher | null = null;
}

export class OnBackPressedDispatcher {
  private readonly callbacks: OnBackPressedCallback[] = [];

  constructor(private readonly fallback: () => void) {}

  addCallback(callback: OnBackPressedCallback): void {
    callback.dispatcher = this;
    this.callbacks.push(callback);
  }

  remove(callback: OnBackPressedCallback): void {
    const at = this.callbacks.indexOf(callback);
    if (at >= 0) this.callbacks.splice(at, 1);
  }

  hasEnabledCallbacks(): boolean {
    return this.callbacks.some((c) => c.isEnabled);
  }

  onBackPressed(): void {
    for (let i = this.callbacks.length - 1; i >= 0; i--) {
      const c = this.callbacks[i]!;
      if (c.isEnabled) {
        c.handleOnBackPressed();
        return;
      }
    }
    this.fallback();
  }
}

/**
 * android.view.WindowInsetsController: the system bars' appearance (light
 * bars = dark icons) and visibility for one window. SystemUI follows the
 * appearance of the top window that set one; until then it follows the
 * status bar state frameworks set (React Native's StatusBar).
 */
export class WindowInsetsController {
  static readonly APPEARANCE_LIGHT_STATUS_BARS = 8;
  static readonly APPEARANCE_LIGHT_NAVIGATION_BARS = 16;
  static readonly BEHAVIOR_DEFAULT = 1;
  static readonly BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE = 2;
  private appearance = 0;
  /** which appearance bits the app has set */
  private appearanceMask = 0;
  private hidden = 0;
  private behavior = WindowInsetsController.BEHAVIOR_DEFAULT;

  constructor(private readonly onChange: () => void, private readonly onVisibility: () => void = () => {}) {}

  setSystemBarsAppearance(appearance: number, mask: number): void {
    this.appearance = (this.appearance & ~mask) | (appearance & mask);
    this.appearanceMask |= mask;
    this.onChange();
  }

  getSystemBarsAppearance(): number {
    return this.appearance;
  }

  /** @internal the appearance bits the app chose (0: none, follow the defaults) */
  getAppearanceMask(): number {
    return this.appearanceMask;
  }

  /** Hide system bars (WindowInsets.Type masks): their insets go to 0 and SystemUI stops drawing them. */
  hide(types: number): void {
    this.hidden |= types;
    this.onVisibility();
    this.onChange();
  }

  show(types: number): void {
    this.hidden &= ~types;
    this.onVisibility();
    this.onChange();
  }

  /** @internal hidden inset types */
  getHiddenTypes(): number {
    return this.hidden;
  }

  setSystemBarsBehavior(behavior: number): void {
    this.behavior = behavior;
  }

  getSystemBarsBehavior(): number {
    return this.behavior;
  }
}

const windowsByDecor = new WeakMap<View, PhoneWindow>();

export class PhoneWindow {
  readonly decorView: FrameLayout;
  readonly contentParent: FrameLayout;
  private statusBarColor: number = Color.TRANSPARENT;
  private navigationBarColor: number = Color.TRANSPARENT;
  readonly insetsController: WindowInsetsController;
  /** Android 15 draws apps edge to edge: the content goes under the system bars. */
  private decorFits = false;
  /** @internal set when the window is added: re-sends the window its insets */
  refreshInsets: () => void = () => {};

  constructor(context: Context, onAppearance: () => void) {
    this.decorView = new FrameLayout(context);
    this.contentParent = new FrameLayout(context);
    this.contentParent.setId(R_ID_CONTENT);
    this.decorView.addView(this.contentParent, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    this.insetsController = new WindowInsetsController(onAppearance, () => this.refreshInsets());
    windowsByDecor.set(this.decorView, this);
    this.decorView.setOnApplyWindowInsetsListener((_v, insets) => {
      if (!this.decorFits) {
        this.contentParent.setPadding(0, 0, 0, 0);
        return insets;
      }
      // the pre-edge-to-edge window: content padded clear of the bars, which it never sees
      const bars = insets.getInsets(WindowInsetsType.systemBars() | WindowInsetsType.displayCutout());
      this.contentParent.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return insets.consumeSystemWindowInsets();
    });
  }

  /** @internal the window whose decor view this is */
  static forDecorView(view: View): PhoneWindow | null {
    return windowsByDecor.get(view) ?? null;
  }

  getDecorView(): FrameLayout {
    return this.decorView;
  }

  getInsetsController(): WindowInsetsController {
    return this.insetsController;
  }

  /** WindowCompat.setDecorFitsSystemWindows: false (the default) draws edge to edge. */
  setDecorFitsSystemWindows(fits: boolean): void {
    this.decorFits = fits;
    this.decorView.requestApplyInsets();
  }

  getDecorFitsSystemWindows(): boolean {
    return this.decorFits;
  }

  /** @internal the insets this window receives (hidden bars removed) */
  filterInsets(insets: WindowInsets): WindowInsets {
    const hidden = this.insetsController.getHiddenTypes();
    return hidden ? insets.withHidden(hidden) : insets;
  }

  setBackgroundDrawable(drawable: ColorDrawable | null): void {
    this.decorView.setBackground(drawable);
  }

  setStatusBarColor(color: number): void {
    this.statusBarColor = color;
  }

  getStatusBarColor(): number {
    return this.statusBarColor;
  }

  setNavigationBarColor(color: number): void {
    this.navigationBarColor = color;
  }

  getNavigationBarColor(): number {
    return this.navigationBarColor;
  }
}

/** Lifecycle.State values, aligned with the fragment states. */
export const LifecycleState = {
  DESTROYED: -2,
  INITIALIZED: -1,
  CREATED: 1,
  STARTED: 5,
  RESUMED: 7,
} as const;

export class Activity extends Context {
  private window: PhoneWindow | null = null;
  readonly onBackPressedDispatcher: OnBackPressedDispatcher;
  private finished = false;
  private lifecycleState: number = LifecycleState.INITIALIZED;
  private fragments: FragmentManager | null = null;
  private configuration: Configuration | null = null;
  private stopWatchingConfiguration: (() => void) | null = null;
  /**
   * android:configChanges: the changes this activity handles itself in
   * onConfigurationChanged. Any other change recreates it. Everything by
   * default, as React Native's MainActivity declares; set it to 0 for the
   * framework default of recreating on every change.
   */
  protected configChanges: number = Object.values(ActivityInfo).reduce((a, b) => a | b, 0);

  constructor(kernel: Kernel, private readonly windowManager: WindowManager) {
    super(kernel);
    this.onBackPressedDispatcher = new OnBackPressedDispatcher(() => this.finish());
  }

  getWindow(): PhoneWindow {
    if (!this.window) this.window = new PhoneWindow(this, () => this.kernel.setNeedsDisplay());
    return this.window;
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  getOnBackPressedDispatcher(): OnBackPressedDispatcher {
    return this.onBackPressedDispatcher;
  }

  /** Start the activity: create its window, run onCreate/onStart/onResume, show it. */
  launch(savedInstanceState: Record<string, unknown> | null = null): void {
    const window = this.getWindow();
    this.configuration = this.getResources().getConfiguration();
    this.onCreate(savedInstanceState);
    this.moveTo(LifecycleState.CREATED);
    const record = this.windowManager.addView(window.decorView, new WindowLayoutParams(WindowType.TYPE_BASE_APPLICATION), () => {
      this.onBackPressed();
      return true;
    });
    record.insetsFilter = (insets) => window.filterInsets(insets);
    window.refreshInsets = () => this.windowManager.refreshInsets(window.decorView);
    window.refreshInsets();
    this.onStart();
    this.moveTo(LifecycleState.STARTED);
    this.onResume();
    this.moveTo(LifecycleState.RESUMED);
    this.watchConfiguration();
  }

  /** Configuration changes come from the environment (rotation, dark mode, font scale) and AppCompatDelegate's night mode. */
  private watchConfiguration(): void {
    const check = (): void => this.configurationMaybeChanged();
    const unsubscribeEnv = this.kernel.env.subscribe(check);
    const unsubscribeNight = AppCompatDelegate.onNightModeChanged(this.kernel, check);
    this.stopWatchingConfiguration = () => {
      unsubscribeEnv();
      unsubscribeNight();
      this.stopWatchingConfiguration = null;
    };
  }

  private configurationMaybeChanged(): void {
    const previous = this.configuration;
    if (!previous || this.finished) return;
    const next = this.getResources().getConfiguration();
    const changes = next.diff(previous);
    if (changes === 0) return;
    if (changes & ~this.configChanges) {
      this.recreate();
      return;
    }
    this.configuration = next;
    this.onConfigurationChanged(next);
    this.window?.decorView.dispatchConfigurationChanged(next);
    this.kernel.setNeedsDisplay();
  }

  /** The configuration the activity last saw. */
  getConfiguration(): Configuration {
    return this.configuration ?? this.getResources().getConfiguration();
  }

  /** A configuration change this activity handles itself (see configChanges). */
  onConfigurationChanged(_newConfig: Configuration): void {}

  /** Save state across recreate(); handed back to onCreate. */
  protected onSaveInstanceState(_outState: Record<string, unknown>): void {}

  /**
   * Tear the activity down and create it again with fresh resources.
   * Deviation: the same instance runs onCreate again with a new window,
   * and fragments are not restored from saved state.
   */
  recreate(): void {
    const state: Record<string, unknown> = {};
    this.onSaveInstanceState(state);
    this.stopWatchingConfiguration?.();
    this.moveTo(LifecycleState.STARTED);
    this.onPause();
    this.moveTo(LifecycleState.CREATED);
    this.onStop();
    this.moveTo(LifecycleState.DESTROYED);
    this.onDestroy();
    this.fragments = null;
    if (this.window) this.windowManager.removeView(this.window.decorView);
    this.window = null;
    this.lifecycleState = LifecycleState.INITIALIZED;
    this.launch(state);
  }

  private moveTo(state: number): void {
    this.lifecycleState = state;
    this.fragments?.dispatchState(state);
  }

  /** The activity's Lifecycle.State (LifecycleState). */
  getLifecycleState(): number {
    return this.lifecycleState;
  }

  /** The FragmentManager of this (Fragment)Activity. */
  getSupportFragmentManager(): FragmentManager {
    if (!this.fragments) {
      this.fragments = new FragmentManager(this);
      this.fragments.dispatchState(this.lifecycleState);
    }
    return this.fragments;
  }

  protected onCreate(_savedInstanceState: unknown): void {}
  protected onStart(): void {}
  protected onResume(): void {}
  protected onPause(): void {}
  protected onStop(): void {}
  protected onDestroy(): void {}

  setContentView(view: View): void {
    const content = this.getWindow().contentParent;
    content.removeAllViews();
    content.addView(view, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  findViewById<T extends View = View>(id: number): T | null {
    return this.getWindow().decorView.findViewById<T>(id);
  }

  onBackPressed(): void {
    this.onBackPressedDispatcher.onBackPressed();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.moveTo(LifecycleState.STARTED);
    this.onPause();
    this.moveTo(LifecycleState.CREATED);
    this.onStop();
    this.moveTo(LifecycleState.INITIALIZED);
    this.onDestroy();
    this.moveTo(LifecycleState.DESTROYED);
    this.stopWatchingConfiguration?.();
    this.kernel.warnOnce('activity-finish', 'Back pressed with no handler (the app would exit).');
  }

  isFinishing(): boolean {
    return this.finished;
  }

  runOnUiThread(action: () => void): void {
    action();
  }
}

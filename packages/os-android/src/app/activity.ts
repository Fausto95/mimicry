import type { Kernel } from '@mimicry/os-core';
import { Context } from '../content/context';
import { Color } from '../graphics/color';
import { ColorDrawable } from '../graphics/drawable';
import { LayoutParams, View } from '../view/view';
import { FrameLayout } from '../view/view-group';
import { WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';
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

export class WindowInsetsController {
  static readonly APPEARANCE_LIGHT_STATUS_BARS = 8;
  static readonly APPEARANCE_LIGHT_NAVIGATION_BARS = 16;
  private appearance = 0;

  constructor(private readonly onChange: () => void) {}

  setSystemBarsAppearance(appearance: number, mask: number): void {
    this.appearance = (this.appearance & ~mask) | (appearance & mask);
    this.onChange();
  }

  getSystemBarsAppearance(): number {
    return this.appearance;
  }
}

export class PhoneWindow {
  readonly decorView: FrameLayout;
  readonly contentParent: FrameLayout;
  private statusBarColor: number = Color.TRANSPARENT;
  private navigationBarColor: number = Color.TRANSPARENT;
  readonly insetsController: WindowInsetsController;

  constructor(context: Context, onAppearance: () => void) {
    this.decorView = new FrameLayout(context);
    this.contentParent = new FrameLayout(context);
    this.contentParent.setId(R_ID_CONTENT);
    this.decorView.addView(this.contentParent, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    this.insetsController = new WindowInsetsController(onAppearance);
  }

  getDecorView(): FrameLayout {
    return this.decorView;
  }

  getInsetsController(): WindowInsetsController {
    return this.insetsController;
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
  launch(): void {
    const window = this.getWindow();
    this.onCreate(null);
    this.moveTo(LifecycleState.CREATED);
    this.windowManager.addView(window.decorView, new WindowLayoutParams(WindowType.TYPE_BASE_APPLICATION), () => {
      this.onBackPressed();
      return true;
    });
    this.onStart();
    this.moveTo(LifecycleState.STARTED);
    this.onResume();
    this.moveTo(LifecycleState.RESUMED);
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
    this.kernel.warnOnce('activity-finish', 'Back pressed with no handler (the app would exit).');
  }

  isFinishing(): boolean {
    return this.finished;
  }

  runOnUiThread(action: () => void): void {
    action();
  }
}

import type { Context } from '../content/context';
import type { ColorStateList } from '../content/color-state-list';
import type { Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Typeface } from '../text/typeface';
import { View } from '../view/view';
import { WindowInsets, WindowInsetsType } from '../view/window-insets';
import { WindowInsetsController, type Activity, type PhoneWindow } from '../app/activity';

/**
 * androidx.core: ViewCompat, WindowCompat, WindowInsetsCompat,
 * WindowInsetsControllerCompat, ContextCompat and ResourcesCompat, plus
 * androidx.activity's EdgeToEdge — thin layers over the framework classes,
 * as on a recent API level where the compat paths call straight through.
 */
export class WindowInsetsCompat extends WindowInsets {
  static readonly Type = WindowInsetsType;
  static override readonly CONSUMED = WindowInsets.CONSUMED;

  static toWindowInsetsCompat(insets: WindowInsets): WindowInsets {
    return insets;
  }
}

export type OnApplyWindowInsetsListener = (view: View, insets: WindowInsets) => WindowInsets;

export const ViewCompat = {
  IMPORTANT_FOR_ACCESSIBILITY_AUTO: View.IMPORTANT_FOR_ACCESSIBILITY_AUTO,
  IMPORTANT_FOR_ACCESSIBILITY_YES: View.IMPORTANT_FOR_ACCESSIBILITY_YES,
  IMPORTANT_FOR_ACCESSIBILITY_NO: View.IMPORTANT_FOR_ACCESSIBILITY_NO,
  IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS: View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS,
  ACCESSIBILITY_LIVE_REGION_NONE: View.ACCESSIBILITY_LIVE_REGION_NONE,
  ACCESSIBILITY_LIVE_REGION_POLITE: View.ACCESSIBILITY_LIVE_REGION_POLITE,
  ACCESSIBILITY_LIVE_REGION_ASSERTIVE: View.ACCESSIBILITY_LIVE_REGION_ASSERTIVE,

  setOnApplyWindowInsetsListener(view: View, listener: OnApplyWindowInsetsListener | null): void {
    view.setOnApplyWindowInsetsListener(listener);
  },
  getRootWindowInsets(view: View): WindowInsets | null {
    return view.getRootWindowInsets();
  },
  requestApplyInsets(view: View): void {
    view.requestApplyInsets();
  },
  dispatchApplyWindowInsets(view: View, insets: WindowInsets): WindowInsets {
    return view.dispatchApplyWindowInsets(insets);
  },
  setElevation(view: View, elevation: number): void {
    view.setElevation(elevation);
  },
  getElevation(view: View): number {
    return view.getElevation();
  },
  setTranslationZ(view: View, z: number): void {
    view.setTranslationZ(z);
  },
  isLaidOut(view: View): boolean {
    return view.isLaidOut();
  },
  isAttachedToWindow(view: View): boolean {
    return view.isAttachedToWindow();
  },
  generateViewId(): number {
    return View.generateViewId();
  },
  setImportantForAccessibility(view: View, mode: number): void {
    view.setImportantForAccessibility(mode);
  },
  setAccessibilityHeading(view: View, heading: boolean): void {
    view.setAccessibilityHeading(heading);
  },
  setStateDescription(view: View, description: string | null): void {
    view.setStateDescription(description);
  },
  setAccessibilityPaneTitle(view: View, title: string | null): void {
    view.setAccessibilityPaneTitle(title);
  },
  setAccessibilityLiveRegion(view: View, mode: number): void {
    view.setAccessibilityLiveRegion(mode);
  },
  setTooltipText(view: View, text: string | null): void {
    view.setTooltipText(text);
  },
  setBackgroundTintList(view: View, tint: ColorStateList | null): void {
    view.getBackground()?.setTint(tint ? tint.getDefaultColor() : null);
  },
  setTransitionName(view: View, name: string | null): void {
    view.setTransitionName(name);
  },
  getTransitionName(view: View): string | null {
    return view.getTransitionName();
  },
};

/** androidx.core.view.WindowInsetsControllerCompat over a window's controller. */
export class WindowInsetsControllerCompat {
  static readonly BEHAVIOR_DEFAULT = WindowInsetsController.BEHAVIOR_DEFAULT;
  static readonly BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE;
  private readonly controller: WindowInsetsController;

  constructor(window: PhoneWindow, _view: View) {
    this.controller = window.getInsetsController();
  }

  isAppearanceLightStatusBars(): boolean {
    return (this.controller.getSystemBarsAppearance() & WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) !== 0;
  }

  setAppearanceLightStatusBars(light: boolean): void {
    const bit = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
    this.controller.setSystemBarsAppearance(light ? bit : 0, bit);
  }

  isAppearanceLightNavigationBars(): boolean {
    return (this.controller.getSystemBarsAppearance() & WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS) !== 0;
  }

  setAppearanceLightNavigationBars(light: boolean): void {
    const bit = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
    this.controller.setSystemBarsAppearance(light ? bit : 0, bit);
  }

  hide(types: number): void {
    this.controller.hide(types);
  }

  show(types: number): void {
    this.controller.show(types);
  }

  setSystemBarsBehavior(behavior: number): void {
    this.controller.setSystemBarsBehavior(behavior);
  }

  getSystemBarsBehavior(): number {
    return this.controller.getSystemBarsBehavior();
  }
}

export const WindowCompat = {
  /** false draws edge to edge (the default since Android 15); true pads the content clear of the bars. */
  setDecorFitsSystemWindows(window: PhoneWindow, decorFitsSystemWindows: boolean): void {
    window.setDecorFitsSystemWindows(decorFitsSystemWindows);
  },
  getInsetsController(window: PhoneWindow, view: View): WindowInsetsControllerCompat {
    return new WindowInsetsControllerCompat(window, view);
  },
};

/**
 * androidx.activity.EdgeToEdge.enable: draw behind the system bars, with
 * bar icons that suit the theme (dark icons on a light theme).
 */
export const EdgeToEdge = {
  enable(activity: Activity): void {
    const window = activity.getWindow();
    window.setDecorFitsSystemWindows(false);
    const controller = new WindowInsetsControllerCompat(window, window.getDecorView());
    const light = !activity.getTheme().isNight();
    controller.setAppearanceLightStatusBars(light);
    controller.setAppearanceLightNavigationBars(light);
  },
};

export const ContextCompat = {
  /** A color resource ('@android:color/white') or a theme attribute ('?attr/colorPrimary'). */
  getColor(context: Context, name: string): number {
    return context.getColor(name);
  },
  /** Mimicry has no R.drawable table: a Material Symbols icon by name. */
  getDrawable(context: Context, name: string): Drawable {
    return new MaterialIconDrawable(context, name);
  },
  getSystemService<T>(context: Context, name: string): T | null {
    return context.getSystemService<T>(name);
  },
};

export const ResourcesCompat = {
  /** A font file loaded on the kernel (R.font has no counterpart: give its URL). */
  getFont(context: Context, url: string, family?: string): Typeface {
    return Typeface.createFromAsset(context, url, family);
  },
  getColor(context: Context, name: string): number {
    return context.getColor(name);
  },
};

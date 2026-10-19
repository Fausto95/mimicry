import type { Kernel } from '@mimicry/os-core';
import type { SharedPreferences } from './shared-preferences';
import { AppCompatDelegate, Theme, type ColorOverride } from './theme';
import { ANDROID_COLORS } from '../theme';

/**
 * android.content.Context with its Resources (DisplayMetrics, Configuration)
 * and android.os.Handler / Looper on the kernel's run loop.
 */
export class DisplayMetrics {
  constructor(
    readonly widthPixels: number,
    readonly heightPixels: number,
    readonly density: number,
    readonly scaledDensity: number,
  ) {}

  get densityDpi(): number {
    return Math.round(this.density * 160);
  }

  get xdpi(): number {
    return this.densityDpi;
  }

  get ydpi(): number {
    return this.densityDpi;
  }
}

export class Configuration {
  static readonly UI_MODE_NIGHT_MASK = 0x30;
  static readonly UI_MODE_NIGHT_NO = 0x10;
  static readonly UI_MODE_NIGHT_YES = 0x20;
  static readonly UI_MODE_TYPE_NORMAL = 0x01;
  static readonly ORIENTATION_PORTRAIT = 1;
  static readonly ORIENTATION_LANDSCAPE = 2;

  constructor(
    readonly uiMode: number,
    readonly fontScale: number,
    readonly orientation: number,
    readonly screenWidthDp: number,
    readonly screenHeightDp: number,
    readonly smallestScreenWidthDp: number,
    readonly densityDpi: number,
    readonly locale = 'en-US',
  ) {}

  isNightModeActive(): boolean {
    return (this.uiMode & Configuration.UI_MODE_NIGHT_MASK) === Configuration.UI_MODE_NIGHT_YES;
  }
}

export class Resources {
  constructor(private readonly kernel: Kernel, private readonly theme: Theme | null = null) {}

  getDisplayMetrics(): DisplayMetrics {
    const v = this.kernel.viewport;
    return new DisplayMetrics(Math.round(v.width * v.scale), Math.round(v.height * v.scale), v.scale, v.scale * v.fontScale);
  }

  getConfiguration(): Configuration {
    const v = this.kernel.viewport;
    const night = AppCompatDelegate.isNight(this.kernel);
    return new Configuration(
      Configuration.UI_MODE_TYPE_NORMAL | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO),
      v.fontScale,
      v.orientation === 'landscape' ? Configuration.ORIENTATION_LANDSCAPE : Configuration.ORIENTATION_PORTRAIT,
      v.width,
      v.height,
      Math.min(v.width, v.height),
      Math.round(v.scale * 160),
    );
  }

  /** dp → px */
  getDimension(dp: number): number {
    return dp * this.kernel.viewport.scale;
  }

  /** dp → whole px (rounded, at least 1 for a positive size) */
  getDimensionPixelSize(dp: number): number {
    const px = dp * this.kernel.viewport.scale;
    const rounded = Math.round(px);
    return rounded === 0 && px > 0 ? 1 : rounded;
  }

  /**
   * A color by name: a framework color resource ('@android:color/white')
   * or a theme attribute ('?attr/colorPrimary', 'colorSurface'), as ARGB.
   */
  getColor(name: string, theme: Theme | null = this.theme): number {
    const resource = ANDROID_COLORS[name];
    if (resource) {
      const rgba = resource[AppCompatDelegate.isNight(this.kernel) ? 1 : 0];
      return ((rgba >>> 8) | ((rgba & 255) << 24)) | 0;
    }
    const themed = theme?.resolveColor(name);
    if (themed != null) return themed;
    throw new Error(`Resources.NotFoundException: Color resource ${name}`);
  }
}

/** android.os.Handler on the main looper (the kernel's clock). */
export class Handler {
  private readonly pending = new Map<() => void, unknown>();

  constructor(private readonly kernel: Kernel) {}

  post(runnable: () => void): boolean {
    this.kernel.defer(runnable);
    return true;
  }

  postDelayed(runnable: () => void, delayMillis: number): boolean {
    const handle = this.kernel.clock.setTimeout(() => {
      this.pending.delete(runnable);
      runnable();
      this.kernel.requestFrame();
    }, delayMillis);
    this.pending.set(runnable, handle);
    return true;
  }

  removeCallbacks(runnable: () => void): void {
    const handle = this.pending.get(runnable);
    if (handle !== undefined) this.kernel.clock.clearTimeout(handle);
    this.pending.delete(runnable);
  }
}

/** android.view.Choreographer: frame callbacks on vsync. */
export class Choreographer {
  constructor(private readonly kernel: Kernel) {}

  postFrameCallback(callback: (frameTimeNanos: number) => void): number {
    const id = this.kernel.animator.requestAnimationFrame((time) => callback(Math.round(time * 1e6)));
    this.kernel.requestFrame();
    return id;
  }

  removeFrameCallback(id: number): void {
    this.kernel.animator.cancelAnimationFrame(id);
  }
}

export class Context {
  readonly resources: Resources;
  private readonly theme: Theme;
  readonly mainHandler: Handler;
  readonly choreographer: Choreographer;
  private readonly preferences = new Map<string, SharedPreferences>();
  /** @internal installed by the system (shared-preferences.ts) */
  static preferencesFactory: ((kernel: Kernel, name: string) => SharedPreferences) | null = null;

  constructor(readonly kernel: Kernel, readonly packageName = 'com.mimicry.app') {
    this.theme = new Theme(kernel);
    this.resources = new Resources(kernel, this.theme);
    this.mainHandler = new Handler(kernel);
    this.choreographer = new Choreographer(kernel);
  }

  getResources(): Resources {
    return this.resources;
  }

  /** Theme.Material3.DayNight, with whatever overlays the app applied. */
  getTheme(): Theme {
    return this.theme;
  }

  /** Apply a theme overlay: color roles or attributes → ARGB (or [light, dark]). */
  setTheme(colors: Record<string, ColorOverride>): void {
    this.theme.applyColors(colors);
  }

  /** ContextCompat.getColor / Context.getColor: a color resource or theme attribute. */
  getColor(name: string): number {
    return this.resources.getColor(name, this.theme);
  }

  getPackageName(): string {
    return this.packageName;
  }

  getApplicationContext(): Context {
    return this;
  }

  getMainLooper(): Handler {
    return this.mainHandler;
  }

  getSharedPreferences(name: string, _mode = 0): SharedPreferences {
    let prefs = this.preferences.get(name);
    if (!prefs) {
      if (!Context.preferencesFactory) throw new Error('SharedPreferences are not available before the system boots');
      prefs = Context.preferencesFactory(this.kernel, name);
      this.preferences.set(name, prefs);
    }
    return prefs;
  }
}

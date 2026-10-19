import type { Kernel } from '@mimicry/os-core';
import type { SharedPreferences } from './shared-preferences';

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
  constructor(private readonly kernel: Kernel) {}

  getDisplayMetrics(): DisplayMetrics {
    const v = this.kernel.viewport;
    return new DisplayMetrics(Math.round(v.width * v.scale), Math.round(v.height * v.scale), v.scale, v.scale * v.fontScale);
  }

  getConfiguration(): Configuration {
    const v = this.kernel.viewport;
    const night = this.kernel.env.appearance === 'dark';
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
  readonly mainHandler: Handler;
  readonly choreographer: Choreographer;
  private readonly preferences = new Map<string, SharedPreferences>();
  /** @internal installed by the system (shared-preferences.ts) */
  static preferencesFactory: ((kernel: Kernel, name: string) => SharedPreferences) | null = null;

  constructor(readonly kernel: Kernel, readonly packageName = 'com.mimicry.app') {
    this.resources = new Resources(kernel);
    this.mainHandler = new Handler(kernel);
    this.choreographer = new Choreographer(kernel);
  }

  getResources(): Resources {
    return this.resources;
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

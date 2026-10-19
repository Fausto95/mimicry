import type { Clock, Kernel } from '@mimicry/os-core';
import type { CGRect } from '../core-graphics/geometry';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { CATransaction } from '../quartz-core/ca-transaction';
import { UITouchPhase } from './ui-event';
import { UIScreen } from './ui-screen';
import { UITraitCollection } from './ui-trait-collection';
import type { UIView } from './ui-view';
import { UIWindow } from './ui-window';

/**
 * UIApplication: the app's process-level object. It owns the screen and
 * windows, turns the digitizer's samples into touch events for the window
 * under each finger, runs the layout pass before every frame, and tells
 * windows when the screen's traits change.
 */
export interface UIApplicationDelegate {
  applicationDidFinishLaunching?(application: UIApplication): void;
  applicationDidBecomeActive?(application: UIApplication): void;
  applicationWillResignActive?(application: UIApplication): void;
  openURL?(application: UIApplication, url: string): boolean;
}

export enum UIApplicationState { active = 0, inactive = 1, background = 2 }

/** Views that scroll with a mouse wheel / trackpad (UIScrollView). */
export interface WheelScrollable {
  handleWheel(dx: number, dy: number): boolean;
}

export class UIApplication {
  private static current: UIApplication | null = null;
  static get shared(): UIApplication {
    if (!UIApplication.current) throw new Error('UIApplication.shared: no application is running');
    return UIApplication.current;
  }

  readonly screen: UIScreen;
  readonly windows: UIWindow[] = [];
  delegate: UIApplicationDelegate | null = null;
  applicationState = UIApplicationState.active;
  isIdleTimerDisabled = false;
  private _keyWindow: UIWindow | null = null;
  private readonly touchWindows = new Map<number, UIWindow>();
  private readonly statusBarListeners = new Set<() => void>();

  constructor(readonly kernel: Kernel, options: { routeInput?: boolean } = {}) {
    UIApplication.current = this;
    CAEnvironment.kernel = kernel;
    // A transaction left open on another device's run loop must not swallow this one's.
    CATransaction._reset();
    this.screen = new UIScreen(kernel);
    UITraitCollection._setScreenProvider(() => this.screen.traitCollection);
    if (options.routeInput !== false) {
      kernel.on('pointer', (m) => {
        this.pointer(m.phase, m.id, m.x, m.y, m.time);
        kernel.requestFrame();
      });
      kernel.on('wheel', (m) => this.wheel(m.x, m.y, m.dx, m.dy));
    }
    kernel.addLayoutPass(() => {
      for (const window of this.windows.slice()) window._layoutPass();
    });
    kernel.env.subscribe((_env, changed) => {
      if (changed.dimensions || changed.device) {
        for (const window of this.windows) window.frame = this.screen.bounds;
      }
      for (const window of this.windows) window._traitsChanged();
      kernel.setNeedsLayout();
    });
  }

  get clock(): Clock {
    return this.kernel.clock;
  }

  /** A window on this application's screen (UIWindow(windowScene:)). */
  makeWindow(frame: CGRect = this.screen.bounds): UIWindow {
    const window = new UIWindow(frame);
    window.application = this;
    this.windows.push(window);
    return window;
  }

  get keyWindow(): UIWindow | null {
    return this._keyWindow;
  }

  /** @internal */
  _windowBecameKey(window: UIWindow): void {
    if (window.windowLevel === 0 || !this._keyWindow) this._keyWindow = window;
  }

  /** @internal */
  _windowHidden(window: UIWindow): void {
    if (this._keyWindow === window) this._keyWindow = this.windows.find((w) => w !== window && w.isVisible) ?? null;
  }

  openURL(url: string): void {
    this.kernel.send({ type: 'openURL', url });
  }

  // ── status bar ──────────────────────────────────────────────────────

  onStatusBarAppearanceChange(listener: () => void): () => void {
    this.statusBarListeners.add(listener);
    return () => this.statusBarListeners.delete(listener);
  }

  statusBarAppearanceChanged(): void {
    for (const listener of Array.from(this.statusBarListeners)) listener();
    this.kernel.setNeedsDisplay();
  }

  // ── input ───────────────────────────────────────────────────────────

  /** Visible windows from the topmost level down. */
  private windowsTopDown(): UIWindow[] {
    return this.windows.filter((w) => w.isVisible).sort((a, b) => b.windowLevel - a.windowLevel);
  }

  private pointer(phase: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, time: number): void {
    this.kernel.prepareInput();
    if (phase === 'down') {
      if (this.touchWindows.has(id)) return;
      const window = this.windowsTopDown().find((w) => w.hitTest(w.convertPointFrom({ x, y }, null), null));
      if (!window) return;
      this.touchWindows.set(id, window);
      const [wx, wy] = window.layer.convertFromWindow(x, y);
      window._touch(id, UITouchPhase.began, wx, wy, time);
      return;
    }
    const window = this.touchWindows.get(id);
    if (!window) return;
    const [wx, wy] = window.layer.convertFromWindow(x, y);
    const p = phase === 'move' ? UITouchPhase.moved : phase === 'up' ? UITouchPhase.ended : UITouchPhase.cancelled;
    if (p !== UITouchPhase.moved) this.touchWindows.delete(id);
    window._touch(id, p, wx, wy, time);
  }

  private wheel(x: number, y: number, dx: number, dy: number): void {
    this.kernel.prepareInput();
    for (const window of this.windowsTopDown()) {
      let view: UIView | null = window.hitTest(window.convertPointFrom({ x, y }, null), null);
      if (!view) continue;
      for (; view; view = view.superview) {
        const scrollable = view as unknown as Partial<WheelScrollable>;
        if (typeof scrollable.handleWheel === 'function' && scrollable.handleWheel(dx, dy)) return;
      }
      return;
    }
  }
}

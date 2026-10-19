import { UIEdgeInsetsZero, type CGRect, type UIEdgeInsets } from '../core-graphics/geometry';
import { UITouch, UITouchPhase, UIEvent } from './ui-event';
import { GestureEnvironment, UIGestureRecognizer } from './ui-gesture-recognizer';
import { UIColor } from './ui-color';
import type { UIApplication } from './ui-application';
import { UITraitCollection } from './ui-trait-collection';
import { UIView } from './ui-view';
import type { UIViewController } from './ui-view-controller';
import { Presentation } from './presentation';

/**
 * UIWindow: a root view on the display at a window level. It routes touch
 * events (hit testing, gesture recognizers, then the hit view), runs the
 * layout pass for its hierarchy, hosts the root view controller and the
 * view controllers presented over it.
 */
export const UIWindowLevel = { normal: 0, statusBar: 1000, alert: 2000 } as const;

export class UIWindow extends UIView {
  private _rootViewController: UIViewController | null = null;
  private _windowLevel: number = UIWindowLevel.normal;
  private visible = false;
  /** @internal */
  application: UIApplication | null = null;
  /** touches currently down in this window */
  private readonly touches = new Map<number, UITouch>();
  private environment: GestureEnvironment | null = null;
  readonly presentation: Presentation = new Presentation(this);

  constructor(frame?: CGRect) {
    super(frame);
    this.backgroundColor = null;
  }

  override get isWindow(): boolean {
    return true;
  }

  get windowLevel(): number {
    return this._windowLevel;
  }

  set windowLevel(level: number) {
    this._windowLevel = level;
    if (this.visible && this.application) this.application.kernel.display.addWindow(this.layer, level);
  }

  get rootViewController(): UIViewController | null {
    return this._rootViewController;
  }

  set rootViewController(vc: UIViewController | null) {
    const old = this._rootViewController;
    if (old === vc) return;
    if (old?.isViewLoaded) old.view.removeFromSuperview();
    this._rootViewController = vc;
    if (vc) {
      const view = vc.view;
      view.frame = this.bounds;
      this.insertSubview(view, 0);
    }
  }

  get isKeyWindow(): boolean {
    return this.application?.keyWindow === this;
  }

  /** Show the window on the display and make it receive keyboard focus. */
  makeKeyAndVisible(): void {
    const app = this.application;
    if (!app) throw new Error('UIWindow.makeKeyAndVisible: the window does not belong to an application (create it with application.makeWindow())');
    this.visible = true;
    app.kernel.display.addWindow(this.layer, this._windowLevel);
    this.layer.host = app.kernel;
    app._windowBecameKey(this);
    this._traitsChanged();
    this._scheduleLayout();
  }

  /** Remove the window from the display. */
  resignVisible(): void {
    this.visible = false;
    this.application?.kernel.display.removeWindow(this.layer);
    this.application?._windowHidden(this);
  }

  get isVisible(): boolean {
    return this.visible && !this.isHidden;
  }

  /** @internal screen traits for the views in this window */
  get screenTraits(): UITraitCollection {
    return this.application?.screen.traitCollection ?? DEFAULT;
  }

  /** @internal the view hierarchy changed size or content: layout before the next frame */
  _scheduleLayout(): void {
    this.application?.kernel.setNeedsLayout();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const root = this._rootViewController;
    if (root?.isViewLoaded) root.view.frame = this.bounds;
    this.presentation.layout();
  }

  // ── safe area ───────────────────────────────────────────────────────

  /**
   * The screen's safe area, grown by the additionalSafeAreaInsets of every
   * view controller between the window and `view` (their views' safe areas
   * propagate down the hierarchy).
   */
  windowSafeAreaInsets(view: UIView): UIEdgeInsets {
    const base = this.application?.screen.safeAreaInsets ?? UIEdgeInsetsZero;
    const W = this.bounds.size.width;
    const H = this.bounds.size.height;
    // The safe rect in window coordinates, narrowed top-down by every view
    // controller's view on the way (its own additionalSafeAreaInsets).
    let x0 = base.left;
    let y0 = base.top;
    let x1 = W - base.right;
    let y1 = H - base.bottom;
    const chain: UIView[] = [];
    for (let v: UIView | null = view; v && v !== this; v = v.superview) chain.unshift(v);
    for (const v of chain) {
      const vc = v._viewController;
      if (!vc) continue;
      const extra = vc.additionalSafeAreaInsets;
      if (!extra.top && !extra.left && !extra.bottom && !extra.right) continue;
      const r = v.layer.windowRect();
      x0 = Math.max(x0, r.x) + extra.left;
      y0 = Math.max(y0, r.y) + extra.top;
      x1 = Math.min(x1, r.x + r.w) - extra.right;
      y1 = Math.min(y1, r.y + r.h) - extra.bottom;
    }
    return { top: y0, left: x0, bottom: H - y1, right: W - x1 };
  }

  // ── events ──────────────────────────────────────────────────────────

  /** @internal a digitizer sample for a touch in this window (window coordinates) */
  _touch(id: number, phase: UITouchPhase, x: number, y: number, time: number): void {
    let touch = this.touches.get(id);
    if (phase === UITouchPhase.began) {
      if (touch) return;
      touch = new UITouch(id, x, y, time);
      touch.window = this;
      touch.view = this.hitTest(this.convertPointFrom({ x, y }, null), null);
      this.touches.set(id, touch);
      const env = (this.environment ??= new GestureEnvironment((r) => this.cancelTouchesInViews(r)));
      const recognizers: UIGestureRecognizer[] = [];
      for (let v = touch.view; v; v = v.superview) {
        for (const r of v.gestureRecognizers) {
          if (!r.isEnabled) continue;
          if (r.delegate?.shouldReceiveTouch && !r.delegate.shouldReceiveTouch(r, touch)) continue;
          recognizers.push(r);
        }
      }
      touch.gestureRecognizers = recognizers;
      for (const r of recognizers) {
        env.add(r);
        r._touches.add(touch);
      }
    } else {
      if (!touch) return;
      touch.update(phase, x, y, time);
    }
    this.sendEvent(new UIEvent(time, new Set(this.touches.values())), touch);
    if (phase === UITouchPhase.ended || phase === UITouchPhase.cancelled) {
      this.touches.delete(id);
      if (!this.touches.size && this.environment) {
        const env = this.environment;
        this.environment = null;
        env.finish();
      }
    }
  }

  /**
   * Deliver one touch change: to its gesture recognizers (the hit view's
   * first, then its ancestors'), then to the hit view unless a recognizer
   * cancelled it there.
   */
  sendEvent(event: UIEvent, touch: UITouch): void {
    const set = new Set([touch]);
    const phase = touch.phase;
    for (const r of touch.gestureRecognizers.slice()) {
      if (!r._touches.has(touch)) continue;
      if (r.isFinished && phase !== UITouchPhase.cancelled) continue;
      switch (phase) {
        case UITouchPhase.began: r.touchesBegan(set, event); break;
        case UITouchPhase.moved: r.touchesMoved(set, event); break;
        case UITouchPhase.ended: r.touchesEnded(set, event); break;
        case UITouchPhase.cancelled: r.touchesCancelled(set, event); break;
      }
    }
    const view = touch.view;
    if (!view || touch.deliveredToViewCancelled) return;
    switch (phase) {
      case UITouchPhase.began: view.touchesBegan(set, event); break;
      case UITouchPhase.moved: view.touchesMoved(set, event); break;
      case UITouchPhase.ended: view.touchesEnded(set, event); break;
      case UITouchPhase.cancelled: view.touchesCancelled(set, event); break;
    }
  }

  private cancelTouchesInViews(r: UIGestureRecognizer): void {
    for (const touch of r._touches) {
      if (touch.deliveredToViewCancelled || !touch.view) continue;
      touch.deliveredToViewCancelled = true;
      touch.view.touchesCancelled(new Set([touch]), new UIEvent(touch.timestamp, new Set(this.touches.values())));
    }
  }

  /** The touch currently down with this identifier (tests, the touch handler). */
  touchWithIdentifier(id: number): UITouch | null {
    return this.touches.get(id) ?? null;
  }

  override get backgroundColor(): UIColor | null {
    return super.backgroundColor;
  }

  override set backgroundColor(c: UIColor | null) {
    super.backgroundColor = c;
  }
}

const DEFAULT = new UITraitCollection(1, 1, 2, 3, 0, 'UICTContentSizeCategoryL');

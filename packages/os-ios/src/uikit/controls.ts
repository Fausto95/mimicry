import { easeOut, inflate, type FrameTask, type LayerContext } from '@mimicry/os-core';
import { iosKit } from '../theme';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import type { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import { UIView } from './ui-view';

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/** Shared frame-task plumbing for controls that animate themselves. */
function animator(view: UIView) {
  return view.window?.application?.kernel ?? null;
}

// ── UISwitch ─────────────────────────────────────────────────────────────

/**
 * UISwitch: the iOS 26 switch (63×28), thumb sliding with ease-out over
 * 250 ms, a press that stretches the thumb, and valueChanged on toggle.
 */
export class UISwitch extends UIControl implements FrameTask {
  static readonly size: CGSize = { width: iosKit.switchSize.width, height: iosKit.switchSize.height };
  private _isOn = false;
  private progress = 0;
  private pressed = 0;
  private tween: Tween | null = null;
  private pressTween: Tween | null = null;
  onTintColor: UIColor | null = null;
  thumbTintColor: UIColor | null = null;
  /** the off-state track (UISwitch's tintColor before iOS 13 semantics) */
  offTintColor: UIColor | null = null;

  constructor(frame?: CGRect) {
    super(frame);
    this.touchInsideSlop = 20;
  }

  get isOn(): boolean {
    return this._isOn;
  }

  set isOn(on: boolean) {
    this.setOn(on, false);
  }

  setOn(on: boolean, animated: boolean): void {
    if (on === this._isOn && !this.tween) return;
    this._isOn = on;
    const target = on ? 1 : 0;
    const kernel = animator(this);
    if (!animated || !kernel) {
      this.tween = null;
      this.progress = target;
      this.setNeedsDisplay();
      return;
    }
    this.tween = { from: this.progress, to: target, start: kernel.animator.animationTime, duration: 250 };
    this.track();
  }

  override get intrinsicContentSize(): CGSize {
    return UISwitch.size;
  }

  override sizeThatFits(): CGSize {
    return UISwitch.size;
  }

  protected override highlightChanged(highlighted: boolean): void {
    const kernel = animator(this);
    const target = highlighted ? 1 : 0;
    if (!kernel) {
      this.pressed = target;
      return;
    }
    if (this.pressed === target && !this.pressTween) return;
    this.pressTween = { from: this.pressed, to: target, start: kernel.animator.animationTime, duration: 150 };
    this.track();
  }

  override touchesEnded(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    const inside = this.isEnabled && this.isTracking;
    const touch = touches.values().next().value as UITouch;
    const p = touch.location(this);
    const b = this.bounds.size;
    const within = p.x >= -20 && p.y >= -20 && p.x <= b.width + 20 && p.y <= b.height + 20;
    super.touchesEnded(touches, event);
    if (inside && within) {
      this.setOn(!this._isOn, true);
      this.sendActions(UIControlEvents.valueChanged, event);
    }
  }

  private track(): void {
    const kernel = animator(this);
    if (!kernel) return;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(now: number): boolean {
    let busy = false;
    const step = (t: Tween) => {
      const k = Math.min(1, (now - t.start) / t.duration);
      return { value: t.from + (t.to - t.from) * easeOut(k), done: k >= 1 };
    };
    if (this.tween) {
      const s = step(this.tween);
      this.progress = s.value;
      if (s.done) this.tween = null;
      else busy = true;
    }
    if (this.pressTween) {
      const s = step(this.pressTween);
      this.pressed = s.value;
      if (s.done) this.pressTween = null;
      else busy = true;
    }
    this.setNeedsDisplay();
    return busy && !!this.window;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    const traits = this.traitCollection;
    const resolve = (c: UIColor | null) => (c ? c.resolvedColor(traits).rgba : null);
    const s = UISwitch.size;
    const state = {
      progress: this.progress,
      pressed: this.pressed,
      disabled: !this.isEnabled,
      trackOn: resolve(this.onTintColor),
      trackOff: resolve(this.offTintColor),
      thumb: resolve(this.thumbTintColor),
      backgroundOff: resolve(this.backgroundColor),
    };
    ctx.item(inflate({ x: ctx.x, y: ctx.y, w: s.width, h: s.height }, 12), (w) => iosKit.drawSwitch(w, ctx.x, ctx.y, state, traits.appearance));
  }

  protected override layerWillDraw(): void {
    // The background color is drawn by the switch itself (under the off track), not by the layer.
    this.layer.backgroundColor = null;
  }
}

// ── UIActivityIndicatorView ──────────────────────────────────────────────

export enum UIActivityIndicatorViewStyle { medium = 100, large = 101 }

/** The spinner: twelve fading spokes rotating once per second. */
export class UIActivityIndicatorView extends UIView implements FrameTask {
  private _style = UIActivityIndicatorViewStyle.medium;
  /** Mimicry: an explicit diameter (React Native's numeric `size`) */
  diameter: number | null = null;
  color: UIColor | null = null;
  hidesWhenStopped = true;
  private started: number | null = null;
  private animating = false;

  get style(): UIActivityIndicatorViewStyle {
    return this._style;
  }

  set style(style: UIActivityIndicatorViewStyle) {
    this._style = style;
    this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  get size(): number {
    if (this.diameter != null) return this.diameter;
    return iosKit.activitySize(this._style === UIActivityIndicatorViewStyle.large ? 'large' : 'small');
  }

  override get intrinsicContentSize(): CGSize {
    return { width: this.size, height: this.size };
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  startAnimating(): void {
    if (this.animating) return;
    this.animating = true;
    this.schedule();
  }

  stopAnimating(): void {
    this.animating = false;
    this.started = null;
    this.setNeedsDisplay();
  }

  override didMoveToWindow(): void {
    if (this.animating) this.schedule();
  }

  private schedule(): void {
    const kernel = animator(this);
    if (!kernel) return;
    this.started ??= kernel.animator.animationTime;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(): boolean {
    this.setNeedsDisplay();
    return this.animating && !!this.window;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    if (!this.animating && this.hidesWhenStopped) return;
    const kernel = animator(this);
    const now = kernel?.animator.animationTime ?? 0;
    const size = this.size;
    const b = this.bounds.size;
    const x = ctx.x + (b.width - size) / 2;
    const y = ctx.y + (b.height - size) / 2;
    const traits = this.traitCollection;
    const state = {
      time: this.animating ? (now - (this.started ?? now)) / 1000 : 0,
      color: this.color ? this.color.resolvedColor(traits).rgba : null,
      animating: this.animating,
    };
    ctx.item(inflate({ x, y, w: size, h: size }, 2), (w) => iosKit.drawActivity(w, x, y, size, state, traits.appearance));
  }
}

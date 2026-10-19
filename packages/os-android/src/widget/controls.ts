import { easeOut, inflate, type FrameTask, type LayerContext } from '@mimicry/os-core';
import { androidKit } from '../theme';
import type { Context } from '../content/context';
import { Color } from '../graphics/color';
import { MotionEvent } from '../view/motion-event';
import { MeasureSpec, View } from '../view/view';

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/**
 * android.widget.CompoundButton / androidx.appcompat.widget.SwitchCompat
 * (drawn as the Material 3 switch) and android.widget.ProgressBar
 * (indeterminate circular).
 */
export type OnCheckedChangeListener = (button: CompoundButton, isChecked: boolean) => void;

export class CompoundButton extends View implements FrameTask {
  private checked = false;
  protected progress = 0;
  protected pressedAmount = 0;
  private tween: Tween | null = null;
  private pressTween: Tween | null = null;
  private listener: OnCheckedChangeListener | null = null;
  /** checked-state animation length (ms) */
  protected toggleDuration = 180;

  constructor(context: Context) {
    super(context);
    this.setClickable(true);
  }

  isChecked(): boolean {
    return this.checked;
  }

  setChecked(checked: boolean, animate = true): void {
    if (checked === this.checked && !this.tween) return;
    const changed = checked !== this.checked;
    this.checked = checked;
    const target = checked ? 1 : 0;
    const kernel = this.kernel;
    if (!animate || !kernel) {
      this.tween = null;
      this.progress = target;
      this.invalidate();
    } else {
      this.tween = { from: this.progress, to: target, start: kernel.animator.animationTime, duration: this.toggleDuration };
      this.track();
    }
    if (changed) this.listener?.(this, checked);
  }

  toggle(): void {
    this.setChecked(!this.checked);
  }

  setOnCheckedChangeListener(listener: OnCheckedChangeListener | null): void {
    this.listener = listener;
  }

  override performClick(): boolean {
    this.toggle();
    super.performClick();
    return true;
  }

  override setPressed(pressed: boolean): void {
    const was = this.isPressed();
    super.setPressed(pressed);
    if (was === pressed) return;
    const kernel = this.kernel;
    const target = pressed ? 1 : 0;
    if (!kernel) {
      this.pressedAmount = target;
      return;
    }
    this.pressTween = { from: this.pressedAmount, to: target, start: kernel.animator.animationTime, duration: 150 };
    this.track();
  }

  private track(): void {
    const kernel = this.kernel;
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
      this.pressedAmount = s.value;
      if (s.done) this.pressTween = null;
      else busy = true;
    }
    this.invalidate();
    return busy && this.isAttachedToWindow();
  }

  /** Touch slop (dp) outside the bounds a press still counts as inside. */
  protected pressSlop = 20;
  /** a press started here and was not cancelled */
  private tracking = false;

  override onTouchEvent(event: MotionEvent): boolean {
    if (!this.isEnabled()) return true;
    const x = event.getX();
    const y = event.getY();
    const inside = x >= -this.pressSlop && y >= -this.pressSlop && x <= this.getWidth() + this.pressSlop && y <= this.getHeight() + this.pressSlop;
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        this.tracking = true;
        this.setPressed(true);
        return true;
      case MotionEvent.ACTION_MOVE:
        if (this.tracking) this.setPressed(inside);
        return true;
      case MotionEvent.ACTION_UP:
        this.setPressed(false);
        if (inside && this.tracking) this.performClick();
        this.tracking = false;
        return true;
      case MotionEvent.ACTION_CANCEL:
        this.tracking = false;
        this.setPressed(false);
        return true;
    }
    return true;
  }
}

export class SwitchCompat extends CompoundButton {
  static readonly size = { width: androidKit.switchSize.width, height: androidKit.switchSize.height };
  private trackTintChecked: number | null = null;
  private trackTintUnchecked: number | null = null;
  private thumbTint: number | null = null;

  /** ARGB colors; null restores the theme's */
  setTrackTintList(checked: number | null, unchecked: number | null): void {
    this.trackTintChecked = checked;
    this.trackTintUnchecked = unchecked;
    this.invalidate();
  }

  setThumbTintList(color: number | null): void {
    this.thumbTint = color;
    this.invalidate();
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.setMeasuredDimension(View.resolveSize(SwitchCompat.size.width, widthMeasureSpec), View.resolveSize(SwitchCompat.size.height, heightMeasureSpec));
    void MeasureSpec;
  }

  protected override drawContent(ctx: LayerContext): void {
    const appearance = this.context.kernel.env.appearance;
    const rgba = (c: number | null) => (c == null ? null : Color.toRgba(c));
    const state = {
      progress: this.progress,
      pressed: this.pressedAmount,
      disabled: !this.isEnabled(),
      trackOn: rgba(this.trackTintChecked),
      trackOff: rgba(this.trackTintUnchecked),
      thumb: rgba(this.thumbTint),
      backgroundOff: null,
    };
    const s = SwitchCompat.size;
    ctx.item(inflate({ x: ctx.x, y: ctx.y, w: s.width, h: s.height }, 12), (w) => androidKit.drawSwitch(w, ctx.x, ctx.y, state, appearance));
  }
}

export class ProgressBar extends View implements FrameTask {
  private indeterminate = true;
  private started: number | null = null;
  private tint: number | null = null;
  /** Mimicry: diameter of the circular indicator (React Native's size) */
  diameter: number = androidKit.activitySize('small');
  private animating = true;

  setIndeterminate(indeterminate: boolean): void {
    this.indeterminate = indeterminate;
    this.invalidate();
  }

  isIndeterminate(): boolean {
    return this.indeterminate;
  }

  /** setIndeterminateTintList with a single ARGB color (null: theme accent) */
  setIndeterminateTint(color: number | null): void {
    this.tint = color;
    this.invalidate();
  }

  setAnimating(animating: boolean): void {
    this.animating = animating;
    if (animating) this.schedule();
    else this.started = null;
    this.invalidate();
  }

  protected override onAttachedToWindow(): void {
    if (this.animating) this.schedule();
  }

  private schedule(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    this.started ??= kernel.animator.animationTime;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(): boolean {
    this.invalidate();
    return this.animating && this.isAttachedToWindow() && this.getVisibility() === View.VISIBLE;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.setMeasuredDimension(View.resolveSize(this.diameter, widthMeasureSpec), View.resolveSize(this.diameter, heightMeasureSpec));
  }

  protected override drawContent(ctx: LayerContext): void {
    if (!this.animating) return;
    const kernel = this.context.kernel;
    const now = kernel.animator.animationTime;
    const size = this.diameter;
    const x = ctx.x + (this.getWidth() - size) / 2;
    const y = ctx.y + (this.getHeight() - size) / 2;
    const state = { time: (now - (this.started ?? now)) / 1000, color: this.tint == null ? null : Color.toRgba(this.tint), animating: true };
    ctx.item(inflate({ x, y, w: size, h: size }, 2), (w) => androidKit.drawActivity(w, x, y, size, state, kernel.env.appearance));
  }
}

import { cubicBezier, easeOut, inflate, type FrameTask, type LayerContext } from '@mimicry/os-core';
import { androidKit } from '../theme';
import type { Context } from '../content/context';
import { withAlphaArgb } from '../content/theme';
import { Color } from '../graphics/color';
import { StateSet, type Drawable } from '../graphics/drawable';
import type { Canvas } from '../graphics/canvas';
import { MotionEvent } from '../view/motion-event';
import { MeasureSpec, View } from '../view/view';
import { TextView } from './text-view';

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/**
 * android.widget.CompoundButton (a TextView, like Button in the framework)
 * / androidx.appcompat.widget.SwitchCompat (drawn as the AppCompat switch
 * React Native shows) and android.widget.ProgressBar (indeterminate
 * circular).
 */
export type OnCheckedChangeListener = (button: CompoundButton, isChecked: boolean) => void;

export class CompoundButton extends TextView implements FrameTask {
  override getAccessibilityClassName(): string {
    return 'android.widget.CompoundButton';
  }

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

  /** An explicit description, else the framework's checked/not checked wording (switches say on/off). */
  override getStateDescription(): string | null {
    const explicit = super.getStateDescription();
    if (explicit !== null) return explicit;
    if (this.getAccessibilityClassName() === 'android.widget.Switch') return this.checked ? 'On' : 'Off';
    return this.checked ? 'Checked' : 'Not checked';
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
    if (changed) {
      this.refreshDrawableState();
      this.listener?.(this, checked);
      this.widgetListener?.(this, checked);
    }
  }

  protected override drawableState(): string[] {
    const s = super.drawableState();
    s.push(StateSet.checkable);
    if (this.checked) s.push(StateSet.checked);
    return s;
  }

  toggle(): void {
    this.setChecked(!this.checked);
  }

  // ── the button (check box, radio circle) at the start of the label ──

  private buttonDrawable: Drawable | null = null;

  /** CompoundButton.setButtonDrawable: drawn at the start, vertically centered, before the text. */
  setButtonDrawable(drawable: Drawable | null): void {
    this.buttonDrawable?.setCallback(null);
    this.buttonDrawable = drawable;
    if (drawable) {
      drawable.setCallback(this);
      if (drawable.isStateful()) drawable.setState(this.getDrawableState());
    }
    this.requestLayout();
    this.invalidate();
  }

  getButtonDrawable(): Drawable | null {
    return this.buttonDrawable;
  }

  /** Size of the button area (subclasses that draw their own button override this). */
  protected buttonSize(): { width: number; height: number } | null {
    const d = this.buttonDrawable;
    return d ? { width: Math.max(0, d.getIntrinsicWidth()), height: Math.max(0, d.getIntrinsicHeight()) } : null;
  }

  /** Draw the button in its area. */
  protected drawButton(canvas: Canvas, x: number, y: number, width: number, height: number): void {
    const d = this.buttonDrawable;
    if (!d) return;
    d.setBounds(x, y, x + width, y + height);
    d.draw(canvas);
  }

  override getCompoundPaddingLeft(): number {
    return super.getCompoundPaddingLeft() + (this.buttonSize()?.width ?? 0);
  }

  protected override onDraw(canvas: Canvas): void {
    super.onDraw(canvas);
    const size = this.buttonSize();
    if (size) this.drawButton(canvas, 0, (this.getHeight() - size.height) / 2, size.width, size.height);
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    if (this.buttonDrawable?.isStateful()) this.buttonDrawable.setState(this.getDrawableState());
  }

  override invalidateDrawable(who: Drawable): void {
    if (who === this.buttonDrawable) this.invalidate();
    else super.invalidateDrawable(who);
  }

  setOnCheckedChangeListener(listener: OnCheckedChangeListener | null): void {
    this.listener = listener;
  }

  private widgetListener: OnCheckedChangeListener | null = null;

  /** @internal the containing widget's listener (RadioGroup), separate from the app's */
  setOnCheckedChangeWidgetListener(listener: OnCheckedChangeListener | null): void {
    this.widgetListener = listener;
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
  override getAccessibilityClassName(): string {
    return 'android.widget.Switch';
  }

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

/**
 * android.widget.ProgressBar: the indeterminate circular spinner (the
 * default style, React Native's ActivityIndicator) or, with
 * STYLE_HORIZONTAL, a horizontal bar showing progress between min and max
 * (with a secondary progress), or an indeterminate sweep.
 */
export class ProgressBar extends View implements FrameTask {
  override getAccessibilityClassName(): string {
    return 'android.widget.ProgressBar';
  }

  /** android.R.attr.progressBarStyle* (the style argument of the framework constructor) */
  static readonly STYLE_DEFAULT = 0x01010077;
  static readonly STYLE_HORIZONTAL = 0x01010078;
  static readonly STYLE_SMALL = 0x01010079;
  static readonly STYLE_LARGE = 0x0101007a;

  private indeterminate = true;
  private started: number | null = null;
  private tint: number | null = null;
  /** Mimicry: diameter of the circular indicator (React Native's size) */
  diameter: number = androidKit.activitySize('small');
  private animating = true;
  protected readonly horizontal: boolean;
  private min = 0;
  private max = 100;
  private progress = 0;
  private secondaryProgress = 0;
  /** the progress drawn (animates toward `progress` with setProgress(p, true)) */
  protected visualProgress = 0;
  private progressTween: { from: number; to: number; start: number; duration: number } | null = null;
  private progressTint: number | null = null;
  private progressBackgroundTint: number | null = null;

  constructor(context: Context, style: number = ProgressBar.STYLE_DEFAULT) {
    super(context);
    this.horizontal = style === ProgressBar.STYLE_HORIZONTAL;
    if (this.horizontal) {
      this.indeterminate = false;
      this.animating = false;
    }
    if (style === ProgressBar.STYLE_LARGE) this.diameter = androidKit.activitySize('large');
  }

  setIndeterminate(indeterminate: boolean): void {
    this.indeterminate = indeterminate;
    if (this.horizontal) this.setAnimating(indeterminate);
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

  setProgressTint(color: number | null): void {
    this.progressTint = color;
    this.invalidate();
  }

  setProgressBackgroundTint(color: number | null): void {
    this.progressBackgroundTint = color;
    this.invalidate();
  }

  // ── progress ────────────────────────────────────────────────────────

  setMin(min: number): void {
    this.min = Math.min(min, this.max);
    this.setProgress(this.progress);
  }

  getMin(): number {
    return this.min;
  }

  setMax(max: number): void {
    this.max = Math.max(max, this.min);
    this.setProgress(this.progress);
  }

  getMax(): number {
    return this.max;
  }

  getProgress(): number {
    return this.indeterminate ? 0 : this.progress;
  }

  /** Set the progress (clamped to min..max); `animate` eases to it over 80 ms like the framework. */
  setProgress(progress: number, animate = false): void {
    const value = Math.round(Math.max(this.min, Math.min(this.max, progress)));
    const changed = value !== this.progress;
    this.progress = value;
    const kernel = this.kernel;
    if (animate && kernel && changed) {
      this.progressTween = { from: this.visualProgress, to: value, start: kernel.animator.animationTime, duration: 80 };
      kernel.animator.add(this);
      kernel.setNeedsDisplay();
    } else {
      this.progressTween = null;
      this.visualProgress = value;
    }
    if (changed) this.onProgressRefresh(value, this.fromUser);
    this.invalidate();
  }

  /** @internal set while a subclass changes progress on behalf of the user */
  protected fromUser = false;

  /** Called when the progress changes (SeekBar reports it to its listener). */
  protected onProgressRefresh(_progress: number, _fromUser: boolean): void {}

  incrementProgressBy(diff: number): void {
    this.setProgress(this.progress + diff);
  }

  getSecondaryProgress(): number {
    return this.secondaryProgress;
  }

  setSecondaryProgress(progress: number): void {
    this.secondaryProgress = Math.max(this.min, Math.min(this.max, progress));
    this.invalidate();
  }

  incrementSecondaryProgressBy(diff: number): void {
    this.setSecondaryProgress(this.secondaryProgress + diff);
  }

  /** The drawn progress as a fraction 0..1. */
  protected progressFraction(value = this.visualProgress): number {
    const range = this.max - this.min;
    return range > 0 ? (value - this.min) / range : 0;
  }

  // ── animation ───────────────────────────────────────────────────────

  setAnimating(animating: boolean): void {
    this.animating = animating;
    if (animating) this.schedule();
    else this.started = null;
    this.invalidate();
  }

  protected override onAttachedToWindow(): void {
    super.onAttachedToWindow();
    if (this.animating) this.schedule();
  }

  private schedule(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    this.started ??= kernel.animator.animationTime;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  /** Seconds since the indeterminate animation started. */
  protected animationSeconds(): number {
    const now = this.context.kernel.animator.animationTime;
    return (now - (this.started ?? now)) / 1000;
  }

  tick(now: number): boolean {
    let busy = false;
    const t = this.progressTween;
    if (t) {
      const k = Math.min(1, (now - t.start) / t.duration);
      this.visualProgress = t.from + (t.to - t.from) * (1 - (1 - k) * (1 - k));
      if (k >= 1) this.progressTween = null;
      else busy = true;
    }
    this.invalidate();
    const spinning = this.animating && this.isAttachedToWindow() && this.getVisibility() === View.VISIBLE;
    return busy || spinning;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    if (this.horizontal) {
      // Widget.Material.ProgressBar.Horizontal: 16 dp tall
      this.setMeasuredDimension(View.resolveSize(Math.max(48, this.getSuggestedMinimumWidth()), widthMeasureSpec), View.resolveSize(16, heightMeasureSpec));
      return;
    }
    this.setMeasuredDimension(View.resolveSize(this.diameter, widthMeasureSpec), View.resolveSize(this.diameter, heightMeasureSpec));
  }

  protected override drawContent(ctx: LayerContext): void {
    if (this.horizontal) {
      super.drawContent(ctx);
      this.drawHorizontal(ctx);
      return;
    }
    if (!this.animating) return;
    const kernel = this.context.kernel;
    const now = kernel.animator.animationTime;
    const size = this.diameter;
    const x = ctx.x + (this.getWidth() - size) / 2;
    const y = ctx.y + (this.getHeight() - size) / 2;
    const state = { time: (now - (this.started ?? now)) / 1000, color: this.tint == null ? null : Color.toRgba(this.tint), animating: true };
    ctx.item(inflate({ x, y, w: size, h: size }, 2), (w) => androidKit.drawActivity(w, x, y, size, state, kernel.env.appearance));
  }

  /** The platform's Material horizontal bar: a 4 dp track, progress in colorControlActivated. */
  private drawHorizontal(ctx: LayerContext): void {
    const theme = this.context.getTheme();
    const accent = Color.toRgba(this.progressTint ?? this.tint ?? theme.getColor('colorControlActivated'));
    const track = Color.toRgba(this.progressBackgroundTint ?? withAlphaArgb(theme.getColor('colorControlActivated'), 0.24));
    const width = this.getWidth() - this.getPaddingLeft() - this.getPaddingRight();
    const h = 4;
    const x = ctx.x + this.getPaddingLeft();
    const y = ctx.y + (this.getHeight() - h) / 2;
    ctx.item({ x, y, w: width, h }, (w) => {
      w.fillRect(x, y, width, h, track);
      if (this.indeterminate) {
        for (const [a, b] of indeterminateSegments(this.animationSeconds())) {
          if (b > a) w.fillRect(x + a * width, y, (b - a) * width, h, accent);
        }
        return;
      }
      const secondary = this.progressFraction(this.secondaryProgress);
      if (secondary > 0) w.fillRect(x, y, secondary * width, h, (accent & 0xffffff00) | 0x66);
      w.fillRect(x, y, this.progressFraction() * width, h, accent);
    });
  }
}

/**
 * The Material indeterminate linear animation: two bars sweeping across in
 * an 1800 ms cycle, their heads and tails each easing at their own time.
 * Returns [tail, head] fractions of the track.
 */
export function indeterminateSegments(seconds: number): Array<[number, number]> {
  const t = ((seconds * 1000) % 1800);
  const ease = (start: number, duration: number) => {
    const k = Math.max(0, Math.min(1, (t - start) / duration));
    return fastOutSlowIn(k);
  };
  return [
    [ease(333, 850), ease(0, 750)],
    [ease(1267, 533), ease(1000, 567)],
  ];
}

const fastOutSlowIn = cubicBezier(0.4, 0, 0.2, 1);

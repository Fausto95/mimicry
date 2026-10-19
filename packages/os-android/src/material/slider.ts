import type { LayerContext } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import { Color } from '../graphics/color';
import { Typeface } from '../text/typeface';
import { MotionEvent } from '../view/motion-event';
import { View } from '../view/view';
import { DragTracker } from '../widget/seek-bar';

/**
 * com.google.android.material.slider.Slider, Material 3 (MDC 1.12+): a
 * 16 dp tall rounded track — active part in primary, inactive in
 * secondaryContainer — split by a 4 × 44 dp handle with a 6 dp gap on each
 * side, a stop indicator dot at the end, tick dots for stepped sliders, and
 * a value label above the handle while dragging.
 *
 * Values snap to the step size; listeners hear every change with whether
 * the user made it. Dragging inside a scrolling container waits for a
 * horizontal move past the touch slop, as in MDC.
 */
export type SliderChangeListener = (slider: Slider, value: number, fromUser: boolean) => void;

export interface SliderTouchListener {
  onStartTrackingTouch?(slider: Slider): void;
  onStopTrackingTouch?(slider: Slider): void;
}

export type LabelFormatter = (value: number) => string;

export class Slider extends View {
  static readonly LABEL_FLOATING = 0;
  static readonly LABEL_WITHIN_BOUNDS = 1;
  static readonly LABEL_GONE = 2;
  static readonly LABEL_VISIBLE = 3;

  private valueFrom = 0;
  private valueTo = 1;
  private value = 0;
  private stepSize = 0;
  private readonly changeListeners: SliderChangeListener[] = [];
  private readonly touchListeners: SliderTouchListener[] = [];
  private labelBehavior = Slider.LABEL_FLOATING;
  private formatter: LabelFormatter | null = null;
  private readonly tracker: DragTracker;
  private trackHeight = 16;
  private thumbWidth = 4;
  private thumbHeight = 44;
  private thumbGap = 6;
  private stopIndicator = 4;
  private tickVisible = true;

  constructor(context: Context) {
    super(context);
    this.setClickable(true);
    this.setFocusable(true);
    this.tracker = new DragTracker(this, {
      start: () => {
        for (const l of this.touchListeners.slice()) l.onStartTrackingTouch?.(this);
      },
      track: (x) => this.trackTouch(x),
      stop: () => {
        for (const l of this.touchListeners.slice()) l.onStopTrackingTouch?.(this);
        this.invalidate();
      },
    });
  }

  // ── value ───────────────────────────────────────────────────────────

  setValueFrom(from: number): void {
    this.valueFrom = from;
    this.setValueInternal(this.value, false);
  }

  getValueFrom(): number {
    return this.valueFrom;
  }

  setValueTo(to: number): void {
    this.valueTo = to;
    this.setValueInternal(this.value, false);
  }

  getValueTo(): number {
    return this.valueTo;
  }

  /** The value must lie between valueFrom and valueTo (and on a step), as MDC requires. */
  setValue(value: number): void {
    if (value < this.valueFrom || value > this.valueTo) {
      throw new Error(`IllegalStateException: Slider value(${value}) must be greater or equal to valueFrom(${this.valueFrom}), and lower or equal to valueTo(${this.valueTo})`);
    }
    this.setValueInternal(value, false);
  }

  getValue(): number {
    return this.value;
  }

  setStepSize(step: number): void {
    if (step < 0) throw new Error('IllegalArgumentException: The stepSize must be 0, or a factor of the valueFrom-valueTo range');
    this.stepSize = step;
    this.setValueInternal(this.value, false);
  }

  getStepSize(): number {
    return this.stepSize;
  }

  private snap(value: number): number {
    const v = Math.max(this.valueFrom, Math.min(this.valueTo, value));
    if (this.stepSize <= 0) return v;
    const steps = Math.round((v - this.valueFrom) / this.stepSize);
    return Math.min(this.valueTo, this.valueFrom + steps * this.stepSize);
  }

  private setValueInternal(value: number, fromUser: boolean): void {
    const v = this.snap(value);
    if (v === this.value) return;
    this.value = v;
    for (const l of this.changeListeners.slice()) l(this, v, fromUser);
    this.invalidate();
  }

  addOnChangeListener(listener: SliderChangeListener): void {
    this.changeListeners.push(listener);
  }

  removeOnChangeListener(listener: SliderChangeListener): void {
    const at = this.changeListeners.indexOf(listener);
    if (at >= 0) this.changeListeners.splice(at, 1);
  }

  addOnSliderTouchListener(listener: SliderTouchListener): void {
    this.touchListeners.push(listener);
  }

  removeOnSliderTouchListener(listener: SliderTouchListener): void {
    const at = this.touchListeners.indexOf(listener);
    if (at >= 0) this.touchListeners.splice(at, 1);
  }

  setLabelBehavior(behavior: number): void {
    this.labelBehavior = behavior;
    this.invalidate();
  }

  getLabelBehavior(): number {
    return this.labelBehavior;
  }

  setLabelFormatter(formatter: LabelFormatter | null): void {
    this.formatter = formatter;
  }

  setTickVisible(visible: boolean): void {
    this.tickVisible = visible;
    this.invalidate();
  }

  setTrackHeight(height: number): void {
    this.trackHeight = height;
    this.requestLayout();
  }

  setThumbWidth(width: number): void {
    this.thumbWidth = width;
    this.invalidate();
  }

  setThumbHeight(height: number): void {
    this.thumbHeight = height;
    this.requestLayout();
  }

  setThumbTrackGapSize(gap: number): void {
    this.thumbGap = gap;
    this.invalidate();
  }

  setTrackStopIndicatorSize(size: number): void {
    this.stopIndicator = size;
    this.invalidate();
  }

  // ── geometry & touch ────────────────────────────────────────────────

  /** Space at each end of the track (half the handle plus a little). */
  private sidePadding(): number {
    return 8;
  }

  private trackBounds(): { left: number; width: number } {
    const left = this.getPaddingLeft() + this.sidePadding();
    const width = Math.max(0, this.getWidth() - this.getPaddingLeft() - this.getPaddingRight() - 2 * this.sidePadding());
    return { left, width };
  }

  private fraction(value = this.value): number {
    const range = this.valueTo - this.valueFrom;
    return range > 0 ? (value - this.valueFrom) / range : 0;
  }

  private trackTouch(x: number): void {
    const { left, width } = this.trackBounds();
    const f = width > 0 ? Math.max(0, Math.min(1, (x - left) / width)) : 0;
    this.setValueInternal(this.valueFrom + f * (this.valueTo - this.valueFrom), true);
    this.invalidate();
  }

  override onTouchEvent(event: MotionEvent): boolean {
    if (!this.isEnabled()) return false;
    return this.tracker.onTouchEvent(event);
  }

  get isDragging(): boolean {
    return this.tracker.dragging;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const height = Math.max(48, this.thumbHeight) + this.getPaddingTop() + this.getPaddingBottom();
    this.setMeasuredDimension(View.resolveSize(Math.max(96, this.getSuggestedMinimumWidth()), widthMeasureSpec), View.resolveSize(height, heightMeasureSpec));
  }

  private label(): string {
    if (this.formatter) return this.formatter(this.value);
    const v = this.value;
    return Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString();
  }

  // ── drawing ─────────────────────────────────────────────────────────

  protected override drawContent(ctx: LayerContext): void {
    super.drawContent(ctx);
    const theme = this.context.getTheme();
    const enabled = this.isEnabled();
    const onSurface = theme.getColor('colorOnSurface');
    const active = Color.toRgba(enabled ? theme.getColor('colorPrimary') : withAlphaArgb(onSurface, 0.38));
    const inactive = Color.toRgba(enabled ? theme.getColor('colorSecondaryContainer') : withAlphaArgb(onSurface, 0.12));
    const { left, width } = this.trackBounds();
    const x0 = ctx.x + left;
    const cy = ctx.y + this.getPaddingTop() + (this.getHeight() - this.getPaddingTop() - this.getPaddingBottom()) / 2;
    const h = this.trackHeight;
    const outer = h / 2;
    const inner = 2;
    const thumbX = x0 + this.fraction() * width;
    const gap = this.thumbGap + this.thumbWidth / 2;
    const showLabel = this.tracker.dragging && (this.labelBehavior === Slider.LABEL_FLOATING || this.labelBehavior === Slider.LABEL_WITHIN_BOUNDS) || this.labelBehavior === Slider.LABEL_VISIBLE;
    const labelTop = cy - this.thumbHeight / 2 - 4 - 44;
    ctx.item({ x: ctx.x, y: Math.min(ctx.y, labelTop), w: this.getWidth(), h: this.getHeight() + Math.max(0, ctx.y - labelTop) }, (w) => {
      const activeEnd = thumbX - gap;
      if (activeEnd > x0) w.fillRRect(x0, cy - h / 2, activeEnd - x0, h, [outer, inner, inner, outer], active);
      const inactiveStart = thumbX + gap;
      const end = x0 + width;
      if (end > inactiveStart) w.fillRRect(inactiveStart, cy - h / 2, end - inactiveStart, h, [inner, outer, outer, inner], inactive);
      // tick marks on stepped sliders, the stop indicator otherwise
      const dot = (x: number, color: number, r: number) => w.pathBegin().arc(x, cy, r, 0, Math.PI * 2).closePath().fillPath(color);
      const steps = this.stepSize > 0 ? Math.round((this.valueTo - this.valueFrom) / this.stepSize) : 0;
      if (this.tickVisible && steps > 0 && steps <= 60) {
        for (let i = 0; i <= steps; i++) {
          const tx = x0 + (i / steps) * width;
          if (Math.abs(tx - thumbX) < gap + 2) continue;
          const onActive = tx < thumbX;
          const tick = Color.toRgba(onActive ? theme.getColor('colorOnPrimary') : theme.getColor('colorOnSecondaryContainer'));
          dot(Math.min(Math.max(tx, x0 + outer), end - outer), tick, 2);
        }
      } else if (this.stopIndicator > 0 && end - outer > inactiveStart + this.stopIndicator) {
        dot(end - outer, active, this.stopIndicator / 2);
      }
      const tw = this.isPressed() ? this.thumbWidth / 2 : this.thumbWidth;
      const th = this.thumbHeight;
      w.fillRRect(thumbX - tw / 2, cy - th / 2, tw, th, [tw / 2, tw / 2, tw / 2, tw / 2], active);
      if (showLabel) {
        const text = this.label();
        const font = Typeface.create('sans-serif-medium', Typeface.NORMAL).css(TextAppearance.LabelLarge.size);
        const textWidth = this.context.kernel.measurer.width(text, font, 0);
        const lw = Math.max(48, textWidth + 32);
        const lx = thumbX - lw / 2;
        w.fillRRect(lx, labelTop, lw, 44, [22, 22, 22, 22], Color.toRgba(theme.getColor('colorSurfaceInverse')));
        w.font(font);
        w.text(thumbX - textWidth / 2, labelTop + 22 + 5, Color.toRgba(theme.getColor('colorOnSurfaceInverse')), 0, text);
      }
    });
  }
}

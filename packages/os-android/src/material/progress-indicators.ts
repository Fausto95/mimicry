import type { LayerContext } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { Color } from '../graphics/color';
import { View } from '../view/view';
import { ProgressBar, indeterminateSegments } from '../widget/controls';

/**
 * com.google.android.material.progressindicator: LinearProgressIndicator
 * and CircularProgressIndicator in their Material 3 form — a 4 dp rounded
 * indicator in primary over a secondaryContainer track, separated from it
 * by a 4 dp gap, with a stop indicator dot at the track's end. Determinate
 * changes animate with setProgressCompat(progress, true); indeterminate
 * ones sweep (linear) or spin (circular).
 */
abstract class BaseProgressIndicator extends ProgressBar {
  protected trackThickness = 4;
  protected trackCornerRadius = 2;
  protected indicatorTrackGap = 4;
  protected indicatorColors: number[];
  protected trackColor: number;

  constructor(context: Context, style: number) {
    super(context, style);
    const theme = context.getTheme();
    this.indicatorColors = [theme.getColor('colorPrimary')];
    this.trackColor = theme.getColor('colorSecondaryContainer');
  }

  /** Animated when `animated`, the way the M3 indicators ease between values. */
  setProgressCompat(progress: number, animated: boolean): void {
    this.setProgress(progress, animated);
  }

  setIndicatorColor(...colors: number[]): void {
    this.indicatorColors = colors.length ? colors : this.indicatorColors;
    this.invalidate();
  }

  getIndicatorColor(): number[] {
    return this.indicatorColors.slice();
  }

  setTrackColor(color: number): void {
    this.trackColor = color;
    this.invalidate();
  }

  getTrackColor(): number {
    return this.trackColor;
  }

  setTrackThickness(thickness: number): void {
    this.trackThickness = thickness;
    this.requestLayout();
  }

  getTrackThickness(): number {
    return this.trackThickness;
  }

  setTrackCornerRadius(radius: number): void {
    this.trackCornerRadius = radius;
    this.invalidate();
  }

  setIndicatorTrackGapSize(gap: number): void {
    this.indicatorTrackGap = gap;
    this.invalidate();
  }

  /** show()/hide(): fade the indicator in and out. */
  show(): void {
    this.setVisibility(View.VISIBLE);
    this.setAlpha(0);
    this.animate().alpha(1).setDuration(150).start();
  }

  hide(): void {
    this.animate().alpha(0).setDuration(150).withEndAction(() => this.setVisibility(View.INVISIBLE)).start();
  }

  protected get color(): number {
    return Color.toRgba(this.indicatorColors[0]!);
  }

  protected get track(): number {
    return Color.toRgba(this.trackColor);
  }
}

export class LinearProgressIndicator extends BaseProgressIndicator {
  private trackStopIndicatorSize = 4;

  constructor(context: Context) {
    super(context, ProgressBar.STYLE_HORIZONTAL);
  }

  setTrackStopIndicatorSize(size: number): void {
    this.trackStopIndicatorSize = size;
    this.invalidate();
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const height = this.trackThickness + this.getPaddingTop() + this.getPaddingBottom();
    this.setMeasuredDimension(View.resolveSize(Math.max(48, this.getSuggestedMinimumWidth()), widthMeasureSpec), View.resolveSize(height, heightMeasureSpec));
  }

  protected override drawContent(ctx: LayerContext): void {
    const width = this.getWidth() - this.getPaddingLeft() - this.getPaddingRight();
    const h = this.trackThickness;
    const x = ctx.x + this.getPaddingLeft();
    const y = ctx.y + this.getPaddingTop() + (this.getHeight() - this.getPaddingTop() - this.getPaddingBottom() - h) / 2;
    const r = Math.min(this.trackCornerRadius, h / 2);
    const radii = [r, r, r, r] as const;
    const gap = this.indicatorTrackGap;
    ctx.item({ x, y, w: width, h }, (w) => {
      const bar = (from: number, to: number, color: number) => {
        if (to - from > 0.5) w.fillRRect(x + from, y, to - from, h, radii, color);
      };
      if (this.isIndeterminate()) {
        // indicator segments with the track showing in the gaps between them
        const segments = indeterminateSegments(this.animationSeconds()).map(([a, b]) => [a * width, b * width] as const).filter(([a, b]) => b - a > 0.5);
        let at = 0;
        for (const [a, b] of segments.slice().sort((p, q) => p[0] - q[0])) {
          bar(at, a - gap, this.track);
          bar(a, b, this.color);
          at = b + gap;
        }
        bar(at, width, this.track);
        return;
      }
      const end = this.progressFraction() * width;
      bar(0, end, this.color);
      bar(end > 0 ? end + gap : 0, width, this.track);
      const stop = this.trackStopIndicatorSize;
      if (stop > 0 && end < width - gap - stop) {
        const cx = x + width - h / 2;
        const cy = y + h / 2;
        w.pathBegin().arc(cx, cy, stop / 2, 0, Math.PI * 2).closePath().fillPath(this.color);
      }
    });
  }
}

export class CircularProgressIndicator extends BaseProgressIndicator {
  private indicatorSize = 40;
  private indicatorInset = 4;

  constructor(context: Context) {
    super(context, ProgressBar.STYLE_DEFAULT);
    this.diameter = this.indicatorSize + this.indicatorInset * 2;
    this.setIndeterminate(true);
  }

  override setIndeterminate(indeterminate: boolean): void {
    super.setIndeterminate(indeterminate);
    this.setAnimating(indeterminate);
  }

  setIndicatorSize(size: number): void {
    this.indicatorSize = size;
    this.diameter = size + this.indicatorInset * 2;
    this.requestLayout();
  }

  getIndicatorSize(): number {
    return this.indicatorSize;
  }

  setIndicatorInset(inset: number): void {
    this.indicatorInset = inset;
    this.diameter = this.indicatorSize + inset * 2;
    this.requestLayout();
  }

  protected override drawContent(ctx: LayerContext): void {
    const size = this.indicatorSize;
    const stroke = this.trackThickness;
    const cx = ctx.x + this.getWidth() / 2;
    const cy = ctx.y + this.getHeight() / 2;
    const r = (size - stroke) / 2;
    const top = -Math.PI / 2;
    ctx.item({ x: cx - size / 2 - 1, y: cy - size / 2 - 1, w: size + 2, h: size + 2 }, (w) => {
      if (this.isIndeterminate()) {
        // M3 indeterminate: the arc grows and shrinks while it turns (one cycle 1333 ms)
        const t = this.animationSeconds();
        const cycle = 1.333;
        const phase = (t % cycle) / cycle;
        const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
        const grow = phase < 0.5 ? ease(phase * 2) : 1 - ease((phase - 0.5) * 2);
        const sweep = ((15 + 255 * grow) * Math.PI) / 180;
        const base = top + t * Math.PI * 2 * 0.75 + (phase >= 0.5 ? (ease((phase - 0.5) * 2) * 255 * Math.PI) / 180 : 0);
        w.pathBegin().arc(cx, cy, r, base, base + sweep).strokePath(this.color, stroke, 1, 1);
        return;
      }
      const f = this.progressFraction();
      const circumference = 2 * Math.PI * r;
      const gapAngle = ((this.indicatorTrackGap + stroke) / circumference) * Math.PI * 2;
      const end = top + f * Math.PI * 2;
      if (f > 0) w.pathBegin().arc(cx, cy, r, top, end).strokePath(this.color, stroke, 1, 1);
      if (f < 1) {
        const from = f > 0 ? end + gapAngle : top;
        const to = top + Math.PI * 2 - (f > 0 ? gapAngle : 0);
        if (to > from) w.pathBegin().arc(cx, cy, r, from, to).strokePath(this.track, stroke, 1, 1);
      }
    });
  }
}

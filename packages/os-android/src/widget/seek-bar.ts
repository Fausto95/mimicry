import type { LayerContext } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { withAlphaArgb } from '../content/theme';
import { Color } from '../graphics/color';
import { MotionEvent, ViewConfiguration } from '../view/motion-event';
import { View } from '../view/view';
import { ViewGroup } from '../view/view-group';
import { ProgressBar } from './controls';

/**
 * android.widget.SeekBar (AbsSeekBar): a horizontal ProgressBar with a
 * draggable thumb, drawn as the platform Material seek bar — a 2 dp track
 * in colorControlNormal, the progress and a 20 dp thumb in
 * colorControlActivated, a halo while pressed.
 *
 * Touch follows AbsSeekBar: outside a scrolling container a touch grabs the
 * thumb at once; inside one the drag starts only once the finger moved
 * horizontally past the touch slop, so vertical scrolls still scroll. A tap
 * jumps to the touched value.
 */
export interface OnSeekBarChangeListener {
  onProgressChanged?(seekBar: SeekBar, progress: number, fromUser: boolean): void;
  onStartTrackingTouch?(seekBar: SeekBar): void;
  onStopTrackingTouch?(seekBar: SeekBar): void;
}

/** Shared drag protocol of SeekBar and Slider. */
export class DragTracker {
  private downX = 0;
  private pending = false;
  dragging = false;

  constructor(
    private readonly view: View,
    private readonly callbacks: { start(): void; track(x: number): void; stop(): void },
  ) {}

  onTouchEvent(event: MotionEvent): boolean {
    const x = event.getX();
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        this.downX = x;
        if (ViewGroup.isInScrollingContainer(this.view)) this.pending = true;
        else this.start(x);
        return true;
      case MotionEvent.ACTION_MOVE:
        if (this.dragging) this.callbacks.track(x);
        else if (this.pending && Math.abs(x - this.downX) > ViewConfiguration.getScaledTouchSlop()) this.start(x);
        return true;
      case MotionEvent.ACTION_UP:
        if (this.pending && !this.dragging) {
          // a tap: jump to it
          this.start(x);
        } else if (this.dragging) this.callbacks.track(x);
        this.finish();
        return true;
      case MotionEvent.ACTION_CANCEL:
        this.finish();
        return true;
    }
    return true;
  }

  private start(x: number): void {
    this.pending = false;
    this.dragging = true;
    this.view.setPressed(true);
    this.view.getParent()?.requestDisallowInterceptTouchEvent(true);
    this.callbacks.start();
    this.callbacks.track(x);
  }

  private finish(): void {
    this.pending = false;
    if (!this.dragging) return;
    this.dragging = false;
    this.view.setPressed(false);
    this.callbacks.stop();
  }
}

export class SeekBar extends ProgressBar {
  override getAccessibilityClassName(): string {
    return 'android.widget.SeekBar';
  }

  private listener: OnSeekBarChangeListener | null = null;
  private readonly tracker: DragTracker;
  private keyProgressIncrement = 1;

  constructor(context: Context) {
    super(context, ProgressBar.STYLE_HORIZONTAL);
    this.setClickable(true);
    this.setFocusable(true);
    this.setPadding(16, 0, 16, 0);
    this.tracker = new DragTracker(this, {
      start: () => this.listener?.onStartTrackingTouch?.(this),
      track: (x) => this.trackTouch(x),
      stop: () => this.listener?.onStopTrackingTouch?.(this),
    });
  }

  setOnSeekBarChangeListener(listener: OnSeekBarChangeListener | null): void {
    this.listener = listener;
  }

  setKeyProgressIncrement(increment: number): void {
    this.keyProgressIncrement = increment;
  }

  getKeyProgressIncrement(): number {
    return this.keyProgressIncrement;
  }

  protected override onProgressRefresh(progress: number, fromUser: boolean): void {
    this.listener?.onProgressChanged?.(this, progress, fromUser);
  }

  private trackTouch(x: number): void {
    const available = this.getWidth() - this.getPaddingLeft() - this.getPaddingRight();
    const fraction = available > 0 ? Math.max(0, Math.min(1, (x - this.getPaddingLeft()) / available)) : 0;
    this.fromUser = true;
    this.setProgress(this.getMin() + fraction * (this.getMax() - this.getMin()));
    this.fromUser = false;
  }

  override onTouchEvent(event: MotionEvent): boolean {
    if (!this.isEnabled()) return false;
    return this.tracker.onTouchEvent(event);
  }

  get isDragging(): boolean {
    return this.tracker.dragging;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.setMeasuredDimension(View.resolveSize(Math.max(64, this.getSuggestedMinimumWidth()), widthMeasureSpec), View.resolveSize(Math.max(32, this.getSuggestedMinimumHeight()), heightMeasureSpec));
  }

  protected override drawContent(ctx: LayerContext): void {
    const theme = this.context.getTheme();
    const enabled = this.isEnabled();
    const accent = enabled ? theme.getColor('colorControlActivated') : withAlphaArgb(theme.getColor('colorOnSurface'), 0.38);
    const normal = withAlphaArgb(theme.getColor('colorControlNormal'), 0.3);
    const left = ctx.x + this.getPaddingLeft();
    const width = this.getWidth() - this.getPaddingLeft() - this.getPaddingRight();
    const cy = ctx.y + this.getHeight() / 2;
    const x = left + this.progressFraction() * width;
    ctx.item({ x: ctx.x, y: ctx.y, w: this.getWidth(), h: this.getHeight() }, (w) => {
      w.fillRect(left, cy - 1, width, 2, Color.toRgba(normal));
      const secondary = this.progressFraction(this.getSecondaryProgress());
      if (secondary > 0) w.fillRect(left, cy - 1, secondary * width, 2, Color.toRgba(withAlphaArgb(accent, 0.5)));
      w.fillRect(left, cy - 1, x - left, 2, Color.toRgba(accent));
      if (this.isPressed()) w.pathBegin().arc(x, cy, 16, 0, Math.PI * 2).closePath().fillPath(Color.toRgba(withAlphaArgb(accent, 0.24)));
      w.pathBegin().arc(x, cy, 10, 0, Math.PI * 2).closePath().fillPath(Color.toRgba(accent));
    });
  }
}

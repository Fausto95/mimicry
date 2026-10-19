import {
  RenderLayer, ScrollKinetics, type FrameTask, type IndicatorBar, type ScrollConfig, type ScrollEvent, type ScrollMetrics, type ScrollPhysics, type LayerContext,
} from '@mimicry/os-core';
import { androidKit } from '../theme';
import type { Context } from '../content/context';
import { MotionEvent, ViewConfiguration } from '../view/motion-event';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { FrameLayout, ViewGroup } from '../view/view-group';

/**
 * android.widget.ScrollView and HorizontalScrollView: one child scrolled by
 * dragging (intercepted from the children once the touch moves past the
 * slop along the scroll axis), flung with OverScroller-style deceleration,
 * and scroll bars that fade out. Touching a flinging scroll view stops it
 * and takes the gesture, so the touch never reaches a child.
 */
export type OnScrollChangeListener = (view: View, scrollX: number, scrollY: number, oldScrollX: number, oldScrollY: number) => void;

export interface ScrollViewCallbacks {
  /** the user started dragging */
  onDragStarted?(view: ScrollView): void;
  onDragEnded?(view: ScrollView, velocity: { x: number; y: number }): void;
  onFlingStarted?(view: ScrollView): void;
  onScrollIdle?(view: ScrollView): void;
}

export class ScrollView extends FrameLayout implements FrameTask {
  static readonly OVER_SCROLL_ALWAYS = 0;
  static readonly OVER_SCROLL_IF_CONTENT_SCROLLS = 1;
  static readonly OVER_SCROLL_NEVER = 2;

  readonly kinetics: ScrollKinetics;
  protected readonly horizontal: boolean = false;
  private isBeingDragged = false;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private scrollListener: OnScrollChangeListener | null = null;
  callbacks: ScrollViewCallbacks | null = null;
  private scrollEnabled = true;
  private overScrollMode = ScrollView.OVER_SCROLL_IF_CONTENT_SCROLLS;
  private verticalScrollBarEnabled = true;
  private horizontalScrollBarEnabled = true;
  private fillViewport = false;
  /** Mimicry: the scrollable extent when a framework lays the content out itself */
  contentExtent: { width: number; height: number } | null = null;
  /** snapping (React Native's pagingEnabled, snapToInterval, snapToOffsets) */
  pagingEnabled = false;
  snapToInterval: number | null = null;
  snapToOffsets: number[] | null = null;
  snapToStart = true;
  snapToEnd = true;
  decelerationRate: 'normal' | 'fast' | number = 'normal';
  /** whether a touch-down stopped a fling in the current gesture */
  touchStoppedScrolling = false;
  private readonly indicator = new ScrollBarState();

  constructor(context: Context) {
    super(context);
    this.renderNode.scrollsContent = true;
    this.renderNode.masksToBounds = true;
    this.kinetics = new ScrollKinetics({
      physics: this.physics,
      metrics: () => this.metrics(),
      config: () => this.config(),
      now: () => this.kernel?.animator.animationTime ?? 0,
      activate: () => this.activate(),
      requestFrame: () => this.kernel?.setNeedsDisplay(),
      appearance: () => this.context.kernel.env.appearance,
      event: (name, extra) => this.kineticsEvent(name, extra?.velocity),
    });
  }

  get physics(): ScrollPhysics {
    return androidKit.scroll;
  }

  override shouldDelayChildPressedState(): boolean {
    return true;
  }

  setOnScrollChangeListener(listener: OnScrollChangeListener | null): void {
    this.scrollListener = listener;
  }

  setScrollEnabled(enabled: boolean): void {
    this.scrollEnabled = enabled;
  }

  isScrollEnabled(): boolean {
    return this.scrollEnabled;
  }

  setOverScrollMode(mode: number): void {
    this.overScrollMode = mode;
  }

  getOverScrollMode(): number {
    return this.overScrollMode;
  }

  setVerticalScrollBarEnabled(enabled: boolean): void {
    this.verticalScrollBarEnabled = enabled;
  }

  setHorizontalScrollBarEnabled(enabled: boolean): void {
    this.horizontalScrollBarEnabled = enabled;
  }

  setFillViewport(fill: boolean): void {
    this.fillViewport = fill;
    this.requestLayout();
  }

  // ── geometry ────────────────────────────────────────────────────────

  metrics(): ScrollMetrics {
    const child = this.getChildAt(0);
    const extent = this.contentExtent ?? (child ? { width: child.getRight() + this.getPaddingRight(), height: child.getBottom() + this.getPaddingBottom() } : { width: 0, height: 0 });
    const viewportW = this.getWidth();
    const viewportH = this.getHeight();
    return {
      contentW: extent.width,
      contentH: extent.height,
      viewportW,
      viewportH,
      minX: 0,
      minY: 0,
      maxX: Math.max(0, extent.width - viewportW),
      maxY: Math.max(0, extent.height - viewportH),
    };
  }

  private config(): ScrollConfig {
    return {
      horizontal: this.horizontal,
      scrollEnabled: this.scrollEnabled,
      bounces: this.overScrollMode !== ScrollView.OVER_SCROLL_NEVER,
      alwaysBounceVertical: false,
      alwaysBounceHorizontal: false,
      decelerationRate: this.decelerationRate,
      pagingEnabled: this.pagingEnabled,
      snapToInterval: this.snapToInterval,
      snapToOffsets: this.snapToOffsets,
      snapToStart: this.snapToStart,
      snapToEnd: this.snapToEnd,
      showsIndicator: this.horizontal ? this.horizontalScrollBarEnabled : this.verticalScrollBarEnabled,
      indicatorStyle: undefined,
    };
  }

  override canScrollVertically(direction: number): boolean {
    if (this.horizontal) return false;
    const m = this.metrics();
    return direction < 0 ? this.kinetics.y > m.minY : direction > 0 ? this.kinetics.y < m.maxY : m.maxY > m.minY;
  }

  override canScrollHorizontally(direction: number): boolean {
    if (!this.horizontal) return false;
    const m = this.metrics();
    return direction < 0 ? this.kinetics.x > m.minX : direction > 0 ? this.kinetics.x < m.maxX : m.maxX > m.minX;
  }

  /** Can the content move along the axis at all (and is scrolling enabled)? */
  canScroll(): boolean {
    return this.kinetics.scrollable(this.horizontal ? 'x' : 'y');
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const width = MeasureSpec.getSize(widthMeasureSpec);
    const height = MeasureSpec.getSize(heightMeasureSpec);
    const child = this.getChildAt(0);
    if (child) {
      const lp = child.getLayoutParams();
      const padW = this.getPaddingLeft() + this.getPaddingRight();
      const padH = this.getPaddingTop() + this.getPaddingBottom();
      // Along the scroll axis the child is as big as it wants (or its fixed size).
      const along = (fixed: number | undefined) => (fixed !== undefined && fixed >= 0 ? MeasureSpec.makeMeasureSpec(fixed, MeasureSpec.EXACTLY) : MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
      const wSpec = this.horizontal ? along(lp?.width) : ViewGroup.getChildMeasureSpec(widthMeasureSpec, padW, lp?.width ?? LayoutParams.MATCH_PARENT);
      const hSpec = this.horizontal ? ViewGroup.getChildMeasureSpec(heightMeasureSpec, padH, lp?.height ?? LayoutParams.MATCH_PARENT) : along(lp?.height);
      child.measure(wSpec, hSpec);
      if (this.fillViewport) {
        const fixedW = MeasureSpec.makeMeasureSpec(width - padW, MeasureSpec.EXACTLY);
        const fixedH = MeasureSpec.makeMeasureSpec(height - padH, MeasureSpec.EXACTLY);
        if (!this.horizontal && child.getMeasuredHeight() < height - padH) child.measure(wSpec, fixedH);
        if (this.horizontal && child.getMeasuredWidth() < width - padW) child.measure(fixedW, hSpec);
      }
    }
    // Not exactly sized (wrap_content): as big as the content, up to the limit, like FrameLayout.
    const padW = this.getPaddingLeft() + this.getPaddingRight();
    const padH = this.getPaddingTop() + this.getPaddingBottom();
    const contentW = (child?.getMeasuredWidth() ?? 0) + padW;
    const contentH = (child?.getMeasuredHeight() ?? 0) + padH;
    this.setMeasuredDimension(
      MeasureSpec.getMode(widthMeasureSpec) === MeasureSpec.EXACTLY ? width : View.resolveSize(contentW, widthMeasureSpec),
      MeasureSpec.getMode(heightMeasureSpec) === MeasureSpec.EXACTLY ? height : View.resolveSize(contentH, heightMeasureSpec),
    );
  }

  // ── programmatic scrolling ──────────────────────────────────────────

  override scrollTo(x: number, y: number): void {
    this.kinetics.scrollTo(x, y, false);
    this.syncOffset();
  }

  smoothScrollTo(x: number, y: number): void {
    this.kinetics.scrollTo(x, y, true);
    this.syncOffset();
  }

  fling(velocity: number): void {
    this.kinetics.scrollTo(this.horizontal ? this.kinetics.x + velocity * 0.3 : undefined, this.horizontal ? undefined : this.kinetics.y + velocity * 0.3, true);
  }

  fullScroll(direction: number): void {
    const m = this.metrics();
    if (this.horizontal) this.smoothScrollTo(direction > 0 ? m.maxX : 0, 0);
    else this.smoothScrollTo(0, direction > 0 ? m.maxY : 0);
  }

  awakenScrollBars(): boolean {
    this.kinetics.flash();
    return true;
  }

  /** Content or viewport changed: keep an idle offset in range. */
  clampOffset(): boolean {
    const moved = this.kinetics.clampIdle();
    if (moved) this.syncOffset();
    return moved;
  }

  // ── touch ───────────────────────────────────────────────────────────

  override onInterceptTouchEvent(ev: MotionEvent): boolean {
    const action = ev.getActionMasked();
    if (action === MotionEvent.ACTION_MOVE && this.isBeingDragged) return true;
    switch (action) {
      case MotionEvent.ACTION_DOWN: {
        this.downX = ev.getRawX();
        this.downY = ev.getRawY();
        this.downTime = ev.getEventTime();
        // Touching a moving scroll view stops it and takes the gesture.
        this.touchStoppedScrolling = this.kinetics.touchDown();
        this.syncOffset();
        this.isBeingDragged = false;
        break;
      }
      case MotionEvent.ACTION_MOVE: {
        if (this.shouldStartDrag(ev)) this.startDrag(ev);
        break;
      }
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        this.isBeingDragged = false;
        break;
    }
    return this.isBeingDragged;
  }

  override onTouchEvent(ev: MotionEvent): boolean {
    switch (ev.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        if (!this.getChildCount()) return false;
        this.downX = ev.getRawX();
        this.downY = ev.getRawY();
        this.downTime = ev.getEventTime();
        if (!this.touchStoppedScrolling) this.touchStoppedScrolling = this.kinetics.touchDown();
        return true;
      case MotionEvent.ACTION_MOVE:
        if (!this.isBeingDragged && this.shouldStartDrag(ev)) this.startDrag(ev);
        if (this.isBeingDragged) {
          this.kinetics.drag(ev.getRawX(), ev.getRawY(), ev.getEventTime());
          this.syncOffset();
        }
        return true;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        if (this.isBeingDragged) {
          this.isBeingDragged = false;
          this.kinetics.endDrag(ev.getEventTime());
          this.syncOffset();
        }
        return true;
    }
    return true;
  }

  /** Past the touch slop with the dominant movement along this view's axis. */
  protected shouldStartDrag(ev: MotionEvent): boolean {
    const dx = ev.getRawX() - this.downX;
    const dy = ev.getRawY() - this.downY;
    const slop = ViewConfiguration.getScaledTouchSlop();
    if (Math.abs(dx) < slop && Math.abs(dy) < slop) return false;
    const axisIsX = Math.abs(dx) > Math.abs(dy);
    if (axisIsX !== this.horizontal) return false;
    return this.canScroll() && this.allowsDrag();
  }

  /** Frameworks veto drags (another gesture owns the touch). */
  protected allowsDrag(): boolean {
    return true;
  }

  private startDrag(ev: MotionEvent): void {
    this.isBeingDragged = true;
    this.getParent()?.requestDisallowInterceptTouchEvent(true);
    this.kinetics.beginDrag(this.downX, this.downY, this.downTime);
    this.kinetics.drag(ev.getRawX(), ev.getRawY(), ev.getEventTime());
    this.syncOffset();
  }

  get isDragging(): boolean {
    return this.isBeingDragged;
  }

  // ── motion ──────────────────────────────────────────────────────────

  private activate(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(now: number): boolean {
    if (!this.kernel) return false;
    const keep = this.kinetics.tick(now);
    this.syncOffset();
    return keep;
  }

  private syncOffset(): void {
    const oldX = this.renderNode.originX;
    const oldY = this.renderNode.originY;
    const x = this.kinetics.x;
    const y = this.kinetics.y;
    if (x === oldX && y === oldY) return;
    this.renderNode.originX = x;
    this.renderNode.originY = y;
    this.onScrollChanged(x, y, oldX, oldY);
  }

  protected override onScrollChanged(l: number, t: number, oldl: number, oldt: number): void {
    this.scrollListener?.(this, l, t, oldl, oldt);
  }

  override getScrollX(): number {
    return this.kinetics.x;
  }

  override getScrollY(): number {
    return this.kinetics.y;
  }

  private kineticsEvent(name: ScrollEvent, velocity?: { x: number; y: number }): void {
    this.syncOffset();
    const cb = this.callbacks;
    switch (name) {
      case 'beginDrag':
        cb?.onDragStarted?.(this);
        break;
      case 'endDrag':
        cb?.onDragEnded?.(this, velocity ?? { x: 0, y: 0 });
        break;
      case 'momentumBegin':
        cb?.onFlingStarted?.(this);
        break;
      case 'momentumEnd':
        cb?.onScrollIdle?.(this);
        break;
      case 'scroll':
        this.onScrollEvent();
        break;
    }
  }

  /** Every offset change the kinetics report (frame by frame). */
  protected onScrollEvent(): void {}

  /** Mouse wheel / trackpad. */
  handleWheel(dx: number, dy: number): boolean {
    const axisIsX = Math.abs(dx) > Math.abs(dy);
    if (axisIsX !== this.horizontal || !this.canScroll()) return false;
    this.kinetics.wheel(dx, dy);
    this.syncOffset();
    return true;
  }

  // ── scroll bars ─────────────────────────────────────────────────────

  indicators(): IndicatorBar[] {
    return this.kinetics.indicators();
  }

  protected override drawContent(ctx: LayerContext): void {
    super.drawContent(ctx);
    // before the render server reaches the fixed sublayers
    this.indicator.sync(this, this.kinetics.indicators());
  }
}

/** Scroll bars live on fixed sublayers so fading never re-rasters the content. */
class ScrollBarState {
  private readonly layers = new Map<'x' | 'y', BarLayer>();

  sync(view: ScrollView, bars: IndicatorBar[]): void {
    for (const axis of ['y', 'x'] as const) {
      const bar = bars.find((b) => b.axis === axis);
      let layer = this.layers.get(axis);
      if (!layer) {
        layer = new BarLayer();
        view.renderNode.addFixedSublayer(layer);
        this.layers.set(axis, layer);
      }
      layer.show(bar ?? null);
    }
  }
}

class BarLayer extends RenderLayer {
  private color = 0;

  constructor() {
    super();
    this.composited = true;
    this.hidden = true;
  }

  show(bar: IndicatorBar | null): void {
    if (!bar) {
      this.hidden = true;
      return;
    }
    this.hidden = false;
    this.setFrame(bar.x, bar.y, bar.w, bar.h);
    this.opacity = bar.alpha;
    this.color = bar.color;
  }

  override drawContent(ctx: LayerContext): void {
    const t = Math.min(this.width, this.height) / 2;
    const c = this.color;
    ctx.item({ x: ctx.x, y: ctx.y, w: this.width, h: this.height }, (w) => w.fillRRect(ctx.x, ctx.y, this.width, this.height, [t, t, t, t], c));
  }
}

export class HorizontalScrollView extends ScrollView {
  protected override readonly horizontal: boolean = true;
}

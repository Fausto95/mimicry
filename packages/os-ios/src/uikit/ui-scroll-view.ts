import {
  ScrollKinetics, type FrameTask, type IndicatorBar, type ScrollConfig, type ScrollEvent, type ScrollMetrics, type ScrollPhysics,
} from '@mimicry/os-core';
import { iosKit } from '../theme';
import { CALayer } from '../quartz-core/ca-layer';
import { UIEdgeInsetsZero, type CGPoint, type CGRect, type CGSize, type UIEdgeInsets } from '../core-graphics/geometry';
import { UIPanGestureRecognizer } from './gesture-recognizers';
import type { UIEvent, UITouch } from './ui-event';
import { UIGestureRecognizerState } from './ui-gesture-recognizer';
import { UIResponder } from './ui-responder';
import { UIView } from './ui-view';
import type { WheelScrollable } from './ui-application';

/**
 * UIScrollView: content larger than the view, moved by its pan gesture
 * recognizer with rubber banding, deceleration, paging, and indicators that
 * fade out. `contentOffset` is the layer's bounds origin, so subviews are
 * laid out in content coordinates and the render server composites the
 * content as one moving layer.
 */
export enum UIScrollViewContentInsetAdjustmentBehavior { automatic = 0, scrollableAxes = 1, never = 2, always = 3 }
export enum UIScrollViewIndicatorStyle { default = 0, black = 1, white = 2 }
export enum UIScrollViewKeyboardDismissMode { none = 0, onDrag = 1, interactive = 2 }
export const UIScrollViewDecelerationRate = { normal: 0.998, fast: 0.99 } as const;

export interface UIScrollViewDelegate {
  scrollViewDidScroll?(scrollView: UIScrollView): void;
  scrollViewWillBeginDragging?(scrollView: UIScrollView): void;
  scrollViewWillEndDragging?(scrollView: UIScrollView, velocity: CGPoint, targetContentOffset: { current: CGPoint }): void;
  scrollViewDidEndDragging?(scrollView: UIScrollView, willDecelerate: boolean): void;
  scrollViewWillBeginDecelerating?(scrollView: UIScrollView): void;
  scrollViewDidEndDecelerating?(scrollView: UIScrollView): void;
  scrollViewDidEndScrollingAnimation?(scrollView: UIScrollView): void;
  scrollViewShouldScrollToTop?(scrollView: UIScrollView): boolean;
}

/** The scroll view's own pan: begins after the touch slop, along an axis the content can move. */
export class UIScrollViewPanGestureRecognizer extends UIPanGestureRecognizer {
  constructor(private readonly scrollView: UIScrollView) {
    super();
    this.slop = scrollView.physics.touchSlop;
  }

  protected override shouldBeginPan(t: CGPoint): boolean {
    if (Math.abs(t.x) < this.slop && Math.abs(t.y) < this.slop) return false;
    const axis = Math.abs(t.x) > Math.abs(t.y) ? 'x' : 'y';
    return this.scrollView.canScroll(axis);
  }

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (this.numberOfTouches === touches.size) this.scrollView._touchDown();
    super.touchesBegan(touches, event);
  }
}

export class UIScrollView extends UIView implements FrameTask, WheelScrollable {
  delegate: UIScrollViewDelegate | null = null;
  private _contentSize: CGSize = { width: 0, height: 0 };
  private _contentInset: UIEdgeInsets = UIEdgeInsetsZero;
  contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentBehavior.automatic;
  bounces = true;
  alwaysBounceVertical = false;
  alwaysBounceHorizontal = false;
  isPagingEnabled = false;
  isScrollEnabled = true;
  isDirectionalLockEnabled = false;
  decelerationRate: number = UIScrollViewDecelerationRate.normal;
  showsVerticalScrollIndicator = true;
  showsHorizontalScrollIndicator = true;
  indicatorStyle = UIScrollViewIndicatorStyle.default;
  keyboardDismissMode = UIScrollViewKeyboardDismissMode.none;
  scrollsToTop = true;
  /** Mimicry: the axis the content scrolls along (UIKit infers it from contentSize; RN states it) */
  horizontal = false;
  /** snapping (React Native's snapToInterval / snapToOffsets) */
  snapToInterval: number | null = null;
  snapToOffsets: number[] | null = null;
  snapToStart = true;
  snapToEnd = true;

  readonly panGestureRecognizer: UIScrollViewPanGestureRecognizer;
  readonly kinetics: ScrollKinetics;
  private readonly indicatorY = new IndicatorLayer();
  private readonly indicatorX = new IndicatorLayer();
  private initialized = false;
  /** the touch-down of the current sequence stopped a moving scroll */
  touchStoppedScrolling = false;

  constructor(frame?: CGRect) {
    super(frame);
    this.layer.scrollsContent = true;
    this.layer.addFixedSublayer(this.indicatorY);
    this.layer.addFixedSublayer(this.indicatorX);
    const physics = this.physics;
    this.kinetics = new ScrollKinetics({
      physics,
      metrics: () => this.metrics(),
      config: () => this.config(),
      now: () => this.kernel?.animator.animationTime ?? 0,
      activate: () => this.activate(),
      requestFrame: () => this.kernel?.setNeedsDisplay(),
      appearance: () => this.traitCollection.appearance,
      event: (name, extra) => this.kineticsEvent(name, extra?.velocity),
    });
    this.panGestureRecognizer = new UIScrollViewPanGestureRecognizer(this);
    this.panGestureRecognizer.addTarget((g) => this.handlePan(g as UIScrollViewPanGestureRecognizer));
    this.addGestureRecognizer(this.panGestureRecognizer);
  }

  /** Scroll constants for this device family (iOS deceleration, rubber band). */
  get physics(): ScrollPhysics {
    return iosKit.scroll;
  }

  private get kernel() {
    return this.window?.application?.kernel ?? null;
  }

  // ── geometry ────────────────────────────────────────────────────────

  get contentSize(): CGSize {
    return this._contentSize;
  }

  set contentSize(size: CGSize) {
    this._contentSize = size;
    this.setNeedsDisplay();
  }

  get contentInset(): UIEdgeInsets {
    return this._contentInset;
  }

  set contentInset(inset: UIEdgeInsets) {
    this._contentInset = inset;
    this.setNeedsDisplay();
  }

  /** contentInset plus the safe area on the axes the adjustment behavior covers. */
  get adjustedContentInset(): UIEdgeInsets {
    const i = this._contentInset;
    const out = { top: i.top, left: i.left, bottom: i.bottom, right: i.right };
    const B = UIScrollViewContentInsetAdjustmentBehavior;
    const behavior = this.contentInsetAdjustmentBehavior;
    if (behavior === B.never) return out;
    const safe = this.safeAreaInsets;
    const vertical = behavior !== B.scrollableAxes || !this.horizontal;
    const horizontal = behavior !== B.scrollableAxes || this.horizontal;
    if (vertical) {
      out.top += safe.top;
      out.bottom += safe.bottom;
    }
    if (horizontal) {
      out.left += safe.left;
      out.right += safe.right;
    }
    return out;
  }

  get contentOffset(): CGPoint {
    return { x: this.kinetics.x, y: this.kinetics.y };
  }

  set contentOffset(p: CGPoint) {
    this.setContentOffset(p, false);
  }

  setContentOffset(p: CGPoint, animated: boolean): void {
    this.kinetics.scrollTo(p.x, p.y, animated);
    this.syncOffset();
  }

  scrollRectToVisible(rect: CGRect, animated: boolean): void {
    const o = this.contentOffset;
    const b = this.bounds.size;
    let x = o.x;
    let y = o.y;
    if (rect.origin.x < x) x = rect.origin.x;
    else if (rect.origin.x + rect.size.width > x + b.width) x = rect.origin.x + rect.size.width - b.width;
    if (rect.origin.y < y) y = rect.origin.y;
    else if (rect.origin.y + rect.size.height > y + b.height) y = rect.origin.y + rect.size.height - b.height;
    this.setContentOffset({ x, y }, animated);
  }

  flashScrollIndicators(): void {
    this.kinetics.flash();
  }

  get isTracking(): boolean {
    return this.panGestureRecognizer.state === UIGestureRecognizerState.possible && this.panGestureRecognizer.numberOfTouches > 0 || this.kinetics.isTracking;
  }

  get isDragging(): boolean {
    return this.kinetics.isTracking;
  }

  get isDecelerating(): boolean {
    return this.kinetics.isDecelerating;
  }

  /** Programmatic animated scroll in flight. */
  get isScrollAnimating(): boolean {
    return this.kinetics.phase === 'animating';
  }

  canScroll(axis: 'x' | 'y'): boolean {
    return this.kinetics.scrollable(axis);
  }

  /**
   * The first layout fixes the initial offset: UIKit starts an inset-adjusted
   * scroll view at -adjustedContentInset.
   */
  initializeOffsetIfNeeded(initial?: CGPoint | null): void {
    if (this.initialized) return;
    this.initialized = true;
    const m = this.metrics();
    if (initial) {
      this.kinetics.x = clampTo(initial.x ?? 0, m.minX, m.maxX);
      this.kinetics.y = clampTo(initial.y ?? 0, m.minY, m.maxY);
    } else if (this.contentInsetAdjustmentBehavior !== UIScrollViewContentInsetAdjustmentBehavior.never) {
      this.kinetics.x = m.minX;
      this.kinetics.y = m.minY;
    }
    this.syncOffset();
  }

  /** Content or bounds changed: keep an idle offset in range. */
  clampOffset(): boolean {
    const moved = this.kinetics.clampIdle();
    if (moved) this.syncOffset();
    return moved;
  }

  metrics(): ScrollMetrics {
    const size = this._contentSize;
    const inset = this.adjustedContentInset;
    const viewportW = this.bounds.size.width;
    const viewportH = this.bounds.size.height;
    const minX = 0 - inset.left; // not -inset.left: avoid -0
    const minY = 0 - inset.top;
    return {
      contentW: size.width,
      contentH: size.height,
      viewportW,
      viewportH,
      minX,
      minY,
      maxX: Math.max(minX, size.width - viewportW + inset.right),
      maxY: Math.max(minY, size.height - viewportH + inset.bottom),
    };
  }

  private config(): ScrollConfig {
    const rate = this.decelerationRate;
    return {
      horizontal: this.horizontal,
      scrollEnabled: this.isScrollEnabled,
      bounces: this.bounces,
      alwaysBounceVertical: this.alwaysBounceVertical,
      alwaysBounceHorizontal: this.alwaysBounceHorizontal,
      decelerationRate: rate === UIScrollViewDecelerationRate.normal ? 'normal' : rate === UIScrollViewDecelerationRate.fast ? 'fast' : rate,
      pagingEnabled: this.isPagingEnabled,
      snapToInterval: this.snapToInterval,
      snapToOffsets: this.snapToOffsets,
      snapToStart: this.snapToStart,
      snapToEnd: this.snapToEnd,
      showsIndicator: this.horizontal ? this.showsHorizontalScrollIndicator : this.showsVerticalScrollIndicator,
      indicatorStyle: this.indicatorStyle === UIScrollViewIndicatorStyle.black ? 'black' : this.indicatorStyle === UIScrollViewIndicatorStyle.white ? 'white' : undefined,
    };
  }

  // ── motion ──────────────────────────────────────────────────────────

  private activate(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(now: number): boolean {
    if (!this.window) return false;
    const keep = this.kinetics.tick(now);
    this.syncOffset();
    return keep;
  }

  private syncOffset(): void {
    this.layer.originX = this.kinetics.x;
    this.layer.originY = this.kinetics.y;
  }

  /** @internal a finger touched down on the scroll view */
  _touchDown(): void {
    this.touchStoppedScrolling = this.kinetics.touchDown();
    this.syncOffset();
  }

  private handlePan(g: UIScrollViewPanGestureRecognizer): void {
    const S = UIGestureRecognizerState;
    const touches = Array.from(g._touches);
    const touch = touches[0];
    if (!touch) return;
    const p = touch.windowLocation;
    switch (g.state) {
      case S.began:
        if (this.keyboardDismissMode !== UIScrollViewKeyboardDismissMode.none) UIResponder.currentFirstResponder?.resignFirstResponder();
        this.kinetics.beginDrag(touch.startX, touch.startY, touch.startTime);
        this.kinetics.drag(p.x, p.y, touch.timestamp);
        break;
      case S.changed:
        this.kinetics.drag(p.x, p.y, touch.timestamp);
        break;
      case S.ended:
      case S.cancelled:
        this.kinetics.endDrag(touch.timestamp);
        break;
    }
    this.syncOffset();
  }

  handleWheel(dx: number, dy: number): boolean {
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (!this.canScroll(axis)) return false;
    this.kinetics.wheel(dx, dy);
    this.syncOffset();
    return true;
  }

  private kineticsEvent(name: ScrollEvent, velocity?: { x: number; y: number }): void {
    const d = this.delegate;
    this.syncOffset();
    switch (name) {
      case 'scroll':
        d?.scrollViewDidScroll?.(this);
        break;
      case 'beginDrag':
        d?.scrollViewWillBeginDragging?.(this);
        break;
      case 'endDrag': {
        const target = { current: this.contentOffset };
        d?.scrollViewWillEndDragging?.(this, velocity ?? { x: 0, y: 0 }, target);
        d?.scrollViewDidEndDragging?.(this, true);
        break;
      }
      case 'momentumBegin':
        d?.scrollViewWillBeginDecelerating?.(this);
        break;
      case 'momentumEnd':
        d?.scrollViewDidEndDecelerating?.(this);
        break;
    }
  }

  // ── indicators ──────────────────────────────────────────────────────

  protected override layerWillDraw(): void {
    super.layerWillDraw();
    const bars = this.kinetics.indicators();
    this.indicatorY.show(bars.find((b) => b.axis === 'y') ?? null);
    this.indicatorX.show(bars.find((b) => b.axis === 'x') ?? null);
  }

  /** Current indicator bars (view coordinates), for tests and inspection. */
  indicators(): IndicatorBar[] {
    return this.kinetics.indicators();
  }

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    super.touchesBegan(touches, event);
  }
}

/** A scroll indicator: a pill on its own composited layer, so fading never re-rasters. */
class IndicatorLayer extends CALayer {
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

  override drawContent(ctx: import('@mimicry/os-core').LayerContext): void {
    const t = Math.min(this.width, this.height) / 2;
    const c = this.color;
    ctx.item({ x: ctx.x, y: ctx.y, w: this.width, h: this.height }, (w) => w.fillRRect(ctx.x, ctx.y, this.width, this.height, [t, t, t, t], c));
  }
}

const clampTo = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

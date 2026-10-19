import { clamp, type IndicatorBar, type ScrollKinetics, type ScrollMetrics } from '@mimicry/os-core';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';
import { safeAreaInsetsOf } from '../layout/safe-area';

/**
 * React Native's side of native scrolling. The scrolling itself — drag,
 * rubber band, momentum, paging, indicators — belongs to the OS scroll view
 * behind each ScrollView (UIScrollView, android.widget.ScrollView); this
 * manager reads React Native's props into it, computes the scrollable
 * bounds the way React Native lays content out, and turns the scroll
 * view's callbacks into onScroll & co.
 */
export class ScrollManager {
  private readonly observers = new Set<(node: HostNode) => void>();

  constructor(private readonly engine: Engine) {}

  /**
   * Native-side observers of scroll position (e.g. a navigation bar
   * collapsing its large title), called whenever any scroll view moves.
   */
  observe(listener: (node: HostNode) => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  /** The OS scroll view's kinetics (offset, phase, velocity). */
  kinetics(node: HostNode): ScrollKinetics {
    const view = node.hostView as unknown as { kinetics?: ScrollKinetics } | null;
    if (!view?.kinetics) throw new Error(`Mimicry: ${node} is not a scroll view`);
    return view.kinetics;
  }

  /** The scroll state, with the initial offset applied once the scroll view is laid out. */
  ensure(node: HostNode): ScrollKinetics {
    const k = this.kinetics(node);
    if (!node.native.scrollInitialized && node.laidOut) {
      node.native.scrollInitialized = true;
      const offset = node.props.contentOffset;
      const b = this.bounds(node);
      if (offset) {
        k.x = clamp(offset.x ?? 0, b.minX, b.maxX);
        k.y = clamp(offset.y ?? 0, b.minY, b.maxY);
      } else if (this.adjustsInsets(node)) {
        // UIKit starts an inset-adjusted scroll view at -adjustedContentInset
        k.x = b.minX;
        k.y = b.minY;
      }
      this.sync(node);
    }
    return k;
  }

  private adjustsInsets(node: HostNode): boolean {
    const behavior = node.props.contentInsetAdjustmentBehavior;
    return this.engine.platform === 'ios' && (behavior === 'automatic' || behavior === 'always' || behavior === 'scrollableAxes');
  }

  /**
   * contentInset plus, for `contentInsetAdjustmentBehavior` other than
   * 'never', the scroll view's safe area insets (UIScrollView.adjustedContentInset).
   */
  contentInsets(node: HostNode): { top: number; left: number; bottom: number; right: number } {
    const inset = node.props.contentInset ?? {};
    const out = { top: inset.top ?? 0, left: inset.left ?? 0, bottom: inset.bottom ?? 0, right: inset.right ?? 0 };
    if (!this.adjustsInsets(node)) return out;
    const safe = safeAreaInsetsOf(this.engine, node);
    const behavior = node.props.contentInsetAdjustmentBehavior;
    const vertical = behavior !== 'scrollableAxes' || !this.horizontal(node);
    const horizontal = behavior !== 'scrollableAxes' || this.horizontal(node);
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

  horizontal(node: HostNode): boolean {
    return !!node.props.horizontal;
  }

  /** Scrollable bounds from the laid-out content (React Native's contentSize). */
  bounds(node: HostNode): ScrollMetrics {
    const i = node.insets;
    let contentW = 0;
    let contentH = 0;
    for (const c of node.children) {
      contentW = Math.max(contentW, c.x + c.w);
      contentH = Math.max(contentH, c.y + c.h);
    }
    contentW += i.right;
    contentH += i.bottom;
    const inset = this.contentInsets(node);
    const viewportW = node.w;
    const viewportH = node.h;
    const minX = 0 - inset.left; // not -inset.left: avoid -0
    const minY = 0 - inset.top;
    return {
      contentW,
      contentH,
      viewportW,
      viewportH,
      minX,
      minY,
      maxX: Math.max(minX, contentW - viewportW + inset.right),
      maxY: Math.max(minY, contentH - viewportH + inset.bottom),
    };
  }

  /** Can this scroll view move along `axis`? */
  scrollable(node: HostNode, axis: 'x' | 'y'): boolean {
    return this.kinetics(node).scrollable(axis);
  }

  /** A touch went down on this scroll view: stop momentum. Returns true if it was moving. */
  touchDown(node: HostNode): boolean {
    const moving = this.ensure(node).touchDown();
    this.sync(node);
    return moving;
  }

  beginDrag(node: HostNode, px: number, py: number, t: number): void {
    this.engine.focus.dismissForScroll(node);
    this.ensure(node).beginDrag(px, py, t);
    this.sync(node);
  }

  drag(node: HostNode, px: number, py: number, t: number): void {
    this.ensure(node).drag(px, py, t);
    this.sync(node);
  }

  endDrag(node: HostNode, t: number): void {
    this.ensure(node).endDrag(t);
    this.sync(node);
  }

  wheel(node: HostNode, dx: number, dy: number): void {
    this.ensure(node).wheel(dx, dy);
    this.sync(node);
  }

  scrollTo(node: HostNode, x: number | undefined, y: number | undefined, animated: boolean): void {
    this.ensure(node).scrollTo(x, y, animated);
    this.sync(node);
  }

  scrollToEnd(node: HostNode, animated: boolean): void {
    const b = this.bounds(node);
    if (this.horizontal(node)) this.scrollTo(node, b.maxX, undefined, animated);
    else this.scrollTo(node, undefined, b.maxY, animated);
  }

  flash(node: HostNode): void {
    this.ensure(node).flash();
  }

  /** Content shrank or the viewport grew: idle offsets must stay in range (and say so). */
  clampAfterLayout(): void {
    for (const node of this.engine.nodes.values()) {
      if (node.kind !== 'scroll' || !node.native.scrollInitialized) continue;
      if (this.kinetics(node).clampIdle()) {
        this.sync(node);
        this.engine.markPaint();
      }
    }
  }

  /** The kinetics moved the content: the scroll view's bounds origin follows. */
  private sync(node: HostNode): void {
    const k = this.kinetics(node);
    const layer = node.hostView!.layer;
    layer.originX = k.x;
    layer.originY = k.y;
  }

  /** The OS scroll view reported a new offset. */
  didScroll(node: HostNode): void {
    this.sync(node);
    for (const observer of Array.from(this.observers)) observer(node);
    const k = this.kinetics(node);
    this.emitEvent(node, 'onScroll', { velocity: { x: k.vx, y: k.vy } }, 'continuous');
  }

  emitEvent(node: HostNode, name: string, extra: Record<string, unknown> = {}, priority: 'discrete' | 'continuous' = 'discrete'): void {
    if (typeof node.props[name] !== 'function') return;
    const k = this.kinetics(node);
    const b = this.bounds(node);
    const inset = this.contentInsets(node);
    this.engine.events.emit(node, name, {
      contentOffset: { x: k.x, y: k.y },
      contentSize: { width: b.contentW, height: b.contentH },
      layoutMeasurement: { width: b.viewportW, height: b.viewportH },
      contentInset: { top: inset.top ?? 0, left: inset.left ?? 0, bottom: inset.bottom ?? 0, right: inset.right ?? 0 },
      zoomScale: 1,
      responderIgnoreScroll: true,
      target: node.id,
      ...extra,
    }, this.engine.animator.animationTime, priority);
  }

  indicators(node: HostNode): IndicatorBar[] {
    return this.kinetics(node).indicators();
  }

  release(_node: HostNode): void {}
}

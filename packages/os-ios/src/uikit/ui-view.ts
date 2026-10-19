import type { LayerContext } from '@mimicry/os-core';
import { apply, intersect, type Rect } from '@mimicry/os-core';
import { CALayer } from '../quartz-core/ca-layer';
import { CGContext } from '../core-graphics/context';
import {
  CGAffineTransformIdentity, CGAffineTransformIsIdentity, CGRectZero, UIEdgeInsetsZero, fromMatrix, toMatrix,
  type CGAffineTransform, type CGPoint, type CGRect, type CGSize, type UIEdgeInsets,
} from '../core-graphics/geometry';
import type { UIColor } from './ui-color';
import type { UIEvent } from './ui-event';
import type { UIGestureRecognizer } from './ui-gesture-recognizer';
import { UIResponder } from './ui-responder';
import { UITraitCollection, UIUserInterfaceStyle } from './ui-trait-collection';
import type { UIWindow } from './ui-window';
import type { UIViewController } from './ui-view-controller';

export const UIViewNoIntrinsicMetric = -1;

export enum UIViewContentMode {
  scaleToFill = 0, scaleAspectFit = 1, scaleAspectFill = 2, redraw = 3, center = 4,
  top = 5, bottom = 6, left = 7, right = 8, topLeft = 9, topRight = 10, bottomLeft = 11, bottomRight = 12,
}

/**
 * UIView: a rectangle on screen backed by a CALayer. It owns the subview
 * hierarchy (mirrored onto sublayers), geometry (frame, bounds, center,
 * transform), appearance (backgroundColor, alpha, isHidden, clipsToBounds),
 * custom drawing (`draw(_:)`), layout (`layoutSubviews` on the layout pass),
 * hit testing, coordinate conversion, gesture recognizers, safe area and
 * trait collections.
 */
export class UIView extends UIResponder {
  /** override to back a view subclass with a CALayer subclass */
  static layerClass: new () => CALayer = CALayer;

  readonly layer: CALayer;
  private _superview: UIView | null = null;
  private readonly _subviews: UIView[] = [];
  private _backgroundColor: UIColor | null = null;
  private _tintColor: UIColor | null = null;
  private _transform: CGAffineTransform = CGAffineTransformIdentity;
  private _gestureRecognizers: UIGestureRecognizer[] = [];
  private needsLayout = true;
  private lastTraits: UITraitCollection | null = null;
  /** @internal the view controller whose root view this is */
  _viewController: UIViewController | null = null;

  isUserInteractionEnabled = true;
  isMultipleTouchEnabled = false;
  isExclusiveTouch = false;
  tag = 0;
  accessibilityIdentifier: string | null = null;
  accessibilityLabel: string | null = null;
  contentMode = UIViewContentMode.scaleToFill;
  overrideUserInterfaceStyle = UIUserInterfaceStyle.unspecified;
  insetsLayoutMarginsFromSafeArea = true;
  layoutMargins: UIEdgeInsets = { top: 8, left: 8, bottom: 8, right: 8 };

  constructor(frame: CGRect = CGRectZero) {
    super();
    const LayerClass = (this.constructor as typeof UIView).layerClass;
    this.layer = new LayerClass();
    this.layer.layerDelegate = {
      draw: (_layer, ctx) => this.drawLayerContent(ctx),
      drawOverlay: (_layer, ctx) => this.drawLayerOverlay(ctx),
      willDraw: () => this.layerWillDraw(),
    };
    this.layer.name = this.constructor.name;
    this.frame = frame;
  }

  // ── responder chain ─────────────────────────────────────────────────

  get next(): UIResponder | null {
    return this._viewController ?? this._superview;
  }

  // ── hierarchy ───────────────────────────────────────────────────────

  get superview(): UIView | null {
    return this._superview;
  }

  get subviews(): readonly UIView[] {
    return this._subviews;
  }

  get window(): UIWindow | null {
    let v: UIView | null = this;
    while (v) {
      if (v.isWindow) return v as unknown as UIWindow;
      v = v._superview;
    }
    return null;
  }

  /** @internal */
  get isWindow(): boolean {
    return false;
  }

  addSubview(view: UIView): void {
    this.insertSubview(view, this._subviews.length);
  }

  insertSubview(view: UIView, index: number): void {
    if (view === this) return;
    const sameParent = view._superview === this;
    const oldWindow = view.window;
    if (!sameParent) view.willMoveToSuperview(this);
    if (view._superview) view.detach();
    const at = Math.max(0, Math.min(index, this._subviews.length));
    this._subviews.splice(at, 0, view);
    view._superview = this;
    // Sublayers keep subview order; the layer index skips any non-view sublayers above.
    const nextView = this._subviews[at + 1];
    if (nextView) this.layer.insertSublayerBelow(view.layer, nextView.layer);
    else this.layer.addSublayer(view.layer);
    if (!sameParent) {
      view.didMoveToSuperview();
      this.didAddSubview(view);
    }
    const newWindow = view.window;
    if (newWindow !== oldWindow) view.propagateWindowChange(newWindow);
    this.setNeedsLayout();
  }

  insertSubviewBelow(view: UIView, sibling: UIView): void {
    const at = this._subviews.indexOf(sibling);
    this.insertSubview(view, at < 0 ? this._subviews.length : at);
  }

  insertSubviewAbove(view: UIView, sibling: UIView): void {
    const at = this._subviews.indexOf(sibling);
    this.insertSubview(view, at < 0 ? this._subviews.length : at + 1);
  }

  bringSubviewToFront(view: UIView): void {
    if (view._superview === this) this.insertSubview(view, this._subviews.length);
  }

  sendSubviewToBack(view: UIView): void {
    if (view._superview === this) this.insertSubview(view, 0);
  }

  exchangeSubview(i: number, j: number): void {
    const a = this._subviews[i];
    const b = this._subviews[j];
    if (!a || !b) return;
    this.insertSubview(a, j);
    this.insertSubview(b, i);
  }

  removeFromSuperview(): void {
    const parent = this._superview;
    if (!parent) return;
    const oldWindow = this.window;
    parent.willRemoveSubview(this);
    this.willMoveToSuperview(null);
    this.detach();
    this.didMoveToSuperview();
    if (oldWindow) this.propagateWindowChange(null);
    parent.setNeedsLayout();
  }

  private detach(): void {
    const parent = this._superview;
    if (!parent) return;
    const at = parent._subviews.indexOf(this);
    if (at >= 0) parent._subviews.splice(at, 1);
    this._superview = null;
    this.layer.removeFromSuperlayer();
  }

  private propagateWindowChange(window: UIWindow | null): void {
    this.willMoveToWindow(window);
    this.didMoveToWindow();
    for (const sub of this._subviews) sub.propagateWindowChange(window);
    if (window) {
      this.needsLayout = true;
      window._scheduleLayout();
    }
  }

  isDescendantOf(view: UIView): boolean {
    for (let v: UIView | null = this; v; v = v._superview) if (v === view) return true;
    return false;
  }

  viewWithTag(tag: number): UIView | null {
    if (this.tag === tag) return this;
    for (const sub of this._subviews) {
      const found = sub.viewWithTag(tag);
      if (found) return found;
    }
    return null;
  }

  // observation hooks (override)
  didAddSubview(_subview: UIView): void {}
  willRemoveSubview(_subview: UIView): void {}
  willMoveToSuperview(_superview: UIView | null): void {}
  didMoveToSuperview(): void {}
  willMoveToWindow(_window: UIWindow | null): void {}
  didMoveToWindow(): void {}

  // ── geometry ────────────────────────────────────────────────────────

  get frame(): CGRect {
    if (CGAffineTransformIsIdentity(this._transform)) return this.layer.frame;
    const r = this.layer.windowRect();
    const parent = this._superview;
    if (!parent) return { origin: { x: r.x, y: r.y }, size: { width: r.w, height: r.h } };
    const [x, y] = parent.layer.convertFromWindow(r.x, r.y);
    return { origin: { x, y }, size: { width: r.w, height: r.h } };
  }

  set frame(r: CGRect) {
    const old = this.layer.frame;
    this.layer.frame = r;
    if (old.size.width !== r.size.width || old.size.height !== r.size.height) this.boundsSizeChanged();
    this.layer.setNeedsDisplay();
  }

  get bounds(): CGRect {
    return this.layer.boundsRect;
  }

  set bounds(r: CGRect) {
    const old = this.layer.boundsRect;
    this.layer.boundsRect = r;
    if (old.size.width !== r.size.width || old.size.height !== r.size.height) this.boundsSizeChanged();
    this.layer.setNeedsDisplay();
  }

  get center(): CGPoint {
    return this.layer.position;
  }

  set center(p: CGPoint) {
    this.layer.position = p;
    this.layer.setNeedsDisplay();
  }

  get transform(): CGAffineTransform {
    return this._transform;
  }

  set transform(t: CGAffineTransform) {
    this._transform = t;
    this.layer.affineTransform = CGAffineTransformIsIdentity(t) ? null : toMatrix(t);
    this.layer.setNeedsDisplay();
  }

  private boundsSizeChanged(): void {
    this.setNeedsLayout();
    this._superview?.setNeedsLayout();
  }

  convertPoint(point: CGPoint, to: UIView | null): CGPoint {
    const [x, y] = this.layer.convertPoint(point.x, point.y, to ? to.layer : null);
    return { x, y };
  }

  convertPointFrom(point: CGPoint, from: UIView | null): CGPoint {
    if (!from) {
      const [x, y] = this.layer.convertFromWindow(point.x, point.y);
      return { x, y };
    }
    return from.convertPoint(point, this);
  }

  convertRect(rect: CGRect, to: UIView | null): CGRect {
    const m = this.layer.windowMatrix();
    const corners = [
      apply(m, rect.origin.x, rect.origin.y),
      apply(m, rect.origin.x + rect.size.width, rect.origin.y + rect.size.height),
    ];
    let [ax, ay] = corners[0]!;
    let [bx, by] = corners[1]!;
    if (to) {
      [ax, ay] = to.layer.convertFromWindow(ax, ay);
      [bx, by] = to.layer.convertFromWindow(bx, by);
    }
    return { origin: { x: Math.min(ax, bx), y: Math.min(ay, by) }, size: { width: Math.abs(bx - ax), height: Math.abs(by - ay) } };
  }

  // ── appearance ──────────────────────────────────────────────────────

  get backgroundColor(): UIColor | null {
    return this._backgroundColor;
  }

  set backgroundColor(c: UIColor | null) {
    this._backgroundColor = c;
    this.layer.setNeedsDisplay();
  }

  get alpha(): number {
    return this.layer.opacity;
  }

  set alpha(a: number) {
    this.layer.opacity = Math.max(0, Math.min(1, a));
    this.layer.setNeedsDisplay();
  }

  get isHidden(): boolean {
    return this.layer.hidden;
  }

  set isHidden(h: boolean) {
    this.layer.hidden = h;
    this.layer.setNeedsDisplay();
  }

  get clipsToBounds(): boolean {
    return this.layer.masksToBounds;
  }

  set clipsToBounds(c: boolean) {
    this.layer.masksToBounds = c;
    this.layer.setNeedsDisplay();
  }

  get isOpaque(): boolean {
    return false;
  }

  get tintColor(): UIColor | null {
    if (this._tintColor) return this._tintColor;
    return this._superview?.tintColor ?? null;
  }

  set tintColor(c: UIColor | null) {
    this._tintColor = c;
    this.tintColorDidChange();
  }

  tintColorDidChange(): void {
    this.setNeedsDisplay();
    for (const sub of this._subviews) if (!sub._tintColor) sub.tintColorDidChange();
  }

  // ── traits ──────────────────────────────────────────────────────────

  get traitCollection(): UITraitCollection {
    const inherited = this._superview?.traitCollection ?? this.window?.screenTraits ?? DEFAULT_TRAITS;
    const style = this._viewController?.overrideUserInterfaceStyle ?? UIUserInterfaceStyle.unspecified;
    return inherited.withStyle(this.overrideUserInterfaceStyle !== UIUserInterfaceStyle.unspecified ? this.overrideUserInterfaceStyle : style);
  }

  traitCollectionDidChange(_previous: UITraitCollection | null): void {}

  /** @internal called by the window when screen traits change */
  _traitsChanged(): void {
    const traits = this.traitCollection;
    const previous = this.lastTraits;
    this.lastTraits = traits;
    if (previous && previous !== traits) this.traitCollectionDidChange(previous);
    this.setNeedsDisplay();
    for (const sub of this._subviews) sub._traitsChanged();
  }

  // ── safe area ───────────────────────────────────────────────────────

  /**
   * The parts of the view covered by the window's safe area insets (status
   * bar, home indicator, notch), plus any additionalSafeAreaInsets of view
   * controllers in between, clipped to the view's own bounds.
   */
  get safeAreaInsets(): UIEdgeInsets {
    const window = this.window;
    if (!window) return UIEdgeInsetsZero;
    const outer = window.windowSafeAreaInsets(this);
    const r = this.layer.windowRect();
    const v = { w: window.bounds.size.width, h: window.bounds.size.height };
    return {
      top: Math.max(0, Math.min(r.h, outer.top - r.y)),
      left: Math.max(0, Math.min(r.w, outer.left - r.x)),
      bottom: Math.max(0, Math.min(r.h, r.y + r.h - (v.h - outer.bottom))),
      right: Math.max(0, Math.min(r.w, r.x + r.w - (v.w - outer.right))),
    };
  }

  safeAreaInsetsDidChange(): void {}

  // ── layout ──────────────────────────────────────────────────────────

  setNeedsLayout(): void {
    this.needsLayout = true;
    this.window?._scheduleLayout();
  }

  layoutIfNeeded(): void {
    this._layoutPass();
  }

  /** Override to position subviews; called on the layout pass after setNeedsLayout. */
  layoutSubviews(): void {
    this._viewController?.viewWillLayoutSubviews();
    this._viewController?.viewDidLayoutSubviews();
  }

  /** @internal UIKit's layout pass: top-down, each view that needs it. */
  _layoutPass(): void {
    if (this.needsLayout) {
      this.needsLayout = false;
      this.layoutSubviews();
    }
    for (const sub of this._subviews.slice()) sub._layoutPass();
  }

  sizeThatFits(size: CGSize): CGSize {
    return { width: this.bounds.size.width || size.width, height: this.bounds.size.height || size.height };
  }

  sizeToFit(): void {
    const size = this.sizeThatFits({ width: Infinity, height: Infinity });
    const f = this.frame;
    this.frame = { origin: f.origin, size };
  }

  get intrinsicContentSize(): CGSize {
    return { width: UIViewNoIntrinsicMetric, height: UIViewNoIntrinsicMetric };
  }

  invalidateIntrinsicContentSize(): void {
    this._superview?.setNeedsLayout();
  }

  // ── drawing ─────────────────────────────────────────────────────────

  setNeedsDisplay(): void {
    this.layer.setNeedsDisplay();
  }

  /** Override for custom drawing in the view's own coordinates (Quartz 2D). */
  draw(_ctx: CGContext, _rect: CGRect): void {}

  /**
   * Draw the view's content into the frame recorder. The default records the
   * view's `draw(_:)` as one item over its bounds; views that know which
   * parts of themselves are visible (text, images) override this to record
   * finer items.
   */
  protected drawLayerContent(ctx: LayerContext): void {
    if (this.draw === UIView.prototype.draw) return;
    const b = this.bounds;
    ctx.item({ x: ctx.x, y: ctx.y, w: b.size.width, h: b.size.height }, (w) => {
      w.save();
      w.transform(1, 0, 0, 1, ctx.x, ctx.y);
      this.draw(new CGContext(w, this.traitCollection), { origin: { x: 0, y: 0 }, size: b.size });
      w.restore();
    });
  }

  /** Drawn above the subviews (rarely needed: focus rings, foreground effects). */
  protected drawLayerOverlay(_ctx: LayerContext): void {}

  /** Right before the layer draws: resolve dynamic colors against the current traits. */
  protected layerWillDraw(): void {
    const bg = this._backgroundColor;
    this.layer.backgroundColor = bg ? bg.resolvedColor(this.traitCollection).rgba : null;
  }

  // ── hit testing ─────────────────────────────────────────────────────

  /** The deepest descendant (or self) that contains `point` (own coordinates) and takes touches. */
  hitTest(point: CGPoint, event: UIEvent | null): UIView | null {
    if (!this.isUserInteractionEnabled || this.isHidden || this.alpha < 0.01) return null;
    if (!this.pointInside(point, event)) return null;
    for (let i = this._subviews.length - 1; i >= 0; i--) {
      const sub = this._subviews[i]!;
      const local = sub.convertPointFrom(point, this);
      const hit = sub.hitTest(local, event);
      if (hit) return hit;
    }
    return this;
  }

  pointInside(point: CGPoint, _event: UIEvent | null): boolean {
    const b = this.bounds;
    return point.x >= b.origin.x && point.y >= b.origin.y && point.x < b.origin.x + b.size.width && point.y < b.origin.y + b.size.height;
  }

  // ── gestures ────────────────────────────────────────────────────────

  get gestureRecognizers(): readonly UIGestureRecognizer[] {
    return this._gestureRecognizers;
  }

  addGestureRecognizer(recognizer: UIGestureRecognizer): void {
    if (this._gestureRecognizers.includes(recognizer)) return;
    recognizer.view?.removeGestureRecognizer(recognizer);
    this._gestureRecognizers.push(recognizer);
    recognizer._setView(this);
  }

  removeGestureRecognizer(recognizer: UIGestureRecognizer): void {
    const at = this._gestureRecognizers.indexOf(recognizer);
    if (at < 0) return;
    this._gestureRecognizers.splice(at, 1);
    recognizer._setView(null);
  }

  gestureRecognizerShouldBegin(_recognizer: UIGestureRecognizer): boolean {
    return true;
  }

  /** The visible part of the view in window coordinates, after ancestor clipping. */
  visibleWindowRect(): Rect | null {
    let visible: Rect | null = this.layer.windowRect();
    for (let v = this._superview; v && visible; v = v._superview) {
      if (v.clipsToBounds) visible = intersect(visible, v.layer.windowRect());
    }
    return visible;
  }

  /** CGAffineTransform of the layer (convenience for subclasses). */
  protected get layerTransform(): CGAffineTransform {
    return this.layer.transform ? fromMatrix(this.layer.transform) : CGAffineTransformIdentity;
  }
}

const DEFAULT_TRAITS = new UITraitCollection(UIUserInterfaceStyle.light, 1, 2, 3, 0, 'UICTContentSizeCategoryL');

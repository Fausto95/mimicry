import { invert, type RenderLayer } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { MotionEvent } from './motion-event';
import { LayoutParams, MeasureSpec, View } from './view';
import { Gravity } from './gravity';
import type { Canvas } from '../graphics/canvas';
import type { Drawable } from '../graphics/drawable';
import type { ViewRootImpl } from './view-root';
import type { WindowInsets } from './window-insets';

/**
 * android.view.ViewGroup: children, drawing order and the touch dispatch
 * protocol — onInterceptTouchEvent, touch targets that own pointers, and
 * requestDisallowInterceptTouchEvent — as in the framework.
 */
interface TouchTarget {
  child: View;
  pointerIdBits: number;
}

export class ViewGroup extends View {
  private readonly children: View[] = [];
  private touchTargets: TouchTarget[] = [];
  private disallowIntercept = false;
  private clipChildren = true;
  private childrenDrawingOrderEnabled = false;

  constructor(context: Context) {
    super(context);
    this.renderNode.masksToBounds = true;
  }

  // ── children ────────────────────────────────────────────────────────

  getChildCount(): number {
    return this.children.length;
  }

  getChildAt(index: number): View | null {
    return this.children[index] ?? null;
  }

  indexOfChild(child: View): number {
    return this.children.indexOf(child);
  }

  addView(child: View, index = -1, params?: LayoutParams): void {
    if (child._parent) throw new Error('IllegalStateException: The specified child already has a parent. You must call removeView() on the child\'s parent first.');
    if (params) child.setLayoutParams(params);
    else if (!child.getLayoutParams()) child.setLayoutParams(this.generateDefaultLayoutParams());
    const at = index < 0 || index > this.children.length ? this.children.length : index;
    this.children.splice(at, 0, child);
    child._parent = this;
    const next = this.children[at + 1];
    if (next) this.renderNode.insertSublayerBelow(child.renderNode, next.renderNode);
    else this.renderNode.addSublayer(child.renderNode);
    this.onViewAdded(child);
    if (this._attachInfo) dispatchAttach(child, this._attachInfo);
    this.requestLayout();
    this.invalidate();
  }

  removeView(child: View): void {
    const at = this.children.indexOf(child);
    if (at >= 0) this.removeViewAt(at);
  }

  removeViewAt(index: number): void {
    const child = this.children[index];
    if (!child) return;
    this.touchTargets = this.touchTargets.filter((t) => t.child !== child);
    if (child._attachInfo) dispatchDetach(child);
    this.children.splice(index, 1);
    child._parent = null;
    child.renderNode.removeFromSuperlayer();
    this.onViewRemoved(child);
    this.requestLayout();
    this.invalidate();
  }

  removeAllViews(): void {
    while (this.children.length) this.removeViewAt(this.children.length - 1);
  }

  onViewAdded(_child: View): void {}
  onViewRemoved(_child: View): void {}

  protected generateDefaultLayoutParams(): LayoutParams {
    return new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
  }

  override findViewById<T extends View = View>(id: number): T | null {
    if (this.getId() === id) return this as unknown as T;
    for (const child of this.children) {
      const found = child.findViewById<T>(id);
      if (found) return found;
    }
    return null;
  }

  // ── drawing order ───────────────────────────────────────────────────

  getClipChildren(): boolean {
    return this.clipChildren;
  }

  setClipChildren(clip: boolean): void {
    this.clipChildren = clip;
    this.renderNode.masksToBounds = clip;
    this.invalidate();
  }

  setChildrenDrawingOrderEnabled(enabled: boolean): void {
    this.childrenDrawingOrderEnabled = enabled;
    this.invalidate();
  }

  isChildrenDrawingOrderEnabled(): boolean {
    return this.childrenDrawingOrderEnabled;
  }

  /** With drawing order enabled: which child to draw at position `drawingPosition`. */
  getChildDrawingOrder(_childCount: number, drawingPosition: number): number {
    return drawingPosition;
  }

  /**
   * Children in drawing order: Z (elevation + translationZ) ascending, ties
   * in custom drawing order (or child order) — ViewGroup.buildOrderedChildList.
   */
  orderedChildren(): View[] {
    const count = this.children.length;
    const order = this.childrenDrawingOrderEnabled
      ? Array.from({ length: count }, (_, i) => this.children[this.getChildDrawingOrder(count, i)] ?? this.children[i]!)
      : this.children.slice();
    if (!order.some((c) => c.getZ() !== 0)) return order;
    return order.map((c, i) => ({ c, i })).sort((a, b) => a.c.getZ() - b.c.getZ() || a.i - b.i).map((x) => x.c);
  }

  override _orderedChildNodes(): readonly RenderLayer[] {
    return this.orderedChildren().map((c) => c.renderNode);
  }

  // ── layout ──────────────────────────────────────────────────────────

  protected measureChild(child: View, parentWidthMeasureSpec: number, parentHeightMeasureSpec: number): void {
    const lp = child.getLayoutParams() ?? this.generateDefaultLayoutParams();
    child.measure(
      ViewGroup.getChildMeasureSpec(parentWidthMeasureSpec, this.getPaddingLeft() + this.getPaddingRight(), lp.width),
      ViewGroup.getChildMeasureSpec(parentHeightMeasureSpec, this.getPaddingTop() + this.getPaddingBottom(), lp.height),
    );
  }

  protected measureChildren(widthMeasureSpec: number, heightMeasureSpec: number): void {
    for (const child of this.children) if (child.getVisibility() !== View.GONE) this.measureChild(child, widthMeasureSpec, heightMeasureSpec);
  }

  static getChildMeasureSpec(spec: number, padding: number, childDimension: number): number {
    const specMode = MeasureSpec.getMode(spec);
    const size = Math.max(0, MeasureSpec.getSize(spec) - padding);
    if (childDimension >= 0) return MeasureSpec.makeMeasureSpec(childDimension, MeasureSpec.EXACTLY);
    if (childDimension === LayoutParams.MATCH_PARENT) {
      return specMode === MeasureSpec.UNSPECIFIED ? MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED) : MeasureSpec.makeMeasureSpec(size, specMode);
    }
    // WRAP_CONTENT
    return specMode === MeasureSpec.UNSPECIFIED ? MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED) : MeasureSpec.makeMeasureSpec(size, MeasureSpec.AT_MOST);
  }

  // ── touch dispatch ──────────────────────────────────────────────────

  /**
   * Whether children's pressed state (and drags that might be scrolls)
   * should wait: true for scrolling containers. SeekBar and Slider check
   * their ancestors before they start dragging.
   */
  shouldDelayChildPressedState(): boolean {
    return false;
  }

  /** @internal is any ancestor of `view` a scrolling container? */
  static isInScrollingContainer(view: View): boolean {
    for (let p = view.getParent(); p; p = p.getParent()) if (p.shouldDelayChildPressedState()) return true;
    return false;
  }

  /** Return true to steal the gesture from the children (they get ACTION_CANCEL). */
  onInterceptTouchEvent(_event: MotionEvent): boolean {
    return false;
  }

  requestDisallowInterceptTouchEvent(disallow: boolean): void {
    if (this.disallowIntercept === disallow) return;
    this.disallowIntercept = disallow;
    this._parent?.requestDisallowInterceptTouchEvent(disallow);
  }

  override dispatchTouchEvent(event: MotionEvent): boolean {
    const action = event.getActionMasked();
    if (action === MotionEvent.ACTION_DOWN) {
      this.cancelAndClearTouchTargets(event);
      this.disallowIntercept = false;
    }
    let intercepted: boolean;
    if (action === MotionEvent.ACTION_DOWN || this.touchTargets.length) {
      intercepted = !this.disallowIntercept && this.onInterceptTouchEvent(event);
    } else {
      intercepted = true;
    }
    const canceled = action === MotionEvent.ACTION_CANCEL;
    let handled = false;
    let newTarget: TouchTarget | null = null;
    let alreadyDispatchedToNew = false;

    if (!canceled && !intercepted && (action === MotionEvent.ACTION_DOWN || action === MotionEvent.ACTION_POINTER_DOWN)) {
      const index = event.getActionIndex();
      const idBit = 1 << event.getPointerId(index);
      const x = event.getX(index);
      const y = event.getY(index);
      const ordered = this.orderedChildren();
      for (let i = ordered.length - 1; i >= 0; i--) {
        const child = ordered[i]!;
        if (!this.canReceivePointer(child, x, y)) continue;
        const existing = this.touchTargets.find((t) => t.child === child);
        if (existing) {
          existing.pointerIdBits |= idBit;
          newTarget = existing;
          break;
        }
        if (this.dispatchTransformed(event, false, child, idBit)) {
          newTarget = { child, pointerIdBits: idBit };
          this.touchTargets.unshift(newTarget);
          alreadyDispatchedToNew = true;
          break;
        }
      }
      if (!newTarget && this.touchTargets.length) {
        // No child took the new pointer: give it to the most recent target.
        newTarget = this.touchTargets[this.touchTargets.length - 1]!;
        newTarget.pointerIdBits |= idBit;
      }
    }

    if (!this.touchTargets.length) {
      handled = this.dispatchTransformed(event, canceled, null, ALL_POINTERS);
    } else {
      for (const target of this.touchTargets.slice()) {
        if (alreadyDispatchedToNew && target === newTarget) {
          handled = true;
          continue;
        }
        const cancelChild = intercepted;
        if (this.dispatchTransformed(event, cancelChild, target.child, target.pointerIdBits)) handled = true;
        if (cancelChild) this.touchTargets = this.touchTargets.filter((t) => t !== target);
      }
    }

    if (canceled || action === MotionEvent.ACTION_UP) {
      this.touchTargets = [];
      this.disallowIntercept = false;
    } else if (action === MotionEvent.ACTION_POINTER_UP) {
      const idBit = 1 << event.getPointerId(event.getActionIndex());
      for (const t of this.touchTargets) t.pointerIdBits &= ~idBit;
      this.touchTargets = this.touchTargets.filter((t) => t.pointerIdBits !== 0);
    }
    return handled;
  }

  /** Is (x, y) — in this view's coordinates — inside `child`, and does it take touches? */
  protected canReceivePointer(child: View, x: number, y: number): boolean {
    if (child.getVisibility() !== View.VISIBLE) return false;
    const [lx, ly] = this.toChild(child, x, y);
    return lx >= 0 && ly >= 0 && lx < child.getWidth() && ly < child.getHeight();
  }

  /** this view's coordinates → the child's */
  protected toChild(child: View, x: number, y: number): [number, number] {
    const m = child.renderNode.localMatrix();
    const inv = invert(m);
    if (!inv) return [x, y];
    return [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]];
  }

  private dispatchTransformed(event: MotionEvent, cancel: boolean, child: View | null, idBits: number): boolean {
    const copy = idBits === ALL_POINTERS ? MotionEvent.obtainCopy(event) : event.split(idBits);
    if (!copy) return false;
    if (cancel) copy.setAction(MotionEvent.ACTION_CANCEL);
    if (!child) return super.dispatchTouchEvent(copy);
    const inv = invert(child.renderNode.localMatrix());
    if (inv) copy.transform(inv);
    return child.dispatchTouchEvent(copy);
  }

  private cancelAndClearTouchTargets(event: MotionEvent): void {
    for (const target of this.touchTargets) {
      const copy = MotionEvent.obtainCopy(event);
      copy.setAction(MotionEvent.ACTION_CANCEL);
      target.child.dispatchTouchEvent(copy);
    }
    this.touchTargets = [];
  }

  protected override dispatchSetSelected(selected: boolean): void {
    for (const child of this.children) child.setSelected(selected);
  }

  protected override dispatchSetActivated(activated: boolean): void {
    for (const child of this.children) child.setActivated(activated);
  }

  // ── attach & insets ─────────────────────────────────────────────────

  override dispatchApplyWindowInsets(insets: WindowInsets): WindowInsets {
    const result = super.dispatchApplyWindowInsets(insets);
    if (result.isConsumed()) return result;
    for (const child of this.children) child.dispatchApplyWindowInsets(result);
    return result;
  }

  /** @internal */
  get childViews(): readonly View[] {
    return this.children;
  }
}

const ALL_POINTERS = -1;

export function dispatchAttach(view: View, info: ViewRootImpl): void {
  view._dispatchAttachedToWindow(info);
  if (view instanceof ViewGroup) for (const child of view.childViews) dispatchAttach(child, info);
}

export function dispatchDetach(view: View): void {
  if (view instanceof ViewGroup) for (const child of view.childViews) dispatchDetach(child);
  view._dispatchDetachedFromWindow();
}

/** ViewGroup.MarginLayoutParams: layout params with margins (dp). */
export class MarginLayoutParams extends LayoutParams {
  leftMargin = 0;
  topMargin = 0;
  rightMargin = 0;
  bottomMargin = 0;

  constructor(width: number | LayoutParams = LayoutParams.WRAP_CONTENT, height: number = LayoutParams.WRAP_CONTENT) {
    super(typeof width === 'number' ? width : width.width, typeof width === 'number' ? height : width.height);
    if (width instanceof MarginLayoutParams) this.setMargins(width.leftMargin, width.topMargin, width.rightMargin, width.bottomMargin);
  }

  setMargins(left: number, top: number, right: number, bottom: number): this {
    this.leftMargin = left;
    this.topMargin = top;
    this.rightMargin = right;
    this.bottomMargin = bottom;
    return this;
  }

  setMarginStart(start: number): void {
    this.leftMargin = start;
  }

  setMarginEnd(end: number): void {
    this.rightMargin = end;
  }

  getMarginStart(): number {
    return this.leftMargin;
  }

  getMarginEnd(): number {
    return this.rightMargin;
  }
}

/** The margins of any layout params (zero for plain ones). */
export function marginsOf(lp: LayoutParams | null): { left: number; top: number; right: number; bottom: number } {
  if (lp instanceof MarginLayoutParams) return { left: lp.leftMargin, top: lp.topMargin, right: lp.rightMargin, bottom: lp.bottomMargin };
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

/** FrameLayout.LayoutParams: margins plus the child's gravity in the frame. */
export class FrameLayoutParams extends MarginLayoutParams {
  static readonly UNSPECIFIED_GRAVITY = -1;
  gravity: number = FrameLayoutParams.UNSPECIFIED_GRAVITY;

  constructor(width: number | LayoutParams = LayoutParams.WRAP_CONTENT, height: number = LayoutParams.WRAP_CONTENT, gravity: number = FrameLayoutParams.UNSPECIFIED_GRAVITY) {
    super(width, height);
    if (width instanceof FrameLayoutParams) this.gravity = width.gravity;
    else if (gravity !== FrameLayoutParams.UNSPECIFIED_GRAVITY) this.gravity = gravity;
  }
}

/** ViewGroup.measureChildWithMargins: a child's measure specs, minus its margins and the space already used. */
export function measureChildWithMargins(parent: ViewGroup, child: View, parentWidthMeasureSpec: number, widthUsed: number, parentHeightMeasureSpec: number, heightUsed: number): void {
  const lp = child.getLayoutParams() ?? new LayoutParams();
  const m = marginsOf(lp);
  child.measure(
    ViewGroup.getChildMeasureSpec(parentWidthMeasureSpec, parent.getPaddingLeft() + parent.getPaddingRight() + m.left + m.right + widthUsed, lp.width),
    ViewGroup.getChildMeasureSpec(parentHeightMeasureSpec, parent.getPaddingTop() + parent.getPaddingBottom() + m.top + m.bottom + heightUsed, lp.height),
  );
}

/**
 * android.widget.FrameLayout: children stacked, each placed by its
 * layout_gravity (top-left by default) inside the padding, the frame sized
 * to the largest child. When the frame is not exactly sized, MATCH_PARENT
 * children are measured again at its final size, as in the framework.
 */
export class FrameLayout extends ViewGroup {
  static readonly LayoutParams = FrameLayoutParams;
  private measureAllChildren = false;

  protected override generateDefaultLayoutParams(): LayoutParams {
    return new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
  }

  setMeasureAllChildren(measureAll: boolean): void {
    this.measureAllChildren = measureAll;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const measureMatchParent = MeasureSpec.getMode(widthMeasureSpec) !== MeasureSpec.EXACTLY || MeasureSpec.getMode(heightMeasureSpec) !== MeasureSpec.EXACTLY;
    const matchParent: View[] = [];
    let maxW = 0;
    let maxH = 0;
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (!this.measureAllChildren && child.getVisibility() === View.GONE) continue;
      measureChildWithMargins(this, child, widthMeasureSpec, 0, heightMeasureSpec, 0);
      const lp = child.getLayoutParams();
      const m = marginsOf(lp);
      maxW = Math.max(maxW, child.getMeasuredWidth() + m.left + m.right);
      maxH = Math.max(maxH, child.getMeasuredHeight() + m.top + m.bottom);
      if (measureMatchParent && lp && (lp.width === LayoutParams.MATCH_PARENT || lp.height === LayoutParams.MATCH_PARENT)) matchParent.push(child);
    }
    maxW += this.getPaddingLeft() + this.getPaddingRight();
    maxH += this.getPaddingTop() + this.getPaddingBottom();
    maxW = Math.max(maxW, this.getMinimumWidth());
    maxH = Math.max(maxH, this.getMinimumHeight());
    this.setMeasuredDimension(View.resolveSize(maxW, widthMeasureSpec), View.resolveSize(maxH, heightMeasureSpec));
    if (matchParent.length > 1) {
      for (const child of matchParent) {
        const lp = child.getLayoutParams()!;
        const m = marginsOf(lp);
        const padW = this.getPaddingLeft() + this.getPaddingRight() + m.left + m.right;
        const padH = this.getPaddingTop() + this.getPaddingBottom() + m.top + m.bottom;
        const wSpec = lp.width === LayoutParams.MATCH_PARENT
          ? MeasureSpec.makeMeasureSpec(Math.max(0, this.getMeasuredWidth() - padW), MeasureSpec.EXACTLY)
          : ViewGroup.getChildMeasureSpec(widthMeasureSpec, padW, lp.width);
        const hSpec = lp.height === LayoutParams.MATCH_PARENT
          ? MeasureSpec.makeMeasureSpec(Math.max(0, this.getMeasuredHeight() - padH), MeasureSpec.EXACTLY)
          : ViewGroup.getChildMeasureSpec(heightMeasureSpec, padH, lp.height);
        child.measure(wSpec, hSpec);
      }
    }
  }

  protected override onLayout(_changed: boolean, l: number, t: number, r: number, b: number): void {
    this.layoutChildren(l, t, r, b);
  }

  /** FrameLayout.layoutChildren: each child at its gravity inside the padding, offset by its margins. */
  protected layoutChildren(l: number, t: number, r: number, b: number): void {
    const parentLeft = this.getPaddingLeft();
    const parentRight = r - l - this.getPaddingRight();
    const parentTop = this.getPaddingTop();
    const parentBottom = b - t - this.getPaddingBottom();
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (child.getVisibility() === View.GONE) continue;
      const lp = child.getLayoutParams();
      const m = marginsOf(lp);
      const width = child.getMeasuredWidth();
      const height = child.getMeasuredHeight();
      let gravity = lp instanceof FrameLayoutParams ? lp.gravity : -1;
      if (gravity === -1) gravity = Gravity.TOP | Gravity.START;
      const abs = Gravity.getAbsoluteGravity(gravity);
      let left: number;
      switch (abs & Gravity.HORIZONTAL_GRAVITY_MASK) {
        case Gravity.CENTER_HORIZONTAL:
          left = parentLeft + (parentRight - parentLeft - width) / 2 + m.left - m.right;
          break;
        case Gravity.RIGHT:
          left = parentRight - width - m.right;
          break;
        default:
          left = parentLeft + m.left;
      }
      let top: number;
      switch (abs & Gravity.VERTICAL_GRAVITY_MASK) {
        case Gravity.CENTER_VERTICAL:
          top = parentTop + (parentBottom - parentTop - height) / 2 + m.top - m.bottom;
          break;
        case Gravity.BOTTOM:
          top = parentBottom - height - m.bottom;
          break;
        default:
          top = parentTop + m.top;
      }
      child.layout(left, top, left + width, top + height);
    }
  }
}

/** LinearLayout.LayoutParams: margins, a weight along the orientation and a cross-axis gravity. */
export class LinearLayoutParams extends MarginLayoutParams {
  weight = 0;
  gravity = -1;

  constructor(width: number | LayoutParams = LayoutParams.WRAP_CONTENT, height: number = LayoutParams.WRAP_CONTENT, weight = 0) {
    super(width, height);
    if (width instanceof LinearLayoutParams) {
      this.weight = width.weight;
      this.gravity = width.gravity;
    } else this.weight = weight;
  }
}

type Margins = ReturnType<typeof marginsOf>;

/**
 * android.widget.LinearLayout: children in a row or column. Weighted
 * children share the space left once the others are measured (a weighted
 * child of size 0 gets exactly its share); the layout's gravity positions
 * the content along the orientation, a child's layout_gravity (or the
 * layout's gravity) across it. Dividers draw between children when
 * showDividers asks for them.
 */
export class LinearLayout extends ViewGroup {
  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  static readonly SHOW_DIVIDER_NONE = 0;
  static readonly SHOW_DIVIDER_BEGINNING = 1;
  static readonly SHOW_DIVIDER_MIDDLE = 2;
  static readonly SHOW_DIVIDER_END = 4;
  static readonly LayoutParams = LinearLayoutParams;
  private orientation = LinearLayout.HORIZONTAL;
  private gravity: number = Gravity.START | Gravity.TOP;
  private weightSum = -1;
  private totalLength = 0;
  private divider: Drawable | null = null;
  private dividerSize = 0;
  private showDividers = LinearLayout.SHOW_DIVIDER_NONE;
  private dividerPadding = 0;

  setOrientation(orientation: number): void {
    this.orientation = orientation;
    this.requestLayout();
  }

  getOrientation(): number {
    return this.orientation;
  }

  setGravity(gravity: number): void {
    if ((gravity & Gravity.RELATIVE_HORIZONTAL_GRAVITY_MASK) === 0) gravity |= Gravity.START;
    if ((gravity & Gravity.VERTICAL_GRAVITY_MASK) === 0) gravity |= Gravity.TOP;
    this.gravity = gravity;
    this.requestLayout();
  }

  getGravity(): number {
    return this.gravity;
  }

  setWeightSum(weightSum: number): void {
    this.weightSum = weightSum;
    this.requestLayout();
  }

  getWeightSum(): number {
    return this.weightSum;
  }

  /** A divider drawable (its intrinsic size along the orientation, or 1 dp). */
  setDividerDrawable(divider: Drawable | null): void {
    this.divider = divider;
    const size = divider ? (this.orientation === LinearLayout.VERTICAL ? divider.getIntrinsicHeight() : divider.getIntrinsicWidth()) : 0;
    this.dividerSize = divider ? (size > 0 ? size : 1) : 0;
    this.requestLayout();
  }

  setShowDividers(showDividers: number): void {
    this.showDividers = showDividers;
    this.requestLayout();
  }

  setDividerPadding(padding: number): void {
    this.dividerPadding = padding;
    this.invalidate();
  }

  protected override generateDefaultLayoutParams(): LayoutParams {
    return this.orientation === LinearLayout.VERTICAL
      ? new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
      : new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
  }

  private visibleChildren(): View[] {
    return this.childViews.filter((c) => c.getVisibility() !== View.GONE);
  }

  /** Is there a divider before the visible child at `index` (index === count: after the last)? */
  private hasDividerBefore(index: number, count: number): boolean {
    if (!this.divider || !this.showDividers) return false;
    if (index === 0) return (this.showDividers & LinearLayout.SHOW_DIVIDER_BEGINNING) !== 0;
    if (index === count) return (this.showDividers & LinearLayout.SHOW_DIVIDER_END) !== 0;
    return (this.showDividers & LinearLayout.SHOW_DIVIDER_MIDDLE) !== 0;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const vertical = this.orientation === LinearLayout.VERTICAL;
    // main = along the orientation, cross = across it
    const mainSpec = vertical ? heightMeasureSpec : widthMeasureSpec;
    const crossSpec = vertical ? widthMeasureSpec : heightMeasureSpec;
    const mainMode = MeasureSpec.getMode(mainSpec);
    const crossMode = MeasureSpec.getMode(crossSpec);
    const mainPadding = vertical ? this.getPaddingTop() + this.getPaddingBottom() : this.getPaddingLeft() + this.getPaddingRight();
    const crossPadding = vertical ? this.getPaddingLeft() + this.getPaddingRight() : this.getPaddingTop() + this.getPaddingBottom();
    const children = this.visibleChildren();
    const mainOf = (c: View) => (vertical ? c.getMeasuredHeight() : c.getMeasuredWidth());
    const crossOf = (c: View) => (vertical ? c.getMeasuredWidth() : c.getMeasuredHeight());
    const mainSizeOf = (lp: LayoutParams) => (vertical ? lp.height : lp.width);
    const crossSizeOf = (lp: LayoutParams) => (vertical ? lp.width : lp.height);
    const mainMargins = (m: Margins) => (vertical ? m.top + m.bottom : m.left + m.right);
    const crossMargins = (m: Margins) => (vertical ? m.left + m.right : m.top + m.bottom);
    const measure = (child: View, mainS: number, crossS: number) => (vertical ? child.measure(crossS, mainS) : child.measure(mainS, crossS));
    const paramsOf = (child: View) => child.getLayoutParams() ?? this.generateDefaultLayoutParams();
    const weightOf = (lp: LayoutParams) => (lp instanceof LinearLayoutParams ? lp.weight : 0);
    const dividers = () => {
      let n = 0;
      for (let i = 0; i <= children.length; i++) if ((i < children.length || children.length > 0) && this.hasDividerBefore(i, children.length)) n += this.dividerSize;
      return n;
    };

    let total = 0;
    let totalWeight = 0;
    let matchCross = false;
    const deferred = new Set<View>();
    for (const child of children) {
      const lp = paramsOf(child);
      const m = marginsOf(lp);
      const weight = weightOf(lp);
      totalWeight += weight;
      const useExcess = mainSizeOf(lp) === 0 && weight > 0;
      if (mainMode === MeasureSpec.EXACTLY && useExcess) {
        // Measured below with its share of the excess space.
        total += mainMargins(m);
        deferred.add(child);
      } else {
        const used = totalWeight === 0 ? total : 0;
        const mainSize = useExcess ? LayoutParams.WRAP_CONTENT : mainSizeOf(lp);
        measure(child,
          ViewGroup.getChildMeasureSpec(mainSpec, mainPadding + mainMargins(m) + used, mainSize),
          ViewGroup.getChildMeasureSpec(crossSpec, crossPadding + crossMargins(m), crossSizeOf(lp)));
        total += mainOf(child) + mainMargins(m);
      }
      if (crossMode !== MeasureSpec.EXACTLY && crossSizeOf(lp) === LayoutParams.MATCH_PARENT) matchCross = true;
    }
    total += dividers() + mainPadding;
    const minMain = vertical ? this.getMinimumHeight() : this.getMinimumWidth();
    const mainSize = View.resolveSize(Math.max(total, minMain), mainSpec);

    let remaining = mainSize - total;
    if (deferred.size || (remaining !== 0 && totalWeight > 0)) {
      let weightLeft = this.weightSum > 0 ? this.weightSum : totalWeight;
      total = 0;
      for (const child of children) {
        const lp = paramsOf(child);
        const m = marginsOf(lp);
        const weight = weightOf(lp);
        if (weight > 0 && weightLeft > 0) {
          const share = (weight * remaining) / weightLeft;
          remaining -= share;
          weightLeft -= weight;
          const size = deferred.has(child) ? Math.max(0, share) : Math.max(0, mainOf(child) + share);
          measure(child, MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY), ViewGroup.getChildMeasureSpec(crossSpec, crossPadding + crossMargins(m), crossSizeOf(lp)));
        }
        total += mainOf(child) + mainMargins(m);
      }
      total += dividers() + mainPadding;
    }
    this.totalLength = total;
    // Children that match the parent's cross size do not decide it, unless they all do.
    let maxCross = 0;
    let alternativeCross = 0;
    let allFill = true;
    for (const child of children) {
      const lp = paramsOf(child);
      const margins = crossMargins(marginsOf(lp));
      const fills = crossSizeOf(lp) === LayoutParams.MATCH_PARENT;
      allFill &&= fills;
      maxCross = Math.max(maxCross, crossOf(child) + margins);
      alternativeCross = Math.max(alternativeCross, fills && crossMode !== MeasureSpec.EXACTLY ? margins : crossOf(child) + margins);
    }
    if (!allFill && crossMode !== MeasureSpec.EXACTLY) maxCross = alternativeCross;
    maxCross += crossPadding;
    const minCross = vertical ? this.getMinimumWidth() : this.getMinimumHeight();
    const crossSize = View.resolveSize(Math.max(maxCross, minCross), crossSpec);
    if (vertical) this.setMeasuredDimension(crossSize, mainSize);
    else this.setMeasuredDimension(mainSize, crossSize);

    if (matchCross) {
      // forceUniformWidth / forceUniformHeight: MATCH_PARENT children take the final cross size.
      const uniform = MeasureSpec.makeMeasureSpec(crossSize, MeasureSpec.EXACTLY);
      for (const child of children) {
        const lp = paramsOf(child);
        if (crossSizeOf(lp) !== LayoutParams.MATCH_PARENT) continue;
        const m = marginsOf(lp);
        measure(child, MeasureSpec.makeMeasureSpec(mainOf(child), MeasureSpec.EXACTLY), ViewGroup.getChildMeasureSpec(uniform, crossPadding + crossMargins(m), LayoutParams.MATCH_PARENT));
      }
    }
  }

  protected override onLayout(_changed: boolean, l: number, t: number, r: number, b: number): void {
    const vertical = this.orientation === LinearLayout.VERTICAL;
    const children = this.visibleChildren();
    const width = r - l;
    const height = b - t;
    const gravity = Gravity.getAbsoluteGravity(this.gravity);
    let at: number;
    if (vertical) {
      const major = gravity & Gravity.VERTICAL_GRAVITY_MASK;
      at = major === Gravity.BOTTOM ? this.getPaddingTop() + height - this.totalLength
        : major === Gravity.CENTER_VERTICAL ? this.getPaddingTop() + (height - this.totalLength) / 2
          : this.getPaddingTop();
    } else {
      const major = gravity & Gravity.HORIZONTAL_GRAVITY_MASK;
      at = major === Gravity.RIGHT ? this.getPaddingLeft() + width - this.totalLength
        : major === Gravity.CENTER_HORIZONTAL ? this.getPaddingLeft() + (width - this.totalLength) / 2
          : this.getPaddingLeft();
    }
    const crossStart = vertical ? this.getPaddingLeft() : this.getPaddingTop();
    const crossEnd = vertical ? width - this.getPaddingRight() : height - this.getPaddingBottom();
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (this.hasDividerBefore(i, children.length)) at += this.dividerSize;
      const lp = child.getLayoutParams();
      const m = marginsOf(lp);
      const w = child.getMeasuredWidth();
      const h = child.getMeasuredHeight();
      const childGravity = Gravity.getAbsoluteGravity(lp instanceof LinearLayoutParams && lp.gravity >= 0 ? lp.gravity : gravity);
      if (vertical) {
        let x: number;
        switch (childGravity & Gravity.HORIZONTAL_GRAVITY_MASK) {
          case Gravity.CENTER_HORIZONTAL:
            x = crossStart + (crossEnd - crossStart - w) / 2 + m.left - m.right;
            break;
          case Gravity.RIGHT:
            x = crossEnd - w - m.right;
            break;
          default:
            x = crossStart + m.left;
        }
        at += m.top;
        child.layout(x, at, x + w, at + h);
        at += h + m.bottom;
      } else {
        let y: number;
        switch (childGravity & Gravity.VERTICAL_GRAVITY_MASK) {
          case Gravity.CENTER_VERTICAL:
            y = crossStart + (crossEnd - crossStart - h) / 2 + m.top - m.bottom;
            break;
          case Gravity.BOTTOM:
            y = crossEnd - h - m.bottom;
            break;
          default:
            y = crossStart + m.top;
        }
        at += m.left;
        child.layout(at, y, at + w, y + h);
        at += w + m.right;
      }
    }
  }

  protected override onDraw(canvas: Canvas): void {
    const divider = this.divider;
    if (!divider) return;
    const vertical = this.orientation === LinearLayout.VERTICAL;
    const children = this.visibleChildren();
    const draw = (pos: number) => {
      if (vertical) divider.setBounds(this.getPaddingLeft() + this.dividerPadding, pos, this.getWidth() - this.getPaddingRight() - this.dividerPadding, pos + this.dividerSize);
      else divider.setBounds(pos, this.getPaddingTop() + this.dividerPadding, pos + this.dividerSize, this.getHeight() - this.getPaddingBottom() - this.dividerPadding);
      divider.draw(canvas);
    };
    for (let i = 0; i < children.length; i++) {
      if (!this.hasDividerBefore(i, children.length)) continue;
      const child = children[i]!;
      const m = marginsOf(child.getLayoutParams());
      draw(vertical ? child.getTop() - m.top - this.dividerSize : child.getLeft() - m.left - this.dividerSize);
    }
    if (children.length && this.hasDividerBefore(children.length, children.length)) {
      const last = children[children.length - 1]!;
      const m = marginsOf(last.getLayoutParams());
      draw(vertical ? last.getBottom() + m.bottom : last.getRight() + m.right);
    }
  }
}

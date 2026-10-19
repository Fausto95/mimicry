import { invert, type RenderLayer } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { MotionEvent } from './motion-event';
import { LayoutParams, MeasureSpec, View } from './view';
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

/** android.widget.FrameLayout: children stacked at the top-left (gravity), sized to the largest. */
export class FrameLayout extends ViewGroup {
  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    let maxW = 0;
    let maxH = 0;
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (child.getVisibility() === View.GONE) continue;
      this.measureChild(child, widthMeasureSpec, heightMeasureSpec);
      maxW = Math.max(maxW, child.getMeasuredWidth());
      maxH = Math.max(maxH, child.getMeasuredHeight());
    }
    maxW += this.getPaddingLeft() + this.getPaddingRight();
    maxH += this.getPaddingTop() + this.getPaddingBottom();
    this.setMeasuredDimension(View.resolveSize(maxW, widthMeasureSpec), View.resolveSize(maxH, heightMeasureSpec));
  }

  protected override onLayout(_changed: boolean, _l: number, _t: number, _r: number, _b: number): void {
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (child.getVisibility() === View.GONE) continue;
      const x = this.getPaddingLeft();
      const y = this.getPaddingTop();
      child.layout(x, y, x + child.getMeasuredWidth(), y + child.getMeasuredHeight());
    }
  }
}

/** android.widget.LinearLayout: children in a row or column. */
export class LinearLayout extends ViewGroup {
  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  private orientation = LinearLayout.HORIZONTAL;

  setOrientation(orientation: number): void {
    this.orientation = orientation;
    this.requestLayout();
  }

  getOrientation(): number {
    return this.orientation;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const vertical = this.orientation === LinearLayout.VERTICAL;
    let main = 0;
    let cross = 0;
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (child.getVisibility() === View.GONE) continue;
      this.measureChild(child, widthMeasureSpec, heightMeasureSpec);
      main += vertical ? child.getMeasuredHeight() : child.getMeasuredWidth();
      cross = Math.max(cross, vertical ? child.getMeasuredWidth() : child.getMeasuredHeight());
    }
    const padW = this.getPaddingLeft() + this.getPaddingRight();
    const padH = this.getPaddingTop() + this.getPaddingBottom();
    const w = (vertical ? cross : main) + padW;
    const h = (vertical ? main : cross) + padH;
    this.setMeasuredDimension(View.resolveSize(w, widthMeasureSpec), View.resolveSize(h, heightMeasureSpec));
  }

  protected override onLayout(): void {
    const vertical = this.orientation === LinearLayout.VERTICAL;
    let at = vertical ? this.getPaddingTop() : this.getPaddingLeft();
    for (let i = 0; i < this.getChildCount(); i++) {
      const child = this.getChildAt(i)!;
      if (child.getVisibility() === View.GONE) continue;
      const w = child.getMeasuredWidth();
      const h = child.getMeasuredHeight();
      if (vertical) {
        child.layout(this.getPaddingLeft(), at, this.getPaddingLeft() + w, at + h);
        at += h;
      } else {
        child.layout(at, this.getPaddingTop(), at + w, this.getPaddingTop() + h);
        at += w;
      }
    }
  }
}

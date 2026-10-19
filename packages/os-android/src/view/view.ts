import { invert, multiply, rotation, scaling, translation, RenderLayer, type Kernel, type LayerContext, type Matrix } from '@mimicry/os-core';
import { Canvas, RectF } from '../graphics/canvas';
import { ColorDrawable, StateSet, type Drawable, type DrawableCallback } from '../graphics/drawable';
import type { Context } from '../content/context';
import { MotionEvent, ViewConfiguration } from './motion-event';
import type { ViewGroup } from './view-group';
import type { ViewRootImpl } from './view-root';
import type { WindowInsets } from './window-insets';

/**
 * android.view.View: a rectangle in the view tree backed by a RenderNode.
 *
 * Units: Mimicry's Android views measure in density-independent pixels (dp)
 * rather than physical pixels — layout, drawing and MotionEvent coordinates
 * are all dp, and DisplayMetrics reports the device's real density.
 */
export class RenderNode extends RenderLayer {
  constructor(readonly view: View) {
    super();
    this.name = view.constructor.name;
  }

  override drawContent(ctx: LayerContext): void {
    this.view._drawContent(ctx);
  }

  override drawOverlay(ctx: LayerContext): void {
    this.view._drawOverlay(ctx);
  }

  override orderedSublayers(): readonly RenderLayer[] {
    return this.view._orderedChildNodes() ?? super.orderedSublayers();
  }
}

/**
 * View.MeasureSpec. Sizes are dp and may be fractional, so a spec is
 * `mode + size` with the modes as large offsets (sizes stay below 2^30).
 */
export const MeasureSpec = {
  UNSPECIFIED: 0,
  EXACTLY: 0x40000000,
  AT_MOST: 0x80000000,
  makeMeasureSpec(size: number, mode: number): number {
    return mode + Math.max(0, Math.min(size, 0x3fffffff));
  },
  getMode(spec: number): number {
    return spec >= 0x80000000 ? 0x80000000 : spec >= 0x40000000 ? 0x40000000 : 0;
  },
  getSize(spec: number): number {
    return spec - MeasureSpec.getMode(spec);
  },
  toString(spec: number): string {
    const mode = MeasureSpec.getMode(spec);
    return `MeasureSpec: ${mode === 0x40000000 ? 'EXACTLY' : mode === 0x80000000 ? 'AT_MOST' : 'UNSPECIFIED'} ${MeasureSpec.getSize(spec)}`;
  },
} as const;

export class LayoutParams {
  static readonly MATCH_PARENT = -1;
  static readonly WRAP_CONTENT = -2;
  constructor(public width: number = LayoutParams.WRAP_CONTENT, public height: number = LayoutParams.WRAP_CONTENT) {}
}

export type OnClickListener = (view: View) => void;
export type OnLongClickListener = (view: View) => boolean;
export type OnTouchListener = (view: View, event: MotionEvent) => boolean;

let nextViewId = 1;

export class View implements DrawableCallback {
  static readonly VISIBLE = 0;
  static readonly INVISIBLE = 4;
  static readonly GONE = 8;
  static readonly NO_ID = -1;
  static readonly LAYER_TYPE_NONE = 0;
  static readonly LAYER_TYPE_SOFTWARE = 1;
  static readonly LAYER_TYPE_HARDWARE = 2;
  static generateViewId(): number {
    return nextViewId++;
  }

  readonly renderNode: RenderNode;
  /** @internal */
  _parent: ViewGroup | null = null;
  /** @internal set while attached */
  _attachInfo: ViewRootImpl | null = null;
  private id = View.NO_ID;
  private tag: unknown = null;
  private readonly keyedTags = new Map<number, unknown>();
  private layoutParams: LayoutParams | null = null;

  protected mLeft = 0;
  protected mTop = 0;
  protected mRight = 0;
  protected mBottom = 0;
  private measuredWidth = 0;
  private measuredHeight = 0;
  private layoutRequested = true;
  protected paddingLeft = 0;
  protected paddingTop = 0;
  protected paddingRight = 0;
  protected paddingBottom = 0;
  private translationX = 0;
  private translationY = 0;
  private translationZ = 0;
  private elevation = 0;
  private rotation = 0;
  private scaleX = 1;
  private scaleY = 1;
  private pivotX: number | null = null;
  private pivotY: number | null = null;
  private visibility = View.VISIBLE;
  private background: Drawable | null = null;
  private foreground: Drawable | null = null;
  private enabled = true;
  private pressed = false;
  private clickable = false;
  private longClickable = false;
  private focusable = false;
  private contentDescription: string | null = null;
  private onClick: OnClickListener | null = null;
  private onLongClick: OnLongClickListener | null = null;
  private onTouch: OnTouchListener | null = null;
  private longPressTimer: unknown = null;
  private hasPerformedLongPress = false;
  private touchDown: { x: number; y: number } | null = null;
  private insetsListener: ((view: View, insets: WindowInsets) => WindowInsets) | null = null;
  private layerType = View.LAYER_TYPE_NONE;

  constructor(readonly context: Context) {
    this.renderNode = new RenderNode(this);
  }

  getContext(): Context {
    return this.context;
  }

  // ── identity ────────────────────────────────────────────────────────

  getId(): number {
    return this.id;
  }

  setId(id: number): void {
    this.id = id;
  }

  getTag(key?: number): unknown {
    return key === undefined ? this.tag : this.keyedTags.get(key);
  }

  setTag(keyOrTag: unknown, tag?: unknown): void {
    if (tag === undefined) this.tag = keyOrTag;
    else this.keyedTags.set(keyOrTag as number, tag);
  }

  findViewById<T extends View = View>(id: number): T | null {
    return this.id === id ? (this as unknown as T) : null;
  }

  setContentDescription(text: string | null): void {
    this.contentDescription = text;
  }

  getContentDescription(): string | null {
    return this.contentDescription;
  }

  // ── tree ────────────────────────────────────────────────────────────

  getParent(): ViewGroup | null {
    return this._parent;
  }

  getRootView(): View {
    let v: View = this;
    while (v._parent) v = v._parent;
    return v;
  }

  isAttachedToWindow(): boolean {
    return this._attachInfo !== null;
  }

  /** @internal */
  _dispatchAttachedToWindow(info: ViewRootImpl): void {
    this._attachInfo = info;
    this.onAttachedToWindow();
    this.background?.setCallback(this);
    this.foreground?.setCallback(this);
  }

  /** @internal */
  _dispatchDetachedFromWindow(): void {
    this.onDetachedFromWindow();
    this.cancelLongPress();
    this._attachInfo = null;
  }

  protected onAttachedToWindow(): void {}
  protected onDetachedFromWindow(): void {}

  /** The kernel this view's window runs on (null when detached). */
  get kernel(): Kernel | null {
    return this._attachInfo?.kernel ?? null;
  }

  drawableKernel(): Kernel | null {
    return this.kernel;
  }

  // ── layout ──────────────────────────────────────────────────────────

  getLayoutParams(): LayoutParams | null {
    return this.layoutParams;
  }

  setLayoutParams(params: LayoutParams): void {
    this.layoutParams = params;
    this.requestLayout();
  }

  measure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.onMeasure(widthMeasureSpec, heightMeasureSpec);
  }

  protected onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.setMeasuredDimension(View.getDefaultSize(0, widthMeasureSpec), View.getDefaultSize(0, heightMeasureSpec));
  }

  protected setMeasuredDimension(width: number, height: number): void {
    this.measuredWidth = width;
    this.measuredHeight = height;
  }

  static getDefaultSize(size: number, measureSpec: number): number {
    const mode = MeasureSpec.getMode(measureSpec);
    return mode === MeasureSpec.UNSPECIFIED ? size : MeasureSpec.getSize(measureSpec);
  }

  static resolveSize(size: number, measureSpec: number): number {
    const mode = MeasureSpec.getMode(measureSpec);
    const specSize = MeasureSpec.getSize(measureSpec);
    if (mode === MeasureSpec.EXACTLY) return specSize;
    if (mode === MeasureSpec.AT_MOST) return Math.min(size, specSize);
    return size;
  }

  getMeasuredWidth(): number {
    return this.measuredWidth;
  }

  getMeasuredHeight(): number {
    return this.measuredHeight;
  }

  layout(l: number, t: number, r: number, b: number): void {
    const changed = l !== this.mLeft || t !== this.mTop || r !== this.mRight || b !== this.mBottom;
    this.setFrame(l, t, r, b);
    if (changed || this.layoutRequested) {
      this.layoutRequested = false;
      this.onLayout(changed, l, t, r, b);
    }
  }

  protected onLayout(_changed: boolean, _l: number, _t: number, _r: number, _b: number): void {}

  /** @internal position without a layout pass (frameworks that lay out themselves) */
  setFrame(l: number, t: number, r: number, b: number): void {
    const resized = r - l !== this.mRight - this.mLeft || b - t !== this.mBottom - this.mTop;
    const oldW = this.mRight - this.mLeft;
    const oldH = this.mBottom - this.mTop;
    this.mLeft = l;
    this.mTop = t;
    this.mRight = r;
    this.mBottom = b;
    this.renderNode.setFrame(l, t, r - l, b - t);
    this.updateMatrix();
    this.background?.setBounds(0, 0, r - l, b - t);
    this.foreground?.setBounds(0, 0, r - l, b - t);
    if (resized) this.onSizeChanged(r - l, b - t, oldW, oldH);
    this.invalidate();
  }

  protected onSizeChanged(_w: number, _h: number, _oldw: number, _oldh: number): void {}

  requestLayout(): void {
    this.layoutRequested = true;
    this._parent?.requestLayout();
    this._attachInfo?.scheduleTraversals();
  }

  forceLayout(): void {
    this.layoutRequested = true;
  }

  isLayoutRequested(): boolean {
    return this.layoutRequested;
  }

  getLeft(): number { return this.mLeft; }
  getTop(): number { return this.mTop; }
  getRight(): number { return this.mRight; }
  getBottom(): number { return this.mBottom; }
  getWidth(): number { return this.mRight - this.mLeft; }
  getHeight(): number { return this.mBottom - this.mTop; }

  setLeft(left: number): void { this.setFrame(left, this.mTop, this.mRight, this.mBottom); }
  setTop(top: number): void { this.setFrame(this.mLeft, top, this.mRight, this.mBottom); }
  setRight(right: number): void { this.setFrame(this.mLeft, this.mTop, right, this.mBottom); }
  setBottom(bottom: number): void { this.setFrame(this.mLeft, this.mTop, this.mRight, bottom); }

  setPadding(left: number, top: number, right: number, bottom: number): void {
    this.paddingLeft = left;
    this.paddingTop = top;
    this.paddingRight = right;
    this.paddingBottom = bottom;
    this.requestLayout();
  }

  getPaddingLeft(): number { return this.paddingLeft; }
  getPaddingTop(): number { return this.paddingTop; }
  getPaddingRight(): number { return this.paddingRight; }
  getPaddingBottom(): number { return this.paddingBottom; }

  // ── transform properties (RenderNode properties) ────────────────────

  getX(): number { return this.mLeft + this.translationX; }
  getY(): number { return this.mTop + this.translationY; }
  setX(x: number): void { this.setTranslationX(x - this.mLeft); }
  setY(y: number): void { this.setTranslationY(y - this.mTop); }
  getZ(): number { return this.elevation + this.translationZ; }
  getTranslationX(): number { return this.translationX; }
  getTranslationY(): number { return this.translationY; }
  getTranslationZ(): number { return this.translationZ; }
  getElevation(): number { return this.elevation; }
  getRotation(): number { return this.rotation; }
  getScaleX(): number { return this.scaleX; }
  getScaleY(): number { return this.scaleY; }
  getPivotX(): number { return this.pivotX ?? this.getWidth() / 2; }
  getPivotY(): number { return this.pivotY ?? this.getHeight() / 2; }
  getAlpha(): number { return this.renderNode.opacity; }

  setTranslationX(v: number): void { this.translationX = v; this.updateMatrix(); }
  setTranslationY(v: number): void { this.translationY = v; this.updateMatrix(); }
  setTranslationZ(v: number): void { this.translationZ = v; this.invalidateParent(); }
  setElevation(v: number): void { this.elevation = v; this.invalidateParent(); }
  setRotation(degrees: number): void { this.rotation = degrees; this.updateMatrix(); }
  setScaleX(v: number): void { this.scaleX = v; this.updateMatrix(); }
  setScaleY(v: number): void { this.scaleY = v; this.updateMatrix(); }
  setPivotX(v: number): void { this.pivotX = v; this.updateMatrix(); }
  setPivotY(v: number): void { this.pivotY = v; this.updateMatrix(); }

  setAlpha(alpha: number): void {
    this.renderNode.opacity = Math.max(0, Math.min(1, alpha));
    this.invalidate();
  }

  /** The RenderNode transform: translation, then rotation and scale about the pivot. */
  private updateMatrix(): void {
    const plain = !this.translationX && !this.translationY && !this.rotation && this.scaleX === 1 && this.scaleY === 1;
    if (plain) {
      this.renderNode.transform = this.customTransform;
    } else {
      const px = this.getPivotX();
      const py = this.getPivotY();
      let m: Matrix = translation(this.translationX, this.translationY);
      if (this.rotation || this.scaleX !== 1 || this.scaleY !== 1) {
        m = multiply(m, multiply(translation(px, py), multiply(rotation((this.rotation * Math.PI) / 180), multiply(scaling(this.scaleX, this.scaleY), translation(-px, -py)))));
      }
      this.renderNode.transform = this.customTransform ? multiply(m, this.customTransform) : m;
    }
    this.invalidate();
  }

  private customTransform: Matrix | null = null;

  /**
   * Mimicry: an arbitrary 2D matrix applied after the transform properties
   * (frameworks with CSS-style transforms set it; Android itself exposes
   * only the decomposed properties and getMatrix()).
   */
  setAnimationMatrix(matrix: Matrix | null): void {
    this.customTransform = matrix;
    this.updateMatrix();
  }

  getMatrix(): Matrix {
    return this.renderNode.transform ?? [1, 0, 0, 1, 0, 0];
  }

  // ── visibility & drawing ────────────────────────────────────────────

  getVisibility(): number {
    return this.visibility;
  }

  setVisibility(visibility: number): void {
    const wasGone = this.visibility === View.GONE;
    this.visibility = visibility;
    this.renderNode.hidden = visibility !== View.VISIBLE;
    if (wasGone !== (visibility === View.GONE)) this.requestLayout();
    this.invalidateParent();
  }

  isShown(): boolean {
    for (let v: View | null = this; v; v = v._parent) if (v.visibility !== View.VISIBLE) return false;
    return this._attachInfo !== null;
  }

  setBackground(drawable: Drawable | null): void {
    this.background?.setCallback(null);
    this.background = drawable;
    if (drawable) {
      drawable.setCallback(this);
      drawable.setBounds(0, 0, this.getWidth(), this.getHeight());
      if (drawable.isStateful()) drawable.setState(this.drawableState());
    }
    this.invalidate();
  }

  setBackgroundColor(color: number): void {
    if (this.background instanceof ColorDrawable) this.background.setColor(color);
    else this.setBackground(new ColorDrawable(color));
  }

  getBackground(): Drawable | null {
    return this.background;
  }

  setForeground(drawable: Drawable | null): void {
    this.foreground?.setCallback(null);
    this.foreground = drawable;
    if (drawable) {
      drawable.setCallback(this);
      drawable.setBounds(0, 0, this.getWidth(), this.getHeight());
      if (drawable.isStateful()) drawable.setState(this.drawableState());
    }
    this.invalidate();
  }

  getForeground(): Drawable | null {
    return this.foreground;
  }

  setClipToOutline(clip: boolean): void {
    this.renderNode.masksToBounds = clip;
    this.invalidate();
  }

  getClipToOutline(): boolean {
    return this.renderNode.masksToBounds;
  }

  setLayerType(type: number): void {
    this.layerType = type;
    this.renderNode.composited = type === View.LAYER_TYPE_HARDWARE;
  }

  getLayerType(): number {
    return this.layerType;
  }

  setWillNotDraw(_willNotDraw: boolean): void {}

  invalidate(): void {
    this.renderNode.setNeedsDisplay();
  }

  postInvalidateOnAnimation(): void {
    this.invalidate();
  }

  invalidateDrawable(_who: Drawable): void {
    this.invalidate();
  }

  private invalidateParent(): void {
    (this._parent ?? this).invalidate();
  }

  /** Override to draw content (between the background and the children). */
  protected onDraw(_canvas: Canvas): void {}

  /** Override to draw above the children (foreground, scroll bars). */
  protected onDrawForeground(canvas: Canvas): void {
    this.foreground?.draw(canvas);
  }

  /**
   * @internal What the RenderNode records under the children: the
   * background drawable, then onDraw. Frameworks that know their visible
   * extents override drawContent() to record finer items.
   */
  _drawContent(ctx: LayerContext): void {
    this.drawContent(ctx);
  }

  /** @internal */
  _drawOverlay(ctx: LayerContext): void {
    this.drawOverlay(ctx);
  }

  protected drawContent(ctx: LayerContext): void {
    const w = this.getWidth();
    const h = this.getHeight();
    const background = this.background;
    const hasOnDraw = this.onDraw !== View.prototype.onDraw;
    if (!background && !hasOnDraw) return;
    const outset = background?.drawingOutset() ?? 0;
    ctx.item({ x: ctx.x - outset, y: ctx.y - outset, w: w + outset * 2, h: h + outset * 2 }, (writer) => {
      writer.save();
      writer.transform(1, 0, 0, 1, ctx.x, ctx.y);
      const canvas = new Canvas(writer, w, h);
      background?.draw(canvas);
      if (hasOnDraw) this.onDraw(canvas);
      writer.restore();
    });
  }

  protected drawOverlay(ctx: LayerContext): void {
    const fg = this.foreground;
    const hasForeground = this.onDrawForeground !== View.prototype.onDrawForeground;
    if (!fg && !hasForeground) return;
    const w = this.getWidth();
    const h = this.getHeight();
    const outset = fg?.drawingOutset() ?? 0;
    ctx.item({ x: ctx.x - outset, y: ctx.y - outset, w: w + outset * 2, h: h + outset * 2 }, (writer) => {
      writer.save();
      writer.transform(1, 0, 0, 1, ctx.x, ctx.y);
      this.onDrawForeground(new Canvas(writer, w, h));
      writer.restore();
    });
  }

  /** @internal ViewGroup supplies its drawing order */
  _orderedChildNodes(): readonly RenderLayer[] | null {
    return null;
  }

  // ── state ───────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refreshDrawableState();
  }

  isPressed(): boolean {
    return this.pressed;
  }

  setPressed(pressed: boolean): void {
    if (this.pressed === pressed) return;
    this.pressed = pressed;
    this.refreshDrawableState();
    this.dispatchSetPressed(pressed);
  }

  protected dispatchSetPressed(_pressed: boolean): void {}

  /** Where the touch is, for ripples (drawableHotspotChanged). */
  drawableHotspotChanged(x: number, y: number): void {
    this.background?.setHotspot(x, y);
    this.foreground?.setHotspot(x, y);
  }

  refreshDrawableState(): void {
    const state = this.drawableState();
    if (this.background?.isStateful()) this.background.setState(state);
    if (this.foreground?.isStateful()) this.foreground.setState(state);
    this.drawableStateChanged();
    this.invalidate();
  }

  protected drawableStateChanged(): void {}

  protected drawableState(): string[] {
    const s: string[] = [];
    if (this.enabled) s.push(StateSet.enabled);
    if (this.pressed) s.push(StateSet.pressed);
    return s;
  }

  isClickable(): boolean {
    return this.clickable;
  }

  setClickable(clickable: boolean): void {
    this.clickable = clickable;
  }

  isLongClickable(): boolean {
    return this.longClickable;
  }

  setLongClickable(longClickable: boolean): void {
    this.longClickable = longClickable;
  }

  setFocusable(focusable: boolean): void {
    this.focusable = focusable;
  }

  isFocusable(): boolean {
    return this.focusable;
  }

  setOnClickListener(listener: OnClickListener | null): void {
    if (listener) this.clickable = true;
    this.onClick = listener;
  }

  setOnLongClickListener(listener: OnLongClickListener | null): void {
    if (listener) this.longClickable = true;
    this.onLongClick = listener;
  }

  setOnTouchListener(listener: OnTouchListener | null): void {
    this.onTouch = listener;
  }

  performClick(): boolean {
    if (!this.onClick) return false;
    this.onClick(this);
    return true;
  }

  performLongClick(): boolean {
    return this.onLongClick?.(this) ?? false;
  }

  // ── touch ───────────────────────────────────────────────────────────

  dispatchTouchEvent(event: MotionEvent): boolean {
    if (this.enabled && this.onTouch?.(this, event)) return true;
    return this.onTouchEvent(event);
  }

  /** Default handling for clickable views: pressed state, click, long click. */
  onTouchEvent(event: MotionEvent): boolean {
    const clickable = this.clickable || this.longClickable;
    if (!this.enabled) return clickable;
    if (!clickable) return false;
    const x = event.getX();
    const y = event.getY();
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        this.touchDown = { x, y };
        this.hasPerformedLongPress = false;
        this.drawableHotspotChanged(x, y);
        this.setPressed(true);
        if (this.longClickable) this.scheduleLongPress();
        break;
      case MotionEvent.ACTION_MOVE: {
        this.drawableHotspotChanged(x, y);
        const slop = ViewConfiguration.getScaledTouchSlop();
        if (x < -slop || y < -slop || x > this.getWidth() + slop || y > this.getHeight() + slop) {
          this.cancelLongPress();
          this.setPressed(false);
        }
        break;
      }
      case MotionEvent.ACTION_UP:
        if (this.pressed && !this.hasPerformedLongPress) {
          this.cancelLongPress();
          this.performClick();
        }
        this.setPressed(false);
        this.touchDown = null;
        break;
      case MotionEvent.ACTION_CANCEL:
        this.cancelLongPress();
        this.setPressed(false);
        this.touchDown = null;
        break;
    }
    return true;
  }

  private scheduleLongPress(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    this.longPressTimer = kernel.clock.setTimeout(() => {
      this.longPressTimer = null;
      if (this.pressed && this.performLongClick()) this.hasPerformedLongPress = true;
      kernel.requestFrame();
    }, ViewConfiguration.getLongPressTimeout());
  }

  cancelLongPress(): void {
    if (this.longPressTimer != null) this.kernel?.clock.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  // ── coordinates ─────────────────────────────────────────────────────

  getLocationInWindow(out: number[] = [0, 0]): number[] {
    const r = this.renderNode.windowRect();
    out[0] = r.x;
    out[1] = r.y;
    return out;
  }

  getLocationOnScreen(out: number[] = [0, 0]): number[] {
    return this.getLocationInWindow(out);
  }

  getGlobalVisibleRect(out: RectF): boolean {
    const r = this.renderNode.windowRect();
    out.set(r.x, r.y, r.x + r.w, r.y + r.h);
    return r.w > 0 && r.h > 0;
  }

  /** window → this view's coordinates */
  windowToLocal(): Matrix {
    return invert(this.renderNode.windowMatrix()) ?? [1, 0, 0, 1, 0, 0];
  }

  // ── scrolling ───────────────────────────────────────────────────────

  getScrollX(): number {
    return this.renderNode.originX;
  }

  getScrollY(): number {
    return this.renderNode.originY;
  }

  scrollTo(x: number, y: number): void {
    const oldX = this.renderNode.originX;
    const oldY = this.renderNode.originY;
    if (x === oldX && y === oldY) return;
    this.renderNode.originX = x;
    this.renderNode.originY = y;
    this.onScrollChanged(x, y, oldX, oldY);
    this.invalidate();
  }

  scrollBy(dx: number, dy: number): void {
    this.scrollTo(this.renderNode.originX + dx, this.renderNode.originY + dy);
  }

  protected onScrollChanged(_l: number, _t: number, _oldl: number, _oldt: number): void {}

  canScrollVertically(_direction: number): boolean {
    return false;
  }

  canScrollHorizontally(_direction: number): boolean {
    return false;
  }

  // ── window insets ───────────────────────────────────────────────────

  setOnApplyWindowInsetsListener(listener: ((view: View, insets: WindowInsets) => WindowInsets) | null): void {
    this.insetsListener = listener;
  }

  dispatchApplyWindowInsets(insets: WindowInsets): WindowInsets {
    return this.insetsListener ? this.insetsListener(this, insets) : this.onApplyWindowInsets(insets);
  }

  onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    return insets;
  }

  getRootWindowInsets(): WindowInsets | null {
    return this._attachInfo?.windowInsets ?? null;
  }

  requestApplyInsets(): void {
    this._attachInfo?.requestApplyInsets();
  }

  // ── posting ─────────────────────────────────────────────────────────

  post(action: () => void): boolean {
    const kernel = this.kernel;
    if (!kernel) return false;
    kernel.defer(action);
    return true;
  }

  postDelayed(action: () => void, delayMillis: number): boolean {
    const kernel = this.kernel;
    if (!kernel) return false;
    kernel.clock.setTimeout(() => {
      action();
      kernel.requestFrame();
    }, delayMillis);
    return true;
  }

  postOnAnimation(action: () => void): void {
    const kernel = this.kernel;
    if (!kernel) return;
    kernel.animator.requestAnimationFrame(() => action());
    kernel.requestFrame();
  }

  toString(): string {
    return `${this.constructor.name}{${this.id !== View.NO_ID ? `id=${this.id} ` : ''}${this.mLeft},${this.mTop}-${this.mRight},${this.mBottom}}`;
  }
}

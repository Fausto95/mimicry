import { RenderLayer, ScrollKinetics, type FrameTask, type LayerContext, type ScrollConfig, type ScrollEvent, type ScrollMetrics, type ScrollPhysics } from '@mimicry/os-core';
import { androidKit } from '../theme';
import type { Context } from '../content/context';
import { Canvas, Rect } from '../graphics/canvas';
import { Color } from '../graphics/color';
import type { Drawable } from '../graphics/drawable';
import { MotionEvent, ViewConfiguration } from '../view/motion-event';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { MarginLayoutParams, ViewGroup, marginsOf } from '../view/view-group';

/**
 * androidx.recyclerview.widget.RecyclerView with LinearLayoutManager
 * (vertical or horizontal) and GridLayoutManager: an adapter's items bound
 * into a small set of recycled ViewHolders, item decorations, scroll
 * listeners and the same drag / fling kinetics as ScrollView.
 *
 * Items are measured as they come into view; the sizes of items not yet
 * seen are estimated from the average, and the list keeps the visible
 * items still when an estimate turns out wrong. Item change animations
 * (DefaultItemAnimator) are not played: changes apply on the next layout.
 *
 * Deviation: like ScrollView, the list scrolls its content layer (a
 * composited scroll offset) instead of offsetting every child, so a child's
 * getTop()/getLeft() are in content coordinates — subtract
 * computeVerticalScrollOffset() (or the horizontal one) for the position on
 * screen. getScrollY() still returns 0, as on Android. Item decorations draw
 * in the same content coordinates, so decorations written against child
 * bounds draw where they should. Children scroll under the padding
 * (clipToPadding="false" behavior).
 */

// ── adapter & view holders ───────────────────────────────────────────────

export class ViewHolder {
  /** @internal */
  position = RecyclerView.NO_POSITION;
  /** @internal */
  itemViewType = 0;
  /** @internal */
  itemId = RecyclerView.NO_ID;
  /** @internal set while bound content is stale */
  needsBind = true;
  /** @internal */
  owner: RecyclerView | null = null;
  private recyclable = true;

  constructor(readonly itemView: View) {
    if (!itemView) throw new Error('IllegalArgumentException: itemView may not be null');
  }

  /** @deprecated in androidx, kept for older code: same as getBindingAdapterPosition(). */
  getAdapterPosition(): number {
    return this.position;
  }

  getBindingAdapterPosition(): number {
    return this.position;
  }

  getAbsoluteAdapterPosition(): number {
    return this.position;
  }

  getLayoutPosition(): number {
    return this.position;
  }

  getItemViewType(): number {
    return this.itemViewType;
  }

  getItemId(): number {
    return this.itemId;
  }

  isRecyclable(): boolean {
    return this.recyclable;
  }

  setIsRecyclable(recyclable: boolean): void {
    this.recyclable = recyclable;
  }

  toString(): string {
    return `ViewHolder{position=${this.position} type=${this.itemViewType}}`;
  }
}

export interface AdapterDataObserver {
  onChanged?(): void;
  onItemRangeChanged?(positionStart: number, itemCount: number, payload?: unknown): void;
  onItemRangeInserted?(positionStart: number, itemCount: number): void;
  onItemRangeRemoved?(positionStart: number, itemCount: number): void;
  onItemRangeMoved?(fromPosition: number, toPosition: number, itemCount: number): void;
}

export abstract class Adapter<VH extends ViewHolder = ViewHolder> {
  private readonly observers: AdapterDataObserver[] = [];
  private stableIds = false;

  abstract getItemCount(): number;
  abstract onCreateViewHolder(parent: ViewGroup, viewType: number): VH;
  abstract onBindViewHolder(holder: VH, position: number, payloads?: unknown[]): void;

  getItemViewType(_position: number): number {
    return 0;
  }

  getItemId(_position: number): number {
    return RecyclerView.NO_ID;
  }

  setHasStableIds(hasStableIds: boolean): void {
    this.stableIds = hasStableIds;
  }

  hasStableIds(): boolean {
    return this.stableIds;
  }

  onViewRecycled(_holder: VH): void {}
  onViewAttachedToWindow(_holder: VH): void {}
  onViewDetachedFromWindow(_holder: VH): void {}
  onAttachedToRecyclerView(_recyclerView: RecyclerView): void {}
  onDetachedFromRecyclerView(_recyclerView: RecyclerView): void {}

  registerAdapterDataObserver(observer: AdapterDataObserver): void {
    this.observers.push(observer);
  }

  unregisterAdapterDataObserver(observer: AdapterDataObserver): void {
    const at = this.observers.indexOf(observer);
    if (at >= 0) this.observers.splice(at, 1);
  }

  notifyDataSetChanged(): void {
    for (const o of this.observers.slice()) o.onChanged?.();
  }

  notifyItemChanged(position: number, payload?: unknown): void {
    this.notifyItemRangeChanged(position, 1, payload);
  }

  notifyItemRangeChanged(positionStart: number, itemCount: number, payload?: unknown): void {
    for (const o of this.observers.slice()) o.onItemRangeChanged?.(positionStart, itemCount, payload);
  }

  notifyItemInserted(position: number): void {
    this.notifyItemRangeInserted(position, 1);
  }

  notifyItemRangeInserted(positionStart: number, itemCount: number): void {
    for (const o of this.observers.slice()) o.onItemRangeInserted?.(positionStart, itemCount);
  }

  notifyItemRemoved(position: number): void {
    this.notifyItemRangeRemoved(position, 1);
  }

  notifyItemRangeRemoved(positionStart: number, itemCount: number): void {
    for (const o of this.observers.slice()) o.onItemRangeRemoved?.(positionStart, itemCount);
  }

  notifyItemMoved(fromPosition: number, toPosition: number): void {
    for (const o of this.observers.slice()) o.onItemRangeMoved?.(fromPosition, toPosition, 1);
  }
}

/** RecyclerView.RecycledViewPool: spare view holders by view type (5 each by default). */
export class RecycledViewPool {
  private readonly scrap = new Map<number, ViewHolder[]>();
  private readonly max = new Map<number, number>();

  setMaxRecycledViews(viewType: number, max: number): void {
    this.max.set(viewType, max);
    const list = this.scrap.get(viewType);
    if (list && list.length > max) list.length = max;
  }

  getRecycledViewCount(viewType: number): number {
    return this.scrap.get(viewType)?.length ?? 0;
  }

  getRecycledView(viewType: number): ViewHolder | null {
    return this.scrap.get(viewType)?.pop() ?? null;
  }

  putRecycledView(holder: ViewHolder): void {
    const type = holder.getItemViewType();
    const list = this.scrap.get(type) ?? [];
    if (list.length >= (this.max.get(type) ?? 5)) return;
    holder.position = RecyclerView.NO_POSITION;
    holder.needsBind = true;
    list.push(holder);
    this.scrap.set(type, list);
  }

  clear(): void {
    this.scrap.clear();
  }
}

/** RecyclerView.State: what layout and decorations may ask about the current pass. */
export class RecyclerViewState {
  constructor(private readonly rv: RecyclerView) {}
  getItemCount(): number {
    return this.rv.getAdapter()?.getItemCount() ?? 0;
  }
  isPreLayout(): boolean {
    return false;
  }
  willRunPredictiveAnimations(): boolean {
    return false;
  }
  didStructureChange(): boolean {
    return false;
  }
}

export abstract class ItemDecoration {
  /** Draw under the items (content coordinates; see RecyclerView). */
  onDraw(_canvas: Canvas, _parent: RecyclerView, _state: RecyclerViewState): void {}
  /** Draw over the items. */
  onDrawOver(_canvas: Canvas, _parent: RecyclerView, _state: RecyclerViewState): void {}
  /** Space to leave around an item. */
  getItemOffsets(outRect: Rect, _view: View, _parent: RecyclerView, _state: RecyclerViewState): void {
    outRect.set(0, 0, 0, 0);
  }
}

/**
 * androidx DividerItemDecoration: a divider (?android:attr/listDivider, a
 * 1 dp line) after every item, along the orientation.
 */
export class DividerItemDecoration extends ItemDecoration {
  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  private drawable: Drawable | null = null;
  private size = 1;
  private color: number;

  constructor(context: Context, private orientation: number) {
    super();
    this.color = context.getTheme().getColor('colorOutlineVariant');
  }

  setOrientation(orientation: number): void {
    this.orientation = orientation;
  }

  setDrawable(drawable: Drawable): void {
    this.drawable = drawable;
    const s = this.orientation === DividerItemDecoration.VERTICAL ? drawable.getIntrinsicHeight() : drawable.getIntrinsicWidth();
    this.size = s > 0 ? s : 1;
  }

  getDrawable(): Drawable | null {
    return this.drawable;
  }

  override getItemOffsets(outRect: Rect): void {
    if (this.orientation === DividerItemDecoration.VERTICAL) outRect.set(0, 0, 0, this.size);
    else outRect.set(0, 0, this.size, 0);
  }

  override onDraw(canvas: Canvas, parent: RecyclerView): void {
    const vertical = this.orientation === DividerItemDecoration.VERTICAL;
    for (let i = 0; i < parent.getChildCount(); i++) {
      const child = parent.getChildAt(i)!;
      const m = marginsOf(child.getLayoutParams());
      const b = vertical
        ? { l: parent.getPaddingLeft(), t: child.getBottom() + m.bottom + child.getTranslationY(), r: parent.getWidth() - parent.getPaddingRight(), bt: 0 }
        : { l: child.getRight() + m.right + child.getTranslationX(), t: parent.getPaddingTop(), r: 0, bt: parent.getHeight() - parent.getPaddingBottom() };
      if (vertical) b.bt = b.t + this.size;
      else b.r = b.l + this.size;
      if (this.drawable) {
        this.drawable.setBounds(b.l, b.t, b.r, b.bt);
        this.drawable.draw(canvas);
      } else canvas.writer.fillRect(b.l, b.t, b.r - b.l, b.bt - b.t, Color.toRgba(this.color));
    }
  }
}

/**
 * com.google.android.material.divider.MaterialDividerItemDecoration: a
 * 1 dp outlineVariant divider between items, with optional insets; the last
 * item is decorated unless told otherwise.
 */
export class MaterialDividerItemDecoration extends ItemDecoration {
  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  private thickness = 1;
  private insetStart = 0;
  private insetEnd = 0;
  private lastItemDecorated = true;
  private color: number;

  constructor(context: Context, private readonly orientation: number) {
    super();
    this.color = context.getTheme().getColor('colorOutlineVariant');
  }

  setDividerThickness(t: number): void { this.thickness = t; }
  setDividerInsetStart(i: number): void { this.insetStart = i; }
  setDividerInsetEnd(i: number): void { this.insetEnd = i; }
  setDividerColor(c: number): void { this.color = c; }
  setLastItemDecorated(d: boolean): void { this.lastItemDecorated = d; }

  private decorated(view: View, parent: RecyclerView): boolean {
    const pos = parent.getChildAdapterPosition(view);
    const count = parent.getAdapter()?.getItemCount() ?? 0;
    return this.lastItemDecorated || pos !== count - 1;
  }

  override getItemOffsets(outRect: Rect, view: View, parent: RecyclerView): void {
    if (!this.decorated(view, parent)) outRect.set(0, 0, 0, 0);
    else if (this.orientation === MaterialDividerItemDecoration.VERTICAL) outRect.set(0, 0, 0, this.thickness);
    else outRect.set(0, 0, this.thickness, 0);
  }

  override onDraw(canvas: Canvas, parent: RecyclerView): void {
    const color = Color.toRgba(this.color);
    for (let i = 0; i < parent.getChildCount(); i++) {
      const child = parent.getChildAt(i)!;
      if (!this.decorated(child, parent)) continue;
      if (this.orientation === MaterialDividerItemDecoration.VERTICAL) {
        const top = child.getBottom() + marginsOf(child.getLayoutParams()).bottom + child.getTranslationY();
        const left = parent.getPaddingLeft() + this.insetStart;
        canvas.writer.fillRect(left, top, parent.getWidth() - parent.getPaddingRight() - this.insetEnd - left, this.thickness, color);
      } else {
        const left = child.getRight() + marginsOf(child.getLayoutParams()).right + child.getTranslationX();
        const top = parent.getPaddingTop() + this.insetStart;
        canvas.writer.fillRect(left, top, this.thickness, parent.getHeight() - parent.getPaddingBottom() - this.insetEnd - top, color);
      }
    }
  }
}

export interface OnScrollListener {
  onScrollStateChanged?(recyclerView: RecyclerView, newState: number): void;
  onScrolled?(recyclerView: RecyclerView, dx: number, dy: number): void;
}

// ── layout managers ──────────────────────────────────────────────────────

/**
 * RecyclerView.LayoutManager. Mimicry's managers lay items out in lines
 * along one axis: one item per line (LinearLayoutManager) or spanCount
 * items per line (GridLayoutManager).
 */
export abstract class LayoutManager {
  /** @internal */
  recyclerView: RecyclerView | null = null;

  abstract getOrientation(): number;
  /** items per line */
  abstract spanCount(): number;

  canScrollVertically(): boolean {
    return this.getOrientation() === RecyclerView.VERTICAL;
  }

  canScrollHorizontally(): boolean {
    return this.getOrientation() === RecyclerView.HORIZONTAL;
  }

  generateDefaultLayoutParams(): LayoutParams {
    return this.getOrientation() === RecyclerView.VERTICAL
      ? new MarginLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
      : new MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT);
  }

  getItemCount(): number {
    return this.recyclerView?.getAdapter()?.getItemCount() ?? 0;
  }

  getChildCount(): number {
    return this.recyclerView?.getChildCount() ?? 0;
  }

  getChildAt(index: number): View | null {
    return this.recyclerView?.getChildAt(index) ?? null;
  }

  findViewByPosition(position: number): View | null {
    return this.recyclerView?.findViewHolderForAdapterPosition(position)?.itemView ?? null;
  }

  scrollToPosition(position: number): void {
    this.recyclerView?.scrollToPosition(position);
  }

  /** @internal positions shown, in order */
  visiblePositions(completely: boolean): number[] {
    return this.recyclerView?.visiblePositions(completely) ?? [];
  }
}

export class LinearLayoutManager extends LayoutManager {
  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  private orientation: number;
  private reverseLayout: boolean;

  constructor(_context: Context, orientation: number = LinearLayoutManager.VERTICAL, reverseLayout = false) {
    super();
    this.orientation = orientation;
    this.reverseLayout = reverseLayout;
  }

  getOrientation(): number {
    return this.orientation;
  }

  setOrientation(orientation: number): void {
    this.orientation = orientation;
    this.recyclerView?.requestLayout();
  }

  /** Recorded only: items are always laid out from the start. */
  setReverseLayout(reverse: boolean): void {
    this.reverseLayout = reverse;
  }

  getReverseLayout(): boolean {
    return this.reverseLayout;
  }

  spanCount(): number {
    return 1;
  }

  findFirstVisibleItemPosition(): number {
    return this.visiblePositions(false)[0] ?? RecyclerView.NO_POSITION;
  }

  findLastVisibleItemPosition(): number {
    const v = this.visiblePositions(false);
    return v[v.length - 1] ?? RecyclerView.NO_POSITION;
  }

  findFirstCompletelyVisibleItemPosition(): number {
    return this.visiblePositions(true)[0] ?? RecyclerView.NO_POSITION;
  }

  findLastCompletelyVisibleItemPosition(): number {
    const v = this.visiblePositions(true);
    return v[v.length - 1] ?? RecyclerView.NO_POSITION;
  }

  /** Scroll so `position` starts `offset` dp from the start of the list. */
  scrollToPositionWithOffset(position: number, offset: number): void {
    this.recyclerView?.scrollToPosition(position, offset);
  }
}

/** GridLayoutManager: spanCount items per line, each line as tall as its tallest item. */
export class GridLayoutManager extends LinearLayoutManager {
  constructor(context: Context, private spans: number, orientation: number = LinearLayoutManager.VERTICAL, reverseLayout = false) {
    super(context, orientation, reverseLayout);
  }

  override spanCount(): number {
    return Math.max(1, this.spans);
  }

  getSpanCount(): number {
    return this.spans;
  }

  setSpanCount(spans: number): void {
    this.spans = spans;
    this.recyclerView?.requestLayout();
  }

  override generateDefaultLayoutParams(): LayoutParams {
    return this.getOrientation() === RecyclerView.VERTICAL
      ? new MarginLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
      : new MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT);
  }
}

// ── RecyclerView ─────────────────────────────────────────────────────────

/** Draws item decorations inside the scrolled content (under or over the items). */
class DecorationLayer extends RenderLayer {
  constructor(private readonly rv: RecyclerView, private readonly over: boolean) {
    super();
  }

  override drawContent(ctx: LayerContext): void {
    this.rv.drawDecorations(ctx, this.over);
  }
}

const DEFAULT_ESTIMATE = 56;

export class RecyclerView extends ViewGroup implements FrameTask {
  override getAccessibilityClassName(): string {
    return 'androidx.recyclerview.widget.RecyclerView';
  }

  static readonly HORIZONTAL = 0;
  static readonly VERTICAL = 1;
  static readonly NO_POSITION = -1;
  static override readonly NO_ID = -1;
  static readonly INVALID_TYPE = -1;
  static readonly SCROLL_STATE_IDLE = 0;
  static readonly SCROLL_STATE_DRAGGING = 1;
  static readonly SCROLL_STATE_SETTLING = 2;

  private adapter: Adapter | null = null;
  private layoutManager: LayoutManager | null = null;
  private readonly decorations: ItemDecoration[] = [];
  private readonly scrollListeners: OnScrollListener[] = [];
  private pool = new RecycledViewPool();
  private readonly holders = new Map<number, ViewHolder>();
  private readonly holderOf = new WeakMap<View, ViewHolder>();
  /** main-axis size of each line (undefined until measured) */
  private lineSizes: Array<number | undefined> = [];
  private readonly state = new RecyclerViewState(this);
  readonly kinetics: ScrollKinetics;
  private scrollState = RecyclerView.SCROLL_STATE_IDLE;
  private isBeingDragged = false;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private filling = false;
  private fixedSize = false;
  private nestedScrolling = true;
  private readonly decorUnder = new DecorationLayer(this, false);
  private readonly decorOver = new DecorationLayer(this, true);
  private lastOffset = { x: 0, y: 0 };
  private readonly observer: AdapterDataObserver = {
    onChanged: () => this.dataSetChanged(),
    onItemRangeChanged: (start, count) => this.itemsChanged(start, count),
    onItemRangeInserted: (start, count) => this.itemsInserted(start, count),
    onItemRangeRemoved: (start, count) => this.itemsRemoved(start, count),
    onItemRangeMoved: (from, to) => this.itemMoved(from, to),
  };

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
      event: (name) => this.kineticsEvent(name),
    });
  }

  get physics(): ScrollPhysics {
    return androidKit.scroll;
  }

  // ── configuration ───────────────────────────────────────────────────

  setAdapter(adapter: Adapter | null): void {
    if (this.adapter) {
      this.adapter.unregisterAdapterDataObserver(this.observer);
      this.adapter.onDetachedFromRecyclerView(this);
    }
    this.removeAndRecycleAll(true);
    this.pool.clear();
    this.adapter = adapter;
    this.lineSizes = [];
    if (adapter) {
      adapter.registerAdapterDataObserver(this.observer);
      adapter.onAttachedToRecyclerView(this);
    }
    this.kinetics.scrollTo(0, 0, false);
    this.requestLayout();
  }

  /** Swap adapters keeping the pool (both adapters share view types). */
  swapAdapter(adapter: Adapter | null, _removeAndRecycleExistingViews: boolean): void {
    this.setAdapter(adapter);
  }

  getAdapter(): Adapter | null {
    return this.adapter;
  }

  setLayoutManager(layout: LayoutManager | null): void {
    if (this.layoutManager) this.layoutManager.recyclerView = null;
    this.removeAndRecycleAll(true);
    this.layoutManager = layout;
    if (layout) layout.recyclerView = this;
    this.lineSizes = [];
    this.requestLayout();
  }

  getLayoutManager(): LayoutManager | null {
    return this.layoutManager;
  }

  setRecycledViewPool(pool: RecycledViewPool | null): void {
    this.pool = pool ?? new RecycledViewPool();
  }

  getRecycledViewPool(): RecycledViewPool {
    return this.pool;
  }

  setHasFixedSize(fixed: boolean): void {
    this.fixedSize = fixed;
  }

  hasFixedSize(): boolean {
    return this.fixedSize;
  }

  /** Item animations are not modeled; null and DefaultItemAnimator both apply changes at once. */
  setItemAnimator(_animator: unknown): void {}

  setNestedScrollingEnabled(enabled: boolean): void {
    this.nestedScrolling = enabled;
  }

  isNestedScrollingEnabled(): boolean {
    return this.nestedScrolling;
  }

  override shouldDelayChildPressedState(): boolean {
    return true;
  }

  addItemDecoration(decoration: ItemDecoration, index = -1): void {
    if (index < 0 || index > this.decorations.length) this.decorations.push(decoration);
    else this.decorations.splice(index, 0, decoration);
    this.invalidateItemDecorations();
  }

  removeItemDecoration(decoration: ItemDecoration): void {
    const at = this.decorations.indexOf(decoration);
    if (at >= 0) this.decorations.splice(at, 1);
    this.invalidateItemDecorations();
  }

  getItemDecorationCount(): number {
    return this.decorations.length;
  }

  getItemDecorationAt(index: number): ItemDecoration | null {
    return this.decorations[index] ?? null;
  }

  invalidateItemDecorations(): void {
    this.lineSizes = [];
    this.requestLayout();
    this.invalidate();
  }

  addOnScrollListener(listener: OnScrollListener): void {
    this.scrollListeners.push(listener);
  }

  removeOnScrollListener(listener: OnScrollListener): void {
    const at = this.scrollListeners.indexOf(listener);
    if (at >= 0) this.scrollListeners.splice(at, 1);
  }

  clearOnScrollListeners(): void {
    this.scrollListeners.length = 0;
  }

  getScrollState(): number {
    return this.scrollState;
  }

  private setScrollState(state: number): void {
    if (state === this.scrollState) return;
    this.scrollState = state;
    for (const l of this.scrollListeners.slice()) l.onScrollStateChanged?.(this, state);
  }

  // ── holders ─────────────────────────────────────────────────────────

  getChildViewHolder(child: View): ViewHolder | null {
    return this.holderOf.get(child) ?? null;
  }

  getChildAdapterPosition(child: View): number {
    return this.holderOf.get(child)?.getBindingAdapterPosition() ?? RecyclerView.NO_POSITION;
  }

  getChildLayoutPosition(child: View): number {
    return this.getChildAdapterPosition(child);
  }

  findViewHolderForAdapterPosition(position: number): ViewHolder | null {
    return this.holders.get(position) ?? null;
  }

  findViewHolderForLayoutPosition(position: number): ViewHolder | null {
    return this.holders.get(position) ?? null;
  }

  findContainingViewHolder(view: View): ViewHolder | null {
    for (let v: View | null = view; v; v = v.getParent()) {
      if (v.getParent() === this) return this.holderOf.get(v) ?? null;
    }
    return null;
  }

  /** The child under (x, y) in this view's (viewport) coordinates. */
  findChildViewUnder(x: number, y: number): View | null {
    const cx = x + this.offsetX;
    const cy = y + this.offsetY;
    for (let i = this.getChildCount() - 1; i >= 0; i--) {
      const c = this.getChildAt(i)!;
      const l = c.getLeft() + c.getTranslationX();
      const t = c.getTop() + c.getTranslationY();
      if (cx >= l && cx < l + c.getWidth() && cy >= t && cy < t + c.getHeight()) return c;
    }
    return null;
  }

  // ── geometry ────────────────────────────────────────────────────────

  private get vertical(): boolean {
    return (this.layoutManager?.getOrientation() ?? RecyclerView.VERTICAL) === RecyclerView.VERTICAL;
  }

  private get offsetX(): number {
    return this.kinetics.x;
  }

  private get offsetY(): number {
    return this.kinetics.y;
  }

  private itemCount(): number {
    return this.adapter?.getItemCount() ?? 0;
  }

  private span(): number {
    return this.layoutManager?.spanCount() ?? 1;
  }

  private lineCount(): number {
    return Math.ceil(this.itemCount() / this.span());
  }

  private estimate(): number {
    let sum = 0;
    let n = 0;
    for (const s of this.lineSizes) {
      if (s !== undefined) {
        sum += s;
        n++;
      }
    }
    return n ? sum / n : DEFAULT_ESTIMATE;
  }

  private sizeOfLine(line: number, estimate: number): number {
    return this.lineSizes[line] ?? estimate;
  }

  private padStart(): number {
    return this.vertical ? this.getPaddingTop() : this.getPaddingLeft();
  }

  private padEnd(): number {
    return this.vertical ? this.getPaddingBottom() : this.getPaddingRight();
  }

  /** Where `line` starts along the main axis, in content coordinates. */
  private lineStart(line: number, estimate = this.estimate()): number {
    let at = this.padStart();
    for (let i = 0; i < line; i++) at += this.sizeOfLine(i, estimate);
    return at;
  }

  private contentExtent(): number {
    return this.lineStart(this.lineCount()) + this.padEnd();
  }

  private viewportMain(): number {
    return this.vertical ? this.getHeight() : this.getWidth();
  }

  metrics(): ScrollMetrics {
    const extent = this.contentExtent();
    const w = this.getWidth();
    const h = this.getHeight();
    return {
      contentW: this.vertical ? w : extent,
      contentH: this.vertical ? extent : h,
      viewportW: w,
      viewportH: h,
      minX: 0,
      minY: 0,
      maxX: this.vertical ? 0 : Math.max(0, extent - w),
      maxY: this.vertical ? Math.max(0, extent - h) : 0,
    };
  }

  private config(): ScrollConfig {
    return {
      horizontal: !this.vertical,
      scrollEnabled: !!this.layoutManager,
      bounces: true,
      alwaysBounceVertical: false,
      alwaysBounceHorizontal: false,
      decelerationRate: 'normal',
      pagingEnabled: false,
      snapToInterval: null,
      snapToOffsets: null,
      snapToStart: true,
      snapToEnd: true,
      showsIndicator: false,
      indicatorStyle: undefined,
    };
  }

  computeVerticalScrollOffset(): number {
    return this.vertical ? this.offsetY : 0;
  }

  computeVerticalScrollRange(): number {
    return this.vertical ? this.contentExtent() : this.getHeight();
  }

  computeVerticalScrollExtent(): number {
    return this.getHeight();
  }

  computeHorizontalScrollOffset(): number {
    return this.vertical ? 0 : this.offsetX;
  }

  computeHorizontalScrollRange(): number {
    return this.vertical ? this.getWidth() : this.contentExtent();
  }

  computeHorizontalScrollExtent(): number {
    return this.getWidth();
  }

  /** RecyclerView never scrolls itself: its content offset is not a View scroll. */
  override getScrollX(): number {
    return 0;
  }

  override getScrollY(): number {
    return 0;
  }

  override canScrollVertically(direction: number): boolean {
    if (!this.vertical || !this.layoutManager) return false;
    const m = this.metrics();
    return direction < 0 ? this.offsetY > 0 : direction > 0 ? this.offsetY < m.maxY - 0.5 : m.maxY > 0;
  }

  override canScrollHorizontally(direction: number): boolean {
    if (this.vertical || !this.layoutManager) return false;
    const m = this.metrics();
    return direction < 0 ? this.offsetX > 0 : direction > 0 ? this.offsetX < m.maxX - 0.5 : m.maxX > 0;
  }

  // ── measure & layout ────────────────────────────────────────────────

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const vertical = this.vertical;
    const mainSpec = vertical ? heightMeasureSpec : widthMeasureSpec;
    if (MeasureSpec.getMode(mainSpec) === MeasureSpec.EXACTLY || !this.layoutManager || !this.adapter) {
      this.setMeasuredDimension(View.getDefaultSize(this.getSuggestedMinimumWidth(), widthMeasureSpec), View.getDefaultSize(this.getSuggestedMinimumHeight(), heightMeasureSpec));
      return;
    }
    // wrap_content along the scroll axis: measure every item (lists that wrap are short).
    const crossSize = vertical ? MeasureSpec.getSize(widthMeasureSpec) : MeasureSpec.getSize(heightMeasureSpec);
    let cross = 0;
    for (let line = 0; line < this.lineCount(); line++) {
      for (const position of this.positionsOfLine(line)) {
        const holder = this.obtain(position, crossSize);
        cross = Math.max(cross, this.crossSizeOf(holder.itemView));
        this.scrapIfDetached(holder);
      }
    }
    const extent = this.contentExtent();
    const pad = vertical ? this.getPaddingLeft() + this.getPaddingRight() : this.getPaddingTop() + this.getPaddingBottom();
    const w = vertical ? View.getDefaultSize(cross + pad, widthMeasureSpec) : View.resolveSize(extent, widthMeasureSpec);
    const h = vertical ? View.resolveSize(extent, heightMeasureSpec) : View.getDefaultSize(cross + pad, heightMeasureSpec);
    this.setMeasuredDimension(w, h);
  }

  private crossSizeOf(view: View): number {
    const m = marginsOf(view.getLayoutParams());
    return this.vertical ? view.getMeasuredWidth() + m.left + m.right : view.getMeasuredHeight() + m.top + m.bottom;
  }

  protected override onSizeChanged(w: number, h: number, oldw: number, oldh: number): void {
    super.onSizeChanged(w, h, oldw, oldh);
    // cross size changed: items may wrap differently
    if ((this.vertical && w !== oldw) || (!this.vertical && h !== oldh)) this.lineSizes = [];
  }

  protected override onLayout(): void {
    this.fill();
  }

  private positionsOfLine(line: number): number[] {
    const span = this.span();
    const out: number[] = [];
    for (let p = line * span; p < Math.min(this.itemCount(), (line + 1) * span); p++) out.push(p);
    return out;
  }

  /** The holder for `position`: attached already, recycled or created, then bound and measured. */
  private obtain(position: number, crossSize = this.vertical ? this.getWidth() : this.getHeight()): ViewHolder {
    const adapter = this.adapter!;
    const type = adapter.getItemViewType(position);
    let holder = this.holders.get(position);
    if (holder && holder.itemViewType !== type) {
      this.recycle(holder);
      holder = undefined;
    }
    if (!holder) {
      holder = this.pool.getRecycledView(type) ?? undefined;
      if (!holder) {
        holder = adapter.onCreateViewHolder(this, type);
        holder.itemViewType = type;
        this.holderOf.set(holder.itemView, holder);
      }
      holder.owner = this;
      holder.needsBind = true;
    }
    holder.position = position;
    if (holder.needsBind) {
      holder.itemId = adapter.hasStableIds() ? adapter.getItemId(position) : RecyclerView.NO_ID;
      adapter.onBindViewHolder(holder, position, []);
      holder.needsBind = false;
    }
    this.measureItem(holder.itemView, crossSize);
    return holder;
  }

  private decorInsets(view: View): Rect {
    const total = new Rect();
    const r = new Rect();
    for (const d of this.decorations) {
      r.set(0, 0, 0, 0);
      d.getItemOffsets(r, view, this, this.state);
      total.left += r.left;
      total.top += r.top;
      total.right += r.right;
      total.bottom += r.bottom;
    }
    return total;
  }

  private measureItem(view: View, crossSize: number): void {
    const lp = view.getLayoutParams() ?? this.layoutManager!.generateDefaultLayoutParams();
    if (!view.getLayoutParams()) view.setLayoutParams(lp);
    const m = marginsOf(lp);
    const decor = this.decorInsets(view);
    const span = this.span();
    if (this.vertical) {
      const available = (crossSize - this.getPaddingLeft() - this.getPaddingRight()) / span;
      const wSpec = ViewGroup.getChildMeasureSpec(MeasureSpec.makeMeasureSpec(available, MeasureSpec.EXACTLY), m.left + m.right + decor.left + decor.right, lp.width);
      const hSpec = lp.height >= 0 ? MeasureSpec.makeMeasureSpec(lp.height, MeasureSpec.EXACTLY) : MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED);
      view.measure(wSpec, hSpec);
    } else {
      const available = (crossSize - this.getPaddingTop() - this.getPaddingBottom()) / span;
      const hSpec = ViewGroup.getChildMeasureSpec(MeasureSpec.makeMeasureSpec(available, MeasureSpec.EXACTLY), m.top + m.bottom + decor.top + decor.bottom, lp.height);
      const wSpec = lp.width >= 0 ? MeasureSpec.makeMeasureSpec(lp.width, MeasureSpec.EXACTLY) : MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED);
      view.measure(wSpec, hSpec);
    }
    const size = this.mainSizeWithDecor(view, decor);
    const line = Math.floor(this.positionOfView(view) / span);
    if (line >= 0) {
      // a line is as big as its biggest item
      const others = this.positionsOfLine(line).map((p) => this.holders.get(p)?.itemView).filter((v): v is View => !!v && v !== view);
      const lineSize = Math.max(size, ...others.map((o) => this.mainSizeWithDecor(o, this.decorInsets(o))));
      this.lineSizes[line] = lineSize;
    }
  }

  private positionOfView(view: View): number {
    return this.holderOf.get(view)?.position ?? RecyclerView.NO_POSITION;
  }

  private mainSizeWithDecor(view: View, decor: Rect): number {
    const m = marginsOf(view.getLayoutParams());
    return this.vertical ? view.getMeasuredHeight() + m.top + m.bottom + decor.top + decor.bottom : view.getMeasuredWidth() + m.left + m.right + decor.left + decor.right;
  }

  /** A holder measured during wrap_content measurement that is not part of the layout. */
  private scrapIfDetached(holder: ViewHolder): void {
    if (holder.itemView.getParent() !== this) {
      holder.position = RecyclerView.NO_POSITION;
      this.pool.putRecycledView(holder);
    }
  }

  private recycle(holder: ViewHolder): void {
    const view = holder.itemView;
    if (view.getParent() === this) {
      this.adapter?.onViewDetachedFromWindow(holder);
      super.removeView(view);
    }
    if (this.holders.get(holder.position) === holder) this.holders.delete(holder.position);
    this.adapter?.onViewRecycled(holder);
    if (holder.isRecyclable()) this.pool.putRecycledView(holder);
  }

  private removeAndRecycleAll(dropHolders: boolean): void {
    for (const holder of Array.from(this.holders.values())) {
      if (dropHolders) {
        const view = holder.itemView;
        if (view.getParent() === this) super.removeView(view);
        this.holders.delete(holder.position);
      } else this.recycle(holder);
    }
    if (dropHolders) this.holders.clear();
  }

  /**
   * Lay out the lines that intersect the viewport: bind and measure what
   * comes into view, recycle what left it, keep the visible items still if
   * estimated sizes above them were wrong.
   */
  private fill(): void {
    if (this.filling || !this.layoutManager || !this.adapter) {
      if (!this.adapter || !this.layoutManager) this.removeAndRecycleAll(false);
      return;
    }
    this.filling = true;
    try {
      const lines = this.lineCount();
      if (lines === 0) {
        this.removeAndRecycleAll(false);
        this.lineSizes = [];
        this.kinetics.clampIdle();
        this.syncOffset(true);
        return;
      }
      if (this.lineSizes.length > lines) this.lineSizes.length = lines;
      for (let pass = 0; pass < 3; pass++) {
        // anchor: the first item on screen keeps its on-screen position
        const anchor = this.firstVisibleLine();
        const anchorScreen = anchor >= 0 ? this.lineStart(anchor) - this.mainOffset() : 0;
        const needed = this.visibleLines();
        const keep = new Set<number>();
        for (const line of needed) for (const p of this.positionsOfLine(line)) keep.add(p);
        for (const [position, holder] of Array.from(this.holders)) if (!keep.has(position)) this.recycle(holder);
        for (const position of Array.from(keep).sort((a, b) => a - b)) {
          const holder = this.obtain(position);
          this.holders.set(position, holder);
        }
        let stable = true;
        if (anchor >= 0 && anchor < lines) {
          const moved = this.lineStart(anchor) - this.mainOffset() - anchorScreen;
          if (Math.abs(moved) > 0.5) {
            this.setMainOffset(this.mainOffset() + moved);
            stable = false;
          }
        }
        const after = this.visibleLines();
        if (stable && after[0] === needed[0] && after[after.length - 1] === needed[needed.length - 1]) break;
      }
      this.attachAndPosition();
      this.kinetics.clampIdle();
      this.syncOffset(true);
    } finally {
      this.filling = false;
    }
  }

  private mainOffset(): number {
    return this.vertical ? this.kinetics.y : this.kinetics.x;
  }

  private setMainOffset(value: number): void {
    const m = this.metrics();
    if (this.vertical) this.kinetics.y = Math.max(0, Math.min(value, m.maxY));
    else this.kinetics.x = Math.max(0, Math.min(value, m.maxX));
  }

  private firstVisibleLine(): number {
    const offset = this.mainOffset();
    const estimate = this.estimate();
    let at = this.padStart();
    for (let line = 0; line < this.lineCount(); line++) {
      const size = this.sizeOfLine(line, estimate);
      if (at + size > offset) return line;
      at += size;
    }
    return -1;
  }

  private visibleLines(): number[] {
    const offset = this.mainOffset();
    const end = offset + this.viewportMain();
    const estimate = this.estimate();
    const out: number[] = [];
    let at = this.padStart();
    for (let line = 0; line < this.lineCount(); line++) {
      const size = this.sizeOfLine(line, estimate);
      if (at >= end) break;
      if (at + size > offset) out.push(line);
      at += size;
    }
    return out;
  }

  /** Attach laid-out holders in position order and place them in content coordinates. */
  private attachAndPosition(): void {
    const ordered = Array.from(this.holders.values()).sort((a, b) => a.position - b.position);
    ordered.forEach((holder, index) => {
      const view = holder.itemView;
      if (view.getParent() !== this) {
        super.addView(view, Math.min(index, this.getChildCount()));
        this.adapter?.onViewAttachedToWindow(holder);
      } else if (this.indexOfChild(view) !== index) {
        // keep children in adapter order
        super.removeView(view);
        super.addView(view, Math.min(index, this.getChildCount()));
      }
    });
    const estimate = this.estimate();
    const span = this.span();
    const crossAvailable = (this.vertical ? this.getWidth() - this.getPaddingLeft() - this.getPaddingRight() : this.getHeight() - this.getPaddingTop() - this.getPaddingBottom()) / span;
    for (const holder of ordered) {
      const view = holder.itemView;
      const line = Math.floor(holder.position / span);
      const column = holder.position % span;
      const m = marginsOf(view.getLayoutParams());
      const decor = this.decorInsets(view);
      const start = this.lineStart(line, estimate);
      if (this.vertical) {
        const left = this.getPaddingLeft() + column * crossAvailable + m.left + decor.left;
        const top = start + m.top + decor.top;
        view.layout(left, top, left + view.getMeasuredWidth(), top + view.getMeasuredHeight());
      } else {
        const left = start + m.left + decor.left;
        const top = this.getPaddingTop() + column * crossAvailable + m.top + decor.top;
        view.layout(left, top, left + view.getMeasuredWidth(), top + view.getMeasuredHeight());
      }
    }
    this.decorUnder.setFrame(0, 0, this.getWidth(), this.getHeight());
    this.decorOver.setFrame(0, 0, this.getWidth(), this.getHeight());
    this.invalidate();
  }

  /** @internal positions on screen (completely: fully inside the viewport) */
  visiblePositions(completely: boolean): number[] {
    const offset = this.mainOffset();
    const end = offset + this.viewportMain();
    return Array.from(this.holders.values())
      .filter((h) => {
        const v = h.itemView;
        const start = this.vertical ? v.getTop() : v.getLeft();
        const stop = this.vertical ? v.getBottom() : v.getRight();
        return completely ? start >= offset - 0.5 && stop <= end + 0.5 : stop > offset && start < end;
      })
      .map((h) => h.position)
      .sort((a, b) => a - b);
  }

  // ── data changes ────────────────────────────────────────────────────

  private dataSetChanged(): void {
    for (const h of this.holders.values()) h.needsBind = true;
    this.lineSizes = [];
    this.requestLayout();
  }

  private itemsChanged(start: number, count: number): void {
    for (let p = start; p < start + count; p++) {
      const h = this.holders.get(p);
      if (h) h.needsBind = true;
    }
    const span = this.span();
    for (let line = Math.floor(start / span); line <= Math.floor((start + count - 1) / span); line++) this.lineSizes[line] = undefined;
    this.requestLayout();
  }

  private shiftHolders(from: number, delta: number): void {
    const moved = Array.from(this.holders).filter(([p]) => p >= from);
    for (const [p] of moved) this.holders.delete(p);
    for (const [p, h] of moved) {
      h.position = p + delta;
      this.holders.set(p + delta, h);
    }
  }

  private itemsInserted(start: number, count: number): void {
    this.shiftHolders(start, count);
    if (this.span() === 1) this.lineSizes.splice(start, 0, ...new Array<undefined>(count).fill(undefined));
    else this.lineSizes = [];
    this.requestLayout();
  }

  private itemsRemoved(start: number, count: number): void {
    for (let p = start; p < start + count; p++) {
      const h = this.holders.get(p);
      if (h) this.recycle(h);
    }
    this.shiftHolders(start + count, -count);
    if (this.span() === 1) this.lineSizes.splice(start, count);
    else this.lineSizes = [];
    this.requestLayout();
  }

  private itemMoved(from: number, to: number): void {
    const moving = this.holders.get(from);
    this.holders.delete(from);
    if (from < to) {
      for (let p = from + 1; p <= to; p++) this.moveHolder(p, p - 1);
    } else {
      for (let p = from - 1; p >= to; p--) this.moveHolder(p, p + 1);
    }
    if (moving) {
      moving.position = to;
      this.holders.set(to, moving);
    }
    if (this.span() === 1) {
      const [size] = this.lineSizes.splice(from, 1);
      this.lineSizes.splice(to, 0, size);
    } else this.lineSizes = [];
    this.requestLayout();
  }

  private moveHolder(from: number, to: number): void {
    const h = this.holders.get(from);
    this.holders.delete(from);
    if (h) {
      h.position = to;
      this.holders.set(to, h);
    }
  }

  // ── scrolling ───────────────────────────────────────────────────────

  /** Jump so `position` is at the start (plus `offset`). */
  scrollToPosition(position: number, offset = 0): void {
    if (!this.layoutManager || !this.adapter) return;
    const line = Math.floor(Math.max(0, Math.min(position, this.itemCount() - 1)) / this.span());
    this.kinetics.touchDown();
    this.setMainOffset(this.lineStart(line) - this.padStart() - offset);
    this.fill();
    // sizes may have changed now that the item is measured: land on it exactly
    this.setMainOffset(this.lineStart(line) - this.padStart() - offset);
    this.fill();
  }

  /** Scroll there with an animation (LinearSmoothScroller). */
  smoothScrollToPosition(position: number): void {
    if (!this.layoutManager || !this.adapter) return;
    const line = Math.floor(Math.max(0, Math.min(position, this.itemCount() - 1)) / this.span());
    const start = this.lineStart(line);
    const size = this.sizeOfLine(line, this.estimate());
    const offset = this.mainOffset();
    // like SNAP_TO_ANY: the least movement that brings the item fully into view
    let target = offset;
    if (start < offset + this.padStart()) target = start - this.padStart();
    else if (start + size > offset + this.viewportMain() - this.padEnd()) target = start + size - this.viewportMain() + this.padEnd();
    this.smoothScrollBy(this.vertical ? 0 : target - offset, this.vertical ? target - offset : 0);
  }

  /** Like the framework: absolute scroll positions are not supported (use scrollToPosition). */
  override scrollTo(_x: number, _y: number): void {
    this.context.kernel.warnOnce('RecyclerView.scrollTo', 'RecyclerView does not support scrolling to an absolute position. Use scrollToPosition instead');
  }

  override scrollBy(dx: number, dy: number): void {
    this.kinetics.scrollTo(this.kinetics.x + dx, this.kinetics.y + dy, false);
    this.syncOffset(false);
  }

  smoothScrollBy(dx: number, dy: number): void {
    this.kinetics.scrollTo(this.kinetics.x + dx, this.kinetics.y + dy, true);
    this.setScrollState(RecyclerView.SCROLL_STATE_SETTLING);
  }

  stopScroll(): void {
    this.kinetics.touchDown();
    this.setScrollState(RecyclerView.SCROLL_STATE_IDLE);
  }

  fling(velocityX: number, velocityY: number): boolean {
    const v = this.vertical ? velocityY : velocityX;
    if (Math.abs(v) < ViewConfiguration.getScaledMinimumFlingVelocity()) return false;
    // OverScroller's distance for a velocity under the platform's deceleration
    const distance = v * 0.3;
    this.smoothScrollBy(this.vertical ? 0 : distance, this.vertical ? distance : 0);
    return true;
  }

  private activate(): void {
    const kernel = this.kernel;
    if (!kernel) return;
    kernel.animator.add(this);
    kernel.setNeedsDisplay();
  }

  tick(now: number): boolean {
    if (!this.kernel) return false;
    const keep = this.kinetics.tick(now);
    this.syncOffset(false);
    if (!keep && !this.isBeingDragged) this.setScrollState(RecyclerView.SCROLL_STATE_IDLE);
    return keep;
  }

  /** Move the content layer to the kinetics' offset, fill new items, tell listeners. */
  private syncOffset(fromLayout: boolean): void {
    const x = this.kinetics.x;
    const y = this.kinetics.y;
    const dx = x - this.lastOffset.x;
    const dy = y - this.lastOffset.y;
    this.renderNode.originX = x;
    this.renderNode.originY = y;
    if (!dx && !dy) return;
    this.lastOffset = { x, y };
    if (!fromLayout) this.fill();
    for (const l of this.scrollListeners.slice()) l.onScrolled?.(this, dx, dy);
    this.invalidate();
  }

  private kineticsEvent(name: ScrollEvent): void {
    if (name === 'scroll') this.syncOffset(false);
    else if (name === 'momentumBegin') this.setScrollState(RecyclerView.SCROLL_STATE_SETTLING);
    else if (name === 'momentumEnd' && !this.isBeingDragged) this.setScrollState(RecyclerView.SCROLL_STATE_IDLE);
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
        // touching a settling list stops it and takes the gesture
        const wasMoving = this.kinetics.touchDown();
        this.syncOffset(false);
        this.isBeingDragged = false;
        if (wasMoving) {
          this.beginDrag(ev);
          return true;
        }
        break;
      }
      case MotionEvent.ACTION_MOVE:
        if (this.shouldStartDrag(ev)) this.beginDrag(ev);
        break;
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
        this.downX = ev.getRawX();
        this.downY = ev.getRawY();
        this.downTime = ev.getEventTime();
        this.kinetics.touchDown();
        return true;
      case MotionEvent.ACTION_MOVE:
        if (!this.isBeingDragged && this.shouldStartDrag(ev)) this.beginDrag(ev);
        if (this.isBeingDragged) {
          this.kinetics.drag(ev.getRawX(), ev.getRawY(), ev.getEventTime());
          this.syncOffset(false);
        }
        return true;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        if (this.isBeingDragged) {
          this.isBeingDragged = false;
          this.kinetics.endDrag(ev.getEventTime());
          this.syncOffset(false);
          if (this.kinetics.phase === 'idle') this.setScrollState(RecyclerView.SCROLL_STATE_IDLE);
          else this.setScrollState(RecyclerView.SCROLL_STATE_SETTLING);
        }
        return true;
    }
    return true;
  }

  private shouldStartDrag(ev: MotionEvent): boolean {
    const dx = ev.getRawX() - this.downX;
    const dy = ev.getRawY() - this.downY;
    const slop = ViewConfiguration.getScaledTouchSlop();
    if (Math.abs(dx) < slop && Math.abs(dy) < slop) return false;
    const axisIsX = Math.abs(dx) > Math.abs(dy);
    if (axisIsX === this.vertical) return false;
    return this.kinetics.scrollable(this.vertical ? 'y' : 'x');
  }

  private beginDrag(ev: MotionEvent): void {
    this.isBeingDragged = true;
    this.getParent()?.requestDisallowInterceptTouchEvent(true);
    this.kinetics.beginDrag(this.downX, this.downY, this.downTime);
    this.kinetics.drag(ev.getRawX(), ev.getRawY(), ev.getEventTime());
    this.syncOffset(false);
    this.setScrollState(RecyclerView.SCROLL_STATE_DRAGGING);
  }

  /** Mouse wheel / trackpad. */
  handleWheel(dx: number, dy: number): boolean {
    if (!this.kinetics.scrollable(this.vertical ? 'y' : 'x')) return false;
    this.kinetics.wheel(dx, dy);
    this.syncOffset(false);
    return true;
  }

  // ── drawing ─────────────────────────────────────────────────────────

  override _orderedChildNodes(): readonly RenderLayer[] {
    return [this.decorUnder, ...super._orderedChildNodes(), this.decorOver];
  }

  /** @internal draw decorations in content coordinates (the scroll layer's space) */
  drawDecorations(ctx: LayerContext, over: boolean): void {
    if (!this.decorations.length) return;
    const offset = { x: this.kinetics.x, y: this.kinetics.y };
    const bounds = { x: ctx.x + offset.x, y: ctx.y + offset.y, w: this.getWidth(), h: this.getHeight() };
    ctx.item(bounds, (w) => {
      w.save();
      w.transform(1, 0, 0, 1, ctx.x, ctx.y);
      const canvas = new Canvas(w, this.getWidth(), this.getHeight());
      for (const d of this.decorations) {
        if (over) d.onDrawOver(canvas, this, this.state);
        else d.onDraw(canvas, this, this.state);
      }
      w.restore();
    });
  }

  // ── children ────────────────────────────────────────────────────────

  /** Children come from the adapter; adding views directly is not supported. */
  override addView(_child: View, _index = -1, _params?: LayoutParams): void {
    throw new Error('IllegalStateException: RecyclerView children come from its adapter');
  }

  /** Layout requests from items bound or added during a fill are absorbed (mBlockLayoutRequests). */
  override requestLayout(): void {
    if (this.filling) return;
    super.requestLayout();
  }
}

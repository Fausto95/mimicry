import type { CGPoint, CGRect } from '../core-graphics/geometry';
import { IndexPath } from '../foundation/index-path';
import { UIColor } from './ui-color';
import type { UIEvent, UITouch } from './ui-event';
import {
  UICollectionElementCategory, UICollectionViewFlowLayout, UICollectionViewScrollDirection,
  type CollectionLayoutHost, type UICollectionViewDelegateFlowLayout, type UICollectionViewLayout, type UICollectionViewLayoutAttributes,
} from './ui-collection-view-layout';
import { UIScrollView, type UIScrollViewDelegate } from './ui-scroll-view';
import { UIView } from './ui-view';

/**
 * UICollectionView: items placed by a UICollectionViewLayout (the flow
 * layout here), with reusable cells and supplementary views made by the
 * data source only for what is near the visible region. Touches highlight
 * and select items like the table view's rows.
 */
export enum UICollectionViewScrollPosition {
  top = 1, centeredVertically = 2, bottom = 4, left = 8, centeredHorizontally = 16, right = 32,
}

export class UICollectionReusableView extends UIView {
  /** @internal */
  _reuseIdentifier: string | null = null;

  get reuseIdentifier(): string | null {
    return this._reuseIdentifier;
  }

  prepareForReuse(): void {}

  /** apply(_:) — the layout's attributes for this view */
  apply(_attributes: UICollectionViewLayoutAttributes): void {}
}

export class UICollectionViewCell extends UICollectionReusableView {
  readonly contentView = new UIView();
  private _backgroundView: UIView | null = null;
  private _selectedBackgroundView: UIView | null = null;
  private _isSelected = false;
  private _isHighlighted = false;
  /** @internal */
  _host: { _cellTouched(cell: UICollectionViewCell, phase: 'began' | 'ended' | 'cancelled', inside: boolean): void } | null = null;

  constructor(frame?: CGRect) {
    super(frame);
    this.addSubview(this.contentView);
  }

  get backgroundView(): UIView | null {
    return this._backgroundView;
  }

  set backgroundView(view: UIView | null) {
    this._backgroundView?.removeFromSuperview();
    this._backgroundView = view;
    if (view) this.insertSubview(view, 0);
    this.setNeedsLayout();
  }

  get selectedBackgroundView(): UIView | null {
    return this._selectedBackgroundView;
  }

  set selectedBackgroundView(view: UIView | null) {
    this._selectedBackgroundView?.removeFromSuperview();
    this._selectedBackgroundView = view;
    if (view) this.insertSubview(view, this._backgroundView ? 1 : 0);
    this.update();
  }

  get isSelected(): boolean {
    return this._isSelected;
  }

  set isSelected(selected: boolean) {
    this._isSelected = selected;
    this.update();
  }

  get isHighlighted(): boolean {
    return this._isHighlighted;
  }

  set isHighlighted(highlighted: boolean) {
    this._isHighlighted = highlighted;
    this.update();
  }

  private update(): void {
    if (this._selectedBackgroundView) this._selectedBackgroundView.isHidden = !(this._isSelected || this._isHighlighted);
    this.setNeedsDisplay();
  }

  override prepareForReuse(): void {
    this.isSelected = false;
    this.isHighlighted = false;
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const f = { origin: { x: 0, y: 0 }, size: this.bounds.size };
    this.contentView.frame = f;
    if (this._backgroundView) this._backgroundView.frame = f;
    if (this._selectedBackgroundView) this._selectedBackgroundView.frame = f;
  }

  override touchesBegan(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    this._host?._cellTouched(this, 'began', true);
  }

  override touchesMoved(): void {}

  override touchesEnded(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    const p = (touches.values().next().value as UITouch | undefined)?.location(this);
    const b = this.bounds.size;
    this._host?._cellTouched(this, 'ended', !!p && p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height);
  }

  override touchesCancelled(): void {
    this._host?._cellTouched(this, 'cancelled', false);
  }
}

export interface UICollectionViewDataSource {
  numberOfSections?(collectionView: UICollectionView): number;
  collectionViewNumberOfItemsInSection(collectionView: UICollectionView, section: number): number;
  collectionViewCellForItemAt(collectionView: UICollectionView, indexPath: IndexPath): UICollectionViewCell;
  collectionViewViewForSupplementaryElementOfKind?(collectionView: UICollectionView, kind: string, indexPath: IndexPath): UICollectionReusableView;
}

export interface UICollectionViewDelegate extends UIScrollViewDelegate, UICollectionViewDelegateFlowLayout {
  collectionViewShouldSelectItemAt?(collectionView: UICollectionView, indexPath: IndexPath): boolean;
  collectionViewDidSelectItemAt?(collectionView: UICollectionView, indexPath: IndexPath): void;
  collectionViewDidDeselectItemAt?(collectionView: UICollectionView, indexPath: IndexPath): void;
  collectionViewShouldHighlightItemAt?(collectionView: UICollectionView, indexPath: IndexPath): boolean;
  collectionViewWillDisplay?(collectionView: UICollectionView, cell: UICollectionViewCell, indexPath: IndexPath): void;
}

type ReusableClass = new () => UICollectionReusableView;

const PREFETCH = 120;
const key = (kind: string | null, p: IndexPath) => `${kind ?? 'cell'}:${p.section}:${p.row}`;

export class UICollectionView extends UIScrollView {
  dataSource: UICollectionViewDataSource | null = null;
  declare delegate: UICollectionViewDelegate | null;
  allowsSelection = true;
  allowsMultipleSelection = false;
  private _layout: UICollectionViewLayout;
  private readonly classes = new Map<string, ReusableClass>();
  private readonly reuse = new Map<string, UICollectionReusableView[]>();
  private readonly visible = new Map<string, { view: UICollectionReusableView; attributes: UICollectionViewLayoutAttributes }>();
  private selected: IndexPath[] = [];
  private touched: IndexPath | null = null;
  private laidOutWidth = -1;

  constructor(frame: CGRect, collectionViewLayout: UICollectionViewLayout) {
    super(frame);
    this._layout = collectionViewLayout;
    collectionViewLayout._host = this.layoutHost();
    this.backgroundColor = UIColor.systemBackground;
    this._observeScroll(() => this.layoutVisible());
  }

  private layoutHost(): CollectionLayoutHost {
    const view = this;
    return {
      get bounds() {
        return view.bounds;
      },
      get adjustedContentInset() {
        return view.adjustedContentInset;
      },
      numberOfSections: () => view.numberOfSections,
      numberOfItems: (section: number) => view.numberOfItems(section),
      _flowDelegate: () => view.delegate,
    };
  }

  get collectionViewLayout(): UICollectionViewLayout {
    return this._layout;
  }

  set collectionViewLayout(layout: UICollectionViewLayout) {
    this.setCollectionViewLayout(layout, false);
  }

  setCollectionViewLayout(layout: UICollectionViewLayout, _animated: boolean): void {
    this._layout = layout;
    layout._host = this.layoutHost();
    this.reloadData();
  }

  // ── reuse ─────────────────────────────────────────────────────────────

  /** register(_:forCellWithReuseIdentifier:) */
  register(cellClass: new () => UICollectionViewCell, forCellWithReuseIdentifier: string): void {
    this.classes.set(`cell:${forCellWithReuseIdentifier}`, cellClass);
  }

  /** register(_:forSupplementaryViewOfKind:withReuseIdentifier:) */
  registerSupplementary(viewClass: ReusableClass, kind: string, withReuseIdentifier: string): void {
    this.classes.set(`${kind}:${withReuseIdentifier}`, viewClass);
  }

  private dequeue(slot: string, identifier: string): UICollectionReusableView {
    const view = this.reuse.get(slot)?.pop();
    if (view) {
      view.prepareForReuse();
      return view;
    }
    const Class = this.classes.get(slot);
    if (!Class) throw new Error(`UICollectionView: could not dequeue a view with identifier ${identifier} — register a class for it first`);
    const made = new Class();
    made._reuseIdentifier = slot;
    return made;
  }

  dequeueReusableCell(withReuseIdentifier: string, _for: IndexPath): UICollectionViewCell {
    return this.dequeue(`cell:${withReuseIdentifier}`, withReuseIdentifier) as UICollectionViewCell;
  }

  dequeueReusableSupplementaryView(ofKind: string, withReuseIdentifier: string, _for: IndexPath): UICollectionReusableView {
    return this.dequeue(`${ofKind}:${withReuseIdentifier}`, withReuseIdentifier);
  }

  private recycle(view: UICollectionReusableView): void {
    view.removeFromSuperview();
    const slot = view._reuseIdentifier;
    if (!slot) return;
    let queue = this.reuse.get(slot);
    if (!queue) this.reuse.set(slot, (queue = []));
    queue.push(view);
  }

  // ── data ──────────────────────────────────────────────────────────────

  get numberOfSections(): number {
    return this.dataSource?.numberOfSections?.(this) ?? (this.dataSource ? 1 : 0);
  }

  numberOfItems(inSection: number): number {
    return this.dataSource?.collectionViewNumberOfItemsInSection(this, inSection) ?? 0;
  }

  reloadData(): void {
    for (const { view } of this.visible.values()) this.recycle(view);
    this.visible.clear();
    this.selected = [];
    this._layout.invalidateLayout();
    this.laidOutWidth = -1;
    this.setNeedsLayout();
  }

  reloadItems(_at: IndexPath[]): void {
    this.reloadData();
  }

  insertItems(_at: IndexPath[]): void {
    this.reloadData();
  }

  deleteItems(_at: IndexPath[]): void {
    this.reloadData();
  }

  performBatchUpdates(updates: (() => void) | null, completion?: (finished: boolean) => void): void {
    updates?.();
    this.reloadData();
    completion?.(true);
  }

  cellForItem(at: IndexPath): UICollectionViewCell | null {
    return (this.visible.get(key(null, at))?.view as UICollectionViewCell | undefined) ?? null;
  }

  get visibleCells(): UICollectionViewCell[] {
    return this.visibleEntries().map((e) => e.view as UICollectionViewCell);
  }

  get indexPathsForVisibleItems(): IndexPath[] {
    return this.visibleEntries().map((e) => e.attributes.indexPath);
  }

  private visibleEntries() {
    return Array.from(this.visible.values())
      .filter((e) => e.attributes.representedElementCategory === UICollectionElementCategory.cell)
      .sort((a, b) => a.attributes.indexPath.section - b.attributes.indexPath.section || a.attributes.indexPath.row - b.attributes.indexPath.row);
  }

  /** indexPathForItem(at:) — a point in content coordinates */
  indexPathForItem(at: CGPoint): IndexPath | null {
    const hits = this._layout.layoutAttributesForElements({ origin: at, size: { width: 1, height: 1 } });
    return hits.find((a) => a.representedElementCategory === UICollectionElementCategory.cell)?.indexPath ?? null;
  }

  layoutAttributesForItem(at: IndexPath): UICollectionViewLayoutAttributes | null {
    return this._layout.layoutAttributesForItem(at);
  }

  scrollToItem(at: IndexPath, position: UICollectionViewScrollPosition, animated: boolean): void {
    const a = this._layout.layoutAttributesForItem(at);
    if (!a) return;
    const f = a.frame;
    const b = this.bounds.size;
    const inset = this.adjustedContentInset;
    let { x, y } = this.contentOffset;
    if (position & UICollectionViewScrollPosition.top) y = f.origin.y - inset.top;
    if (position & UICollectionViewScrollPosition.centeredVertically) y = f.origin.y + f.size.height / 2 - b.height / 2;
    if (position & UICollectionViewScrollPosition.bottom) y = f.origin.y + f.size.height - b.height + inset.bottom;
    if (position & UICollectionViewScrollPosition.left) x = f.origin.x - inset.left;
    if (position & UICollectionViewScrollPosition.centeredHorizontally) x = f.origin.x + f.size.width / 2 - b.width / 2;
    if (position & UICollectionViewScrollPosition.right) x = f.origin.x + f.size.width - b.width + inset.right;
    const m = this.metrics();
    this.setContentOffset({ x: Math.max(m.minX, Math.min(m.maxX, x)), y: Math.max(m.minY, Math.min(m.maxY, y)) }, animated);
  }

  // ── selection ─────────────────────────────────────────────────────────

  get indexPathsForSelectedItems(): IndexPath[] | null {
    return this.selected.length ? this.selected.slice() : null;
  }

  selectItem(at: IndexPath | null, _animated: boolean, _position: UICollectionViewScrollPosition | 0 = 0): void {
    if (!this.allowsMultipleSelection) for (const p of this.selected.slice()) this.deselectItem(p, false);
    if (!at) return;
    if (!this.selected.some((p) => p.isEqual(at))) this.selected.push(at);
    const cell = this.cellForItem(at);
    if (cell) cell.isSelected = true;
  }

  deselectItem(at: IndexPath, _animated: boolean): void {
    this.selected = this.selected.filter((p) => !p.isEqual(at));
    const cell = this.cellForItem(at);
    if (cell) cell.isSelected = false;
  }

  /** @internal */
  _cellTouched(cell: UICollectionViewCell, phase: 'began' | 'ended' | 'cancelled', inside: boolean): void {
    const entry = Array.from(this.visible.values()).find((e) => e.view === cell);
    if (!entry || !this.allowsSelection) return;
    const d = this.delegate;
    const indexPath = entry.attributes.indexPath;
    if (phase === 'began') {
      if (this.isDecelerating || d?.collectionViewShouldHighlightItemAt?.(this, indexPath) === false) return;
      this.touched = indexPath;
      cell.isHighlighted = true;
      return;
    }
    if (!this.touched?.isEqual(indexPath)) return;
    this.touched = null;
    cell.isHighlighted = false;
    if (phase !== 'ended' || !inside) return;
    if (d?.collectionViewShouldSelectItemAt?.(this, indexPath) === false) return;
    if (this.allowsMultipleSelection && this.selected.some((p) => p.isEqual(indexPath))) {
      this.deselectItem(indexPath, false);
      d?.collectionViewDidDeselectItemAt?.(this, indexPath);
      return;
    }
    const previous = this.allowsMultipleSelection ? [] : this.selected.slice();
    this.selectItem(indexPath, false);
    for (const p of previous) if (!p.isEqual(indexPath)) d?.collectionViewDidDeselectItemAt?.(this, p);
    d?.collectionViewDidSelectItemAt?.(this, indexPath);
  }

  // ── layout ────────────────────────────────────────────────────────────

  override layoutSubviews(): void {
    const b = this.bounds.size;
    if (this.laidOutWidth !== b.width) {
      this.laidOutWidth = b.width;
      this._layout.invalidateLayout();
    }
    this._layout.prepare();
    const size = this._layout.collectionViewContentSize;
    const c = this.contentSize;
    if (c.width !== size.width || c.height !== size.height) this.contentSize = size;
    const flow = this._layout instanceof UICollectionViewFlowLayout ? this._layout : null;
    this.horizontal = flow?.scrollDirection === UICollectionViewScrollDirection.horizontal;
    super.layoutSubviews();
    this.layoutVisible();
  }

  private layoutVisible(): void {
    if (!this.dataSource || !this.window) return;
    const o = this.contentOffset;
    const b = this.bounds.size;
    const rect = { origin: { x: o.x - PREFETCH, y: o.y - PREFETCH }, size: { width: b.width + PREFETCH * 2, height: b.height + PREFETCH * 2 } };
    const wanted = new Set<string>();
    UIView.performWithoutAnimation(() => {
      for (const attributes of this._layout.layoutAttributesForElements(rect)) {
        const kind = attributes.representedElementKind;
        const k = key(kind, attributes.indexPath);
        wanted.add(k);
        let entry = this.visible.get(k);
        if (!entry) {
          const view = kind === null
            ? this.dataSource!.collectionViewCellForItemAt(this, attributes.indexPath)
            : this.dataSource!.collectionViewViewForSupplementaryElementOfKind?.(this, kind, attributes.indexPath);
          if (!view) continue;
          if (view instanceof UICollectionViewCell) {
            view._host = this;
            view.isSelected = this.selected.some((p) => p.isEqual(attributes.indexPath));
          }
          this.insertSubview(view, kind === null ? 0 : this.subviews.length);
          entry = { view, attributes };
          this.visible.set(k, entry);
          if (view instanceof UICollectionViewCell) this.delegate?.collectionViewWillDisplay?.(this, view, attributes.indexPath);
        }
        entry.attributes = attributes;
        entry.view.setFrameIfNeeded(attributes.frame);
        entry.view.alpha = attributes.alpha;
        entry.view.isHidden = attributes.isHidden;
        entry.view.layer.zPosition = attributes.zIndex;
        entry.view.apply(attributes);
      }
    });
    for (const [k, entry] of this.visible) {
      if (wanted.has(k)) continue;
      this.visible.delete(k);
      this.recycle(entry.view);
    }
  }
}

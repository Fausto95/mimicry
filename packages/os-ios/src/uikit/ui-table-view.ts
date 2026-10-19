import type { CGPoint, CGRect } from '../core-graphics/geometry';
import { IndexPath } from '../foundation/index-path';
import { NSLineBreakMode } from './ns-paragraph-style';
import { UIColor } from './ui-color';
import { UIFont, UIFontWeight } from './ui-font';
import { UILabel } from './ui-label';
import { UIScrollView, type UIScrollViewDelegate } from './ui-scroll-view';
import { UITableViewCell, UITableViewCellStyle, type TableCellHost } from './ui-table-view-cell';
import { UIView } from './ui-view';

/**
 * UITableView: rows in sections on a UIScrollView, with cells made by its
 * data source and reused as they scroll out (only rows near the visible
 * region have cells).
 *
 * Styles: plain (edge to edge, sticky-less section headers in 15 pt
 * semibold), grouped (full-width sections on the grouped background) and
 * insetGrouped (cards 16 pt from the sides with 26 pt corners — iOS 26's
 * rounder cards). Rows are 44 pt or self-sized from their standard content
 * (rowHeight = automaticDimension, the default), unless the delegate says
 * otherwise. Separators run from the text's leading edge, not after a
 * section's last row in the grouped styles.
 *
 * A touch highlights its row; lifting the finger on it selects (didSelect);
 * a scroll that starts cancels the highlight. Row-level insert / delete /
 * reload calls reload the table without row animations.
 */
export enum UITableViewStyle { plain = 0, grouped = 1, insetGrouped = 2 }
export enum UITableViewScrollPosition { none = 0, top = 1, middle = 2, bottom = 3 }
export enum UITableViewCellSeparatorStyle { none = 0, singleLine = 1 }
export enum UITableViewRowAnimation { fade = 0, right = 1, left = 2, top = 3, bottom = 4, none = 5, middle = 6, automatic = 100 }

export const UITableViewAutomaticDimension = -1;

export interface UITableViewDataSource {
  numberOfSections?(tableView: UITableView): number;
  tableViewNumberOfRowsInSection(tableView: UITableView, section: number): number;
  tableViewCellForRowAt(tableView: UITableView, indexPath: IndexPath): UITableViewCell;
  tableViewTitleForHeaderInSection?(tableView: UITableView, section: number): string | null;
  tableViewTitleForFooterInSection?(tableView: UITableView, section: number): string | null;
}

export interface UITableViewDelegate extends UIScrollViewDelegate {
  tableViewHeightForRowAt?(tableView: UITableView, indexPath: IndexPath): number;
  tableViewHeightForHeaderInSection?(tableView: UITableView, section: number): number;
  tableViewHeightForFooterInSection?(tableView: UITableView, section: number): number;
  tableViewViewForHeaderInSection?(tableView: UITableView, section: number): UIView | null;
  tableViewViewForFooterInSection?(tableView: UITableView, section: number): UIView | null;
  tableViewWillSelectRowAt?(tableView: UITableView, indexPath: IndexPath): IndexPath | null;
  tableViewDidSelectRowAt?(tableView: UITableView, indexPath: IndexPath): void;
  tableViewDidDeselectRowAt?(tableView: UITableView, indexPath: IndexPath): void;
  tableViewShouldHighlightRowAt?(tableView: UITableView, indexPath: IndexPath): boolean;
  tableViewWillDisplay?(tableView: UITableView, cell: UITableViewCell, indexPath: IndexPath): void;
}

interface SectionGeometry {
  top: number;
  headerHeight: number;
  rows: number[];
  rowTops: number[];
  footerHeight: number;
  bottom: number;
  headerTitle: string | null;
  footerTitle: string | null;
}

const INSET_MARGIN = 16;
const INSET_RADIUS = 26;
/** how far beyond the visible region cells are kept */
const PREFETCH = 120;

export class UITableView extends UIScrollView implements TableCellHost {
  readonly style: UITableViewStyle;
  /** UITableViewDelegate (it is a UIScrollViewDelegate too) */
  declare delegate: UITableViewDelegate | null;
  dataSource: UITableViewDataSource | null = null;
  rowHeight = UITableViewAutomaticDimension;
  estimatedRowHeight = UITableViewAutomaticDimension;
  sectionHeaderHeight = UITableViewAutomaticDimension;
  sectionFooterHeight = UITableViewAutomaticDimension;
  separatorStyle = UITableViewCellSeparatorStyle.singleLine;
  separatorColor: UIColor | null = null;
  separatorInset: { top: number; left: number; bottom: number; right: number } | null = null;
  allowsSelection = true;
  allowsMultipleSelection = false;
  private _tableHeaderView: UIView | null = null;
  private _tableFooterView: UIView | null = null;
  private geometry: SectionGeometry[] | null = null;
  private geometryWidth = -1;
  private readonly visible = new Map<string, { cell: UITableViewCell; indexPath: IndexPath }>();
  private readonly headers = new Map<string, UIView>();
  private readonly reuse = new Map<string, UITableViewCell[]>();
  private readonly registered = new Map<string, new (style: UITableViewCellStyle, reuseIdentifier: string) => UITableViewCell>();
  private selected: IndexPath[] = [];
  private touched: IndexPath | null = null;

  constructor(frame?: CGRect, style: UITableViewStyle = UITableViewStyle.plain) {
    super(frame);
    this.style = style;
    this.alwaysBounceVertical = true;
    this.backgroundColor = style === UITableViewStyle.plain ? UIColor.systemBackground : UIColor.systemGroupedBackground;
    this._observeScroll(() => this.layoutVisible());
  }

  private get tableViewDelegate(): UITableViewDelegate | null {
    return this.delegate;
  }

  get tableHeaderView(): UIView | null {
    return this._tableHeaderView;
  }

  set tableHeaderView(view: UIView | null) {
    this._tableHeaderView?.removeFromSuperview();
    this._tableHeaderView = view;
    if (view) this.addSubview(view);
    this.invalidate();
  }

  get tableFooterView(): UIView | null {
    return this._tableFooterView;
  }

  set tableFooterView(view: UIView | null) {
    this._tableFooterView?.removeFromSuperview();
    this._tableFooterView = view;
    if (view) this.addSubview(view);
    this.invalidate();
  }

  // ── cells ─────────────────────────────────────────────────────────────

  /** register(_:forCellReuseIdentifier:) */
  register(cellClass: new (style: UITableViewCellStyle, reuseIdentifier: string) => UITableViewCell, forCellReuseIdentifier: string): void {
    this.registered.set(forCellReuseIdentifier, cellClass);
  }

  /** dequeueReusableCell(withIdentifier:) — a recycled cell, a new one of the registered class, or null. */
  dequeueReusableCell(withIdentifier: string, _for?: IndexPath): UITableViewCell | null {
    const queue = this.reuse.get(withIdentifier);
    const cell = queue?.pop();
    if (cell) {
      cell.prepareForReuse();
      return cell;
    }
    const Cell = this.registered.get(withIdentifier);
    if (Cell) return new Cell(UITableViewCellStyle.default, withIdentifier);
    if (_for) throw new Error(`UITableView: unable to dequeue a cell with identifier ${withIdentifier} — register a class first`);
    return null;
  }

  private recycle(cell: UITableViewCell): void {
    cell.removeFromSuperview();
    const id = cell.reuseIdentifier;
    if (!id) return;
    let queue = this.reuse.get(id);
    if (!queue) this.reuse.set(id, (queue = []));
    queue.push(cell);
  }

  private makeCell(indexPath: IndexPath): UITableViewCell {
    const ds = this.dataSource;
    if (!ds) throw new Error('UITableView: no dataSource');
    const cell = ds.tableViewCellForRowAt(this, indexPath);
    cell._host = this;
    cell._margin = this.style === UITableViewStyle.plain ? 16 : 20;
    cell._applyDefaultBackground(this.style === UITableViewStyle.plain ? UIColor.systemBackground : UIColor.secondarySystemGroupedBackground);
    return cell;
  }

  // ── data ──────────────────────────────────────────────────────────────

  get numberOfSections(): number {
    return this.dataSource?.numberOfSections?.(this) ?? (this.dataSource ? 1 : 0);
  }

  numberOfRows(inSection: number): number {
    return this.dataSource?.tableViewNumberOfRowsInSection(this, inSection) ?? 0;
  }

  /** reloadData(): forget every cell and measurement, then lay out again. */
  reloadData(): void {
    for (const { cell } of this.visible.values()) this.recycle(cell);
    this.visible.clear();
    for (const header of this.headers.values()) header.removeFromSuperview();
    this.headers.clear();
    this.selected = [];
    this.invalidate();
  }

  reloadRows(_at: IndexPath[], _animation: UITableViewRowAnimation): void {
    this.reloadData();
  }

  insertRows(_at: IndexPath[], _animation: UITableViewRowAnimation): void {
    this.reloadData();
  }

  deleteRows(_at: IndexPath[], _animation: UITableViewRowAnimation): void {
    this.reloadData();
  }

  reloadSections(_sections: number[], _animation: UITableViewRowAnimation): void {
    this.reloadData();
  }

  performBatchUpdates(updates: (() => void) | null, completion?: (finished: boolean) => void): void {
    updates?.();
    this.reloadData();
    completion?.(true);
  }

  private invalidate(): void {
    this.geometry = null;
    this.setNeedsLayout();
  }

  // ── geometry ──────────────────────────────────────────────────────────

  private headerHeightFor(section: number, title: string | null): number {
    const d = this.tableViewDelegate;
    const custom = d?.tableViewHeightForHeaderInSection?.(this, section);
    if (custom !== undefined && custom >= 0) return custom;
    if (this.sectionHeaderHeight >= 0) return this.sectionHeaderHeight;
    if (d?.tableViewViewForHeaderInSection?.(this, section)) return 38;
    if (this.style === UITableViewStyle.plain) return title ? 28 : 0;
    return title ? 38 + (section === 0 ? 10 : 0) : section === 0 ? 18 : 18;
  }

  private footerHeightFor(section: number, title: string | null): number {
    const d = this.tableViewDelegate;
    const custom = d?.tableViewHeightForFooterInSection?.(this, section);
    if (custom !== undefined && custom >= 0) return custom;
    if (this.sectionFooterHeight >= 0) return this.sectionFooterHeight;
    if (this.style === UITableViewStyle.plain) return 0;
    if (!title) return 18;
    const label = footerLabel(title);
    return Math.ceil(label.sizeThatFits({ width: this.contentWidth - 40, height: Infinity }).height) + 7 + 18;
  }

  private get contentWidth(): number {
    return this.bounds.size.width - (this.style === UITableViewStyle.insetGrouped ? INSET_MARGIN * 2 : 0);
  }

  private rowHeightFor(indexPath: IndexPath): number {
    const d = this.tableViewDelegate;
    const custom = d?.tableViewHeightForRowAt?.(this, indexPath);
    if (custom !== undefined && custom >= 0) return custom;
    if (this.rowHeight >= 0) return this.rowHeight;
    // Self-sizing: the cell's own content decides (its standard labels).
    const cell = this.makeCell(indexPath);
    const height = cell.sizeThatFits({ width: this.contentWidth, height: Infinity }).height;
    this.recycle(cell);
    return height;
  }

  private ensureGeometry(): SectionGeometry[] {
    const width = this.bounds.size.width;
    if (this.geometry && this.geometryWidth === width) return this.geometry;
    this.geometryWidth = width;
    const ds = this.dataSource;
    const sections: SectionGeometry[] = [];
    let y = this._tableHeaderView ? this._tableHeaderView.bounds.size.height : 0;
    for (let s = 0; s < this.numberOfSections; s++) {
      const headerTitle = ds?.tableViewTitleForHeaderInSection?.(this, s) ?? null;
      const footerTitle = ds?.tableViewTitleForFooterInSection?.(this, s) ?? null;
      const headerHeight = this.headerHeightFor(s, headerTitle);
      const top = y;
      y += headerHeight;
      const rows: number[] = [];
      const rowTops: number[] = [];
      const n = this.numberOfRows(s);
      for (let r = 0; r < n; r++) {
        rowTops.push(y);
        const h = this.rowHeightFor(new IndexPath(r, s));
        rows.push(h);
        y += h;
      }
      const footerHeight = this.footerHeightFor(s, footerTitle);
      y += footerHeight;
      sections.push({ top, headerHeight, rows, rowTops, footerHeight, bottom: y, headerTitle, footerTitle });
    }
    if (this._tableFooterView) y += this._tableFooterView.bounds.size.height;
    this.geometry = sections;
    this.contentSize = { width, height: y };
    return sections;
  }

  /** rectForRow(at:) — content coordinates */
  rectForRow(at: IndexPath): CGRect {
    const g = this.ensureGeometry()[at.section];
    const top = g?.rowTops[at.row];
    if (!g || top === undefined) return { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
    const inset = this.style === UITableViewStyle.insetGrouped ? INSET_MARGIN : 0;
    return { origin: { x: inset, y: top }, size: { width: this.bounds.size.width - inset * 2, height: g.rows[at.row]! } };
  }

  /** indexPathForRow(at:) — a point in content coordinates */
  indexPathForRow(at: CGPoint): IndexPath | null {
    const sections = this.ensureGeometry();
    for (let s = 0; s < sections.length; s++) {
      const g = sections[s]!;
      for (let r = 0; r < g.rows.length; r++) {
        if (at.y >= g.rowTops[r]! && at.y < g.rowTops[r]! + g.rows[r]!) return new IndexPath(r, s);
      }
    }
    return null;
  }

  cellForRow(at: IndexPath): UITableViewCell | null {
    return this.visible.get(key(at))?.cell ?? null;
  }

  get visibleCells(): UITableViewCell[] {
    return this.sortedVisible().map((v) => v.cell);
  }

  get indexPathsForVisibleRows(): IndexPath[] {
    return this.sortedVisible().map((v) => v.indexPath);
  }

  private sortedVisible() {
    return Array.from(this.visible.values()).sort((a, b) => a.indexPath.section - b.indexPath.section || a.indexPath.row - b.indexPath.row);
  }

  scrollToRow(at: IndexPath, position: UITableViewScrollPosition, animated: boolean): void {
    const r = this.rectForRow(at);
    const viewport = this.bounds.size.height;
    const inset = this.adjustedContentInset;
    let y: number;
    switch (position) {
      case UITableViewScrollPosition.top: y = r.origin.y - inset.top; break;
      case UITableViewScrollPosition.middle: y = r.origin.y + r.size.height / 2 - (viewport - inset.top - inset.bottom) / 2 - inset.top; break;
      case UITableViewScrollPosition.bottom: y = r.origin.y + r.size.height - viewport + inset.bottom; break;
      default: {
        this.scrollRectToVisible(r, animated);
        return;
      }
    }
    const max = Math.max(-inset.top, this.contentSize.height - viewport + inset.bottom);
    this.setContentOffset({ x: 0, y: Math.max(-inset.top, Math.min(max, y)) }, animated);
  }

  // ── selection ─────────────────────────────────────────────────────────

  get indexPathForSelectedRow(): IndexPath | null {
    return this.selected[0] ?? null;
  }

  get indexPathsForSelectedRows(): IndexPath[] | null {
    return this.selected.length ? this.selected.slice() : null;
  }

  selectRow(at: IndexPath | null, animated: boolean, position: UITableViewScrollPosition = UITableViewScrollPosition.none): void {
    if (!this.allowsMultipleSelection) for (const p of this.selected.slice()) this.deselectRow(p, false);
    if (!at) return;
    if (!this.selected.some((p) => p.isEqual(at))) this.selected.push(at);
    this.cellForRow(at)?.setSelected(true, animated);
    if (position !== UITableViewScrollPosition.none) this.scrollToRow(at, position, animated);
  }

  deselectRow(at: IndexPath, animated: boolean): void {
    this.selected = this.selected.filter((p) => !p.isEqual(at));
    this.cellForRow(at)?.setSelected(false, animated);
  }

  /** @internal */
  _cellTouched(cell: UITableViewCell, phase: 'began' | 'ended' | 'cancelled', inside: boolean): void {
    const entry = Array.from(this.visible.values()).find((v) => v.cell === cell);
    if (!entry || !this.allowsSelection) return;
    const d = this.tableViewDelegate;
    const indexPath = entry.indexPath;
    if (phase === 'began') {
      if (this.isDecelerating || d?.tableViewShouldHighlightRowAt?.(this, indexPath) === false) return;
      this.touched = indexPath;
      cell.setHighlighted(true, false);
      return;
    }
    if (!this.touched?.isEqual(indexPath)) return;
    this.touched = null;
    cell.setHighlighted(false, phase === 'cancelled');
    if (phase !== 'ended' || !inside) return;
    const target = d?.tableViewWillSelectRowAt ? d.tableViewWillSelectRowAt(this, indexPath) : indexPath;
    if (!target) return;
    if (this.allowsMultipleSelection && this.selected.some((p) => p.isEqual(target))) {
      this.deselectRow(target, false);
      d?.tableViewDidDeselectRowAt?.(this, target);
      return;
    }
    const previous = this.allowsMultipleSelection ? [] : this.selected.slice();
    this.selectRow(target, false);
    for (const p of previous) if (!p.isEqual(target)) d?.tableViewDidDeselectRowAt?.(this, p);
    d?.tableViewDidSelectRowAt?.(this, target);
  }

  // ── layout ────────────────────────────────────────────────────────────

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.ensureGeometry();
    const width = this.bounds.size.width;
    if (this._tableHeaderView) this._tableHeaderView.setFrameIfNeeded({ origin: { x: 0, y: 0 }, size: { width, height: this._tableHeaderView.bounds.size.height } });
    if (this._tableFooterView) {
      const h = this._tableFooterView.bounds.size.height;
      this._tableFooterView.setFrameIfNeeded({ origin: { x: 0, y: this.contentSize.height - h }, size: { width, height: h } });
    }
    this.layoutVisible();
  }

  /** Cells for the rows near the visible region; the others go back to the reuse queue. */
  private layoutVisible(): void {
    if (!this.dataSource || !this.window) return;
    const sections = this.ensureGeometry();
    const top = this.contentOffset.y - PREFETCH;
    const bottom = this.contentOffset.y + this.bounds.size.height + PREFETCH;
    const width = this.bounds.size.width;
    const inset = this.style === UITableViewStyle.insetGrouped ? INSET_MARGIN : 0;
    const wanted = new Set<string>();
    const wantedHeaders = new Set<string>();
    const separatorColor = this.separatorColor ?? UIColor.separator;
    UIView.performWithoutAnimation(() => {
      sections.forEach((g, s) => {
        if (g.bottom < top || g.top > bottom) return;
        this.layoutSupplementary(g, s, 'header', width, wantedHeaders);
        this.layoutSupplementary(g, s, 'footer', width, wantedHeaders);
        const last = g.rows.length - 1;
        g.rows.forEach((h, r) => {
          const y = g.rowTops[r]!;
          if (y + h < top || y > bottom) return;
          const indexPath = new IndexPath(r, s);
          const k = key(indexPath);
          wanted.add(k);
          let entry = this.visible.get(k);
          if (!entry) {
            const cell = this.makeCell(indexPath);
            entry = { cell, indexPath };
            this.visible.set(k, entry);
            this.insertSubview(cell, 0);
            cell.setSelected(this.selected.some((p) => p.isEqual(indexPath)), false);
            this.tableViewDelegate?.tableViewWillDisplay?.(this, cell, indexPath);
          }
          const cell = entry.cell;
          cell.setFrameIfNeeded({ origin: { x: inset, y }, size: { width: width - inset * 2, height: h } });
          if (this.style === UITableViewStyle.insetGrouped) {
            const first = r === 0;
            const end = r === last;
            cell.layer.cornerRadius = first || end ? INSET_RADIUS : 0;
            cell.layer.maskedCorners = (first ? 1 | 2 : 0) | (end ? 4 | 8 : 0);
            cell.clipsToBounds = first || end;
          }
          const showSeparator = this.separatorStyle !== UITableViewCellSeparatorStyle.none && (this.style === UITableViewStyle.plain || r !== last);
          if (showSeparator) {
            const imageWidth = cell.imageView.image ? Math.max(cell.imageView.image.size.width, 29) + 15 : 0;
            const left = cell.separatorInset?.left ?? this.separatorInset?.left ?? cell._margin + imageWidth;
            cell._separator = { left, right: cell.separatorInset?.right ?? this.separatorInset?.right ?? 0, color: separatorColor };
          } else cell._separator = null;
          cell.setNeedsDisplay();
        });
      });
    });
    for (const [k, entry] of this.visible) {
      if (wanted.has(k)) continue;
      this.visible.delete(k);
      this.recycle(entry.cell);
    }
    for (const [k, view] of this.headers) {
      if (wantedHeaders.has(k)) continue;
      this.headers.delete(k);
      view.removeFromSuperview();
    }
  }

  private layoutSupplementary(g: SectionGeometry, s: number, kind: 'header' | 'footer', width: number, wanted: Set<string>): void {
    const height = kind === 'header' ? g.headerHeight : g.footerHeight;
    if (height <= 0) return;
    const d = this.tableViewDelegate;
    const k = `${kind}:${s}`;
    let view = this.headers.get(k);
    if (!view) {
      const custom = kind === 'header' ? d?.tableViewViewForHeaderInSection?.(this, s) : d?.tableViewViewForFooterInSection?.(this, s);
      const title = kind === 'header' ? g.headerTitle : g.footerTitle;
      if (!custom && !title) return;
      view = custom ?? this.titleView(title!, kind);
      this.headers.set(k, view);
      this.addSubview(view);
    }
    wanted.add(k);
    const y = kind === 'header' ? g.top : g.bottom - g.footerHeight;
    view.setFrameIfNeeded({ origin: { x: 0, y }, size: { width, height } });
  }

  /** The standard header / footer title view for this table's style. */
  private titleView(title: string, kind: 'header' | 'footer'): UIView {
    const view = new SupplementaryTitleView(this.style, kind);
    view.label.text = title;
    if (this.style === UITableViewStyle.plain) view.backgroundColor = UIColor.systemBackground;
    return view;
  }
}

/** UITableViewHeaderFooterView's standard title layout. */
class SupplementaryTitleView extends UIView {
  readonly label: UILabel;

  constructor(private readonly tableStyle: UITableViewStyle, private readonly kind: 'header' | 'footer') {
    super();
    this.isUserInteractionEnabled = false;
    this.label = kind === 'footer' ? footerLabel('') : new UILabel();
    if (kind === 'header') {
      this.label.font = tableStyle === UITableViewStyle.plain ? UIFont.systemFont(15, UIFontWeight.semibold) : UIFont.systemFont(13);
      this.label.textColor = tableStyle === UITableViewStyle.plain ? UIColor.label : UIColor.secondaryLabel;
      this.label.lineBreakMode = NSLineBreakMode.byTruncatingTail;
    }
    this.addSubview(this.label);
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const b = this.bounds.size;
    const side = this.tableStyle === UITableViewStyle.insetGrouped ? INSET_MARGIN + 20 : this.tableStyle === UITableViewStyle.grouped ? 20 : 16;
    const width = b.width - side * 2;
    const h = this.label.sizeThatFits({ width, height: Infinity }).height;
    // Headers sit on the section (7 pt above it); footers hang 7 pt below it.
    const y = this.kind === 'header' ? (this.tableStyle === UITableViewStyle.plain ? (b.height - h) / 2 : b.height - 7 - h) : 7;
    this.label.frame = { origin: { x: side, y }, size: { width, height: h } };
  }
}

function footerLabel(text: string): UILabel {
  const label = new UILabel();
  label.text = text;
  label.font = UIFont.systemFont(13);
  label.textColor = UIColor.secondaryLabel;
  label.numberOfLines = 0;
  return label;
}

const key = (p: IndexPath) => `${p.section}:${p.row}`;

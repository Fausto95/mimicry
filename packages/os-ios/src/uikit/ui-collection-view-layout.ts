import { UIEdgeInsetsZero, type CGRect, type CGSize, type UIEdgeInsets } from '../core-graphics/geometry';
import { IndexPath } from '../foundation/index-path';

/**
 * UICollectionViewLayout and UICollectionViewFlowLayout.
 *
 * The flow layout places items in lines along the scroll direction's cross
 * axis: each line takes as many items as fit with the minimum interitem
 * spacing; the leftover space of a full line is shared between its items
 * (UIKit's justified flow), a lone item is centered, and the last line keeps
 * the minimum spacing. Sections stack with their insets, optional header
 * and footer (reference sizes), and per-section values from the flow
 * delegate. Self-sizing (estimatedItemSize) is not modeled: items use
 * itemSize or the delegate's size.
 */
export enum UICollectionViewScrollDirection { vertical = 0, horizontal = 1 }

export const UICollectionElementKindSectionHeader = 'UICollectionElementKindSectionHeader';
export const UICollectionElementKindSectionFooter = 'UICollectionElementKindSectionFooter';

export enum UICollectionElementCategory { cell = 0, supplementaryView = 1, decorationView = 2 }

export class UICollectionViewLayoutAttributes {
  frame: CGRect;
  alpha = 1;
  zIndex = 0;
  isHidden = false;

  constructor(
    readonly indexPath: IndexPath,
    readonly representedElementCategory: UICollectionElementCategory,
    readonly representedElementKind: string | null,
    frame: CGRect,
  ) {
    this.frame = frame;
  }

  get size(): CGSize {
    return this.frame.size;
  }
}

/** What a layout reads from its collection view. */
export interface CollectionLayoutHost {
  readonly bounds: CGRect;
  readonly adjustedContentInset: UIEdgeInsets;
  numberOfSections(): number;
  numberOfItems(inSection: number): number;
  /** the flow delegate's answers, when it has them */
  _flowDelegate(): UICollectionViewDelegateFlowLayout | null;
}

export abstract class UICollectionViewLayout {
  /** @internal set by the collection view */
  _host: CollectionLayoutHost | null = null;

  get collectionView(): CollectionLayoutHost | null {
    return this._host;
  }

  prepare(): void {}
  abstract get collectionViewContentSize(): CGSize;
  abstract layoutAttributesForElements(rect: CGRect): UICollectionViewLayoutAttributes[];
  abstract layoutAttributesForItem(indexPath: IndexPath): UICollectionViewLayoutAttributes | null;

  layoutAttributesForSupplementaryView(_kind: string, _indexPath: IndexPath): UICollectionViewLayoutAttributes | null {
    return null;
  }

  invalidateLayout(): void {}

  shouldInvalidateLayout(newBounds: CGRect): boolean {
    const old = this._host?.bounds.size;
    return !old || old.width !== newBounds.size.width || old.height !== newBounds.size.height;
  }
}

export interface UICollectionViewDelegateFlowLayout {
  collectionViewSizeForItemAt?(view: unknown, layout: UICollectionViewFlowLayout, indexPath: IndexPath): CGSize;
  collectionViewInsetForSectionAt?(view: unknown, layout: UICollectionViewFlowLayout, section: number): UIEdgeInsets;
  collectionViewMinimumLineSpacingForSectionAt?(view: unknown, layout: UICollectionViewFlowLayout, section: number): number;
  collectionViewMinimumInteritemSpacingForSectionAt?(view: unknown, layout: UICollectionViewFlowLayout, section: number): number;
  collectionViewReferenceSizeForHeaderInSection?(view: unknown, layout: UICollectionViewFlowLayout, section: number): CGSize;
  collectionViewReferenceSizeForFooterInSection?(view: unknown, layout: UICollectionViewFlowLayout, section: number): CGSize;
}

export class UICollectionViewFlowLayout extends UICollectionViewLayout {
  scrollDirection = UICollectionViewScrollDirection.vertical;
  itemSize: CGSize = { width: 50, height: 50 };
  estimatedItemSize: CGSize = { width: 0, height: 0 };
  minimumLineSpacing = 10;
  minimumInteritemSpacing = 10;
  sectionInset: UIEdgeInsets = UIEdgeInsetsZero;
  headerReferenceSize: CGSize = { width: 0, height: 0 };
  footerReferenceSize: CGSize = { width: 0, height: 0 };
  sectionHeadersPinToVisibleBounds = false;
  private items: UICollectionViewLayoutAttributes[] = [];
  private supplementary: UICollectionViewLayoutAttributes[] = [];
  private size: CGSize = { width: 0, height: 0 };
  private valid = false;

  override invalidateLayout(): void {
    this.valid = false;
  }

  override prepare(): void {
    if (this.valid) return;
    this.valid = true;
    this.items = [];
    this.supplementary = [];
    const host = this._host;
    if (!host) return;
    const vertical = this.scrollDirection === UICollectionViewScrollDirection.vertical;
    const insets = host.adjustedContentInset;
    // The cross axis available to lines: the viewport minus the adjusted insets on that axis.
    const cross = vertical ? host.bounds.size.width - insets.left - insets.right : host.bounds.size.height - insets.top - insets.bottom;
    const d = host._flowDelegate();
    // Positions along the scroll axis (main) and across it (cross), turned into frames at the end.
    const frame = (main: number, crossPos: number, mainSize: number, crossSize: number): CGRect => (vertical
      ? { origin: { x: crossPos, y: main }, size: { width: crossSize, height: mainSize } }
      : { origin: { x: main, y: crossPos }, size: { width: mainSize, height: crossSize } });
    let main = 0;
    let crossExtent = cross;
    const sections = host.numberOfSections();
    for (let s = 0; s < sections; s++) {
      const inset = d?.collectionViewInsetForSectionAt?.(host, this, s) ?? this.sectionInset;
      const lineSpacing = d?.collectionViewMinimumLineSpacingForSectionAt?.(host, this, s) ?? this.minimumLineSpacing;
      const itemSpacing = d?.collectionViewMinimumInteritemSpacingForSectionAt?.(host, this, s) ?? this.minimumInteritemSpacing;
      const header = d?.collectionViewReferenceSizeForHeaderInSection?.(host, this, s) ?? this.headerReferenceSize;
      const footer = d?.collectionViewReferenceSizeForFooterInSection?.(host, this, s) ?? this.footerReferenceSize;
      const headerMain = vertical ? header.height : header.width;
      if (headerMain > 0) {
        this.supplementary.push(new UICollectionViewLayoutAttributes(indexPathOf(0, s), UICollectionElementCategory.supplementaryView, UICollectionElementKindSectionHeader, frame(main, 0, headerMain, cross)));
        main += headerMain;
      }
      const before = vertical ? inset.top : inset.left;
      const after = vertical ? inset.bottom : inset.right;
      const lead = vertical ? inset.left : inset.top;
      const trail = vertical ? inset.right : inset.bottom;
      const available = cross - lead - trail;
      main += before;
      const count = host.numberOfItems(s);
      const sizes: CGSize[] = [];
      for (let i = 0; i < count; i++) sizes.push(d?.collectionViewSizeForItemAt?.(host, this, indexPathOf(i, s)) ?? this.itemSize);
      let i = 0;
      while (i < count) {
        // Fill a line.
        const line: number[] = [];
        let used = 0;
        while (i < count) {
          const c = vertical ? sizes[i]!.width : sizes[i]!.height;
          const next = used + (line.length ? itemSpacing : 0) + c;
          if (line.length && next > available + 0.01) break;
          line.push(i);
          used = next;
          i++;
        }
        const lineMain = Math.max(...line.map((k) => (vertical ? sizes[k]!.height : sizes[k]!.width)));
        const last = i >= count;
        const free = available - used;
        let spacing = itemSpacing;
        let offset = 0;
        if (line.length === 1) offset = free / 2;
        else if (!last) spacing = itemSpacing + free / (line.length - 1);
        let pos = lead + offset;
        for (const k of line) {
          const sz = sizes[k]!;
          const m = vertical ? sz.height : sz.width;
          const c = vertical ? sz.width : sz.height;
          // Items center on their line's main axis.
          this.items.push(new UICollectionViewLayoutAttributes(indexPathOf(k, s), UICollectionElementCategory.cell, null, frame(main + (lineMain - m) / 2, pos, m, c)));
          pos += c + spacing;
        }
        crossExtent = Math.max(crossExtent, pos - spacing + trail);
        main += lineMain + (last ? 0 : lineSpacing);
      }
      main += after;
      const footerMain = vertical ? footer.height : footer.width;
      if (footerMain > 0) {
        this.supplementary.push(new UICollectionViewLayoutAttributes(indexPathOf(0, s), UICollectionElementCategory.supplementaryView, UICollectionElementKindSectionFooter, frame(main, 0, footerMain, cross)));
        main += footerMain;
      }
    }
    this.size = vertical ? { width: crossExtent, height: main } : { width: main, height: crossExtent };
  }

  get collectionViewContentSize(): CGSize {
    this.prepare();
    return this.size;
  }

  layoutAttributesForElements(rect: CGRect): UICollectionViewLayoutAttributes[] {
    this.prepare();
    const hit = (a: UICollectionViewLayoutAttributes) => {
      const f = a.frame;
      return f.origin.x < rect.origin.x + rect.size.width && f.origin.x + f.size.width > rect.origin.x
        && f.origin.y < rect.origin.y + rect.size.height && f.origin.y + f.size.height > rect.origin.y;
    };
    return [...this.supplementary.filter(hit), ...this.items.filter(hit)];
  }

  layoutAttributesForItem(indexPath: IndexPath): UICollectionViewLayoutAttributes | null {
    this.prepare();
    return this.items.find((a) => a.indexPath.section === indexPath.section && a.indexPath.row === indexPath.row) ?? null;
  }

  override layoutAttributesForSupplementaryView(kind: string, indexPath: IndexPath): UICollectionViewLayoutAttributes | null {
    this.prepare();
    return this.supplementary.find((a) => a.representedElementKind === kind && a.indexPath.section === indexPath.section) ?? null;
  }
}

function indexPathOf(row: number, section: number): IndexPath {
  return new IndexPath(row, section);
}

import { describe, expect, it } from 'vitest';
import {
  CGRectMake, IndexPath, UICollectionElementKindSectionHeader, UICollectionReusableView, UICollectionView, UICollectionViewCell,
  UICollectionViewFlowLayout, UICollectionViewScrollDirection, UIColor, UILabel, UIScrollViewContentInsetAdjustmentBehavior,
  type UICollectionViewDataSource, type UICollectionViewDelegate,
} from '@mimicry/os-ios';
import { boot, saveArtifact } from './helpers';

const COLORS = [UIColor.systemRed, UIColor.systemOrange, UIColor.systemYellow, UIColor.systemGreen, UIColor.systemTeal, UIColor.systemBlue, UIColor.systemIndigo, UIColor.systemPurple];

class Tile extends UICollectionViewCell {
  readonly label = new UILabel();

  constructor() {
    super();
    this.contentView.layer.cornerRadius = 12;
    this.contentView.clipsToBounds = true;
    this.label.textAlignment = 1;
    this.label.textColor = UIColor.white;
    this.contentView.addSubview(this.label);
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.label.frame = { origin: { x: 0, y: 0 }, size: this.bounds.size };
  }
}

class Header extends UICollectionReusableView {
  readonly label = new UILabel(CGRectMake(16, 8, 300, 24));

  constructor() {
    super();
    this.addSubview(this.label);
  }
}

class Grid implements UICollectionViewDataSource, UICollectionViewDelegate {
  made = 0;
  readonly picked: string[] = [];

  constructor(readonly counts: number[]) {}

  numberOfSections(): number {
    return this.counts.length;
  }

  collectionViewNumberOfItemsInSection(_c: UICollectionView, section: number): number {
    return this.counts[section]!;
  }

  collectionViewCellForItemAt(c: UICollectionView, indexPath: IndexPath): UICollectionViewCell {
    const cell = c.dequeueReusableCell('tile', indexPath) as Tile;
    cell.contentView.backgroundColor = COLORS[(indexPath.item + indexPath.section) % COLORS.length]!;
    cell.label.text = `${indexPath.item + 1}`;
    return cell;
  }

  collectionViewViewForSupplementaryElementOfKind(c: UICollectionView, kind: string, indexPath: IndexPath): UICollectionReusableView {
    const header = c.dequeueReusableSupplementaryView(kind, 'header', indexPath) as Header;
    header.label.text = `Section ${indexPath.section + 1}`;
    return header;
  }

  collectionViewDidSelectItemAt(_c: UICollectionView, indexPath: IndexPath): void {
    this.picked.push(indexPath.toString());
  }
}

function scene(counts: number[], configure: (layout: UICollectionViewFlowLayout) => void = () => {}) {
  const env = boot();
  const layout = new UICollectionViewFlowLayout();
  layout.itemSize = { width: 100, height: 100 };
  layout.sectionInset = { top: 10, left: 16, bottom: 10, right: 16 };
  configure(layout);
  const grid = new Grid(counts);
  const view = new UICollectionView(CGRectMake(0, 0, 402, 874), layout);
  view.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentBehavior.never;
  view.register(Tile, 'tile');
  view.registerSupplementary(Header, UICollectionElementKindSectionHeader, 'header');
  view.dataSource = grid;
  view.delegate = grid;
  env.root.view.addSubview(view);
  env.device.advance(17);
  return { ...env, view, layout, grid };
}

describe('UICollectionViewFlowLayout', () => {
  it('fills lines and justifies full ones', () => {
    const { layout } = scene([7]);
    // 370 pt across: three 100 pt items per line, 35 pt apart
    const f = (i: number) => layout.layoutAttributesForItem(new IndexPath(i, 0))!.frame;
    expect(f(0).origin).toEqual({ x: 16, y: 10 });
    expect(f(1).origin.x).toBeCloseTo(151, 3);
    expect(f(2).origin.x).toBeCloseTo(286, 3);
    expect(f(3).origin).toEqual({ x: 16, y: 120 });
    expect(f(5).origin.x).toBeCloseTo(286, 3);
    // a lone item is centered in its line
    expect(f(6).origin.x).toBeCloseTo(151, 3);
    expect(layout.collectionViewContentSize.height).toBe(10 + 100 * 3 + 10 * 2 + 10);
  });

  it('lays out horizontally', () => {
    const { layout } = scene([6], (l) => {
      l.scrollDirection = UICollectionViewScrollDirection.horizontal;
      l.itemSize = { width: 120, height: 500 };
    });
    const f = (i: number) => layout.layoutAttributesForItem(new IndexPath(i, 0))!.frame;
    expect(f(1).origin.x).toBe(16 + 120 + 10);
    expect(layout.collectionViewContentSize.width).toBe(16 + 6 * 120 + 5 * 10 + 16);
  });
});

describe('UICollectionView', () => {
  it('makes cells for what shows, reuses them, and selects on tap', () => {
    const { device, view, grid, layout } = scene([60, 30], (l) => {
      l.headerReferenceSize = { width: 0, height: 40 };
    });
    const first = view.visibleCells.length;
    expect(first).toBeLessThan(40);
    device.tap(66, 40 + 10 + 50);
    expect(grid.picked).toEqual(['[0, 0]']);
    expect(view.indexPathsForSelectedItems?.[0]?.item).toBe(0);
    device.drag(200, 700, 0, -600, { duration: 300 });
    device.settle();
    expect(view.indexPathsForVisibleItems[0]!.item).toBeGreaterThan(3);
    view.scrollToItem(new IndexPath(10, 1), 1, false);
    device.advance(17);
    expect(view.cellForItem(new IndexPath(10, 1))).not.toBeNull();
    expect(layout.layoutAttributesForSupplementaryView(UICollectionElementKindSectionHeader, new IndexPath(0, 1))).not.toBeNull();
    saveArtifact('collection.png', device.screenshot());
  });
});

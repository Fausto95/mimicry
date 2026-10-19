import { withAlpha } from '@mimicry/protocol';
import { inflate, type LayerContext } from '@mimicry/os-core';
import type { CGSize } from '../core-graphics/geometry';
import { NSAttributedStringKey } from '../foundation/ns-attributed-string';
import { drawGlass } from './glass';
import { NSLineBreakMode } from './ns-paragraph-style';
import { UIBarButtonGroupView, groupBarItems, type UIBarButtonItem } from './ui-bar-button-item';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import { UIFont, UIFontWeight } from './ui-font';
import { UILabel } from './ui-label';
import { UINavigationBarAppearance } from './ui-navigation-bar-appearance';
import { UINavigationItem, UINavigationItemLargeTitleDisplayMode } from './ui-navigation-item';
import { UIView } from './ui-view';
import { drawMaterial } from './ui-visual-effect-view';

/**
 * UINavigationBar with iOS 26 metrics (from the React Native header, which
 * was matched against simulator captures): a 44 pt row under the status
 * bar with the title (17 pt semibold) centered, a 44 pt Liquid Glass back
 * button (a chevron) at 16 pt, bar button groups as glass capsules, and an
 * optional 52 pt large title row (34 pt bold) that collapses as the content
 * scrolls — the inline title fades in over the last 15%.
 *
 * The bar shows its top item (a navigation controller pushes and pops
 * items with its view controllers). Each item's content lives in its own
 * view so transitions can cross-fade them. Background: the scroll edge
 * appearance while the content is at its top edge (transparent by default),
 * the standard one otherwise.
 */
export const NAVIGATION_BAR = { height: 44, largeTitleHeight: 52, sideInset: 16, titleSize: 17, largeTitleSize: 34, backButton: 44, itemSpacing: 8 };

export interface UINavigationBarDelegate {
  navigationBarShouldPop?(bar: UINavigationBar, item: UINavigationItem): boolean;
  navigationBarDidPop?(bar: UINavigationBar, item: UINavigationItem): void;
}

/** The glass circle with a chevron. */
export class UIBackButtonView extends UIControl {
  constructor(readonly title: string) {
    super();
    this.accessibilityLabel = title;
  }

  protected override highlightChanged(): void {
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const s = this.bounds.size;
    const r = s.height / 2;
    drawGlass(ctx, { x: ctx.x, y: ctx.y, w: s.width, h: s.height }, [r, r, r, r], traits);
    let color = (this.tintColor ?? UIColor.label).resolvedColor(traits).rgba;
    if (this.isHighlighted) color = withAlpha(color, 0.4);
    // SF Symbol chevron.backward (regular): an 11×19 stroke, nudged left of center.
    const x = ctx.x + (s.width - 11) / 2 - 1;
    const y = ctx.y + (s.height - 19) / 2;
    const k = 11 / 12;
    ctx.item({ x: x - 2, y: y - 2, w: 15, h: 23 }, (w) => {
      w.pathBegin().moveTo(x + 10.2 * k, y + 1.6 * (19 / 21)).lineTo(x + 1.8 * k, y + 10.5 * (19 / 21)).lineTo(x + 10.2 * k, y + 19.4 * (19 / 21));
      w.strokePath(color, 2.4 * k, 1, 1);
    });
  }
}

/** One item's bar content (title, back button, item groups, large title). */
export class UINavigationItemContentView extends UIView {
  readonly titleLabel = new UILabel();
  readonly largeTitleLabel = new UILabel();
  backButton: UIBackButtonView | null = null;
  readonly leftGroups: UIBarButtonGroupView[] = [];
  readonly rightGroups: UIBarButtonGroupView[] = [];
  private readonly gaps = new Map<UIBarButtonGroupView, number>();

  constructor(readonly item: UINavigationItem, backItem: UINavigationItem | null, private readonly bar: UINavigationBar) {
    super();
    this.isUserInteractionEnabled = true;
    this.titleLabel.lineBreakMode = NSLineBreakMode.byTruncatingTail;
    this.largeTitleLabel.lineBreakMode = NSLineBreakMode.byTruncatingTail;
    this.addSubview(this.largeTitleLabel);
    this.addSubview(this.titleLabel);
    const showBack = !!backItem && !item.hidesBackButton && (item.leftBarButtonItems.length === 0 || item.leftItemsSupplementBackButton);
    if (showBack) {
      const backTitle = backItem!.backBarButtonItem?.title ?? backItem!.backButtonTitle ?? backItem!.title ?? 'Back';
      this.backButton = new UIBackButtonView(backTitle || 'Back');
      this.backButton.addTarget(() => this.bar._backTapped(), UIControlEvents.primaryActionTriggered);
      this.addSubview(this.backButton);
    }
    const make = (items: readonly UIBarButtonItem[], into: UIBarButtonGroupView[]) => {
      for (const g of groupBarItems(items)) {
        const view = new UIBarButtonGroupView(g.items, g.prominent);
        this.gaps.set(view, g.gap);
        into.push(view);
        this.addSubview(view);
      }
    };
    make(item.leftBarButtonItems, this.leftGroups);
    // Right items are listed trailing to leading; groups are built leading to trailing.
    make([...item.rightBarButtonItems].reverse(), this.rightGroups);
    if (item.titleView) this.addSubview(item.titleView);
    this.refresh();
  }

  /** Text and colors from the item and the bar's appearance. */
  refresh(): void {
    const appearance = this.bar._appearanceFor(this.item);
    const t = appearance.titleTextAttributes;
    const lt = appearance.largeTitleTextAttributes;
    const font = t[NSAttributedStringKey.font];
    const color = t[NSAttributedStringKey.foregroundColor];
    this.titleLabel.text = this.item.titleView ? null : this.item.title;
    this.titleLabel.font = font instanceof UIFont ? font : UIFont.systemFont(NAVIGATION_BAR.titleSize, UIFontWeight.semibold);
    this.titleLabel.textColor = color instanceof UIColor ? color : UIColor.label;
    const largeFont = lt[NSAttributedStringKey.font];
    const largeColor = lt[NSAttributedStringKey.foregroundColor];
    this.largeTitleLabel.text = this.item.title;
    this.largeTitleLabel.font = largeFont instanceof UIFont ? largeFont : UIFont.systemFont(NAVIGATION_BAR.largeTitleSize, UIFontWeight.bold);
    this.largeTitleLabel.textColor = largeColor instanceof UIColor ? largeColor : UIColor.label;
    this.setNeedsLayout();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const B = NAVIGATION_BAR;
    const width = this.bounds.size.width;
    const top = this.bar._statusInset;
    const rowY = top + (B.height - B.backButton) / 2;
    let left = B.sideInset;
    if (this.backButton) {
      this.backButton.frame = { origin: { x: left, y: rowY }, size: { width: B.backButton, height: B.backButton } };
      left += B.backButton + B.itemSpacing;
    }
    for (const g of this.leftGroups) {
      left += this.gaps.get(g) ?? 0;
      const s = g.sizeThatFits({ width: Infinity, height: Infinity });
      g.frame = { origin: { x: left, y: rowY }, size: s };
      left += s.width + B.itemSpacing;
    }
    let right = width - B.sideInset;
    for (const g of [...this.rightGroups].reverse()) {
      right -= this.gaps.get(g) ?? 0;
      const s = g.sizeThatFits({ width: Infinity, height: Infinity });
      right -= s.width;
      g.frame = { origin: { x: right, y: rowY }, size: s };
      right -= B.itemSpacing;
    }
    // The title is centered in the bar, then pushed clear of the items.
    const room = Math.max(0, Math.min(width / 2 - left, right - width / 2)) * 2;
    const titleView = this.item.titleView;
    if (titleView) {
      const s = titleView.bounds.size;
      titleView.frame = { origin: { x: (width - s.width) / 2, y: top + (B.height - s.height) / 2 }, size: s };
    }
    const natural = this.titleLabel.sizeThatFits({ width: Infinity, height: Infinity });
    let tw = Math.min(natural.width, Math.max(room, right - left));
    let tx = (width - tw) / 2;
    if (tw > room) {
      tx = Math.max(left, Math.min(tx, right - tw));
      tw = Math.min(tw, right - left);
    }
    this.titleLabel.frame = { origin: { x: tx, y: top }, size: { width: Math.max(0, tw), height: B.height } };
    const collapse = this.bar._collapse;
    const largeHeight = this.bar._largeTitleHeight;
    const lh = this.largeTitleLabel.font.lineHeight;
    this.largeTitleLabel.isHidden = largeHeight <= 0;
    this.largeTitleLabel.frame = {
      origin: { x: B.sideInset, y: top + B.height + largeHeight - 8 - lh },
      size: { width: width - B.sideInset * 2, height: lh },
    };
    this.titleLabel.alpha = this.bar._showsLargeTitle(this.item) ? Math.max(0, Math.min(1, (collapse - 0.85) / 0.15)) : 1;
  }
}

export class UINavigationBar extends UIView {
  private _items: UINavigationItem[] = [];
  private _prefersLargeTitles = false;
  standardAppearance = new UINavigationBarAppearance('default');
  scrollEdgeAppearance: UINavigationBarAppearance | null = null;
  compactAppearance: UINavigationBarAppearance | null = null;
  isTranslucent = true;
  delegate: UINavigationBarDelegate | null = null;
  /** @internal set by the navigation controller: back button taps */
  _onBack: (() => void) | null = null;
  /** @internal 0 = large title expanded, 1 = collapsed */
  _collapse = 0;
  /** @internal how far the content is pulled down past its top (the large title follows) */
  _stretch = 0;
  /** @internal the content is at its top edge (scroll edge appearance) */
  _atScrollEdge = true;
  /** @internal the status bar's height above the bar's row */
  _statusInset = 0;
  /** @internal the item content views (more than one during transitions) */
  readonly _contents: UINavigationItemContentView[] = [];
  private unobserve: (() => void) | null = null;

  get items(): readonly UINavigationItem[] {
    return this._items;
  }

  get topItem(): UINavigationItem | null {
    return this._items[this._items.length - 1] ?? null;
  }

  get backItem(): UINavigationItem | null {
    return this._items[this._items.length - 2] ?? null;
  }

  setItems(items: UINavigationItem[], _animated: boolean): void {
    this._items = items.slice();
    this._showTop();
  }

  /** @internal the controller animates the content itself */
  _replaceItems(items: UINavigationItem[]): void {
    this._items = items.slice();
  }

  pushItem(item: UINavigationItem, _animated: boolean): void {
    this._items.push(item);
    this._showTop();
  }

  popItem(_animated: boolean): UINavigationItem | null {
    if (this._items.length < 2) return null;
    const item = this._items.pop()!;
    this._showTop();
    this.delegate?.navigationBarDidPop?.(this, item);
    return item;
  }

  get prefersLargeTitles(): boolean {
    return this._prefersLargeTitles;
  }

  set prefersLargeTitles(prefers: boolean) {
    this._prefersLargeTitles = prefers;
    this.superview?.setNeedsLayout();
    this.setNeedsLayout();
  }

  /** @internal does the bar show `item` with a large title? */
  _showsLargeTitle(item: UINavigationItem | null): boolean {
    if (!item) return false;
    const M = UINavigationItemLargeTitleDisplayMode;
    if (item.largeTitleDisplayMode === M.always) return true;
    if (item.largeTitleDisplayMode === M.never || item.largeTitleDisplayMode === M.inline) return false;
    return this._prefersLargeTitles;
  }

  /** @internal the large title row's current height */
  get _largeTitleHeight(): number {
    if (!this._showsLargeTitle(this.topItem)) return 0;
    return NAVIGATION_BAR.largeTitleHeight * (1 - this._collapse) + this._stretch;
  }

  /** Height of the bar below the status bar (row plus the large title row as it is now). */
  get barHeight(): number {
    return NAVIGATION_BAR.height + this._largeTitleHeight;
  }

  /** @internal what content below the bar is inset by (the expanded height: it scrolls under the collapse) */
  _insetHeight(item: UINavigationItem | null = this.topItem): number {
    return NAVIGATION_BAR.height + (this._showsLargeTitle(item) ? NAVIGATION_BAR.largeTitleHeight : 0);
  }

  /** @internal the appearance an item uses right now */
  _appearanceFor(item: UINavigationItem | null): UINavigationBarAppearance {
    const standard = item?.standardAppearance ?? this.standardAppearance;
    if (!this._atScrollEdge) return standard;
    const edge = item?.scrollEdgeAppearance ?? this.scrollEdgeAppearance;
    if (edge) return edge;
    // Without a scroll edge appearance, UIKit uses the standard one's transparent version.
    const transparent = standard.copy();
    transparent._kind = 'transparent';
    transparent.backgroundColor = null;
    transparent.backgroundEffect = null;
    return transparent;
  }

  /** @internal show the top item at once (no transition) */
  _showTop(): void {
    for (const c of this._contents.splice(0)) c.removeFromSuperview();
    const item = this.topItem;
    this.unobserve?.();
    this.unobserve = null;
    if (!item) return;
    this._contents.push(this._makeContent(item, this.backItem));
    this.watch(item);
  }

  /** @internal a content view for an item (transitions keep several) */
  _makeContent(item: UINavigationItem, backItem: UINavigationItem | null): UINavigationItemContentView {
    const content = new UINavigationItemContentView(item, backItem, this);
    content.frame = this.bounds;
    this.addSubview(content);
    return content;
  }

  /** @internal a transition ended: keep only the top item's content */
  _finishTransition(keep: UINavigationItemContentView): void {
    for (const c of this._contents.splice(0)) if (c !== keep) c.removeFromSuperview();
    this._contents.push(keep);
    keep.alpha = 1;
    if (keep.item !== this.topItem) return;
    this.watch(keep.item);
  }

  private watch(item: UINavigationItem): void {
    this.unobserve?.();
    this.unobserve = item._onChange(() => {
      // Item changes rebuild its content (bar button items, titles).
      const old = this._contents.find((c) => c.item === item);
      if (!old) return;
      const fresh = new UINavigationItemContentView(item, this.backItem, this);
      fresh.frame = this.bounds;
      this.insertSubviewAbove(fresh, old);
      old.removeFromSuperview();
      this._contents.splice(this._contents.indexOf(old), 1, fresh);
      this.superview?.setNeedsLayout();
    });
  }

  /** @internal */
  _backTapped(): void {
    const item = this.topItem;
    if (item && this.delegate?.navigationBarShouldPop && !this.delegate.navigationBarShouldPop(this, item)) return;
    if (this._onBack) this._onBack();
    else this.popItem(true);
  }

  override sizeThatFits(size: CGSize): CGSize {
    return { width: size.width, height: this._statusInset + this.barHeight };
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    for (const c of this._contents) {
      c.frame = this.bounds;
      c.refresh();
      c.layoutIfNeeded();
    }
  }

  override pointInside(point: { x: number; y: number }): boolean {
    return point.y >= this._statusInset && point.y < this.bounds.size.height && point.x >= 0 && point.x < this.bounds.size.width;
  }

  override hitTest(point: { x: number; y: number }, event: import('./ui-event').UIEvent | null): UIView | null {
    const hit = super.hitTest(point, event);
    // The bar's empty areas let touches through to the content beneath (iOS 26 bars float).
    return hit === this || (hit && this._contents.includes(hit as UINavigationItemContentView)) ? null : hit;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const appearance = this._appearanceFor(this.topItem);
    const traits = this.traitCollection;
    const b = this.bounds.size;
    const box = { x: ctx.x, y: ctx.y, w: b.width, h: b.height };
    if (appearance._kind === 'transparent' && !appearance.backgroundColor && !appearance.backgroundEffect) return;
    if (appearance.backgroundEffect) drawMaterial(ctx, box, [0, 0, 0, 0], appearance.backgroundEffect, traits);
    const bg = (appearance.backgroundColor ?? UIColor.systemBackground).resolvedColor(traits).rgba;
    if (appearance._kind === 'opaque' || appearance.backgroundColor) {
      ctx.item(box, (w) => w.fillRect(box.x, box.y, box.w, box.h, appearance._kind === 'opaque' ? bg | 0xff : bg));
    } else if (appearance._kind === 'default' && !appearance.backgroundEffect) {
      // iOS 26 scroll edge effect: the content fades out under the bar.
      const fade = { ...box, h: box.h + 16 };
      ctx.item(fade, (w) => w.linearGradientRRect(fade.x, fade.y, fade.w, fade.h, [0, 0, 0, 0], fade.x, fade.y, fade.x, fade.y + fade.h, [
        [0, withAlpha(bg, 0.94)], [0.75, withAlpha(bg, 0.8)], [1, withAlpha(bg, 0)],
      ]));
    }
    const shadow = appearance.shadowColor ?? (appearance._kind === 'opaque' ? UIColor.separator : null);
    if (shadow) {
      const c = shadow.resolvedColor(traits).rgba;
      const scale = traits.displayScale || 3;
      ctx.item(inflate({ x: box.x, y: box.y + box.h, w: box.w, h: 1 / scale }, 1), (w) => w.fillRect(box.x, box.y + box.h, box.w, 1 / scale, c));
    }
  }
}

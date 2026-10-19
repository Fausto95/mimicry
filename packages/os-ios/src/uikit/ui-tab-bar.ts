import { inflate, type LayerContext } from '@mimicry/os-core';
import type { CGSize } from '../core-graphics/geometry';
import { drawGlass } from './glass';
import { drawCenteredText, measureText } from './text-system';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import { UIFont, UIFontWeight } from './ui-font';
import { UIImageSymbolConfiguration } from './ui-image';
import type { UITabBarItem } from './ui-tab-bar-item';
import { UIUserInterfaceStyle } from './ui-trait-collection';
import { UIView } from './ui-view';

/**
 * UITabBar with the iOS 26 floating Liquid Glass look (metrics from the
 * React Native tab bar, matched against simulator captures): a 62 pt
 * capsule 25 pt from the sides and 21 pt above the bottom edge, items
 * sharing its width — a 28 pt icon over a 10 pt semibold title, the
 * selected one in the tint color on a soft pill — and red badges.
 */
export const TAB_BAR = { height: 62, sideMargin: 25, bottomMargin: 21, icon: 28, label: 10, itemGap: 2, padding: 4 };

export interface UITabBarDelegate {
  tabBarDidSelect?(tabBar: UITabBar, item: UITabBarItem): void;
}

/** UITabBarAppearance (the parts the floating bar uses). */
export class UITabBarAppearance {
  backgroundColor: UIColor | null = null;
  /** stackedLayoutAppearance.normal / .selected title and icon colors */
  normalColor: UIColor | null = null;
  selectedColor: UIColor | null = null;
}

class UITabBarButton extends UIControl {
  constructor(readonly item: UITabBarItem, private readonly bar: UITabBar) {
    super();
    this.accessibilityLabel = item.accessibilityLabel ?? item.title;
    this.addTarget(() => this.bar._tapped(this.item), UIControlEvents.touchUpInside);
  }

  protected override highlightChanged(): void {
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const item = this.item;
    const selected = this.bar.selectedItem === item;
    const b = this.bounds.size;
    if (selected) {
      const r = b.height / 2;
      ctx.item({ x: ctx.x, y: ctx.y, w: b.width, h: b.height }, (w) => w.fillRRect(ctx.x, ctx.y, b.width, b.height, [r, r, r, r], dark ? 0xffffff1f : 0x0000000f));
    }
    const appearance = this.bar.standardAppearance;
    let color = selected
      ? this.bar.tintColor ?? appearance.selectedColor ?? UIColor.tintColor
      : this.bar.unselectedItemTintColor ?? appearance.normalColor ?? UIColor.label;
    if (!item.isEnabled) color = UIColor.tertiaryLabel;
    if (this.isHighlighted) color = color.withAlphaComponent(0.6);
    const hasTitle = !!item.title;
    const iconSize = TAB_BAR.icon;
    const blockH = iconSize + (hasTitle ? TAB_BAR.itemGap + Math.ceil(UIFont.systemFont(TAB_BAR.label).lineHeight) : 0);
    const top = ctx.y + (b.height - blockH) / 2;
    const cx = ctx.x + b.width / 2;
    const source = (selected && item.selectedImage) || item.image;
    if (source) {
      const image = source.isSymbolImage ? source.withConfiguration(UIImageSymbolConfiguration.fromPointSize(iconSize / 1.2)) : source;
      const dest = { origin: { x: cx - iconSize / 2, y: top }, size: { width: iconSize, height: iconSize } };
      const tint = color.resolvedColor(traits).rgba;
      ctx.item({ x: dest.origin.x, y: dest.origin.y, w: iconSize, h: iconSize }, (w) => image._draw(w, dest, image.isTemplate || image.isSymbolImage ? tint : 0, traits));
    }
    if (hasTitle) {
      const font = UIFont.systemFont(TAB_BAR.label, UIFontWeight.semibold);
      drawCenteredText(ctx, item.title!, font, color, cx, top + iconSize + TAB_BAR.itemGap + font.lineHeight / 2, b.width - 4, traits);
    }
    if (item.badgeValue !== null) {
      const font = UIFont.systemFont(12, UIFontWeight.semibold);
      const text = item.badgeValue;
      const tw = text ? measureText(text, font).width : 0;
      const bw = Math.max(18, tw + 10);
      const bx = ctx.x + b.width * 0.55;
      const by = ctx.y + 4;
      const badge = (item.badgeColor ?? UIColor.systemRed).resolvedColor(traits).rgba;
      const empty = !text;
      const size = empty ? 10 : 18;
      ctx.item(inflate({ x: bx, y: by, w: empty ? size : bw, h: size }, 1), (w) => w.fillRRect(bx, by, empty ? size : bw, size, [size / 2, size / 2, size / 2, size / 2], badge));
      if (text) drawCenteredText(ctx, text, font, UIColor.white, bx + bw / 2, by + 9, bw, traits);
    }
  }
}

export class UITabBar extends UIView {
  private _items: UITabBarItem[] = [];
  private _selectedItem: UITabBarItem | null = null;
  private buttons: UITabBarButton[] = [];
  private unobserve: Array<() => void> = [];
  delegate: UITabBarDelegate | null = null;
  unselectedItemTintColor: UIColor | null = null;
  standardAppearance = new UITabBarAppearance();
  /** @internal the tab bar controller decides about taps */
  _onTap: ((item: UITabBarItem) => void) | null = null;

  get items(): readonly UITabBarItem[] {
    return this._items;
  }

  set items(items: readonly UITabBarItem[] | null) {
    this.setItems(items ? [...items] : [], false);
  }

  setItems(items: UITabBarItem[], _animated: boolean): void {
    for (const off of this.unobserve.splice(0)) off();
    for (const b of this.buttons) b.removeFromSuperview();
    this._items = items.slice();
    this.buttons = this._items.map((item) => new UITabBarButton(item, this));
    for (const b of this.buttons) this.addSubview(b);
    for (const item of this._items) this.unobserve.push(item._onChange(() => this.refresh()));
    if (this._selectedItem && !this._items.includes(this._selectedItem)) this._selectedItem = null;
    this.setNeedsLayout();
    this.refresh();
  }

  get selectedItem(): UITabBarItem | null {
    return this._selectedItem;
  }

  set selectedItem(item: UITabBarItem | null) {
    this._selectedItem = item;
    this.refresh();
  }

  private refresh(): void {
    this.setNeedsDisplay();
    for (const b of this.buttons) b.setNeedsDisplay();
  }

  /** @internal */
  _tapped(item: UITabBarItem): void {
    if (!item.isEnabled) return;
    if (this._onTap) {
      this._onTap(item);
      return;
    }
    this.selectedItem = item;
    this.delegate?.tabBarDidSelect?.(this, item);
  }

  override sizeThatFits(size: CGSize): CGSize {
    return { width: size.width, height: TAB_BAR.height };
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const b = this.bounds.size;
    const p = TAB_BAR.padding;
    const n = this.buttons.length || 1;
    const w = (b.width - p * 2) / n;
    this.buttons.forEach((button, i) => {
      button.frame = { origin: { x: p + i * w, y: p }, size: { width: w, height: b.height - p * 2 } };
    });
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const b = this.bounds.size;
    const r = b.height / 2;
    const traits = this.traitCollection;
    const tint = this.standardAppearance.backgroundColor?.resolvedColor(traits).rgba ?? null;
    drawGlass(ctx, { x: ctx.x, y: ctx.y, w: b.width, h: b.height }, [r, r, r, r], traits, {
      blur: 12, tint, light: 0xffffffb8, dark: 0x1e1e20b8, shadowOpacity: 0.12, shadowRadius: 16, shadowY: 6,
    });
  }
}

import type { LayerContext } from '@mimicry/os-core';
import type { CGSize } from '../core-graphics/geometry';
import { drawGlass } from './glass';
import { drawCenteredText, measureText } from './text-system';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import { UIFont, UIFontWeight } from './ui-font';
import { UIImage, UIImageSymbolConfiguration } from './ui-image';
import { UIView } from './ui-view';
import type { UIAction } from './ui-button';

/**
 * UIBarButtonItem and the views UIKit's bars make for it. On iOS 26 the
 * items of a bar side share one Liquid Glass capsule; image items are
 * 44 pt circles, title items 17 pt text in the capsule; `.done` style
 * (and the done / prominent system items) is a separate tinted capsule.
 * Fixed and flexible spaces split groups.
 */
export enum UIBarButtonItemStyle { plain = 0, bordered = 1, done = 2, prominent = 3 }

export enum UIBarButtonSystemItem {
  done = 0, cancel = 1, edit = 2, save = 3, add = 4, flexibleSpace = 5, fixedSpace = 6, compose = 7, reply = 8, action = 9,
  organize = 10, bookmarks = 11, search = 12, refresh = 13, stop = 14, camera = 15, trash = 16, play = 17, pause = 18,
  rewind = 19, fastForward = 20, undo = 21, redo = 22, close = 24, writingTools = 25,
}

/** How system items draw on iOS 26: a symbol, or a localized title. */
const SYSTEM_ITEMS: Record<UIBarButtonSystemItem, { symbol?: string; title?: string; prominent?: boolean }> = {
  [UIBarButtonSystemItem.done]: { symbol: 'checkmark', prominent: true },
  [UIBarButtonSystemItem.cancel]: { symbol: 'xmark' },
  [UIBarButtonSystemItem.close]: { symbol: 'xmark' },
  [UIBarButtonSystemItem.edit]: { title: 'Edit' },
  [UIBarButtonSystemItem.save]: { title: 'Save', prominent: true },
  [UIBarButtonSystemItem.add]: { symbol: 'plus' },
  [UIBarButtonSystemItem.flexibleSpace]: {},
  [UIBarButtonSystemItem.fixedSpace]: {},
  [UIBarButtonSystemItem.compose]: { symbol: 'square.and.pencil' },
  [UIBarButtonSystemItem.reply]: { symbol: 'arrowshape.turn.up.left' },
  [UIBarButtonSystemItem.action]: { symbol: 'square.and.arrow.up' },
  [UIBarButtonSystemItem.organize]: { symbol: 'folder' },
  [UIBarButtonSystemItem.bookmarks]: { symbol: 'book' },
  [UIBarButtonSystemItem.search]: { symbol: 'magnifyingglass' },
  [UIBarButtonSystemItem.refresh]: { symbol: 'arrow.clockwise' },
  [UIBarButtonSystemItem.stop]: { symbol: 'xmark' },
  [UIBarButtonSystemItem.camera]: { symbol: 'camera' },
  [UIBarButtonSystemItem.trash]: { symbol: 'trash' },
  [UIBarButtonSystemItem.play]: { symbol: 'play.fill' },
  [UIBarButtonSystemItem.pause]: { symbol: 'pause.fill' },
  [UIBarButtonSystemItem.rewind]: { symbol: 'backward.fill' },
  [UIBarButtonSystemItem.fastForward]: { symbol: 'forward.fill' },
  [UIBarButtonSystemItem.undo]: { symbol: 'arrow.uturn.backward' },
  [UIBarButtonSystemItem.redo]: { symbol: 'arrow.uturn.forward' },
  [UIBarButtonSystemItem.writingTools]: { symbol: 'apple.writing.tools' },
};

const ITEM_HEIGHT = 44;
const TITLE_FONT = 17;
const TITLE_PADDING = 14;
const SYMBOL_SIZE = 17;

export class UIBarButtonItem {
  title: string | null = null;
  image: UIImage | null = null;
  style = UIBarButtonItemStyle.plain;
  /** fixed space width / item width (0: automatic) */
  width = 0;
  customView: UIView | null = null;
  isEnabled = true;
  tintColor: UIColor | null = null;
  tag = 0;
  accessibilityLabel: string | null = null;
  /** iOS 26: share the glass capsule with neighbors (false gives the item its own) */
  sharesBackground = true;
  hidesSharedBackground = false;
  readonly systemItem: UIBarButtonSystemItem | null;
  private action: ((item: UIBarButtonItem) => void) | null;

  /** UIBarButtonItem(title:style:target:action:) */
  constructor(title: string | null = null, style = UIBarButtonItemStyle.plain, action: ((item: UIBarButtonItem) => void) | null = null) {
    this.title = title;
    this.style = style;
    this.action = action;
    this.systemItem = null;
  }

  /** UIBarButtonItem(image:style:target:action:) */
  static withImage(image: UIImage | null, style = UIBarButtonItemStyle.plain, action: ((item: UIBarButtonItem) => void) | null = null): UIBarButtonItem {
    const item = new UIBarButtonItem(null, style, action);
    item.image = image;
    return item;
  }

  /** UIBarButtonItem(barButtonSystemItem:target:action:) */
  static system(systemItem: UIBarButtonSystemItem, action: ((item: UIBarButtonItem) => void) | null = null): UIBarButtonItem {
    const item = new UIBarButtonItem(null, UIBarButtonItemStyle.plain, action);
    (item as { systemItem: UIBarButtonSystemItem | null }).systemItem = systemItem;
    const spec = SYSTEM_ITEMS[systemItem];
    if (spec.title) item.title = spec.title;
    if (spec.symbol) item.image = UIImage.systemName(spec.symbol);
    if (spec.prominent) item.style = UIBarButtonItemStyle.prominent;
    return item;
  }

  /** UIBarButtonItem(customView:) */
  static withCustomView(view: UIView): UIBarButtonItem {
    const item = new UIBarButtonItem();
    item.customView = view;
    return item;
  }

  /** UIBarButtonItem(primaryAction:) */
  static withPrimaryAction(action: UIAction): UIBarButtonItem {
    const item = new UIBarButtonItem(action.image ? null : action.title, UIBarButtonItemStyle.plain, () => action.handler(action));
    item.image = action.image;
    return item;
  }

  static flexibleSpace(): UIBarButtonItem {
    return UIBarButtonItem.system(UIBarButtonSystemItem.flexibleSpace);
  }

  static fixedSpace(width: number): UIBarButtonItem {
    const item = UIBarButtonItem.system(UIBarButtonSystemItem.fixedSpace);
    item.width = width;
    return item;
  }

  get isSpace(): boolean {
    return this.systemItem === UIBarButtonSystemItem.flexibleSpace || this.systemItem === UIBarButtonSystemItem.fixedSpace;
  }

  get isProminent(): boolean {
    return this.style === UIBarButtonItemStyle.done || this.style === UIBarButtonItemStyle.prominent;
  }

  /** @internal a tap on the item's view */
  _perform(): void {
    if (this.isEnabled) this.action?.(this);
  }

  /** The item's content size in a bar (Mimicry; bars lay out with it). */
  _contentSize(): CGSize {
    if (this.customView) return this.customView.bounds.size;
    if (this.width > 0) return { width: this.width, height: ITEM_HEIGHT };
    if (this.image) return { width: ITEM_HEIGHT, height: ITEM_HEIGHT };
    const text = measureText(this.title ?? '', UIFont.systemFont(TITLE_FONT, this.isProminent ? UIFontWeight.semibold : UIFontWeight.regular));
    return { width: Math.max(ITEM_HEIGHT, Math.ceil(text.width) + TITLE_PADDING * 2), height: ITEM_HEIGHT };
  }
}

/** One item inside a glass group: draws its symbol or title and takes its taps. */
export class UIBarButtonItemView extends UIControl {
  constructor(readonly item: UIBarButtonItem, private readonly prominent: boolean) {
    super();
    this.accessibilityLabel = item.accessibilityLabel ?? item.title;
    this.addTarget(() => this.item._perform(), UIControlEvents.primaryActionTriggered);
    if (item.customView) this.addSubview(item.customView);
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const custom = this.item.customView;
    if (custom) {
      const s = custom.bounds.size;
      custom.frame = { origin: { x: (this.bounds.size.width - s.width) / 2, y: (this.bounds.size.height - s.height) / 2 }, size: s };
    }
  }

  protected override highlightChanged(): void {
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const item = this.item;
    if (item.customView) return;
    const traits = this.traitCollection;
    const b = this.bounds.size;
    let color = this.prominent ? UIColor.white : item.tintColor ?? UIColor.label;
    if (!item.isEnabled) color = UIColor.tertiaryLabel;
    if (this.isHighlighted) color = color.withAlphaComponent(0.4);
    const cx = ctx.x + b.width / 2;
    const cy = ctx.y + b.height / 2;
    if (item.image) {
      const image = item.image.isSymbolImage ? item.image.withConfiguration(UIImageSymbolConfiguration.fromPointSize(SYMBOL_SIZE)) : item.image;
      const size = image.size;
      const dest = { origin: { x: cx - size.width / 2, y: cy - size.height / 2 }, size };
      const tint = color.resolvedColor(traits).rgba;
      ctx.item({ x: dest.origin.x, y: dest.origin.y, w: size.width, h: size.height }, (w) => image._draw(w, dest, tint, traits));
      return;
    }
    const font = UIFont.systemFont(TITLE_FONT, this.prominent ? UIFontWeight.semibold : UIFontWeight.regular);
    drawCenteredText(ctx, item.title ?? '', font, color, cx, cy, b.width, traits);
  }
}

/**
 * Items sharing a glass capsule (iOS 26 bars group a side's items). A
 * prominent item gets its own tinted capsule.
 */
export class UIBarButtonGroupView extends UIView {
  readonly itemViews: UIBarButtonItemView[];

  constructor(readonly items: UIBarButtonItem[], readonly prominent: boolean) {
    super();
    this.itemViews = items.map((item) => new UIBarButtonItemView(item, prominent));
    for (const v of this.itemViews) this.addSubview(v);
  }

  override sizeThatFits(_size?: CGSize): CGSize {
    const width = this.items.reduce((w, item) => w + item._contentSize().width, 0);
    return { width, height: ITEM_HEIGHT };
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    let x = 0;
    this.itemViews.forEach((v, i) => {
      const w = this.items[i]!._contentSize().width;
      v.frame = { origin: { x, y: 0 }, size: { width: w, height: ITEM_HEIGHT } };
      x += w;
    });
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    if (this.items.every((i) => i.customView || i.hidesSharedBackground)) return;
    const b = this.bounds.size;
    const r = b.height / 2;
    const traits = this.traitCollection;
    const tint = this.prominent ? (this.items[0]?.tintColor ?? this.tintColor ?? UIColor.tintColor).resolvedColor(traits).rgba : null;
    drawGlass(ctx, { x: ctx.x, y: ctx.y, w: b.width, h: b.height }, [r, r, r, r], traits, { tint });
  }
}

/** Split a side's items into glass groups (spaces and prominent items break them). */
export function groupBarItems(items: readonly UIBarButtonItem[]): Array<{ items: UIBarButtonItem[]; prominent: boolean; gap: number }> {
  const groups: Array<{ items: UIBarButtonItem[]; prominent: boolean; gap: number }> = [];
  let gap = 0;
  let current: { items: UIBarButtonItem[]; prominent: boolean; gap: number } | null = null;
  for (const item of items) {
    if (item.isSpace) {
      gap += item.systemItem === UIBarButtonSystemItem.fixedSpace ? item.width : 8;
      current = null;
      continue;
    }
    if (item.isProminent || !item.sharesBackground || !current || current.prominent) {
      current = { items: [item], prominent: item.isProminent, gap };
      groups.push(current);
      gap = 0;
      if (!item.sharesBackground) current = null;
      continue;
    }
    current.items.push(item);
  }
  return groups;
}

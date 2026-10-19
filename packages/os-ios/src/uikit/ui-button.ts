import { inflate, type LayerContext } from '@mimicry/os-core';
import { UIEdgeInsetsZero, type CGRect, type CGSize, type UIEdgeInsets } from '../core-graphics/geometry';
import { NSAttributedString } from '../foundation/ns-attributed-string';
import { NSLineBreakMode, NSTextAlignment } from './ns-paragraph-style';
import { UIColor } from './ui-color';
import { UIUserInterfaceStyle } from './ui-trait-collection';
import { UIControl, UIControlEvents, UIControlState } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import { UIFont, UIFontWeight } from './ui-font';
import { UIImage, UIImageSymbolConfiguration } from './ui-image';
import { UIImageView } from './ui-image-view';
import { UILabel } from './ui-label';
import { UIView, UIViewContentMode } from './ui-view';
import { UIViewAnimationOptions } from './ui-view-animation';

/**
 * UIButton, both ways UIKit offers:
 *
 * - UIButton.Configuration (iOS 15+): plain, tinted, gray, filled and the
 *   bordered* aliases, plus iOS 26's glass and prominentGlass — title,
 *   subtitle, image (symbols follow the title's size), placement, paddings,
 *   content insets per button size, corner styles (dynamic is a capsule on
 *   iOS 26), base colors. Pressed buttons dim their content (and fill);
 *   disabled ones turn tertiary.
 * - The legacy API: UIButton(type:), setTitle/TitleColor/Image(_:for:)
 *   per state, titleLabel and imageView, content/title/image edge insets.
 *   A system button's content fades to 20% while pressed and back after.
 *
 * Both lay out a real UILabel and UIImageView, so `titleLabel` and
 * `imageView` are the views on screen.
 */
export enum UIButtonType { custom = 0, system = 1, detailDisclosure = 2, infoLight = 3, infoDark = 4, contactAdd = 5, close = 7 }

export enum UIButtonConfigurationSize { medium = 0, small = 1, mini = 2, large = 3 }
export enum UIButtonConfigurationCornerStyle { fixed = -1, dynamic = 0, small = 1, medium = 2, large = 3, capsule = 4 }
export enum UIButtonConfigurationTitleAlignment { automatic = 0, leading = 1, center = 2, trailing = 3 }
export enum NSDirectionalRectEdge { top = 1, leading = 2, bottom = 4, trailing = 8, all = 15 }

export enum UIControlContentHorizontalAlignment { center = 0, left = 1, right = 2, fill = 3, leading = 4, trailing = 5 }
export enum UIControlContentVerticalAlignment { center = 0, top = 1, bottom = 2, fill = 3 }

export interface NSDirectionalEdgeInsets {
  top: number;
  leading: number;
  bottom: number;
  trailing: number;
}

type Style = 'plain' | 'tinted' | 'gray' | 'filled' | 'glass' | 'prominentGlass';

/** UIButton.Configuration */
export class UIButtonConfiguration {
  title: string | null = null;
  attributedTitle: NSAttributedString | null = null;
  subtitle: string | null = null;
  image: UIImage | null = null;
  imagePlacement = NSDirectionalRectEdge.leading;
  imagePadding = 0;
  titlePadding = 0;
  /** null: the button size's default */
  contentInsets: NSDirectionalEdgeInsets | null = null;
  cornerStyle = UIButtonConfigurationCornerStyle.dynamic;
  /** with cornerStyle fixed */
  cornerRadius = 0;
  buttonSize = UIButtonConfigurationSize.medium;
  titleAlignment = UIButtonConfigurationTitleAlignment.automatic;
  baseForegroundColor: UIColor | null = null;
  baseBackgroundColor: UIColor | null = null;
  showsActivityIndicator = false;
  preferredSymbolConfigurationForImage: UIImageSymbolConfiguration | null = null;
  /** @internal */
  _style: Style = 'plain';

  private static make(style: Style): UIButtonConfiguration {
    const c = new UIButtonConfiguration();
    c._style = style;
    return c;
  }

  static plain(): UIButtonConfiguration { return UIButtonConfiguration.make('plain'); }
  static tinted(): UIButtonConfiguration { return UIButtonConfiguration.make('tinted'); }
  static gray(): UIButtonConfiguration { return UIButtonConfiguration.make('gray'); }
  static filled(): UIButtonConfiguration { return UIButtonConfiguration.make('filled'); }
  static borderless(): UIButtonConfiguration { return UIButtonConfiguration.make('plain'); }
  static bordered(): UIButtonConfiguration { return UIButtonConfiguration.make('gray'); }
  static borderedProminent(): UIButtonConfiguration { return UIButtonConfiguration.make('filled'); }
  static borderedTinted(): UIButtonConfiguration { return UIButtonConfiguration.make('tinted'); }
  /** iOS 26 */
  static glass(): UIButtonConfiguration { return UIButtonConfiguration.make('glass'); }
  /** iOS 26 */
  static prominentGlass(): UIButtonConfiguration { return UIButtonConfiguration.make('prominentGlass'); }

  copy(): UIButtonConfiguration {
    return Object.assign(new UIButtonConfiguration(), this);
  }
}

/** UIAction: a titled handler (UIButton(configuration:primaryAction:), menus). */
export class UIAction {
  constructor(readonly title: string, readonly image: UIImage | null, readonly handler: (action: UIAction) => void) {}
}

/** Content insets and fonts per button size (iOS 15+ defaults). */
const SIZES: Record<UIButtonConfigurationSize, { insets: NSDirectionalEdgeInsets; font: number; subtitle: number }> = {
  [UIButtonConfigurationSize.mini]: { insets: { top: 3, leading: 8, bottom: 3, trailing: 8 }, font: 12, subtitle: 10 },
  [UIButtonConfigurationSize.small]: { insets: { top: 5, leading: 10, bottom: 5, trailing: 10 }, font: 15, subtitle: 12 },
  [UIButtonConfigurationSize.medium]: { insets: { top: 7, leading: 12, bottom: 7, trailing: 12 }, font: 17, subtitle: 15 },
  [UIButtonConfigurationSize.large]: { insets: { top: 14, leading: 20, bottom: 14, trailing: 20 }, font: 17, subtitle: 15 },
};

/** Fixed radii of the non-capsule corner styles. */
const CORNERS: Partial<Record<UIButtonConfigurationCornerStyle, number>> = {
  [UIButtonConfigurationCornerStyle.small]: 6,
  [UIButtonConfigurationCornerStyle.medium]: 8,
  [UIButtonConfigurationCornerStyle.large]: 12,
};

const LEGACY_FONT = 15;

export class UIButton extends UIControl {
  static readonly Configuration = UIButtonConfiguration;

  readonly buttonType: UIButtonType;
  private _configuration: UIButtonConfiguration | null = null;
  private readonly titles = new Map<number, string | null>();
  private readonly attributedTitles = new Map<number, NSAttributedString | null>();
  private readonly titleColors = new Map<number, UIColor | null>();
  private readonly images = new Map<number, UIImage | null>();
  private readonly backgroundImages = new Map<number, UIImage | null>();
  private _titleLabel: UILabel | null = null;
  private _subtitleLabel: UILabel | null = null;
  private _imageView: UIImageView | null = null;
  contentEdgeInsets: UIEdgeInsets = UIEdgeInsetsZero;
  titleEdgeInsets: UIEdgeInsets = UIEdgeInsetsZero;
  imageEdgeInsets: UIEdgeInsets = UIEdgeInsetsZero;
  contentHorizontalAlignment = UIControlContentHorizontalAlignment.center;
  contentVerticalAlignment = UIControlContentVerticalAlignment.center;
  adjustsImageWhenHighlighted = true;
  /** iOS 15: called when the state changes, to edit `configuration` */
  configurationUpdateHandler: ((button: UIButton) => void) | null = null;

  constructor(frame?: CGRect, type: UIButtonType = UIButtonType.custom) {
    super(frame);
    this.buttonType = type;
    const symbol = SYSTEM_GLYPHS[type];
    if (symbol) this.setImage(UIImage.systemName(symbol, UIImageSymbolConfiguration.fromPointSize(type === UIButtonType.close ? 13 : 22)), UIControlState.normal);
  }

  /** UIButton(type:) */
  static withType(type: UIButtonType): UIButton {
    const button = new UIButton(undefined, type);
    button.sizeToFit();
    return button;
  }

  /** UIButton(configuration:primaryAction:) */
  static withConfiguration(configuration: UIButtonConfiguration, primaryAction: UIAction | null = null): UIButton {
    const button = new UIButton(undefined, UIButtonType.system);
    button.configuration = configuration;
    if (primaryAction) {
      button.addTarget(() => primaryAction.handler(primaryAction), UIControlEvents.primaryActionTriggered);
      if (configuration.title === null && primaryAction.title) configuration.title = primaryAction.title;
      if (configuration.image === null && primaryAction.image) configuration.image = primaryAction.image;
    }
    button.sizeToFit();
    return button;
  }

  get configuration(): UIButtonConfiguration | null {
    return this._configuration;
  }

  set configuration(configuration: UIButtonConfiguration | null) {
    this._configuration = configuration ? configuration.copy() : null;
    this.update();
  }

  /** setNeedsUpdateConfiguration() — runs the update handler and re-applies the configuration. */
  setNeedsUpdateConfiguration(): void {
    this.update();
  }

  // ── legacy per-state content ──────────────────────────────────────────

  private lookup<T>(map: Map<number, T | null>, state: number): T | null {
    if (map.has(state) && map.get(state) != null) return map.get(state)!;
    if (state & UIControlState.disabled && map.get(UIControlState.disabled) != null) return map.get(UIControlState.disabled)!;
    if (state & UIControlState.highlighted && map.get(UIControlState.highlighted) != null) return map.get(UIControlState.highlighted)!;
    if (state & UIControlState.selected && map.get(UIControlState.selected) != null) return map.get(UIControlState.selected)!;
    return map.get(UIControlState.normal) ?? null;
  }

  setTitle(title: string | null, state: UIControlState | number): void {
    this.titles.set(state, title);
    this.update();
  }

  title(state: UIControlState | number): string | null {
    return this.lookup(this.titles, state);
  }

  setAttributedTitle(title: NSAttributedString | null, state: UIControlState | number): void {
    this.attributedTitles.set(state, title);
    this.update();
  }

  setTitleColor(color: UIColor | null, state: UIControlState | number): void {
    this.titleColors.set(state, color);
    this.update();
  }

  titleColor(state: UIControlState | number): UIColor | null {
    return this.lookup(this.titleColors, state);
  }

  setImage(image: UIImage | null, state: UIControlState | number): void {
    this.images.set(state, image);
    this.update();
  }

  image(state: UIControlState | number): UIImage | null {
    return this.lookup(this.images, state);
  }

  setBackgroundImage(image: UIImage | null, state: UIControlState | number): void {
    this.backgroundImages.set(state, image);
    this.update();
  }

  get currentTitle(): string | null {
    return this._configuration ? this._configuration.title : this.title(this.state);
  }

  get currentImage(): UIImage | null {
    return this._configuration ? this._configuration.image : this.image(this.state);
  }

  get titleLabel(): UILabel {
    if (!this._titleLabel) {
      this._titleLabel = new UILabel();
      this._titleLabel.font = UIFont.systemFont(LEGACY_FONT);
      this._titleLabel.textAlignment = NSTextAlignment.center;
      this._titleLabel.lineBreakMode = NSLineBreakMode.byTruncatingMiddle;
      this.addSubview(this._titleLabel);
    }
    return this._titleLabel;
  }

  get subtitleLabel(): UILabel {
    if (!this._subtitleLabel) {
      this._subtitleLabel = new UILabel();
      this._subtitleLabel.textAlignment = NSTextAlignment.center;
      this.addSubview(this._subtitleLabel);
    }
    return this._subtitleLabel;
  }

  get imageView(): UIImageView {
    if (!this._imageView) {
      this._imageView = new UIImageView();
      this._imageView.contentMode = UIViewContentMode.center;
      this.addSubview(this._imageView);
    }
    return this._imageView;
  }

  // ── state ─────────────────────────────────────────────────────────────

  override set isEnabled(enabled: boolean) {
    super.isEnabled = enabled;
    this.update();
  }

  override get isEnabled(): boolean {
    return super.isEnabled;
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.update();
  }

  protected override highlightChanged(highlighted: boolean): void {
    if (this._configuration || this.buttonType !== UIButtonType.system) {
      this.update();
      return;
    }
    // System buttons dim at once and fade back.
    const alpha = highlighted ? 0.2 : 1;
    const apply = () => {
      if (this._titleLabel) this._titleLabel.alpha = alpha;
      if (this._imageView) this._imageView.alpha = alpha;
    };
    if (highlighted) UIView.performWithoutAnimation(apply);
    else UIView.animate(0.25, 0, UIViewAnimationOptions.allowUserInteraction | UIViewAnimationOptions.beginFromCurrentState, apply);
  }

  override touchesEnded(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    super.touchesEnded(touches, event);
    this.update();
  }

  // ── content ───────────────────────────────────────────────────────────

  private get foreground(): UIColor {
    const c = this._configuration;
    if (!this.isEnabled) return UIColor.tertiaryLabel;
    const tint = this.tintColor ?? UIColor.tintColor;
    if (!c) return this.titleColor(this.state) ?? (this.buttonType === UIButtonType.custom ? UIColor.white : this.buttonType === UIButtonType.close ? UIColor.secondaryLabel : tint);
    if (c.baseForegroundColor) return c.baseForegroundColor;
    return c._style === 'filled' || c._style === 'prominentGlass' ? UIColor.white : c._style === 'glass' ? UIColor.label : tint;
  }

  private get fill(): UIColor | null {
    const c = this._configuration;
    if (!c) return this.buttonType === UIButtonType.close ? UIColor.tertiarySystemFill : null;
    const tint = c.baseBackgroundColor ?? this.tintColor ?? UIColor.tintColor;
    const hasFill = c._style !== 'plain';
    if (!this.isEnabled) return hasFill ? UIColor.tertiarySystemFill : null;
    switch (c._style) {
      case 'plain': return null;
      case 'tinted': return tint.withAlphaComponent(0.15);
      case 'gray': return c.baseBackgroundColor ?? UIColor.tertiarySystemFill;
      case 'filled': return tint;
      case 'glass': return c.baseBackgroundColor ?? UIColor.dynamic((t) => (t.userInterfaceStyle === UIUserInterfaceStyle.dark ? UIColor.rgb(0.2, 0.2, 0.22, 0.55) : UIColor.rgb(1, 1, 1, 0.55)));
      case 'prominentGlass': return tint.withAlphaComponent(0.85);
    }
  }

  private update(): void {
    this.configurationUpdateHandler?.(this);
    const c = this._configuration;
    const fg = this.foreground;
    const pressed = this.isHighlighted;
    if (c) {
      const size = SIZES[c.buttonSize];
      const label = this.titleLabel;
      label.font = UIFont.systemFont(size.font, c._style === 'prominentGlass' || c._style === 'filled' && c.buttonSize === UIButtonConfigurationSize.large ? UIFontWeight.semibold : UIFontWeight.regular);
      if (c.attributedTitle) label.attributedText = c.attributedTitle;
      else label.text = c.title;
      label.textColor = fg;
      label.isHidden = !c.title && !c.attributedTitle;
      if (c.subtitle) {
        const sub = this.subtitleLabel;
        sub.text = c.subtitle;
        sub.font = UIFont.systemFont(size.subtitle);
        sub.textColor = fg;
        sub.isHidden = false;
      } else if (this._subtitleLabel) this._subtitleLabel.isHidden = true;
      const image = c.image?.isSymbolImage
        ? c.image.withConfiguration(c.preferredSymbolConfigurationForImage ?? UIImageSymbolConfiguration.fromPointSize(size.font))
        : c.image;
      if (image) {
        this.imageView.image = image;
        this.imageView.tintColor = fg;
        this.imageView.isHidden = false;
      } else if (this._imageView) this._imageView.isHidden = true;
      // Pressed configuration buttons dim; filled ones keep their fill a bit stronger than their content.
      const dim = pressed ? (c._style === 'plain' ? 0.3 : 0.7) : 1;
      for (const v of [this._titleLabel, this._subtitleLabel, this._imageView]) if (v) v.alpha = dim;
    } else {
      const attributed = this.lookup(this.attributedTitles, this.state);
      const title = this.title(this.state);
      if (title !== null || attributed) {
        const label = this.titleLabel;
        if (attributed) label.attributedText = attributed;
        else label.text = title;
        label.textColor = fg;
        label.isHidden = false;
      } else if (this._titleLabel) this._titleLabel.isHidden = true;
      const image = this.image(this.state);
      if (image) {
        this.imageView.image = image;
        this.imageView.tintColor = fg;
        this.imageView.isHidden = false;
        if (this.buttonType === UIButtonType.custom && this.adjustsImageWhenHighlighted) this.imageView.alpha = pressed ? 0.5 : 1;
      } else if (this._imageView) this._imageView.isHidden = true;
    }
    this.invalidateIntrinsicContentSize();
    this.setNeedsLayout();
    this.setNeedsDisplay();
  }

  override tintColorDidChange(): void {
    super.tintColorDidChange();
    this.update();
  }

  override traitCollectionDidChange(): void {
    this.update();
  }

  // ── layout ────────────────────────────────────────────────────────────

  private get insets(): UIEdgeInsets {
    const c = this._configuration;
    if (!c) return this.contentEdgeInsets;
    const i = c.contentInsets ?? SIZES[c.buttonSize].insets;
    return { top: i.top, left: i.leading, bottom: i.bottom, right: i.trailing };
  }

  /** The image, title and subtitle sizes and how they are arranged. */
  private contentMetrics(maxWidth: number): { size: CGSize; image: CGSize | null; title: CGSize | null; subtitle: CGSize | null; vertical: boolean; gap: number } {
    const c = this._configuration;
    const showImage = this._imageView && !this._imageView.isHidden && this._imageView.image ? this._imageView.image.size : null;
    const title = this._titleLabel && !this._titleLabel.isHidden ? this._titleLabel.sizeThatFits({ width: maxWidth, height: Infinity }) : null;
    const subtitle = this._subtitleLabel && !this._subtitleLabel.isHidden ? this._subtitleLabel.sizeThatFits({ width: maxWidth, height: Infinity }) : null;
    const textW = Math.max(title?.width ?? 0, subtitle?.width ?? 0);
    const textH = (title?.height ?? 0) + (subtitle?.height ?? 0) + (title && subtitle ? c?.titlePadding ?? 0 : 0);
    const placement = c?.imagePlacement ?? NSDirectionalRectEdge.leading;
    const vertical = placement === NSDirectionalRectEdge.top || placement === NSDirectionalRectEdge.bottom;
    const gap = showImage && (title || subtitle) ? c?.imagePadding ?? 0 : 0;
    const iw = showImage?.width ?? 0;
    const ih = showImage?.height ?? 0;
    const size = vertical
      ? { width: Math.max(iw, textW), height: ih + gap + textH }
      : { width: iw + gap + textW, height: Math.max(ih, textH) };
    return { size, image: showImage, title, subtitle, vertical, gap };
  }

  override sizeThatFits(_size: CGSize): CGSize {
    const i = this.insets;
    const m = this.contentMetrics(Infinity);
    const scale = this.traitCollection.displayScale || 3;
    const round = (v: number) => Math.ceil(v * scale - 1e-6) / scale;
    if (!this._configuration) {
      // Legacy buttons are at least 30 pt tall (and wide), like UIKit's.
      const legacy = this.buttonType === UIButtonType.custom ? 0 : 30;
      return { width: round(Math.max(legacy, m.size.width + i.left + i.right)), height: round(Math.max(legacy, m.size.height + i.top + i.bottom + (this.buttonType === UIButtonType.system && m.title ? 12 : 0))) };
    }
    return { width: round(m.size.width + i.left + i.right), height: round(m.size.height + i.top + i.bottom) };
  }

  override get intrinsicContentSize(): CGSize {
    return this.sizeThatFits({ width: Infinity, height: Infinity });
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const b = this.bounds.size;
    const i = this.insets;
    const box = { x: i.left, y: i.top, w: Math.max(0, b.width - i.left - i.right), h: Math.max(0, b.height - i.top - i.bottom) };
    const m = this.contentMetrics(box.w);
    const H = UIControlContentHorizontalAlignment;
    const V = UIControlContentVerticalAlignment;
    const ha = this.contentHorizontalAlignment;
    const va = this.contentVerticalAlignment;
    const cw = Math.min(m.size.width, box.w);
    const x0 = ha === H.left || ha === H.leading ? box.x : ha === H.right || ha === H.trailing ? box.x + box.w - cw : box.x + (box.w - cw) / 2;
    const y0 = va === V.top ? box.y : va === V.bottom ? box.y + box.h - m.size.height : box.y + (box.h - m.size.height) / 2;
    const placement = this._configuration?.imagePlacement ?? NSDirectionalRectEdge.leading;
    const textW = Math.min(cw - (m.vertical ? 0 : (m.image?.width ?? 0) + m.gap), Math.max(m.title?.width ?? 0, m.subtitle?.width ?? 0));
    const textH = (m.title?.height ?? 0) + (m.subtitle?.height ?? 0) + (m.title && m.subtitle ? this._configuration?.titlePadding ?? 0 : 0);
    let tx: number;
    let ty: number;
    if (m.image) {
      const iw = m.image.width;
      const ih = m.image.height;
      let ix: number;
      let iy: number;
      switch (placement) {
        case NSDirectionalRectEdge.trailing:
          tx = x0;
          ix = x0 + textW + m.gap;
          iy = y0 + (m.size.height - ih) / 2;
          ty = y0 + (m.size.height - textH) / 2;
          break;
        case NSDirectionalRectEdge.top:
          ix = x0 + (cw - iw) / 2;
          iy = y0;
          tx = x0 + (cw - textW) / 2;
          ty = y0 + ih + m.gap;
          break;
        case NSDirectionalRectEdge.bottom:
          tx = x0 + (cw - textW) / 2;
          ty = y0;
          ix = x0 + (cw - iw) / 2;
          iy = y0 + textH + m.gap;
          break;
        default:
          ix = x0;
          iy = y0 + (m.size.height - ih) / 2;
          tx = x0 + iw + m.gap;
          ty = y0 + (m.size.height - textH) / 2;
      }
      const e = this._configuration ? UIEdgeInsetsZero : this.imageEdgeInsets;
      this.imageView.frame = { origin: { x: ix + e.left - e.right, y: iy + e.top - e.bottom }, size: m.image };
    } else {
      tx = x0;
      ty = y0 + (m.size.height - textH) / 2;
    }
    const e = this._configuration ? UIEdgeInsetsZero : this.titleEdgeInsets;
    if (m.title) this.titleLabel.frame = { origin: { x: tx + e.left - e.right, y: ty + e.top - e.bottom }, size: { width: textW, height: m.title.height } };
    if (m.subtitle) {
      this.subtitleLabel.frame = {
        origin: { x: tx, y: ty + (m.title?.height ?? 0) + (m.title ? this._configuration?.titlePadding ?? 0 : 0) },
        size: { width: textW, height: m.subtitle.height },
      };
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────

  private get cornerRadius(): number {
    const c = this._configuration;
    const h = this.bounds.size.height;
    if (!c) return this.buttonType === UIButtonType.close ? h / 2 : 0;
    switch (c.cornerStyle) {
      case UIButtonConfigurationCornerStyle.fixed: return c.cornerRadius;
      case UIButtonConfigurationCornerStyle.dynamic:
      case UIButtonConfigurationCornerStyle.capsule: return h / 2;
      default: return CORNERS[c.cornerStyle] ?? 8;
    }
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const fill = this.fill;
    const b = this.bounds.size;
    const background = this.lookup(this.backgroundImages, this.state);
    const traits = this.traitCollection;
    const r = Math.min(this.cornerRadius, b.width / 2, b.height / 2);
    const radii = [r, r, r, r] as const;
    const box = { x: ctx.x, y: ctx.y, w: b.width, h: b.height };
    const glass = this._configuration && (this._configuration._style === 'glass' || this._configuration._style === 'prominentGlass');
    if (glass) {
      ctx.item(inflate(box, 40), (w) => w.boxShadow(box.x, box.y, box.w, box.h, radii, 0x0000001f, 16, 0, 4, 0, false));
      const visible = ctx.visible(box);
      if (visible) ctx.backdrop(visible, visible.w === box.w && visible.h === box.h ? radii : [0, 0, 0, 0], 8, 1.8);
    }
    const pressedFill = this.isHighlighted && this._configuration && this._configuration._style !== 'plain';
    if (fill) {
      const color = fill.resolvedColor(traits).rgba;
      ctx.item(box, (w) => {
        w.fillRRect(box.x, box.y, box.w, box.h, radii, color);
        if (pressedFill) w.fillRRect(box.x, box.y, box.w, box.h, radii, traits.appearance === 'dark' ? 0xffffff1f : 0x0000001a);
      });
    }
    if (glass) {
      ctx.item(inflate(box, 1), (w) => w.strokeRRect(box.x + 0.25, box.y + 0.25, box.w - 0.5, box.h - 0.5, radii, 0.5, traits.appearance === 'dark' ? 0xffffff2e : 0xffffffb3));
    }
    if (background?.isLoaded) ctx.item(box, (w) => background._draw(w, { origin: { x: box.x, y: box.y }, size: b }, 0, traits));
  }
}

/** Glyphs of the system button types. */
const SYSTEM_GLYPHS: Partial<Record<UIButtonType, string>> = {
  [UIButtonType.detailDisclosure]: 'info.circle',
  [UIButtonType.infoLight]: 'info.circle',
  [UIButtonType.infoDark]: 'info.circle',
  [UIButtonType.contactAdd]: 'plus.circle',
  [UIButtonType.close]: 'xmark',
};

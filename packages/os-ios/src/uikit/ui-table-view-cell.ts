import { type LayerContext } from '@mimicry/os-core';
import type { CGSize, UIEdgeInsets } from '../core-graphics/geometry';
import { NSTextAlignment } from './ns-paragraph-style';
import { UIColor } from './ui-color';
import type { UIEvent, UITouch } from './ui-event';
import { UIFont } from './ui-font';
import { UIImageView } from './ui-image-view';
import { UILabel } from './ui-label';
import { UIView } from './ui-view';
import { UIViewAnimationOptions } from './ui-view-animation';

/**
 * UITableViewCell: content view with the standard styles' labels and image
 * (default, subtitle, value1, value2), accessories (disclosure chevron,
 * checkmark, detail buttons, a custom view), selection and highlight
 * backgrounds, and the bottom separator the table asks for.
 *
 * Metrics are iOS 15+: 16 pt (plain) / 20 pt (grouped) margins, 17 pt
 * text, a 44 pt minimum height; subtitle detail 15 pt secondary.
 */
export enum UITableViewCellStyle { default = 0, value1 = 1, value2 = 2, subtitle = 3 }
export enum UITableViewCellAccessoryType { none = 0, disclosureIndicator = 1, detailDisclosureButton = 2, checkmark = 3, detailButton = 4 }
export enum UITableViewCellSelectionStyle { none = 0, blue = 1, gray = 2, default = 3 }

/** The table's side of a cell (touches and its place in a section). */
export interface TableCellHost {
  _cellTouched(cell: UITableViewCell, phase: 'began' | 'ended' | 'cancelled', inside: boolean): void;
}

const ACCESSORY_WIDTH: Record<UITableViewCellAccessoryType, number> = {
  [UITableViewCellAccessoryType.none]: 0,
  [UITableViewCellAccessoryType.disclosureIndicator]: 9,
  [UITableViewCellAccessoryType.checkmark]: 15,
  [UITableViewCellAccessoryType.detailButton]: 22,
  [UITableViewCellAccessoryType.detailDisclosureButton]: 22 + 12 + 9,
};

export class UITableViewCell extends UIView {
  readonly style: UITableViewCellStyle;
  readonly reuseIdentifier: string | null;
  readonly contentView = new UIView();
  private _textLabel: UILabel | null = null;
  private _detailTextLabel: UILabel | null = null;
  private _imageView: UIImageView | null = null;
  private _accessoryType = UITableViewCellAccessoryType.none;
  private _accessoryView: UIView | null = null;
  selectionStyle = UITableViewCellSelectionStyle.default;
  private _isSelected = false;
  private _isHighlighted = false;
  backgroundView: UIView | null = null;
  selectedBackgroundView: UIView | null = null;
  /** left/right insets of the separator below this cell (null: the table's) */
  separatorInset: UIEdgeInsets | null = null;
  indentationLevel = 0;
  indentationWidth = 10;
  /** @internal set by the table */
  _host: TableCellHost | null = null;
  /** @internal draw the separator below (the table decides per row) */
  _separator: { left: number; right: number; color: UIColor } | null = null;
  /** @internal the margin the table's style uses */
  _margin = 16;
  private readonly highlight = new UIView();

  constructor(style: UITableViewCellStyle = UITableViewCellStyle.default, reuseIdentifier: string | null = null) {
    super();
    this.style = style;
    this.reuseIdentifier = reuseIdentifier;
    this.highlight.isUserInteractionEnabled = false;
    this.highlight.alpha = 0;
    this.addSubview(this.highlight);
    this.addSubview(this.contentView);
    this.backgroundColor = UIColor.systemBackground;
    this.defaultBackground = true;
  }

  /** the cell still has UIKit's default background (the table's style picks it) */
  private defaultBackground = false;

  override get backgroundColor(): UIColor | null {
    return super.backgroundColor;
  }

  override set backgroundColor(color: UIColor | null) {
    super.backgroundColor = color;
    this.defaultBackground = false;
  }

  /** @internal the table's default cell background, unless the app set its own */
  _applyDefaultBackground(color: UIColor): void {
    if (!this.defaultBackground) return;
    super.backgroundColor = color;
  }

  get textLabel(): UILabel {
    if (!this._textLabel) {
      this._textLabel = new UILabel();
      this._textLabel.font = UIFont.systemFont(17);
      this.contentView.addSubview(this._textLabel);
    }
    return this._textLabel;
  }

  /** null in the default style, like UIKit */
  get detailTextLabel(): UILabel | null {
    if (this.style === UITableViewCellStyle.default) return null;
    if (!this._detailTextLabel) {
      const l = new UILabel();
      switch (this.style) {
        case UITableViewCellStyle.subtitle:
          l.font = UIFont.systemFont(15);
          l.textColor = UIColor.secondaryLabel;
          break;
        case UITableViewCellStyle.value1:
          l.font = UIFont.systemFont(17);
          l.textColor = UIColor.secondaryLabel;
          l.textAlignment = NSTextAlignment.right;
          break;
        case UITableViewCellStyle.value2:
          l.font = UIFont.systemFont(15);
          break;
      }
      this._detailTextLabel = l;
      this.contentView.addSubview(l);
    }
    return this._detailTextLabel;
  }

  get imageView(): UIImageView {
    if (!this._imageView) {
      this._imageView = new UIImageView();
      this.contentView.addSubview(this._imageView);
    }
    return this._imageView;
  }

  get accessoryType(): UITableViewCellAccessoryType {
    return this._accessoryType;
  }

  set accessoryType(type: UITableViewCellAccessoryType) {
    this._accessoryType = type;
    this.setNeedsLayout();
    this.setNeedsDisplay();
  }

  get accessoryView(): UIView | null {
    return this._accessoryView;
  }

  set accessoryView(view: UIView | null) {
    this._accessoryView?.removeFromSuperview();
    this._accessoryView = view;
    if (view) this.addSubview(view);
    this.setNeedsLayout();
  }

  get isSelected(): boolean {
    return this._isSelected;
  }

  setSelected(selected: boolean, animated: boolean): void {
    this._isSelected = selected;
    this.updateHighlight(animated);
  }

  get isHighlighted(): boolean {
    return this._isHighlighted;
  }

  setHighlighted(highlighted: boolean, animated: boolean): void {
    this._isHighlighted = highlighted;
    this.updateHighlight(animated);
  }

  private updateHighlight(animated: boolean): void {
    const on = (this._isSelected || this._isHighlighted) && this.selectionStyle !== UITableViewCellSelectionStyle.none;
    const view = this.selectedBackgroundView ?? this.highlight;
    if (view !== this.highlight && view.superview !== this) this.insertSubview(view, 0);
    if (view === this.highlight) this.highlight.backgroundColor = UIColor.systemGray4;
    const apply = () => (view.alpha = on ? 1 : 0);
    if (animated && !on) UIView.animate(0.3, 0, UIViewAnimationOptions.allowUserInteraction, apply);
    else UIView.performWithoutAnimation(apply);
  }

  /** prepareForReuse(): called before the table hands the cell out again. */
  prepareForReuse(): void {
    this.setSelected(false, false);
    this.setHighlighted(false, false);
  }

  // ── touches (forwarded to the table, which selects) ───────────────────

  override touchesBegan(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    this._host?._cellTouched(this, 'began', true);
  }

  override touchesMoved(): void {}

  override touchesEnded(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    const touch = touches.values().next().value as UITouch | undefined;
    const p = touch?.location(this);
    const b = this.bounds.size;
    const inside = !!p && p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height;
    this._host?._cellTouched(this, 'ended', inside);
  }

  override touchesCancelled(): void {
    this._host?._cellTouched(this, 'cancelled', false);
  }

  // ── layout ────────────────────────────────────────────────────────────

  private get accessoryWidth(): number {
    if (this._accessoryView) return this._accessoryView.bounds.size.width;
    return ACCESSORY_WIDTH[this._accessoryType];
  }

  /** The height this cell's standard content needs at `width`. */
  override sizeThatFits(size: CGSize): CGSize {
    const width = size.width;
    const textWidth = Math.max(0, width - this._margin * 2 - this.accessoryInset);
    const title = this._textLabel?.text ? this.textLabel.sizeThatFits({ width: textWidth, height: Infinity }).height : 0;
    const detail = this._detailTextLabel?.text ? this._detailTextLabel.sizeThatFits({ width: textWidth, height: Infinity }).height : 0;
    const content = this.style === UITableViewCellStyle.subtitle ? title + detail + 2 : Math.max(title, detail);
    return { width, height: Math.max(44, Math.ceil(content + 22)) };
  }

  private get accessoryInset(): number {
    const a = this.accessoryWidth;
    return a > 0 ? a + 12 : 0;
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const b = this.bounds.size;
    this.highlight.frame = { origin: { x: 0, y: 0 }, size: b };
    if (this.selectedBackgroundView) this.selectedBackgroundView.frame = { origin: { x: 0, y: 0 }, size: b };
    if (this.backgroundView) this.backgroundView.frame = { origin: { x: 0, y: 0 }, size: b };
    const margin = this._margin;
    const accessory = this.accessoryInset;
    this.contentView.frame = { origin: { x: 0, y: 0 }, size: { width: b.width - accessory, height: b.height } };
    if (this._accessoryView) {
      const s = this._accessoryView.bounds.size;
      this._accessoryView.frame = { origin: { x: b.width - margin - s.width, y: (b.height - s.height) / 2 }, size: s };
    }
    let x = margin + this.indentationLevel * this.indentationWidth;
    const image = this._imageView?.image;
    if (image && this._imageView) {
      const s = image.size;
      this._imageView.frame = { origin: { x, y: (b.height - s.height) / 2 }, size: s };
      x += Math.max(s.width, 29) + 15;
    }
    const right = b.width - accessory - margin;
    const width = Math.max(0, right - x);
    const title = this._textLabel;
    const detail = this._detailTextLabel;
    const th = title ? title.sizeThatFits({ width, height: Infinity }).height : 0;
    const dh = detail?.text ? detail.sizeThatFits({ width, height: Infinity }).height : 0;
    switch (this.style) {
      case UITableViewCellStyle.subtitle: {
        const total = th + (dh ? dh + 2 : 0);
        const top = (b.height - total) / 2;
        title?.setFrameIfNeeded({ origin: { x, y: top }, size: { width, height: th } });
        detail?.setFrameIfNeeded({ origin: { x, y: top + th + 2 }, size: { width, height: dh } });
        break;
      }
      case UITableViewCellStyle.value1: {
        const dw = detail?.text ? Math.min(width / 2, detail.sizeThatFits({ width: Infinity, height: Infinity }).width) : 0;
        title?.setFrameIfNeeded({ origin: { x, y: (b.height - th) / 2 }, size: { width: width - dw - (dw ? 8 : 0), height: th } });
        detail?.setFrameIfNeeded({ origin: { x: right - dw, y: (b.height - dh) / 2 }, size: { width: dw, height: dh } });
        break;
      }
      case UITableViewCellStyle.value2: {
        const lw = 91;
        if (title) {
          title.font = UIFont.boldSystemFont(15);
          title.textColor = this.tintColor ?? UIColor.tintColor;
          title.textAlignment = NSTextAlignment.right;
        }
        title?.setFrameIfNeeded({ origin: { x, y: (b.height - th) / 2 }, size: { width: lw, height: th } });
        detail?.setFrameIfNeeded({ origin: { x: x + lw + 6, y: (b.height - dh) / 2 }, size: { width: width - lw - 6, height: dh } });
        break;
      }
      default:
        title?.setFrameIfNeeded({ origin: { x, y: (b.height - th) / 2 }, size: { width, height: th } });
    }
  }

  // ── drawing: accessories and the separator ────────────────────────────

  protected override drawLayerOverlay(ctx: LayerContext): void {
    super.drawLayerOverlay(ctx);
    const traits = this.traitCollection;
    const b = this.bounds.size;
    const cy = ctx.y + b.height / 2;
    const right = ctx.x + b.width - this._margin;
    const type = this._accessoryView ? UITableViewCellAccessoryType.none : this._accessoryType;
    const tint = (this.tintColor ?? UIColor.tintColor).resolvedColor(traits).rgba;
    if (type === UITableViewCellAccessoryType.disclosureIndicator || type === UITableViewCellAccessoryType.detailDisclosureButton) {
      // SF chevron.forward, footnote semibold, tertiary
      const color = UIColor.tertiaryLabel.resolvedColor(traits).rgba;
      const x = right - 7.5;
      ctx.item({ x: x - 2, y: cy - 9, w: 12, h: 18 }, (w) => {
        w.pathBegin().moveTo(x, cy - 6.5).lineTo(x + 6, cy).lineTo(x, cy + 6.5);
        w.strokePath(color, 2.2, 1, 1);
      });
    }
    if (type === UITableViewCellAccessoryType.checkmark) {
      const x = right - 15;
      ctx.item({ x: x - 2, y: cy - 9, w: 19, h: 18 }, (w) => {
        w.pathBegin().moveTo(x + 1, cy).lineTo(x + 5.5, cy + 5.5).lineTo(x + 14, cy - 6.5);
        w.strokePath(tint, 2.2, 1, 1);
      });
    }
    if (type === UITableViewCellAccessoryType.detailButton || type === UITableViewCellAccessoryType.detailDisclosureButton) {
      const cx = (type === UITableViewCellAccessoryType.detailButton ? right : right - 9 - 12) - 11;
      ctx.item({ x: cx - 12, y: cy - 12, w: 24, h: 24 }, (w) => {
        w.pathBegin().arc(cx, cy, 10, 0, Math.PI * 2).closePath().strokePath(tint, 1.5, 0, 0);
        w.fillRRect(cx - 0.9, cy - 2, 1.8, 7, [0.9, 0.9, 0.9, 0.9], tint);
        w.pathBegin().arc(cx, cy - 5, 1.1, 0, Math.PI * 2).closePath().fillPath(tint);
      });
    }
    const sep = this._separator;
    if (sep) {
      const scale = traits.displayScale || 3;
      const h = 1 / scale;
      const color = sep.color.resolvedColor(traits).rgba;
      const x = ctx.x + sep.left;
      const w = b.width - sep.left - sep.right;
      const y = ctx.y + b.height - h;
      ctx.item({ x, y, w, h }, (wr) => wr.fillRect(x, y, w, h, color));
    }
  }
}


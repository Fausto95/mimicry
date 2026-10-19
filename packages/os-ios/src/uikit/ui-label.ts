import type { LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { NSAttributedString, NSAttributedStringKey, NSMutableAttributedString, type NSAttributes } from '../foundation/ns-attributed-string';
import { kernelOf } from '../quartz-core/ca-media-time';
import { NSLineBreakMode, NSShadow, NSTextAlignment } from './ns-paragraph-style';
import {
  drawLine, layoutAttributedString, lineBounds, shrinkToFit, textMeasurer, type TextContainer, type TextDefaults, type UITextLayout,
} from './text-system';
import { UIColor } from './ui-color';
import { UIFont } from './ui-font';
import { UIView } from './ui-view';

/**
 * UILabel: read-only text. The text is laid out by the UIKit text system,
 * vertically centered in the bounds (UILabel's drawText(in:)), truncated by
 * `numberOfLines`, the bounds' height and `lineBreakMode`, and optionally
 * shrunk to fit (`adjustsFontSizeToFitWidth` + `minimumScaleFactor`). Each
 * line is its own draw item, so a long label in a scroll view only
 * rasterizes what shows.
 *
 * Attributes of `attributedText` win; ranges without a font or color take
 * the label's. A disabled label draws in tertiaryLabel; a highlighted one
 * in highlightedTextColor.
 */
export enum UIBaselineAdjustment { alignBaselines = 0, alignCenters = 1, none = 2 }

export class UILabel extends UIView {
  private _text: string | null = null;
  private _attributed: NSAttributedString | null = null;
  private _font: UIFont = UIFont.systemFont(17);
  private _textColor: UIColor = UIColor.label;
  private _textAlignment = NSTextAlignment.natural;
  private _numberOfLines = 1;
  private _lineBreakMode = NSLineBreakMode.byTruncatingTail;
  private _adjustsFontSizeToFitWidth = false;
  private _minimumScaleFactor = 0;
  private _isEnabled = true;
  private _isHighlighted = false;
  private _highlightedTextColor: UIColor | null = null;
  private _shadowColor: UIColor | null = null;
  private _shadowOffset: CGSize = { width: 0, height: -1 };
  private _preferredMaxLayoutWidth = 0;
  allowsDefaultTighteningForTruncation = false;
  baselineAdjustment = UIBaselineAdjustment.alignBaselines;
  adjustsFontForContentSizeCategory = false;
  showsExpansionTextWhenTruncated = false;
  private cache: { key: string; layout: UITextLayout } | null = null;

  constructor(frame?: CGRect) {
    super(frame);
    this.isUserInteractionEnabled = false;
  }

  // ── content ───────────────────────────────────────────────────────────

  get text(): string | null {
    return this._attributed ? this._attributed.string : this._text;
  }

  set text(text: string | null) {
    this._text = text;
    this._attributed = null;
    this.changed();
  }

  /** The label's text with its attributes (font and color filled in from the label). */
  get attributedText(): NSAttributedString | null {
    if (this._attributed) return this.effectiveText();
    return this._text === null ? null : this.effectiveText();
  }

  set attributedText(text: NSAttributedString | null) {
    this._attributed = text ? text.copy() : null;
    this._text = text ? text.string : null;
    this.changed();
  }

  get font(): UIFont {
    return this._font;
  }

  set font(font: UIFont | null) {
    this._font = font ?? UIFont.systemFont(17);
    this.changed();
  }

  get textColor(): UIColor {
    return this._textColor;
  }

  set textColor(color: UIColor | null) {
    this._textColor = color ?? UIColor.label;
    this.changed(false);
  }

  get textAlignment(): NSTextAlignment {
    return this._textAlignment;
  }

  set textAlignment(alignment: NSTextAlignment) {
    this._textAlignment = alignment;
    this.changed(false);
  }

  get numberOfLines(): number {
    return this._numberOfLines;
  }

  set numberOfLines(lines: number) {
    this._numberOfLines = Math.max(0, lines);
    this.changed();
  }

  get lineBreakMode(): NSLineBreakMode {
    return this._lineBreakMode;
  }

  set lineBreakMode(mode: NSLineBreakMode) {
    this._lineBreakMode = mode;
    this.changed();
  }

  get adjustsFontSizeToFitWidth(): boolean {
    return this._adjustsFontSizeToFitWidth;
  }

  set adjustsFontSizeToFitWidth(adjusts: boolean) {
    this._adjustsFontSizeToFitWidth = adjusts;
    this.changed(false);
  }

  get minimumScaleFactor(): number {
    return this._minimumScaleFactor;
  }

  set minimumScaleFactor(factor: number) {
    this._minimumScaleFactor = Math.max(0, Math.min(1, factor));
    this.changed(false);
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  set isEnabled(enabled: boolean) {
    this._isEnabled = enabled;
    this.changed(false);
  }

  get isHighlighted(): boolean {
    return this._isHighlighted;
  }

  set isHighlighted(highlighted: boolean) {
    this._isHighlighted = highlighted;
    this.changed(false);
  }

  get highlightedTextColor(): UIColor | null {
    return this._highlightedTextColor;
  }

  set highlightedTextColor(color: UIColor | null) {
    this._highlightedTextColor = color;
    this.changed(false);
  }

  get shadowColor(): UIColor | null {
    return this._shadowColor;
  }

  set shadowColor(color: UIColor | null) {
    this._shadowColor = color;
    this.changed(false);
  }

  get shadowOffset(): CGSize {
    return this._shadowOffset;
  }

  set shadowOffset(offset: CGSize) {
    this._shadowOffset = offset;
    this.changed(false);
  }

  /** The width multi-line labels wrap at for their intrinsic size (Auto Layout). */
  get preferredMaxLayoutWidth(): number {
    return this._preferredMaxLayoutWidth;
  }

  set preferredMaxLayoutWidth(width: number) {
    this._preferredMaxLayoutWidth = width;
    this.changed();
  }

  private changed(resizes = true): void {
    this.cache = null;
    if (resizes) this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  override traitCollectionDidChange(): void {
    this.cache = null;
    if (this.adjustsFontForContentSizeCategory) this.invalidateIntrinsicContentSize();
  }

  // ── text system ───────────────────────────────────────────────────────

  private get resolvedFont(): UIFont {
    const style = this._font.textStyle;
    if (this.adjustsFontForContentSizeCategory && style) return UIFont.preferredFont(style, this.traitCollection);
    return this._font;
  }

  private defaults(): TextDefaults {
    let color = this._textColor;
    if (!this._isEnabled) color = UIColor.tertiaryLabel;
    else if (this._isHighlighted && this._highlightedTextColor) color = this._highlightedTextColor;
    return { font: this.resolvedFont, color, alignment: this._textAlignment, lineBreakMode: this._lineBreakMode };
  }

  /** The string the label draws: its attributes, the label's where they are missing. */
  private effectiveText(): NSAttributedString {
    const d = this.defaults();
    const base: NSAttributes = { [NSAttributedStringKey.font]: d.font, [NSAttributedStringKey.foregroundColor]: d.color };
    if (this._shadowColor) {
      const shadow = new NSShadow();
      shadow.shadowColor = this._shadowColor;
      shadow.shadowOffset = this._shadowOffset;
      (base as Record<string, unknown>)[NSAttributedStringKey.shadow] = shadow;
    }
    const source = this._attributed ?? new NSAttributedString(this._text ?? '');
    const out = new NSMutableAttributedString(source.string);
    for (const { range, attributes } of source.attributeRuns) {
      const merged: Record<string, unknown> = { ...base, ...attributes };
      // Links draw in the link color unless the range sets its own.
      if (attributes[NSAttributedStringKey.link] != null && attributes[NSAttributedStringKey.foregroundColor] == null) {
        delete merged[NSAttributedStringKey.foregroundColor];
      }
      if (this._isHighlighted && this._highlightedTextColor) merged[NSAttributedStringKey.foregroundColor] = d.color;
      if (!this._isEnabled) merged[NSAttributedStringKey.foregroundColor] = d.color;
      out.setAttributes(merged, range);
    }
    return out;
  }

  private layoutFor(width: number, height: number, lines = this._numberOfLines): UITextLayout {
    const traits = this.traitCollection;
    const key = `${width}|${height}|${lines}|${traits.userInterfaceStyle}|${traits.preferredContentSizeCategory}`;
    if (this.cache?.key === key) return this.cache.layout;
    const text = this.effectiveText();
    const container: TextContainer = { width, height, numberOfLines: lines, traits, tighten: this.allowsDefaultTighteningForTruncation };
    const defaults = this.defaults();
    const kernel = kernelOf(this.layer.root.host);
    let layout = layoutAttributedString(text, container, defaults, kernel);
    const min = this._minimumScaleFactor;
    if (this._adjustsFontSizeToFitWidth && min > 0 && min < 1 && Number.isFinite(width) && layout.truncated) {
      layout = shrinkToFit(text, container, defaults, min);
    }
    this.cache = { key, layout };
    return layout;
  }

  /** textRect(forBounds:limitedToNumberOfLines:) — where the text goes, vertically centered. */
  textRect(bounds: CGRect, numberOfLines: number): CGRect {
    const layout = this.layoutFor(bounds.size.width, Infinity, numberOfLines);
    const scale = this.traitCollection.displayScale || 3;
    const w = Math.min(bounds.size.width, ceilTo(layout.width, scale));
    const h = Math.min(bounds.size.height, ceilTo(layout.height, scale));
    return { origin: { x: bounds.origin.x, y: bounds.origin.y + (bounds.size.height - h) / 2 }, size: { width: w, height: h } };
  }

  // ── sizing ────────────────────────────────────────────────────────────

  override sizeThatFits(size: CGSize): CGSize {
    const width = size.width > 0 && Number.isFinite(size.width) ? size.width : Infinity;
    const layout = this.layoutFor(width, Infinity);
    const scale = this.traitCollection.displayScale || 3;
    return { width: ceilTo(layout.width, scale), height: ceilTo(layout.height, scale) };
  }

  override get intrinsicContentSize(): CGSize {
    const width = this._numberOfLines !== 1 && this._preferredMaxLayoutWidth > 0 ? this._preferredMaxLayoutWidth : Infinity;
    return this.sizeThatFits({ width, height: Infinity });
  }

  /** Lines the label currently shows (tests and inspection). */
  get layoutLines(): ReadonlyArray<{ text: string; y: number; height: number; x: number; width: number }> {
    const b = this.bounds.size;
    return this.layoutFor(b.width, b.height).lines.map((l) => ({ text: l.runs.map((r) => r.text).join(''), y: l.y, height: l.height, x: l.x, width: l.width }));
  }

  /** Whether the text did not fit (truncated or clipped). */
  get isTruncated(): boolean {
    const b = this.bounds.size;
    return this.layoutFor(b.width, b.height).truncated;
  }

  // ── drawing ───────────────────────────────────────────────────────────

  /** drawText(in:) — override to inset the text; draws into the frame recorder. */
  drawText(rect: CGRect, ctx: LayerContext): void {
    const layout = this.layoutFor(rect.size.width, rect.size.height);
    if (!layout.lines.length) return;
    const scale = this.traitCollection.displayScale || 3;
    const top = rect.origin.y + Math.round(((rect.size.height - layout.height) / 2) * scale) / scale;
    const ox = ctx.x + rect.origin.x;
    const oy = ctx.y + top;
    const measurer = textMeasurer(kernelOf(this.layer.root.host));
    const clip = this._lineBreakMode === NSLineBreakMode.byClipping;
    for (const line of layout.lines) {
      ctx.item(lineBounds(line, ox, oy), (w) => {
        if (clip) {
          w.save();
          w.clipRect(ctx.x + rect.origin.x, ctx.y + rect.origin.y, rect.size.width, rect.size.height);
        }
        drawLine(w, line, ox, oy, measurer);
        if (clip) w.restore();
      });
    }
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    this.drawText({ origin: { x: 0, y: 0 }, size: this.bounds.size }, ctx);
  }
}

const ceilTo = (v: number, scale: number) => Math.ceil(v * scale - 1e-6) / scale;

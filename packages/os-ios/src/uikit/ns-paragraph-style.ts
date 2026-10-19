import type { CGSize } from '../core-graphics/geometry';
import type { UIColor } from './ui-color';

/**
 * UIKit's text attribute values: NSTextAlignment, NSLineBreakMode,
 * NSParagraphStyle / NSMutableParagraphStyle, NSShadow and NSUnderlineStyle.
 */
export enum NSTextAlignment { left = 0, center = 1, right = 2, justified = 3, natural = 4 }

export enum NSLineBreakMode {
  byWordWrapping = 0,
  byCharWrapping = 1,
  byClipping = 2,
  byTruncatingHead = 3,
  byTruncatingTail = 4,
  byTruncatingMiddle = 5,
}

export enum NSWritingDirection { natural = -1, leftToRight = 0, rightToLeft = 1 }

/** NSUnderlineStyle (also used for strikethrough) */
export enum NSUnderlineStyle {
  single = 0x01,
  thick = 0x02,
  double = 0x09,
  patternDot = 0x0100,
  patternDash = 0x0200,
  patternDashDot = 0x0300,
  patternDashDotDot = 0x0400,
  byWord = 0x8000,
}

export class NSParagraphStyle {
  protected _alignment = NSTextAlignment.natural;
  protected _lineSpacing = 0;
  protected _paragraphSpacing = 0;
  protected _paragraphSpacingBefore = 0;
  protected _firstLineHeadIndent = 0;
  protected _headIndent = 0;
  protected _tailIndent = 0;
  protected _lineBreakMode = NSLineBreakMode.byWordWrapping;
  protected _minimumLineHeight = 0;
  protected _maximumLineHeight = 0;
  protected _lineHeightMultiple = 0;
  protected _baseWritingDirection = NSWritingDirection.natural;
  protected _hyphenationFactor = 0;
  protected _allowsDefaultTighteningForTruncation = false;

  static get default(): NSParagraphStyle {
    return new NSParagraphStyle();
  }

  get alignment(): NSTextAlignment { return this._alignment; }
  /** extra space between lines of a paragraph */
  get lineSpacing(): number { return this._lineSpacing; }
  /** extra space after a paragraph */
  get paragraphSpacing(): number { return this._paragraphSpacing; }
  get paragraphSpacingBefore(): number { return this._paragraphSpacingBefore; }
  get firstLineHeadIndent(): number { return this._firstLineHeadIndent; }
  get headIndent(): number { return this._headIndent; }
  /** positive: from the leading edge; zero or negative: from the trailing edge */
  get tailIndent(): number { return this._tailIndent; }
  get lineBreakMode(): NSLineBreakMode { return this._lineBreakMode; }
  get minimumLineHeight(): number { return this._minimumLineHeight; }
  get maximumLineHeight(): number { return this._maximumLineHeight; }
  get lineHeightMultiple(): number { return this._lineHeightMultiple; }
  get baseWritingDirection(): NSWritingDirection { return this._baseWritingDirection; }
  get hyphenationFactor(): number { return this._hyphenationFactor; }
  get allowsDefaultTighteningForTruncation(): boolean { return this._allowsDefaultTighteningForTruncation; }

  mutableCopy(): NSMutableParagraphStyle {
    const copy = new NSMutableParagraphStyle();
    Object.assign(copy, this);
    return copy;
  }

  copy(): NSParagraphStyle {
    const copy = new NSParagraphStyle();
    Object.assign(copy, this);
    return copy;
  }
}

export class NSMutableParagraphStyle extends NSParagraphStyle {
  override get alignment(): NSTextAlignment { return this._alignment; }
  override set alignment(v: NSTextAlignment) { this._alignment = v; }
  override get lineSpacing(): number { return this._lineSpacing; }
  override set lineSpacing(v: number) { this._lineSpacing = v; }
  override get paragraphSpacing(): number { return this._paragraphSpacing; }
  override set paragraphSpacing(v: number) { this._paragraphSpacing = v; }
  override get paragraphSpacingBefore(): number { return this._paragraphSpacingBefore; }
  override set paragraphSpacingBefore(v: number) { this._paragraphSpacingBefore = v; }
  override get firstLineHeadIndent(): number { return this._firstLineHeadIndent; }
  override set firstLineHeadIndent(v: number) { this._firstLineHeadIndent = v; }
  override get headIndent(): number { return this._headIndent; }
  override set headIndent(v: number) { this._headIndent = v; }
  override get tailIndent(): number { return this._tailIndent; }
  override set tailIndent(v: number) { this._tailIndent = v; }
  override get lineBreakMode(): NSLineBreakMode { return this._lineBreakMode; }
  override set lineBreakMode(v: NSLineBreakMode) { this._lineBreakMode = v; }
  override get minimumLineHeight(): number { return this._minimumLineHeight; }
  override set minimumLineHeight(v: number) { this._minimumLineHeight = v; }
  override get maximumLineHeight(): number { return this._maximumLineHeight; }
  override set maximumLineHeight(v: number) { this._maximumLineHeight = v; }
  override get lineHeightMultiple(): number { return this._lineHeightMultiple; }
  override set lineHeightMultiple(v: number) { this._lineHeightMultiple = v; }
  override get baseWritingDirection(): NSWritingDirection { return this._baseWritingDirection; }
  override set baseWritingDirection(v: NSWritingDirection) { this._baseWritingDirection = v; }
  override get hyphenationFactor(): number { return this._hyphenationFactor; }
  override set hyphenationFactor(v: number) { this._hyphenationFactor = v; }
  override get allowsDefaultTighteningForTruncation(): boolean { return this._allowsDefaultTighteningForTruncation; }
  override set allowsDefaultTighteningForTruncation(v: boolean) { this._allowsDefaultTighteningForTruncation = v; }
}

/** NSShadow: a text shadow (the attribute value of NSAttributedString.Key.shadow). */
export class NSShadow {
  shadowOffset: CGSize = { width: 0, height: -3 };
  shadowBlurRadius = 0;
  /** nil draws black at one third opacity */
  shadowColor: UIColor | null = null;
}

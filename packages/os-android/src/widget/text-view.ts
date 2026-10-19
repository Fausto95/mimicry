import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import type { TextAppearanceSpec } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import type { Drawable } from '../graphics/drawable';
import { Gravity } from '../view/gravity';
import { MotionEvent } from '../view/motion-event';
import { MeasureSpec, View } from '../view/view';
import { TypedValue } from '../util/typed-value';
import { ClickableSpan, SpannableStringBuilder, TextPaint, isSpanned, stringOf, type CharSequence } from '../text/spanned';
import { Alignment, Layout, StaticLayout, TruncateAt } from '../text/static-layout';
import { Typeface } from '../text/typeface';

/**
 * android.widget.TextView: styled text in a box. It measures like the
 * framework (wrap_content takes the widest paragraph, capped by the parent;
 * the height is the layout's, limited to maxLines and raised to minLines),
 * lays its text out with StaticLayout (line spacing, font padding, letter
 * spacing, hyphenation, ellipsizing) and draws it aligned by its gravity,
 * with compound drawables around it and a hint when empty.
 *
 * Sizes are dp; sp sizes follow the font scale live, so a font-size change
 * re-lays the text out. A plain TextView in a Material 3 theme draws 14 sp
 * text in ?android:attr/textColorSecondary (Widget.TextView's
 * textAppearanceSmall), as on a device.
 */
export type OnEditorActionListener = (view: TextView, actionId: number) => boolean;

/** android.text.method.MovementMethod (only LinkMovementMethod has behavior here). */
export interface MovementMethod {
  readonly kind: 'link' | 'scrolling' | 'arrow';
}

export const LinkMovementMethod = {
  instance: { kind: 'link' } as MovementMethod,
  getInstance(): MovementMethod {
    return LinkMovementMethod.instance;
  },
};

export const ScrollingMovementMethod = {
  instance: { kind: 'scrolling' } as MovementMethod,
  getInstance(): MovementMethod {
    return ScrollingMovementMethod.instance;
  },
};

interface TextSize {
  unit: number;
  value: number;
}

export class TextView extends View {
  static readonly BufferType = { NORMAL: 0, SPANNABLE: 1, EDITABLE: 2 } as const;

  private text: CharSequence = '';
  private hint: CharSequence | null = null;
  protected readonly textPaint = new TextPaint();
  private textSize: TextSize = { unit: TypedValue.COMPLEX_UNIT_SP, value: 14 };
  private textColors: ColorStateList;
  private hintTextColors: ColorStateList;
  private linkTextColors: ColorStateList;
  private currentTextColor = 0;
  private gravity: number = Gravity.TOP | Gravity.START;
  private maxLines = Number.MAX_SAFE_INTEGER;
  private minLines = 0;
  private maxHeight = Number.MAX_SAFE_INTEGER;
  private minHeightPx = 0;
  private maxWidthPx = Number.MAX_SAFE_INTEGER;
  private singleLine = false;
  private ellipsize: TruncateAt | null = null;
  private spacingAdd = 0;
  private spacingMult = 1;
  private includeFontPadding = true;
  private allCaps = false;
  private hyphenation: number = Layout.HYPHENATION_FREQUENCY_NONE;
  private breakStrategy: number = Layout.BREAK_STRATEGY_HIGH_QUALITY;
  private movementMethod: MovementMethod | null = null;
  private linksClickable = true;
  private readonly compound: [Drawable | null, Drawable | null, Drawable | null, Drawable | null] = [null, null, null, null];
  private compoundPadding = 0;
  private compoundTint: ColorStateList | null = null;
  private textLayout: StaticLayout | null = null;
  private hintLayout: StaticLayout | null = null;
  private layoutKey = '';
  private dirty = true;
  private pressedSpan: ClickableSpan | null = null;
  private unsubscribeFonts: (() => void) | null = null;
  private justification = 0;

  constructor(context: Context) {
    super(context);
    const theme = context.getTheme();
    this.textColors = ColorStateList.valueOf(theme.getColor('textColorSecondary'));
    this.hintTextColors = ColorStateList.valueOf(theme.getColor('textColorHint'));
    this.linkTextColors = ColorStateList.valueOf(theme.getColor('textColorLink'));
    this.currentTextColor = this.textColors.getDefaultColor();
  }

  // ── text ────────────────────────────────────────────────────────────

  setText(text: CharSequence | null, _type?: number): void {
    this.text = text ?? '';
    this.textChanged();
  }

  getText(): CharSequence {
    return this.text;
  }

  append(text: CharSequence): void {
    if (isSpanned(this.text) || isSpanned(text)) {
      const b = new SpannableStringBuilder(this.text);
      b.append(text);
      this.text = b;
    } else this.text = stringOf(this.text) + stringOf(text);
    this.textChanged();
  }

  length(): number {
    return stringOf(this.text).length;
  }

  setHint(hint: CharSequence | null): void {
    this.hint = hint;
    this.textChanged();
  }

  getHint(): CharSequence | null {
    return this.hint;
  }

  private textChanged(): void {
    this.dirty = true;
    this.requestLayout();
    this.invalidate();
  }

  // ── appearance ──────────────────────────────────────────────────────

  /** setTextSize(sp) or setTextSize(TypedValue unit, size). */
  setTextSize(unitOrSize: number, size?: number): void {
    this.textSize = size === undefined ? { unit: TypedValue.COMPLEX_UNIT_SP, value: unitOrSize } : { unit: unitOrSize, value: size };
    this.textChanged();
  }

  /** The text size in dp (sp sizes already scaled by the font scale). */
  getTextSize(): number {
    return TypedValue.applyDimension(this.textSize.unit, this.textSize.value, this.context.getResources().getDisplayMetrics());
  }

  setTextColor(color: number | ColorStateList): void {
    this.textColors = typeof color === 'number' ? ColorStateList.valueOf(color) : color;
    this.updateTextColors();
  }

  getTextColors(): ColorStateList {
    return this.textColors;
  }

  getCurrentTextColor(): number {
    return this.currentTextColor;
  }

  setHintTextColor(color: number | ColorStateList): void {
    this.hintTextColors = typeof color === 'number' ? ColorStateList.valueOf(color) : color;
    this.textChanged();
  }

  getHintTextColors(): ColorStateList {
    return this.hintTextColors;
  }

  setLinkTextColor(color: number | ColorStateList): void {
    this.linkTextColors = typeof color === 'number' ? ColorStateList.valueOf(color) : color;
    this.textChanged();
  }

  private updateTextColors(): void {
    const color = this.textColors.getColorForState(this.getDrawableState(), this.currentTextColor);
    if (color !== this.currentTextColor) {
      this.currentTextColor = color;
      this.dirty = true;
    }
    this.invalidate();
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    if (this.textColors?.isStateful() || this.compoundTint?.isStateful()) this.updateTextColors();
  }

  /** setTypeface(tf) or setTypeface(tf, style) (synthesizes the style on the family). */
  setTypeface(typeface: Typeface | null, style?: number): void {
    const tf = typeface ?? Typeface.DEFAULT;
    this.textPaint.setTypeface(style === undefined ? tf : Typeface.create(tf, style));
    this.textChanged();
  }

  getTypeface(): Typeface {
    return this.textPaint.getTypeface();
  }

  /** TextAppearance.Material3.*: size, line height, weight and tracking. */
  setTextAppearance(appearance: TextAppearanceSpec): void {
    this.textSize = { unit: TypedValue.COMPLEX_UNIT_SP, value: appearance.size };
    const tf = this.textPaint.getTypeface();
    this.textPaint.setTypeface(new Typeface(appearance.family ?? tf.family, appearance.weight, tf.italic));
    this.textPaint.setLetterSpacing(appearance.letterSpacing);
    this.setLineHeightSp(appearance.lineHeight);
    this.textChanged();
  }

  setLetterSpacing(em: number): void {
    this.textPaint.setLetterSpacing(em);
    this.textChanged();
  }

  getLetterSpacing(): number {
    return this.textPaint.getLetterSpacing();
  }

  setShadowLayer(radius: number, dx: number, dy: number, color: number): void {
    if (radius <= 0) this.textPaint.clearShadowLayer();
    else this.textPaint.setShadowLayer(radius, dx, dy, color);
    this.textChanged();
  }

  setPaintFlags(flags: number): void {
    this.textPaint.underlineText = (flags & TextView.UNDERLINE_TEXT_FLAG) !== 0;
    this.textPaint.strikeThru = (flags & TextView.STRIKE_THRU_TEXT_FLAG) !== 0;
    this.textChanged();
  }

  getPaintFlags(): number {
    return (this.textPaint.underlineText ? TextView.UNDERLINE_TEXT_FLAG : 0) | (this.textPaint.strikeThru ? TextView.STRIKE_THRU_TEXT_FLAG : 0);
  }

  /** Paint.UNDERLINE_TEXT_FLAG / STRIKE_THRU_TEXT_FLAG */
  static readonly UNDERLINE_TEXT_FLAG = 8;
  static readonly STRIKE_THRU_TEXT_FLAG = 16;

  getPaint(): TextPaint {
    return this.textPaint;
  }

  // ── layout attributes ───────────────────────────────────────────────

  setGravity(gravity: number): void {
    if ((gravity & Gravity.RELATIVE_HORIZONTAL_GRAVITY_MASK) === 0) gravity |= Gravity.START;
    if ((gravity & Gravity.VERTICAL_GRAVITY_MASK) === 0) gravity |= Gravity.TOP;
    this.gravity = gravity;
    this.textChanged();
  }

  getGravity(): number {
    return this.gravity;
  }

  setMaxLines(maxLines: number): void {
    this.maxLines = maxLines;
    this.textChanged();
  }

  getMaxLines(): number {
    return this.maxLines === Number.MAX_SAFE_INTEGER ? -1 : this.maxLines;
  }

  setMinLines(minLines: number): void {
    this.minLines = minLines;
    this.textChanged();
  }

  getMinLines(): number {
    return this.minLines;
  }

  /** Exactly `lines` lines tall. */
  setLines(lines: number): void {
    this.maxLines = lines;
    this.minLines = lines;
    this.textChanged();
  }

  setMaxHeight(maxPixels: number): void {
    this.maxHeight = maxPixels;
    this.textChanged();
  }

  setMinHeight(minPixels: number): void {
    this.minHeightPx = minPixels;
    this.textChanged();
  }

  setMaxWidth(maxPixels: number): void {
    this.maxWidthPx = maxPixels;
    this.textChanged();
  }

  setSingleLine(singleLine = true): void {
    this.singleLine = singleLine;
    if (singleLine) this.maxLines = 1;
    else if (this.maxLines === 1) this.maxLines = Number.MAX_SAFE_INTEGER;
    this.textChanged();
  }

  isSingleLine(): boolean {
    return this.singleLine;
  }

  setHorizontallyScrolling(whether: boolean): void {
    this.singleLine = whether;
    this.textChanged();
  }

  /** TruncateAt.MARQUEE ellipsizes at the end (no marquee scrolling). */
  setEllipsize(where: TruncateAt | null): void {
    this.ellipsize = where;
    this.textChanged();
  }

  getEllipsize(): TruncateAt | null {
    return this.ellipsize;
  }

  setLineSpacing(add: number, mult: number): void {
    this.spacingAdd = add;
    this.spacingMult = mult;
    this.textChanged();
  }

  getLineSpacingExtra(): number {
    return this.spacingAdd;
  }

  getLineSpacingMultiplier(): number {
    return this.spacingMult;
  }

  /** setLineHeight(dp): line spacing so every line is exactly this tall. */
  setLineHeight(lineHeight: number): void {
    const m = this.fontMetrics();
    this.setLineSpacing(lineHeight - (m.descent - m.ascent), 1);
  }

  private setLineHeightSp(sp: number): void {
    const m = this.fontMetrics();
    const height = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, this.context.getResources().getDisplayMetrics());
    this.spacingAdd = height - (m.descent - m.ascent);
    this.spacingMult = 1;
  }

  setIncludeFontPadding(include: boolean): void {
    this.includeFontPadding = include;
    this.textChanged();
  }

  getIncludeFontPadding(): boolean {
    return this.includeFontPadding;
  }

  setAllCaps(allCaps: boolean): void {
    this.allCaps = allCaps;
    this.textChanged();
  }

  isAllCaps(): boolean {
    return this.allCaps;
  }

  setHyphenationFrequency(frequency: number): void {
    this.hyphenation = frequency;
    this.textChanged();
  }

  getHyphenationFrequency(): number {
    return this.hyphenation;
  }

  /** HIGH_QUALITY (the default) breaks greedily like SIMPLE; BALANCED evens the lines out. */
  setBreakStrategy(strategy: number): void {
    this.breakStrategy = strategy;
    this.textChanged();
  }

  getBreakStrategy(): number {
    return this.breakStrategy;
  }

  setJustificationMode(mode: number): void {
    this.justification = mode;
  }

  getJustificationMode(): number {
    return this.justification;
  }

  setMovementMethod(method: MovementMethod | null): void {
    this.movementMethod = method;
    if (method?.kind === 'link') {
      this.setClickable(true);
      this.setLongClickable(true);
    }
  }

  getMovementMethod(): MovementMethod | null {
    return this.movementMethod;
  }

  setLinksClickable(clickable: boolean): void {
    this.linksClickable = clickable;
  }

  getLinksClickable(): boolean {
    return this.linksClickable;
  }

  // ── compound drawables ──────────────────────────────────────────────

  /** Drawables at the left, top, right and bottom of the text, at their intrinsic sizes. */
  setCompoundDrawablesWithIntrinsicBounds(left: Drawable | null, top: Drawable | null, right: Drawable | null, bottom: Drawable | null): void {
    for (const d of [left, top, right, bottom]) d?.setBounds(0, 0, Math.max(0, d.getIntrinsicWidth()), Math.max(0, d.getIntrinsicHeight()));
    this.setCompoundDrawables(left, top, right, bottom);
  }

  setCompoundDrawablesRelativeWithIntrinsicBounds(start: Drawable | null, top: Drawable | null, end: Drawable | null, bottom: Drawable | null): void {
    this.setCompoundDrawablesWithIntrinsicBounds(start, top, end, bottom);
  }

  /** Drawables with the bounds they already have. */
  setCompoundDrawables(left: Drawable | null, top: Drawable | null, right: Drawable | null, bottom: Drawable | null): void {
    for (const d of this.compound) d?.setCallback(null);
    this.compound[0] = left;
    this.compound[1] = top;
    this.compound[2] = right;
    this.compound[3] = bottom;
    for (const d of this.compound) {
      if (!d) continue;
      d.setCallback(this);
      if (this.compoundTint) d.setTint(this.compoundTint.getColorForState(this.getDrawableState(), this.compoundTint.getDefaultColor()));
    }
    this.textChanged();
  }

  getCompoundDrawables(): Array<Drawable | null> {
    return this.compound.slice();
  }

  setCompoundDrawablePadding(pad: number): void {
    this.compoundPadding = pad;
    this.textChanged();
  }

  getCompoundDrawablePadding(): number {
    return this.compoundPadding;
  }

  setCompoundDrawableTintList(tint: ColorStateList | null): void {
    this.compoundTint = tint;
    for (const d of this.compound) d?.setTint(tint ? tint.getColorForState(this.getDrawableState(), tint.getDefaultColor()) : null);
    this.invalidate();
  }

  private boundsOf(d: Drawable | null): { w: number; h: number } {
    if (!d) return { w: 0, h: 0 };
    const b = d.getBounds();
    return { w: b.width(), h: b.height() };
  }

  getCompoundPaddingLeft(): number {
    const d = this.compound[0];
    return this.getPaddingLeft() + (d ? this.boundsOf(d).w + this.compoundPadding : 0);
  }

  getCompoundPaddingRight(): number {
    const d = this.compound[2];
    return this.getPaddingRight() + (d ? this.boundsOf(d).w + this.compoundPadding : 0);
  }

  getCompoundPaddingTop(): number {
    const d = this.compound[1];
    return this.getPaddingTop() + (d ? this.boundsOf(d).h + this.compoundPadding : 0);
  }

  getCompoundPaddingBottom(): number {
    const d = this.compound[3];
    return this.getPaddingBottom() + (d ? this.boundsOf(d).h + this.compoundPadding : 0);
  }

  // ── layout ──────────────────────────────────────────────────────────

  private fontMetrics() {
    const kernel = this.context.kernel;
    this.syncPaint();
    return this.textPaint.getTypeface().metrics(this.textPaint.getTextSize(), kernel.viewport.scale, kernel.measurer);
  }

  /** The height of one line: font spacing × multiplier + extra (getLineHeight). */
  getLineHeight(): number {
    const m = this.fontMetrics();
    return (m.descent - m.ascent) * this.spacingMult + this.spacingAdd;
  }

  private syncPaint(): void {
    this.textPaint.setTextSize(this.getTextSize());
    this.textPaint.setColor(this.currentTextColor);
    this.textPaint.linkColor = this.linkTextColors.getColorForState(this.getDrawableState(), this.linkTextColors.getDefaultColor());
    this.textPaint.density = this.context.kernel.viewport.scale;
  }

  private displayText(): CharSequence {
    const text = this.text;
    if (!this.allCaps) return text;
    if (!isSpanned(text)) return stringOf(text).toUpperCase();
    // AllCapsTransformationMethod keeps the spans (offsets match for most scripts).
    const plain = stringOf(text).toUpperCase();
    if (plain.length === text.length()) {
      const out = new SpannableStringBuilder(plain);
      for (const span of text.getSpans(0, plain.length)) out.setSpan(span, text.getSpanStart(span), text.getSpanEnd(span), text.getSpanFlags(span));
      return out;
    }
    return plain;
  }

  private alignment(): Alignment {
    switch (Gravity.getAbsoluteGravity(this.gravity) & Gravity.HORIZONTAL_GRAVITY_MASK) {
      case Gravity.CENTER_HORIZONTAL: return Alignment.ALIGN_CENTER;
      case Gravity.RIGHT: return Alignment.ALIGN_OPPOSITE;
      default: return Alignment.ALIGN_NORMAL;
    }
  }

  private makeLayout(text: CharSequence, width: number, paint: TextPaint): StaticLayout {
    return new StaticLayout(text, paint, width, this.alignment(), this.spacingMult, this.spacingAdd, this.includeFontPadding, {
      maxLines: this.ellipsize !== null ? this.maxLines : Number.MAX_SAFE_INTEGER,
      ellipsize: this.ellipsize !== null && (this.maxLines < Number.MAX_SAFE_INTEGER || this.singleLine) ? this.ellipsize : null,
      ellipsizedWidth: width,
      breakStrategy: this.breakStrategy,
      hyphenationFrequency: this.hyphenation,
      singleLine: this.singleLine,
    });
  }

  /** Build the layout for a content width (cached until something changes). */
  private ensureLayout(width: number): StaticLayout {
    this.syncPaint();
    const kernel = this.context.kernel;
    const key = `${width}|${this.textPaint.getTextSize()}|${kernel.viewport.scale}|${kernel.loadedFonts().length}`;
    if (!this.textLayout || this.dirty || key !== this.layoutKey) {
      this.textLayout = this.makeLayout(this.displayText(), width, this.textPaint);
      this.hintLayout = null;
      if (!this.length() && this.hint != null) {
        const hintPaint = new TextPaint(this.textPaint);
        hintPaint.setColor(this.hintTextColors.getColorForState(this.getDrawableState(), this.hintTextColors.getDefaultColor()));
        this.hintLayout = this.makeLayout(this.hint, width, hintPaint);
      }
      this.layoutKey = key;
      this.dirty = false;
    }
    return this.textLayout;
  }

  /** The text's layout once measured (null before). */
  getLayout(): StaticLayout | null {
    return this.textLayout;
  }

  getLineCount(): number {
    return this.textLayout?.getLineCount() ?? 0;
  }

  /** The widest paragraph of the text (or hint), unwrapped. */
  private desiredWidth(): number {
    this.syncPaint();
    const text = this.displayText();
    const textWidth = stringOf(text).length ? Layout.getDesiredWidth(text, this.textPaint) : 0;
    const hintWidth = this.hint != null && !stringOf(text).length ? Layout.getDesiredWidth(this.hint, this.textPaint) : 0;
    return Math.ceil(Math.max(textWidth, hintWidth) * 100) / 100;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const widthMode = MeasureSpec.getMode(widthMeasureSpec);
    const widthSize = MeasureSpec.getSize(widthMeasureSpec);
    const heightMode = MeasureSpec.getMode(heightMeasureSpec);
    const heightSize = MeasureSpec.getSize(heightMeasureSpec);
    const padH = this.getCompoundPaddingLeft() + this.getCompoundPaddingRight();
    const padV = this.getCompoundPaddingTop() + this.getCompoundPaddingBottom();
    let width: number;
    if (widthMode === MeasureSpec.EXACTLY) {
      width = widthSize;
    } else {
      width = this.desiredWidth() + padH;
      const top = this.boundsOf(this.compound[1]).w;
      const bottom = this.boundsOf(this.compound[3]).w;
      width = Math.max(width, top + this.getPaddingLeft() + this.getPaddingRight(), bottom + this.getPaddingLeft() + this.getPaddingRight());
      width = Math.min(width, this.maxWidthPx);
      width = Math.max(width, this.getSuggestedMinimumWidth());
      if (widthMode === MeasureSpec.AT_MOST) width = Math.min(widthSize, width);
    }
    const want = Math.max(0, width - padH);
    const layout = this.ensureLayout(want);
    let height: number;
    if (heightMode === MeasureSpec.EXACTLY) {
      height = heightSize;
    } else {
      height = this.desiredHeight(layout) + padV;
      const left = this.boundsOf(this.compound[0]).h;
      const right = this.boundsOf(this.compound[2]).h;
      height = Math.max(height, left + this.getPaddingTop() + this.getPaddingBottom(), right + this.getPaddingTop() + this.getPaddingBottom());
      height = Math.min(height, this.maxHeight);
      height = Math.max(height, this.minHeightPx, this.getSuggestedMinimumHeight());
      if (heightMode === MeasureSpec.AT_MOST) height = Math.min(height, heightSize);
    }
    this.setMeasuredDimension(width, height);
    this.invalidate();
  }

  /** The layout's height capped at maxLines and raised to minLines (TextView.getDesiredHeight). */
  private desiredHeight(layout: StaticLayout): number {
    const hint = this.hintLayout;
    const source = hint && hint.getHeight() > layout.getHeight() ? hint : layout;
    let lines = source.getLineCount();
    let desired = source.getLineTop(lines);
    if (lines > this.maxLines) {
      desired = source.getLineTop(this.maxLines);
      if (this.includeFontPadding) desired += source.getBottomPadding();
      lines = this.maxLines;
    }
    if (lines < this.minLines) desired += this.getLineHeight() * (this.minLines - lines);
    return desired;
  }

  // ── drawing ─────────────────────────────────────────────────────────

  /** y offset of the text block for the vertical gravity. */
  private verticalOffset(layout: StaticLayout, contentHeight: number): number {
    const visible = Math.min(layout.getLineCount(), this.maxLines);
    let textHeight = layout.getLineTop(visible);
    if (visible < layout.getLineCount() && this.includeFontPadding) textHeight += layout.getBottomPadding();
    const free = contentHeight - textHeight;
    if (free <= 0) return 0;
    switch (this.gravity & Gravity.VERTICAL_GRAVITY_MASK) {
      case Gravity.CENTER_VERTICAL: return free / 2;
      case Gravity.BOTTOM: return free;
      default: return 0;
    }
  }

  private textOrigin(): { x: number; y: number; layout: StaticLayout } | null {
    const layout = this.textLayout;
    if (!layout) return null;
    const contentHeight = this.getHeight() - this.getCompoundPaddingTop() - this.getCompoundPaddingBottom();
    return { x: this.getCompoundPaddingLeft(), y: this.getCompoundPaddingTop() + this.verticalOffset(layout, contentHeight), layout };
  }

  protected override onDraw(canvas: Canvas): void {
    const w = this.getWidth();
    const h = this.getHeight();
    const want = Math.max(0, w - this.getCompoundPaddingLeft() - this.getCompoundPaddingRight());
    // Drawn before measure (a framework placed the view): lay out for the current width.
    if (!this.textLayout || this.dirty) this.ensureLayout(want);
    this.drawCompoundDrawables(canvas, w, h);
    const origin = this.textOrigin();
    if (!origin) return;
    const shown = this.hintLayout ?? origin.layout;
    canvas.save();
    canvas.clipRect(this.getCompoundPaddingLeft(), this.getCompoundPaddingTop(), w - this.getCompoundPaddingRight(), h - this.getCompoundPaddingBottom());
    canvas.translate(origin.x, origin.y);
    shown.drawLines(canvas, 0, Math.min(shown.getLineCount(), this.maxLines));
    canvas.restore();
  }

  private drawCompoundDrawables(canvas: Canvas, w: number, h: number): void {
    const [left, top, right, bottom] = this.compound;
    const vspace = h - this.getCompoundPaddingBottom() - this.getCompoundPaddingTop();
    const hspace = w - this.getCompoundPaddingRight() - this.getCompoundPaddingLeft();
    const place = (d: Drawable, x: number, y: number) => {
      canvas.save();
      canvas.translate(x, y);
      d.draw(canvas);
      canvas.restore();
    };
    if (left) place(left, this.getPaddingLeft(), this.getCompoundPaddingTop() + (vspace - this.boundsOf(left).h) / 2);
    if (right) place(right, w - this.getPaddingRight() - this.boundsOf(right).w, this.getCompoundPaddingTop() + (vspace - this.boundsOf(right).h) / 2);
    if (top) place(top, this.getCompoundPaddingLeft() + (hspace - this.boundsOf(top).w) / 2, this.getPaddingTop());
    if (bottom) place(bottom, this.getCompoundPaddingLeft() + (hspace - this.boundsOf(bottom).w) / 2, h - this.getPaddingBottom() - this.boundsOf(bottom).h);
  }

  // ── links ───────────────────────────────────────────────────────────

  private clickableSpanAt(x: number, y: number): ClickableSpan | null {
    const origin = this.textOrigin();
    if (!origin) return null;
    return origin.layout.spansAt(x - origin.x, y - origin.y, ClickableSpan)[0] ?? null;
  }

  override onTouchEvent(event: MotionEvent): boolean {
    if (this.movementMethod?.kind === 'link' && this.linksClickable && isSpanned(this.text) && this.isEnabled()) {
      const action = event.getActionMasked();
      if (action === MotionEvent.ACTION_DOWN) {
        this.pressedSpan = this.clickableSpanAt(event.getX(), event.getY());
        if (this.pressedSpan) {
          super.onTouchEvent(event);
          return true;
        }
      } else if (this.pressedSpan) {
        if (action === MotionEvent.ACTION_UP) {
          const span = this.clickableSpanAt(event.getX(), event.getY());
          const pressed = this.pressedSpan;
          this.pressedSpan = null;
          this.setPressed(false);
          if (span === pressed) span.onClick(this);
          return true;
        }
        if (action === MotionEvent.ACTION_CANCEL) {
          this.pressedSpan = null;
          this.setPressed(false);
          return true;
        }
        return true;
      }
    }
    return super.onTouchEvent(event);
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  protected override onAttachedToWindow(): void {
    super.onAttachedToWindow();
    this.unsubscribeFonts = this.context.kernel.onFontsChanged(() => this.textChanged());
  }

  protected override onDetachedFromWindow(): void {
    this.unsubscribeFonts?.();
    this.unsubscribeFonts = null;
    super.onDetachedFromWindow();
  }

  override invalidateDrawable(who: Drawable): void {
    if (this.compound.includes(who)) this.invalidate();
    else super.invalidateDrawable(who);
  }

  override toString(): string {
    return `${super.toString()} "${stringOf(this.text).slice(0, 24)}"`;
  }
}

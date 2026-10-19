import { Paint } from '../graphics/canvas';
import { Color } from '../graphics/color';
import type { TextAppearanceSpec } from '../content/theme';
import { Typeface } from './typeface';
import type { View } from '../view/view';

/**
 * android.text: CharSequence with markup — Spanned / Spannable,
 * SpannedString, SpannableString and SpannableStringBuilder (whose spans
 * follow edits by their SPAN_* flags) — TextPaint, and the character styles
 * TextView draws: colors, background, style / typeface / size spans,
 * underline, strikethrough, text appearance and ClickableSpan / URLSpan.
 *
 * Spans that need geometry the text renderer does not have (ScaleXSpan's
 * horizontal glyph scaling, Superscript/SubscriptSpan's baseline shift) are
 * recorded on the paint but not drawn.
 */

// ── TextPaint ────────────────────────────────────────────────────────────

export class TextPaint extends Paint {
  bgColor = 0;
  baselineShift = 0;
  linkColor = 0xff6750a4 | 0;
  drawableState: readonly string[] = [];
  density = 1;
  underlineColor = 0;
  underlineText = false;
  strikeThru = false;
  textScaleX = 1;

  constructor(flags: number | Paint = 0) {
    super(typeof flags === 'number' ? flags : 0);
    if (flags instanceof Paint) this.set(flags);
  }

  override set(other: Paint): void {
    super.set(other);
    if (other instanceof TextPaint) {
      this.bgColor = other.bgColor;
      this.baselineShift = other.baselineShift;
      this.linkColor = other.linkColor;
      this.drawableState = other.drawableState;
      this.density = other.density;
      this.underlineColor = other.underlineColor;
      this.underlineText = other.underlineText;
      this.strikeThru = other.strikeThru;
      this.textScaleX = other.textScaleX;
    }
  }

  setUnderlineText(underline: boolean): void {
    this.underlineText = underline;
  }

  isUnderlineText(): boolean {
    return this.underlineText;
  }

  setStrikeThruText(strike: boolean): void {
    this.strikeThru = strike;
  }

  isStrikeThruText(): boolean {
    return this.strikeThru;
  }

  setTextScaleX(scale: number): void {
    this.textScaleX = scale;
  }
}

// ── spans ────────────────────────────────────────────────────────────────

/** Spans that change how characters draw. */
export abstract class CharacterStyle {
  abstract updateDrawState(tp: TextPaint): void;
  getUnderlying(): CharacterStyle {
    return this;
  }
}

/** Spans that change how characters measure (size, typeface). */
export abstract class MetricAffectingSpan extends CharacterStyle {
  updateMeasureState(tp: TextPaint): void {
    this.updateDrawState(tp);
  }
}

export class ForegroundColorSpan extends CharacterStyle {
  constructor(private readonly color: number) {
    super();
  }
  getForegroundColor(): number {
    return this.color;
  }
  updateDrawState(tp: TextPaint): void {
    tp.setColor(this.color);
  }
}

export class BackgroundColorSpan extends CharacterStyle {
  constructor(private readonly color: number) {
    super();
  }
  getBackgroundColor(): number {
    return this.color;
  }
  updateDrawState(tp: TextPaint): void {
    tp.bgColor = this.color;
  }
}

export class UnderlineSpan extends CharacterStyle {
  updateDrawState(tp: TextPaint): void {
    tp.underlineText = true;
  }
}

export class StrikethroughSpan extends CharacterStyle {
  updateDrawState(tp: TextPaint): void {
    tp.strikeThru = true;
  }
}

/** StyleSpan(Typeface.BOLD | ITALIC): adds the style to whatever typeface the text has. */
export class StyleSpan extends MetricAffectingSpan {
  constructor(private readonly style: number) {
    super();
  }
  getStyle(): number {
    return this.style;
  }
  updateDrawState(tp: TextPaint): void {
    const tf = tp.getTypeface();
    const want = tf.getStyle() | this.style;
    const bold = want & Typeface.BOLD ? Math.max(tf.weight, 700) : tf.weight;
    tp.setTypeface(new Typeface(tf.family, bold, (want & Typeface.ITALIC) !== 0));
  }
}

/** TypefaceSpan(family name or Typeface). */
export class TypefaceSpan extends MetricAffectingSpan {
  constructor(private readonly typeface: string | Typeface) {
    super();
  }
  getFamily(): string | null {
    return typeof this.typeface === 'string' ? this.typeface : this.typeface.family;
  }
  getTypeface(): Typeface | null {
    return typeof this.typeface === 'string' ? null : this.typeface;
  }
  updateDrawState(tp: TextPaint): void {
    const current = tp.getTypeface();
    const tf = typeof this.typeface === 'string' ? Typeface.create(this.typeface, current.getStyle()) : this.typeface;
    tp.setTypeface(tf);
  }
}

/** AbsoluteSizeSpan(size, dip): pixels unless `dip` (Mimicry's units are dp, so pixels divide by the density). */
export class AbsoluteSizeSpan extends MetricAffectingSpan {
  constructor(private readonly size: number, private readonly dip = false) {
    super();
  }
  getSize(): number {
    return this.size;
  }
  getDip(): boolean {
    return this.dip;
  }
  updateDrawState(tp: TextPaint): void {
    tp.setTextSize(this.dip ? this.size : this.size / tp.density);
  }
}

export class RelativeSizeSpan extends MetricAffectingSpan {
  constructor(private readonly proportion: number) {
    super();
  }
  getSizeChange(): number {
    return this.proportion;
  }
  updateDrawState(tp: TextPaint): void {
    tp.setTextSize(tp.getTextSize() * this.proportion);
  }
}

/** Recorded only: glyphs are not scaled horizontally. */
export class ScaleXSpan extends MetricAffectingSpan {
  constructor(private readonly proportion: number) {
    super();
  }
  getScaleX(): number {
    return this.proportion;
  }
  updateDrawState(tp: TextPaint): void {
    tp.textScaleX *= this.proportion;
  }
}

/** Recorded only (baselineShift); text stays on the line's baseline. */
export class SuperscriptSpan extends MetricAffectingSpan {
  updateDrawState(tp: TextPaint): void {
    tp.baselineShift += tp.getTextSize() / 3;
  }
}

export class SubscriptSpan extends MetricAffectingSpan {
  updateDrawState(tp: TextPaint): void {
    tp.baselineShift -= tp.getTextSize() / 3;
  }
}

/** TextAppearanceSpan: size, weight, letter spacing and (optionally) color of a text appearance. */
export class TextAppearanceSpan extends MetricAffectingSpan {
  constructor(private readonly appearance: TextAppearanceSpec, private readonly color: number | null = null) {
    super();
  }
  updateDrawState(tp: TextPaint): void {
    tp.setTextSize(this.appearance.size);
    const tf = tp.getTypeface();
    tp.setTypeface(new Typeface(this.appearance.family ?? tf.family, this.appearance.weight, tf.italic));
    tp.setLetterSpacing(this.appearance.letterSpacing);
    if (this.color != null) tp.setColor(this.color);
  }
}

/** A span the user can tap: link-colored and underlined by default. */
export abstract class ClickableSpan extends CharacterStyle {
  abstract onClick(widget: View): void;
  updateDrawState(tp: TextPaint): void {
    tp.setColor(tp.linkColor);
    tp.underlineText = true;
  }
}

/** A link: opening it hands the URL to the host (Linking / an intent in a real app). */
export class URLSpan extends ClickableSpan {
  constructor(private readonly url: string) {
    super();
  }
  getURL(): string {
    return this.url;
  }
  onClick(widget: View): void {
    widget.context.kernel.send({ type: 'openURL', url: this.url });
  }
}

// ── Spanned ──────────────────────────────────────────────────────────────

type SpanClass<T> = abstract new (...args: any[]) => T;

export interface Spanned {
  length(): number;
  charAt(index: number): string;
  toString(): string;
  subSequence(start: number, end: number): CharSequence;
  getSpans<T>(start: number, end: number, type?: SpanClass<T>): T[];
  getSpanStart(span: unknown): number;
  getSpanEnd(span: unknown): number;
  getSpanFlags(span: unknown): number;
  nextSpanTransition(start: number, limit: number, type?: SpanClass<unknown>): number;
}

export interface Spannable extends Spanned {
  setSpan(what: unknown, start: number, end: number, flags: number): void;
  removeSpan(what: unknown): void;
}

/** java.lang.CharSequence: a plain string or styled text. */
export type CharSequence = string | Spanned;

export const Spanned = {
  SPAN_POINT_MARK_MASK: 0x33,
  SPAN_MARK_MARK: 0x11,
  SPAN_MARK_POINT: 0x12,
  SPAN_POINT_MARK: 0x21,
  SPAN_POINT_POINT: 0x22,
  SPAN_PARAGRAPH: 0x33,
  SPAN_INCLUSIVE_EXCLUSIVE: 0x11,
  SPAN_INCLUSIVE_INCLUSIVE: 0x12,
  SPAN_EXCLUSIVE_EXCLUSIVE: 0x21,
  SPAN_EXCLUSIVE_INCLUSIVE: 0x22,
  SPAN_PRIORITY: 0x00ff0000,
} as const;

export function isSpanned(text: unknown): text is Spanned {
  return typeof text === 'object' && text !== null && typeof (text as Spanned).getSpans === 'function';
}

/** CharSequence.toString() */
export function stringOf(text: CharSequence | null | undefined): string {
  return text == null ? '' : typeof text === 'string' ? text : text.toString();
}

interface SpanRecord {
  what: unknown;
  start: number;
  end: number;
  flags: number;
  order: number;
}

let spanOrder = 0;

abstract class SpannableBase implements Spannable {
  protected text: string;
  protected spans: SpanRecord[] = [];

  constructor(source: CharSequence, start = 0, end?: number) {
    const full = stringOf(source);
    const e = end ?? full.length;
    this.text = full.slice(start, e);
    if (isSpanned(source)) {
      for (const span of source.getSpans(start, e)) {
        const s = Math.max(start, source.getSpanStart(span)) - start;
        const en = Math.min(e, source.getSpanEnd(span)) - start;
        if (en < s) continue;
        this.spans.push({ what: span, start: s, end: en, flags: source.getSpanFlags(span), order: spanOrder++ });
      }
    }
  }

  length(): number {
    return this.text.length;
  }

  charAt(index: number): string {
    return this.text.charAt(index);
  }

  toString(): string {
    return this.text;
  }

  abstract subSequence(start: number, end: number): CharSequence;

  setSpan(what: unknown, start: number, end: number, flags: number): void {
    if (start < 0 || end > this.text.length || start > end) {
      throw new Error(`IndexOutOfBoundsException: setSpan (${start} ... ${end}) ends beyond length ${this.text.length}`);
    }
    const existing = this.spans.find((s) => s.what === what);
    if (existing) {
      existing.start = start;
      existing.end = end;
      existing.flags = flags;
      return;
    }
    this.spans.push({ what, start, end, flags, order: spanOrder++ });
  }

  removeSpan(what: unknown): void {
    this.spans = this.spans.filter((s) => s.what !== what);
  }

  /** Spans overlapping [start, end] (an empty span at a boundary counts), in priority then insertion order. */
  getSpans<T>(start: number, end: number, type?: SpanClass<T>): T[] {
    return this.spans
      .filter((s) => (!type || s.what instanceof type) && overlaps(s, start, end))
      .sort((a, b) => (b.flags & Spanned.SPAN_PRIORITY) - (a.flags & Spanned.SPAN_PRIORITY) || a.order - b.order)
      .map((s) => s.what as T);
  }

  getSpanStart(span: unknown): number {
    return this.spans.find((s) => s.what === span)?.start ?? -1;
  }

  getSpanEnd(span: unknown): number {
    return this.spans.find((s) => s.what === span)?.end ?? -1;
  }

  getSpanFlags(span: unknown): number {
    return this.spans.find((s) => s.what === span)?.flags ?? 0;
  }

  nextSpanTransition(start: number, limit: number, type?: SpanClass<unknown>): number {
    let next = limit;
    for (const s of this.spans) {
      if (type && !(s.what instanceof type)) continue;
      if (s.start > start && s.start < next) next = s.start;
      if (s.end > start && s.end < next) next = s.end;
    }
    return next;
  }

  equals(other: unknown): boolean {
    return isSpanned(other) && other.toString() === this.text;
  }
}

function overlaps(s: SpanRecord, start: number, end: number): boolean {
  if (s.start === s.end) return s.start >= start && s.start <= end;
  if (start === end) return s.start <= start && start < s.end;
  return s.start < end && s.end > start;
}

/** android.text.SpannedString: immutable text with immutable markup. */
export class SpannedString extends SpannableBase {
  override setSpan(): void {
    throw new Error('UnsupportedOperationException: SpannedString is immutable');
  }

  override removeSpan(): void {
    throw new Error('UnsupportedOperationException: SpannedString is immutable');
  }

  override subSequence(start: number, end: number): CharSequence {
    return new SpannedString(this, start, end);
  }

  static override valueOf(source: CharSequence): SpannedString {
    return new SpannedString(source);
  }
}

/** android.text.SpannableString: immutable text with mutable markup. */
export class SpannableString extends SpannableBase {
  override subSequence(start: number, end: number): CharSequence {
    return new SpannableString(this, start, end);
  }

  static override valueOf(source: CharSequence): SpannableString {
    return source instanceof SpannableString ? source : new SpannableString(source);
  }
}

/**
 * android.text.SpannableStringBuilder: editable styled text. Inserting at a
 * span's edge extends it or not according to its flags: a MARK (inclusive)
 * start stays put and a POINT (exclusive) start moves with the insertion;
 * the opposite for the end.
 */
export class SpannableStringBuilder extends SpannableBase {
  constructor(source: CharSequence = '', start = 0, end?: number) {
    super(source, start, end);
  }

  override subSequence(start: number, end: number): CharSequence {
    return new SpannableStringBuilder(this, start, end);
  }

  append(text: CharSequence, what?: unknown, flags: number = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE): this {
    const at = this.text.length;
    this.replace(at, at, text);
    if (what !== undefined) this.setSpan(what, at, this.text.length, flags);
    return this;
  }

  insert(where: number, text: CharSequence): this {
    return this.replace(where, where, text);
  }

  delete(start: number, end: number): this {
    return this.replace(start, end, '');
  }

  clear(): void {
    this.replace(0, this.text.length, '');
  }

  clearSpans(): void {
    this.spans = [];
  }

  /** Replace [start, end) with `text`, carrying `text`'s spans along. */
  replace(start: number, end: number, text: CharSequence): this {
    if (start < 0 || end > this.text.length || start > end) throw new Error(`IndexOutOfBoundsException: replace (${start} ... ${end}) of length ${this.text.length}`);
    const inserted = stringOf(text);
    const delta = inserted.length - (end - start);
    const kept: SpanRecord[] = [];
    for (const s of this.spans) {
      const startPoint = ((s.flags >> 4) & 3) === 2; // POINT start: moves with text inserted at it
      const endPoint = (s.flags & 3) === 2; // POINT end: grows with text inserted at it
      const move = (pos: number, isPoint: boolean) => {
        if (pos < start) return pos;
        if (pos > end) return pos + delta;
        // inside or on the edge of the replaced range
        if (pos === start && start === end) return isPoint ? pos + inserted.length : pos;
        if (pos === end) return isPoint ? start + inserted.length : start;
        return isPoint ? start + inserted.length : start;
      };
      const ns = move(s.start, startPoint);
      const ne = move(s.end, endPoint);
      // Exclusive-exclusive spans emptied by the edit go away.
      if (ns === ne && s.start !== s.end && (s.flags & Spanned.SPAN_POINT_MARK_MASK) === Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) continue;
      kept.push({ ...s, start: Math.min(ns, ne), end: Math.max(ns, ne) });
    }
    this.text = this.text.slice(0, start) + inserted + this.text.slice(end);
    this.spans = kept;
    if (isSpanned(text)) {
      for (const span of text.getSpans(0, inserted.length)) {
        this.spans.push({ what: span, start: start + text.getSpanStart(span), end: start + text.getSpanEnd(span), flags: text.getSpanFlags(span), order: spanOrder++ });
      }
    }
    return this;
  }

  static override valueOf(source: CharSequence): SpannableStringBuilder {
    return new SpannableStringBuilder(source);
  }
}

/** The color a span run draws in, as an RGBA for the render server. */
export function rgbaOf(argb: number): number {
  return Color.toRgba(argb);
}

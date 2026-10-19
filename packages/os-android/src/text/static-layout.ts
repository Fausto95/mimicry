import { hyphenationPoints, layoutText, type Kernel, type Span, type TextLayoutOptions, type TextRun, type TextStyle } from '@mimicry/os-core';
import type { Canvas } from '../graphics/canvas';
import { Color } from '../graphics/color';
import { Looper } from '../os/looper';
import { CharacterStyle, TextPaint, isSpanned, stringOf, type CharSequence } from './spanned';
import type { FontMetrics } from './typeface';

/**
 * android.text.Layout and StaticLayout: styled text broken into lines for a
 * width, with the framework's vertical metrics —
 *
 * - each line is as tall as its tallest font's ascent + descent (rounded to
 *   device pixels like Paint.getFontMetricsInt);
 * - includeFontPadding replaces the first line's ascent with the font's
 *   `top` and the last line's descent with its `bottom`;
 * - line spacing `extra = (descent − ascent) × (mult − 1) + add` goes below
 *   every line but the last.
 *
 * Line breaking, hyphenation and ellipsizing come from os-core's text layout
 * (greedy breaking, Liang hyphenation); BREAK_STRATEGY_BALANCED narrows the
 * width as far as the line count allows. Lines know their character offsets
 * in the source, so hit testing (getOffsetForHorizontal) and ClickableSpans
 * work on them.
 */
export enum Alignment {
  ALIGN_NORMAL = 0,
  ALIGN_OPPOSITE = 1,
  ALIGN_CENTER = 2,
}

export enum TruncateAt {
  START = 0,
  MIDDLE = 1,
  END = 2,
  MARQUEE = 3,
}

export interface LayoutLine {
  /** character offsets in the source: [start, end) including trailing whitespace and the newline */
  start: number;
  end: number;
  /** top and bottom of the line box (bottom includes line spacing extra) */
  top: number;
  bottom: number;
  baseline: number;
  /** negative, like FontMetrics.ascent */
  ascent: number;
  descent: number;
  /** extra spacing at the bottom of the line */
  extra: number;
  width: number;
  ellipsisStart: number;
  ellipsisCount: number;
  runs: Array<TextRun & { offset: number }>;
}

/** Per-segment drawing attributes beyond os-core's TextStyle. */
interface SegmentInfo {
  start: number;
  end: number;
  spans: unknown[];
  paint: TextPaint;
  metrics: FontMetrics;
}

export const Layout = {
  Alignment,
  BREAK_STRATEGY_SIMPLE: 0,
  BREAK_STRATEGY_HIGH_QUALITY: 1,
  BREAK_STRATEGY_BALANCED: 2,
  HYPHENATION_FREQUENCY_NONE: 0,
  HYPHENATION_FREQUENCY_NORMAL: 1,
  HYPHENATION_FREQUENCY_FULL: 2,
  HYPHENATION_FREQUENCY_NORMAL_FAST: 3,
  HYPHENATION_FREQUENCY_FULL_FAST: 4,
  JUSTIFICATION_MODE_NONE: 0,
  JUSTIFICATION_MODE_INTER_WORD: 1,
  DIR_LEFT_TO_RIGHT: 1,
  DIR_RIGHT_TO_LEFT: -1,

  /** The width the text needs on one line per paragraph (the widest paragraph). */
  getDesiredWidth(source: CharSequence, paint: TextPaint, start = 0, end?: number): number {
    const text = stringOf(source).slice(start, end);
    const kernel = Looper.requireMainKernel();
    const spans = buildSpans(isSpanned(source) && start === 0 && end === undefined ? source : text, paint, kernel).spans;
    if (!spans.length) return 0;
    return layoutText(spans, Infinity, {}, kernel.measurer).width;
  },
};

const ELLIPSIS = '…';

function textStyleFor(paint: TextPaint, metrics: FontMetrics, source: SegmentInfo): TextStyle {
  const size = paint.getTextSize();
  return {
    font: paint.cssFont,
    size,
    color: Color.toRgba(paint.getColor()),
    letterSpacing: paint.getLetterSpacing() * size,
    lineHeight: null,
    decoration: (paint.underlineText ? 1 : 0) | (paint.strikeThru ? 2 : 0),
    decorationColor: paint.underlineColor ? Color.toRgba(paint.underlineColor) : null,
    background: paint.bgColor ? Color.toRgba(paint.bgColor) : 0,
    shadow: paint.shadow ? { color: Color.toRgba(paint.shadow.color), dx: paint.shadow.dx, dy: paint.shadow.dy, blur: paint.shadow.radius } : null,
    transform: 'none',
    metrics: { ascent: -metrics.ascent, descent: metrics.descent },
    source,
  };
}

/** The source split at every span transition, each piece with the paint its spans produce. */
function buildSpans(source: CharSequence, base: TextPaint, kernel: Kernel): { spans: Span[]; segments: SegmentInfo[] } {
  const text = stringOf(source);
  const density = kernel.viewport.scale;
  const out: Span[] = [];
  const segments: SegmentInfo[] = [];
  const push = (start: number, end: number, spans: unknown[]) => {
    const paint = new TextPaint(base);
    paint.density = density;
    for (const span of spans) if (span instanceof CharacterStyle) span.updateDrawState(paint);
    const metrics = paint.getTypeface().metrics(paint.getTextSize(), density, kernel.measurer);
    const info: SegmentInfo = { start, end, spans, paint, metrics };
    segments.push(info);
    if (end > start) out.push({ text: text.slice(start, end), style: textStyleFor(paint, metrics, info) });
  };
  if (!isSpanned(source)) {
    push(0, text.length, []);
    return { spans: out, segments };
  }
  let at = 0;
  while (at < text.length) {
    const next = source.nextSpanTransition(at, text.length);
    const spans = source.getSpans(at, next).filter((s) => {
      const st = source.getSpanStart(s);
      const en = source.getSpanEnd(s);
      return st < next && en > at;
    });
    push(at, next, spans);
    at = next;
  }
  if (!text.length) push(0, 0, []);
  return { spans: out, segments };
}

export interface StaticLayoutOptions {
  alignment: Alignment;
  spacingMult: number;
  spacingAdd: number;
  includePad: boolean;
  maxLines: number;
  ellipsize: TruncateAt | null;
  ellipsizedWidth: number;
  breakStrategy: number;
  hyphenationFrequency: number;
  /** a single line that never wraps (TextView.setSingleLine / horizontally scrolling) */
  singleLine: boolean;
}

export class StaticLayout {
  private readonly text: CharSequence;
  private readonly lines: LayoutLine[] = [];
  private readonly height: number;
  private readonly topPadding: number;
  private readonly bottomPadding: number;
  private readonly options: StaticLayoutOptions;

  /** The deprecated constructor: (source, paint, width, align, spacingmult, spacingadd, includepad). */
  constructor(source: CharSequence, paint: TextPaint, width: number, align: Alignment = Alignment.ALIGN_NORMAL, spacingMult = 1, spacingAdd = 0, includePad = true, options: Partial<StaticLayoutOptions> = {}) {
    this.text = source;
    this.paint = paint;
    this.width = Math.max(0, width);
    this.options = {
      alignment: align,
      spacingMult,
      spacingAdd,
      includePad,
      maxLines: Number.MAX_SAFE_INTEGER,
      ellipsize: null,
      ellipsizedWidth: this.width,
      breakStrategy: Layout.BREAK_STRATEGY_SIMPLE,
      hyphenationFrequency: Layout.HYPHENATION_FREQUENCY_NONE,
      singleLine: false,
      ...options,
    };
    const kernel = Looper.requireMainKernel();
    const result = this.build(kernel);
    this.height = result.height;
    this.topPadding = result.topPadding;
    this.bottomPadding = result.bottomPadding;
  }

  readonly paint: TextPaint;
  readonly width: number;

  static readonly Builder = class Builder {
    private alignment = Alignment.ALIGN_NORMAL;
    private spacingMult = 1;
    private spacingAdd = 0;
    private includePad = true;
    private maxLines = Number.MAX_SAFE_INTEGER;
    private ellipsize: TruncateAt | null = null;
    private ellipsizedWidth: number;
    private breakStrategy = Layout.BREAK_STRATEGY_SIMPLE;
    private hyphenation = Layout.HYPHENATION_FREQUENCY_NONE;

    private constructor(private readonly source: CharSequence, private readonly paint: TextPaint, private readonly width: number) {
      this.ellipsizedWidth = width;
    }

    static obtain(source: CharSequence, start: number, end: number, paint: TextPaint, width: number): Builder {
      const sliced = start === 0 && end === stringOf(source).length ? source : isSpanned(source) ? source.subSequence(start, end) : stringOf(source).slice(start, end);
      return new Builder(sliced, paint, width);
    }

    setAlignment(alignment: Alignment): this { this.alignment = alignment; return this; }
    setLineSpacing(spacingAdd: number, spacingMult: number): this { this.spacingAdd = spacingAdd; this.spacingMult = spacingMult; return this; }
    setIncludePad(includePad: boolean): this { this.includePad = includePad; return this; }
    setMaxLines(maxLines: number): this { this.maxLines = maxLines; return this; }
    setEllipsize(ellipsize: TruncateAt | null): this { this.ellipsize = ellipsize; return this; }
    setEllipsizedWidth(width: number): this { this.ellipsizedWidth = width; return this; }
    setBreakStrategy(strategy: number): this { this.breakStrategy = strategy; return this; }
    setHyphenationFrequency(frequency: number): this { this.hyphenation = frequency; return this; }
    setJustificationMode(_mode: number): this { return this; }
    setTextDirection(_dir: unknown): this { return this; }
    setUseLineSpacingFromFallbacks(_use: boolean): this { return this; }

    build(): StaticLayout {
      return new StaticLayout(this.source, this.paint, this.width, this.alignment, this.spacingMult, this.spacingAdd, this.includePad, {
        maxLines: this.maxLines,
        ellipsize: this.ellipsize,
        ellipsizedWidth: this.ellipsizedWidth,
        breakStrategy: this.breakStrategy,
        hyphenationFrequency: this.hyphenation,
      });
    }
  };

  private build(kernel: Kernel): { height: number; topPadding: number; bottomPadding: number } {
    const o = this.options;
    const text = stringOf(this.text);
    const singleLineText = o.singleLine ? text.replace(/\n/g, ' ') : text;
    const source = o.singleLine && isSpanned(this.text) ? this.text : o.singleLine ? singleLineText : this.text;
    const { spans, segments } = buildSpans(source, this.paint, kernel);
    const ellipsize = o.ellipsize === TruncateAt.MARQUEE ? TruncateAt.END : o.ellipsize;
    const maxLines = o.singleLine ? 1 : o.maxLines;
    const options: TextLayoutOptions = {};
    if (ellipsize !== null && maxLines < Number.MAX_SAFE_INTEGER) {
      options.numberOfLines = maxLines;
      options.ellipsizeMode = ellipsize === TruncateAt.START ? 'head' : ellipsize === TruncateAt.MIDDLE ? 'middle' : 'tail';
    }
    const frequency = o.hyphenationFrequency;
    if (frequency !== Layout.HYPHENATION_FREQUENCY_NONE) {
      options.hyphenation = { frequency: frequency === Layout.HYPHENATION_FREQUENCY_FULL || frequency === Layout.HYPHENATION_FREQUENCY_FULL_FAST ? 'full' : 'normal', points: hyphenationPoints };
    }
    let wrapWidth = o.singleLine ? Infinity : this.width;
    if (o.singleLine && ellipsize !== null) wrapWidth = o.ellipsizedWidth;
    let layout = spans.length ? layoutText(spans, wrapWidth, options, kernel.measurer) : null;
    if (layout && o.breakStrategy === Layout.BREAK_STRATEGY_BALANCED && layout.lines.length > 1 && Number.isFinite(wrapWidth) && !layout.truncated) {
      // Narrow the width as far as the line count allows: the lines even out.
      const count = layout.lines.length;
      let lo = 0;
      let hi = wrapWidth;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const trial = layoutText(spans, mid, options, kernel.measurer);
        if (trial.lines.length <= count && !trial.brokeWord) hi = mid;
        else lo = mid;
      }
      layout = layoutText(spans, hi, options, kernel.measurer);
    }
    // Without ellipsizing every line stays in the layout; a TextView clips to its maxLines.
    const laidLines = layout ? layout.lines : [];

    const density = kernel.viewport.scale;
    const baseMetrics = this.paint.getTypeface().metrics(this.paint.getTextSize(), density, kernel.measurer);
    const sourceText = stringOf(source);
    let cursor = 0;
    let y = 0;
    let topPadding = 0;
    let bottomPadding = 0;
    const needMultiply = o.spacingMult !== 1 || o.spacingAdd !== 0;
    const count = laidLines.length || 1;
    for (let i = 0; i < count; i++) {
      const line = laidLines[i];
      const runs = line?.runs ?? [];
      // character offsets: match the line's text against the source
      const start = cursor;
      const mapped: LayoutLine['runs'] = [];
      let ellipsisStart = 0;
      let ellipsisCount = 0;
      let k = cursor;
      for (const run of runs) {
        const runOffset = k;
        let j = 0;
        for (; j < run.text.length; j++) {
          const ch = run.text[j]!;
          if (ch === sourceText[k]) {
            k++;
            continue;
          }
          if (ch === ELLIPSIS) {
            ellipsisStart = k - start;
            const isHead = mapped.length === 0 && j === 0;
            if (isHead) {
              // START: the visible tail is the last characters of the text
              const visible = runs.reduce((n, r) => n + r.text.length, 0) - 1;
              const end = sourceText.length;
              ellipsisCount = Math.max(0, end - start - visible);
              k = start + ellipsisCount;
              ellipsisStart = 0;
            } else {
              ellipsisCount = Math.max(0, sourceText.length - k);
              k = sourceText.length;
            }
            continue;
          }
          if (ch === '-' && j === run.text.length - 1) continue; // an inserted hyphen
          // whitespace os-core collapsed or dropped
          while (k < sourceText.length && sourceText[k] !== ch) k++;
          if (k < sourceText.length) k++;
        }
        mapped.push({ ...run, offset: runOffset });
      }
      // trailing whitespace and the line's newline belong to it
      while (k < sourceText.length && (sourceText[k] === ' ' || sourceText[k] === '\t')) k++;
      if (k < sourceText.length && sourceText[k] === '\n') k++;
      if (i === count - 1) k = sourceText.length;
      cursor = k;

      // vertical metrics: the tallest font on the line
      let ascent = 0;
      let descent = 0;
      let top = 0;
      let bottom = 0;
      const lineSegments = runs.length ? runs.map((r) => (r.style.source as SegmentInfo).metrics) : [segmentMetricsAt(segments, start) ?? baseMetrics];
      for (const m of lineSegments) {
        ascent = Math.min(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
        top = Math.min(top, m.top);
        bottom = Math.max(bottom, m.bottom);
      }
      let above = ascent;
      let below = descent;
      const first = i === 0;
      const last = i === count - 1;
      if (o.includePad) {
        if (first) {
          topPadding = top - above;
          above = top;
        }
        if (last) {
          bottomPadding = bottom - below;
          below = bottom;
        }
      }
      let extra = 0;
      if (needMultiply && !last) {
        const ex = (below - above) * (o.spacingMult - 1) + o.spacingAdd;
        // StaticLayout rounds the extra to whole pixels
        extra = (ex >= 0 ? Math.floor(ex * density + 0.5) : -Math.floor(-ex * density + 0.5)) / density;
      }
      const lineTop = y;
      const baseline = lineTop - above;
      y += below - above + extra;
      this.lines.push({
        start,
        end: k,
        top: lineTop,
        bottom: y,
        baseline,
        ascent: above,
        descent: below,
        extra,
        width: line?.width ?? 0,
        ellipsisStart,
        ellipsisCount,
        runs: mapped,
      });
    }
    return { height: y, topPadding, bottomPadding };
  }

  // ── geometry ────────────────────────────────────────────────────────

  getText(): CharSequence {
    return this.text;
  }

  getPaint(): TextPaint {
    return this.paint;
  }

  getWidth(): number {
    return this.width;
  }

  getEllipsizedWidth(): number {
    return this.options.ellipsizedWidth;
  }

  getHeight(): number {
    return this.height;
  }

  getLineCount(): number {
    return this.lines.length;
  }

  private line(index: number): LayoutLine {
    const l = this.lines[Math.max(0, Math.min(index, this.lines.length - 1))];
    if (!l) throw new Error(`IndexOutOfBoundsException: line ${index}`);
    return l;
  }

  getLineTop(line: number): number {
    return line >= this.lines.length ? this.height : this.line(line).top;
  }

  getLineBottom(line: number): number {
    return this.line(line).bottom;
  }

  /** Bottom without the line spacing extra (Layout.getLineBottom(line, false), API 35). */
  getLineBottomWithoutSpacing(line: number): number {
    const l = this.line(line);
    return l.bottom - l.extra;
  }

  getLineBaseline(line: number): number {
    return this.line(line).baseline;
  }

  getLineAscent(line: number): number {
    return this.line(line).ascent;
  }

  getLineDescent(line: number): number {
    return this.line(line).descent;
  }

  getLineStart(line: number): number {
    return line >= this.lines.length ? stringOf(this.text).length : this.line(line).start;
  }

  getLineEnd(line: number): number {
    return this.line(line).end;
  }

  /** The end without trailing whitespace. */
  getLineVisibleEnd(line: number): number {
    const l = this.line(line);
    const text = stringOf(this.text);
    let end = l.end;
    while (end > l.start && /\s/.test(text[end - 1]!)) end--;
    return end;
  }

  getLineWidth(line: number): number {
    return this.line(line).width;
  }

  getLineMax(line: number): number {
    return this.line(line).width;
  }

  /** x of the line's first glyph, after alignment. */
  getLineLeft(line: number): number {
    const l = this.line(line);
    switch (this.options.alignment) {
      case Alignment.ALIGN_CENTER: return Number.isFinite(this.width) ? (this.width - l.width) / 2 : 0;
      case Alignment.ALIGN_OPPOSITE: return Number.isFinite(this.width) ? this.width - l.width : 0;
      default: return 0;
    }
  }

  getLineRight(line: number): number {
    return this.getLineLeft(line) + this.line(line).width;
  }

  getEllipsisCount(line: number): number {
    return this.line(line).ellipsisCount;
  }

  getEllipsisStart(line: number): number {
    return this.line(line).ellipsisStart;
  }

  getTopPadding(): number {
    return this.topPadding;
  }

  getBottomPadding(): number {
    return this.bottomPadding;
  }

  getAlignment(): Alignment {
    return this.options.alignment;
  }

  getSpacingMultiplier(): number {
    return this.options.spacingMult;
  }

  getSpacingAdd(): number {
    return this.options.spacingAdd;
  }

  getParagraphDirection(_line: number): number {
    return Layout.DIR_LEFT_TO_RIGHT;
  }

  isRtlCharAt(_offset: number): boolean {
    return false;
  }

  getLineForVertical(vertical: number): number {
    for (let i = 0; i < this.lines.length; i++) if (vertical < this.lines[i]!.bottom) return i;
    return Math.max(0, this.lines.length - 1);
  }

  getLineForOffset(offset: number): number {
    for (let i = 0; i < this.lines.length; i++) if (offset < this.lines[i]!.end) return i;
    return Math.max(0, this.lines.length - 1);
  }

  /** The character offset closest to `horiz` on `line`. */
  getOffsetForHorizontal(line: number, horiz: number): number {
    const l = this.line(line);
    const measurer = Looper.requireMainKernel().measurer;
    const x = horiz - this.getLineLeft(line);
    for (const run of l.runs) {
      if (x > run.x + run.width) continue;
      if (x < run.x) return run.offset;
      const s = run.style;
      let prev = 0;
      for (let i = 1; i <= run.text.length; i++) {
        const w = measurer.width(run.text.slice(0, i), s.font, s.letterSpacing);
        if (run.x + w >= x) return run.offset + (x - (run.x + prev) < run.x + w - x ? i - 1 : i);
        prev = w;
      }
      return run.offset + run.text.length;
    }
    return this.getLineVisibleEnd(line);
  }

  /** x of the character at `offset`. */
  getPrimaryHorizontal(offset: number): number {
    const line = this.getLineForOffset(offset);
    const l = this.line(line);
    const measurer = Looper.requireMainKernel().measurer;
    for (const run of l.runs) {
      if (offset >= run.offset && offset <= run.offset + run.text.length) {
        const s = run.style;
        return this.getLineLeft(line) + run.x + measurer.width(run.text.slice(0, offset - run.offset), s.font, s.letterSpacing);
      }
    }
    return this.getLineRight(line);
  }

  /** @internal the laid-out lines */
  get layoutLines(): readonly LayoutLine[] {
    return this.lines;
  }

  /** Draw every line at the canvas origin (the layout's top-left). */
  draw(canvas: Canvas): void {
    this.drawLines(canvas, 0, this.lines.length);
  }

  /** @internal draw lines [first, last) */
  drawLines(canvas: Canvas, first: number, last: number): void {
    const w = canvas.writer;
    let font = '';
    for (let i = first; i < last; i++) {
      const line = this.lines[i]!;
      const lx = this.getLineLeft(i);
      for (const run of line.runs) {
        if (run.style.background && !run.attachment) w.fillRect(lx + run.x, line.top, run.width, line.bottom - line.top - line.extra, run.style.background);
      }
      for (const run of line.runs) {
        if (run.attachment) continue;
        const s = run.style;
        if (s.font !== font) {
          w.font(s.font);
          font = s.font;
        }
        if (s.shadow) w.shadow(s.shadow.color, s.shadow.blur * 2, s.shadow.dx, s.shadow.dy);
        w.text(lx + run.x, line.baseline, s.color, s.letterSpacing, run.text);
        if (s.shadow) w.shadowClear();
        if (s.decoration) {
          // Roboto's post / OS/2 tables: underline 150/2048 below the baseline, 100/2048 thick;
          // strikeout 528/2048 above, 102/2048 thick.
          const color = s.decorationColor ?? s.color;
          if (s.decoration & 1) w.fillRect(lx + run.x, line.baseline + s.size * 0.0732, run.width, Math.max(s.size * 0.0488, 0.5), color);
          if (s.decoration & 2) w.fillRect(lx + run.x, line.baseline - s.size * 0.2578, run.width, Math.max(s.size * 0.0498, 0.5), color);
        }
      }
    }
  }

  /** The spans of type `type` under a point (layout coordinates). */
  spansAt<T>(x: number, y: number, type: abstract new (...args: any[]) => T): T[] {
    if (!isSpanned(this.text) || !this.lines.length) return [];
    const line = this.getLineForVertical(y);
    if (x < this.getLineLeft(line) || x > this.getLineRight(line)) return [];
    const offset = this.getOffsetForHorizontal(line, x);
    const text = this.text;
    return text.getSpans(offset, offset, type).filter((s) => {
      const st = text.getSpanStart(s);
      const en = text.getSpanEnd(s);
      return offset >= st && offset < en || (offset === en && x <= this.getPrimaryHorizontal(en));
    });
  }
}

function segmentMetricsAt(segments: SegmentInfo[], offset: number): FontMetrics | null {
  for (const s of segments) if (offset >= s.start && offset <= s.end) return s.metrics;
  return segments[segments.length - 1]?.metrics ?? null;
}

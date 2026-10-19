import { rgba, withAlpha, type CommandWriter } from '@mimicry/protocol';
import {
  EstimatingTextMeasurer, layoutText, type Kernel, type Rect, type Span, type TextLayout, type TextMeasurer, type TextRun, type TextStyle,
} from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import {
  NSAttributedString as NSAttributedStringCtor, NSAttributedStringKey, NSStringDrawingOptions, type NSAttributedString, type NSAttributes,
  type NSStringDrawingContext,
} from '../foundation/ns-attributed-string';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { NSLineBreakMode, NSParagraphStyle, NSShadow, NSTextAlignment, NSUnderlineStyle } from './ns-paragraph-style';
import { UIColor } from './ui-color';
import { UIFont } from './ui-font';
import { UIGraphicsGetCurrentContext } from './ui-graphics';
import { UITraitCollection } from './ui-trait-collection';

/**
 * UIKit's text system (TextKit, as UILabel and NSStringDrawing use it):
 * attributed string → paragraphs → lines, on os-core's line breaker.
 *
 * What TextKit does beyond os-core's layout and is modeled here:
 * - paragraph styles per paragraph: alignment (natural = left, justified),
 *   indents, line spacing, paragraph spacing, line height multiple and
 *   min/max line height — extra line height goes *above* the glyphs, as in
 *   TextKit (not split around them as React Native does);
 * - line break modes: word or character wrapping, clipping, and head /
 *   middle / tail truncation of the last visible line, where the last
 *   visible line is the container's line limit or the last that fits its
 *   height;
 * - per-run kern, baseline offset, underline / strikethrough styles and
 *   colors, background colors, shadows (NSShadow) and links.
 */
export interface UIKitTextStyle extends TextStyle {
  baselineOffset: number;
  underline: number;
  underlineColor: number | null;
  strikethrough: number;
  strikethroughColor: number | null;
  link: unknown;
}

export interface TextDefaults {
  font: UIFont;
  color: UIColor;
  alignment: NSTextAlignment;
  lineBreakMode: NSLineBreakMode;
}

export interface TextContainer {
  width: number;
  height: number;
  /** 0: unlimited */
  numberOfLines: number;
  /** font size factor (adjustsFontSizeToFitWidth) */
  scale?: number;
  traits?: UITraitCollection;
  /** UILabel: allowsDefaultTighteningForTruncation — accepted, letter spacing is never tightened */
  tighten?: boolean;
}

export interface UITextLine {
  /** left edge of the line in the container (alignment and indents applied) */
  x: number;
  y: number;
  height: number;
  baseline: number;
  width: number;
  runs: TextRun[];
  /** extra space per space character (justified lines) */
  justify: number;
}

export interface UITextLayout {
  lines: UITextLine[];
  /** widest line, indents included */
  width: number;
  height: number;
  truncated: boolean;
  /** the font scale used (adjustsFontSizeToFitWidth) */
  scale: number;
}

const ELLIPSIS = '…';

export function textMeasurer(kernel: Kernel | null = CAEnvironment.kernel): TextMeasurer {
  return kernel?.measurer ?? fallbackMeasurer;
}
const fallbackMeasurer = new EstimatingTextMeasurer();

/** UIKit's default for attributes an NSAttributedString leaves out when drawn on its own. */
export function stringDrawingDefaults(): TextDefaults {
  return {
    font: UIFont.named('Helvetica', 12) ?? UIFont.systemFont(12),
    color: UIColor.black,
    alignment: NSTextAlignment.natural,
    lineBreakMode: NSLineBreakMode.byWordWrapping,
  };
}

// ── attributes → styles ──────────────────────────────────────────────────

function resolveColor(value: unknown, traits: UITraitCollection): number | null {
  if (value instanceof UIColor) return value.resolvedColor(traits).rgba;
  if (typeof value === 'number') return value >>> 0;
  return null;
}

function styleFor(attrs: NSAttributes, defaults: TextDefaults, scale: number, traits: UITraitCollection, kernel: Kernel | null): UIKitTextStyle {
  const base = attrs[NSAttributedStringKey.font] instanceof UIFont ? (attrs[NSAttributedStringKey.font] as UIFont) : defaults.font;
  const font = base._scaled(scale);
  const standIn = font._standIn(kernel);
  const kern = (typeof attrs[NSAttributedStringKey.kern] === 'number' ? (attrs[NSAttributedStringKey.kern] as number) : 0)
    + (typeof attrs[NSAttributedStringKey.tracking] === 'number' ? (attrs[NSAttributedStringKey.tracking] as number) : 0);
  const link = attrs[NSAttributedStringKey.link] ?? null;
  const color = resolveColor(attrs[NSAttributedStringKey.foregroundColor], traits)
    ?? (link ? UIColor.link.resolvedColor(traits).rgba : defaults.color.resolvedColor(traits).rgba);
  const shadowAttr = attrs[NSAttributedStringKey.shadow];
  const shadow = shadowAttr instanceof NSShadow
    ? {
        color: resolveColor(shadowAttr.shadowColor, traits) ?? rgba(0, 0, 0, 1 / 3),
        dx: shadowAttr.shadowOffset.width,
        dy: shadowAttr.shadowOffset.height,
        blur: shadowAttr.shadowBlurRadius,
      }
    : null;
  const underline = typeof attrs[NSAttributedStringKey.underlineStyle] === 'number' ? (attrs[NSAttributedStringKey.underlineStyle] as number) : 0;
  const strike = typeof attrs[NSAttributedStringKey.strikethroughStyle] === 'number' ? (attrs[NSAttributedStringKey.strikethroughStyle] as number) : 0;
  return {
    font: font._css(kernel),
    size: font.pointSize,
    color,
    letterSpacing: kern * scale + (standIn?.tracking ?? 0),
    lineHeight: null,
    decoration: 0,
    decorationColor: null,
    background: resolveColor(attrs[NSAttributedStringKey.backgroundColor], traits) ?? 0,
    shadow,
    transform: 'none',
    metrics: standIn?.metrics ?? null,
    source: null,
    baselineOffset: typeof attrs[NSAttributedStringKey.baselineOffset] === 'number' ? (attrs[NSAttributedStringKey.baselineOffset] as number) : 0,
    underline,
    underlineColor: resolveColor(attrs[NSAttributedStringKey.underlineColor], traits),
    strikethrough: strike,
    strikethroughColor: resolveColor(attrs[NSAttributedStringKey.strikethroughColor], traits),
    link,
  };
}

// ── paragraphs ───────────────────────────────────────────────────────────

interface Paragraph {
  spans: Span[];
  style: NSParagraphStyle;
  /** the style of the paragraph's (possibly empty) text: an empty line still has a height */
  emptyStyle: UIKitTextStyle;
}

const PARAGRAPH_BREAK = /\r\n|[\n\r\u2029]/g;

function paragraphs(str: NSAttributedString, defaults: TextDefaults, scale: number, traits: UITraitCollection, kernel: Kernel | null): Paragraph[] {
  const text = str.string;
  const styles = new Map<NSAttributes, UIKitTextStyle>();
  const style = (attrs: NSAttributes) => {
    let s = styles.get(attrs);
    if (!s) styles.set(attrs, (s = styleFor(attrs, defaults, scale, traits, kernel)));
    return s;
  };
  const runs = str.attributeRuns;
  const attrsAt = (index: number): NSAttributes => {
    for (const r of runs) if (index >= r.range.location && index < r.range.location + r.range.length) return r.attributes;
    return runs[runs.length - 1]?.attributes ?? {};
  };
  const out: Paragraph[] = [];
  let start = 0;
  const push = (end: number, breakAt: number) => {
    const spans: Span[] = [];
    for (const r of runs) {
      const from = Math.max(r.range.location, start);
      const to = Math.min(r.range.location + r.range.length, end);
      if (to > from) spans.push({ text: text.slice(from, to), style: style(r.attributes) });
    }
    const attrs = attrsAt(Math.min(start, Math.max(0, breakAt)));
    const paragraphStyle = attrs[NSAttributedStringKey.paragraphStyle] instanceof NSParagraphStyle
      ? (attrs[NSAttributedStringKey.paragraphStyle] as NSParagraphStyle)
      : null;
    out.push({ spans, style: paragraphStyle ?? DEFAULT_PARAGRAPH, emptyStyle: style(attrs) });
  };
  for (const match of text.matchAll(PARAGRAPH_BREAK)) {
    push(match.index!, match.index!);
    start = match.index! + match[0].length;
  }
  push(text.length, Math.max(0, text.length - 1));
  // A trailing paragraph break ends the text: no extra empty line (UILabel ignores it too).
  if (out.length > 1 && /(\r\n|[\n\r\u2029])$/.test(text)) out.pop();
  return out;
}

const DEFAULT_PARAGRAPH = new NSParagraphStyle();

/** One span per character, sharing the style object: the line breaker then wraps between characters. */
function characterSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) for (const ch of span.text) out.push({ text: ch, style: span.style });
  return out;
}

/** The spans from character `offset` on. */
function sliceSpans(spans: Span[], offset: number): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const span of spans) {
    const end = at + span.text.length;
    if (end > offset) out.push(at >= offset ? span : { text: span.text.slice(offset - at), style: span.style });
    at = end;
  }
  return out;
}

const lineText = (line: { runs: TextRun[] }) => line.runs.map((r) => r.text).join('');

/** Where each laid-out line starts in the paragraph's text (soft-wrap whitespace is dropped by the breaker). */
function lineOffsets(text: string, layout: TextLayout): number[] {
  const offsets: number[] = [];
  let pos = 0;
  layout.lines.forEach((line, i) => {
    if (i > 0) while (pos < text.length && /[ \t ]/.test(text[pos]!)) pos++;
    offsets.push(pos);
    pos += lineText(line).length;
  });
  return offsets;
}

function middleTruncate(spans: Span[], width: number, measurer: TextMeasurer): TextRun[] {
  const chars: Array<{ ch: string; style: TextStyle }> = [];
  for (const s of spans) for (const ch of s.text) if (ch !== '\n') chars.push({ ch, style: s.style });
  const style = chars[0]?.style ?? spans[0]!.style;
  const measure = (list: typeof chars) => {
    let w = 0;
    let i = 0;
    while (i < list.length) {
      let j = i;
      let text = '';
      while (j < list.length && list[j]!.style === list[i]!.style) text += list[j++]!.ch;
      w += measurer.width(text, list[i]!.style.font, list[i]!.style.letterSpacing);
      i = j;
    }
    return w;
  };
  let head = Math.ceil(chars.length / 2);
  let tail = chars.length - head;
  const ellipsis = measurer.width(ELLIPSIS, style.font, style.letterSpacing);
  while (head + tail > 0 && measure(chars.slice(0, head)) + measure(chars.slice(chars.length - tail)) + ellipsis > width) {
    if (head >= tail) head--;
    else tail--;
  }
  const pieces = [...chars.slice(0, head), { ch: ELLIPSIS, style: chars[head]?.style ?? style }, ...chars.slice(chars.length - tail)];
  const runs: TextRun[] = [];
  let x = 0;
  for (let i = 0; i < pieces.length;) {
    let j = i;
    let text = '';
    while (j < pieces.length && pieces[j]!.style === pieces[i]!.style) text += pieces[j++]!.ch;
    const s = pieces[i]!.style;
    const w = measurer.width(text, s.font, s.letterSpacing);
    runs.push({ x, width: w, text, style: s });
    x += w;
    i = j;
  }
  return runs;
}

interface ParagraphLines {
  lines: Array<{ runs: TextRun[]; width: number; ascent: number; descent: number; natural: number; indent: number; available: number }>;
  /** the line could not take all of the paragraph's text (more follows in the layout) */
  offsets: number[];
}

function natural(runs: TextRun[], fallback: TextStyle, measurer: TextMeasurer): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  const styles = runs.length ? runs.map((r) => r.style) : [fallback];
  for (const s of styles) {
    const m = s.metrics ?? measurer.metrics(s.font);
    ascent = Math.max(ascent, m.ascent);
    descent = Math.max(descent, m.descent);
  }
  return { ascent, descent };
}

/** Lay out every line of a paragraph (no line limit). */
function breakParagraph(p: Paragraph, containerWidth: number, mode: NSLineBreakMode, measurer: TextMeasurer): ParagraphLines {
  const ps = p.style;
  const tail = ps.tailIndent;
  const widthFor = (indent: number) => {
    const right = tail > 0 ? tail : containerWidth + tail;
    return Math.max(1, right - indent);
  };
  const spans = mode === NSLineBreakMode.byCharWrapping ? characterSpans(p.spans) : p.spans;
  const text = p.spans.map((s) => s.text).join('');
  const out: ParagraphLines = { lines: [], offsets: [] };
  const push = (runs: TextRun[], indent: number, available: number) => {
    const m = natural(runs, p.emptyStyle, measurer);
    out.lines.push({ runs, width: runs.reduce((w, r) => w + r.width, 0), ...m, natural: m.ascent + m.descent, indent, available });
  };
  if (!text.length) {
    push([], ps.firstLineHeadIndent, widthFor(ps.firstLineHeadIndent));
    out.offsets.push(0);
    return out;
  }
  const firstWidth = widthFor(ps.firstLineHeadIndent);
  const restWidth = widthFor(ps.headIndent);
  const first = layoutText(spans, firstWidth, {}, measurer);
  const firstOffsets = lineOffsets(text, first);
  push(first.lines[0]!.runs, ps.firstLineHeadIndent, firstWidth);
  out.offsets.push(0);
  if (first.lines.length === 1) return out;
  if (firstWidth === restWidth) {
    first.lines.slice(1).forEach((line, i) => {
      push(line.runs, ps.headIndent, restWidth);
      out.offsets.push(firstOffsets[i + 1]!);
    });
    return out;
  }
  // The other lines have another width: lay the rest out again.
  const from = firstOffsets[1]!;
  const restSpans = sliceSpans(spans === p.spans ? p.spans : characterSpans(p.spans), from);
  const rest = layoutText(restSpans, restWidth, {}, measurer);
  const restOffsets = lineOffsets(text.slice(from), rest);
  rest.lines.forEach((line, i) => {
    push(line.runs, ps.headIndent, restWidth);
    out.offsets.push(from + restOffsets[i]!);
  });
  return out;
}

/** Truncate a paragraph's text from `offset` into one line of `width`. */
function truncateLine(p: Paragraph, offset: number, width: number, mode: NSLineBreakMode, measurer: TextMeasurer, more: boolean): TextRun[] {
  const spans = sliceSpans(p.spans, offset);
  if (mode === NSLineBreakMode.byTruncatingMiddle) {
    const all = layoutText(spans, Infinity, {}, measurer);
    if ((all.lines[0]?.width ?? 0) <= width && !more) return all.lines[0]?.runs ?? [];
    return middleTruncate(spans, width, measurer);
  }
  const ellipsizeMode = mode === NSLineBreakMode.byTruncatingHead ? 'head' : 'tail';
  const single = layoutText(spans, width, { numberOfLines: 1, ellipsizeMode }, measurer);
  const line = single.lines[0];
  if (!line) return [];
  if (single.truncated || !more) return line.runs;
  // The paragraph fits, but text follows below: TextKit still marks the cut.
  return appendEllipsis(line.runs, width, measurer);
}

/** `runs` with an ellipsis at the end, dropping characters until it fits `width`. */
function appendEllipsis(runs: TextRun[], width: number, measurer: TextMeasurer): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  const style = out[out.length - 1]?.style;
  if (!style) return out;
  const ellipsis = measurer.width(ELLIPSIS, style.font, style.letterSpacing);
  const total = () => out.reduce((w, r) => w + r.width, 0);
  while (out.length && total() + ellipsis > width) {
    const last = out[out.length - 1]!;
    const chars = Array.from(last.text);
    if (chars.length <= 1) out.pop();
    else {
      last.text = chars.slice(0, -1).join('').trimEnd();
      last.width = measurer.width(last.text, last.style.font, last.style.letterSpacing);
    }
  }
  const x = total();
  out.push({ x, width: ellipsis, text: ELLIPSIS, style: out[out.length - 1]?.style ?? style });
  return out;
}

/** The rest of a paragraph from `offset` on one unwrapped line (byClipping's last line). */
function unwrappedLine(p: Paragraph, offset: number, measurer: TextMeasurer): TextRun[] {
  return layoutText(sliceSpans(p.spans, offset), Infinity, {}, measurer).lines[0]?.runs ?? [];
}

/** Lay out an attributed string in a container. */
export function layoutAttributedString(
  str: NSAttributedString,
  container: TextContainer,
  defaults: TextDefaults,
  kernel: Kernel | null = CAEnvironment.kernel,
): UITextLayout {
  const measurer = textMeasurer(kernel);
  const scale = container.scale ?? 1;
  const traits = container.traits ?? UITraitCollection.current;
  const paras = paragraphs(str, defaults, scale, traits, kernel);
  const limit = container.numberOfLines > 0 ? container.numberOfLines : Infinity;
  const lines: UITextLine[] = [];
  let y = 0;
  let width = 0;
  let truncated = false;
  outer: for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi]!;
    const ps = p.style;
    const mode = str.length && hasParagraphStyle(str) ? ps.lineBreakMode : defaults.lineBreakMode;
    const broken = breakParagraph(p, container.width, mode, measurer);
    if (pi > 0) y += ps.paragraphSpacingBefore;
    for (let li = 0; li < broken.lines.length; li++) {
      const line = broken.lines[li]!;
      let height = line.natural;
      if (ps.lineHeightMultiple > 0) height *= ps.lineHeightMultiple;
      if (ps.minimumLineHeight > 0) height = Math.max(height, ps.minimumLineHeight);
      if (ps.maximumLineHeight > 0) height = Math.min(height, ps.maximumLineHeight);
      const isLastOfText = pi === paras.length - 1 && li === broken.lines.length - 1;
      const fitsHeight = y + height <= container.height + 0.01 || lines.length === 0;
      const moreAfter = !isLastOfText;
      const lastAllowed = lines.length + 1 >= limit || (moreAfter && !fitsNext(y + height + ps.lineSpacing, container.height, broken, li, paras, pi));
      if (!fitsHeight) {
        truncated = true;
        break outer;
      }
      let runs = line.runs;
      let lineWidth = line.width;
      if (lastAllowed && moreAfter) {
        truncated = true;
        if (mode === NSLineBreakMode.byTruncatingTail || mode === NSLineBreakMode.byTruncatingHead || mode === NSLineBreakMode.byTruncatingMiddle) {
          const continues = li < broken.lines.length - 1;
          runs = truncateLine(p, broken.offsets[li]!, line.available, mode, measurer, !continues);
        } else if (mode === NSLineBreakMode.byClipping) {
          runs = unwrappedLine(p, broken.offsets[li]!, measurer);
        }
        lineWidth = runs.reduce((w, r) => w + r.width, 0);
      }
      const alignment = resolveAlignment(hasParagraphStyle(str) ? ps.alignment : defaults.alignment);
      const free = line.available - lineWidth;
      let x = line.indent;
      let justify = 0;
      if (alignment === NSTextAlignment.center) x += free / 2;
      else if (alignment === NSTextAlignment.right) x += free;
      else if (alignment === NSTextAlignment.justified && li < broken.lines.length - 1 && !(lastAllowed && moreAfter)) {
        const spaces = (lineText({ runs }).match(/ /g) ?? []).length;
        if (spaces > 0 && free > 0) justify = free / spaces;
      }
      // Extra line height sits above the glyphs.
      const baseline = y + height - line.descent;
      lines.push({ x, y, height, baseline, width: justify ? line.available : lineWidth, runs, justify });
      width = Math.max(width, x + (justify ? line.available : lineWidth));
      y += height;
      if (lastAllowed) break outer;
      if (li < broken.lines.length - 1) y += ps.lineSpacing;
    }
    if (pi < paras.length - 1) y += ps.lineSpacing + ps.paragraphSpacing;
  }
  return { lines, width, height: y, truncated, scale };
}

/** Will the line after this one still fit the container's height? */
function fitsNext(top: number, containerHeight: number, broken: ParagraphLines, li: number, paras: Paragraph[], pi: number): boolean {
  if (!Number.isFinite(containerHeight)) return true;
  const next = broken.lines[li + 1];
  if (next) return top + next.natural <= containerHeight + 0.01;
  const p = paras[pi + 1];
  if (!p) return true;
  const m = p.emptyStyle.metrics;
  const h = m ? m.ascent + m.descent : p.emptyStyle.size * 1.2;
  return top + p.style.paragraphSpacing + p.style.paragraphSpacingBefore + h <= containerHeight + 0.01;
}

const hasParagraphStyle = (str: NSAttributedString) => str.attributeRuns.some((r) => r.attributes[NSAttributedStringKey.paragraphStyle] instanceof NSParagraphStyle);

/** NSTextAlignment.natural is left in a left-to-right UI. */
export function resolveAlignment(alignment: NSTextAlignment): NSTextAlignment {
  return alignment === NSTextAlignment.natural ? NSTextAlignment.left : alignment;
}

// ── drawing ──────────────────────────────────────────────────────────────

/** The box a line's ink can cover (shadows, italics, underlines). */
export function lineBounds(line: UITextLine, ox: number, oy: number): Rect {
  let extent = 3;
  for (const run of line.runs) {
    const s = run.style as UIKitTextStyle;
    if (s.shadow) extent = Math.max(extent, s.shadow.blur * 2 + Math.max(Math.abs(s.shadow.dx), Math.abs(s.shadow.dy)) + 2);
    if (s.baselineOffset) extent = Math.max(extent, Math.abs(s.baselineOffset) + 3);
  }
  return { x: ox + line.x - extent - 2, y: oy + line.y - extent, w: line.width + extent * 2 + 4, h: line.height + extent * 2 };
}

/** Draw one laid-out line with its top-left container corner at (ox, oy). */
export function drawLine(w: CommandWriter, line: UITextLine, ox: number, oy: number, measurer: TextMeasurer, alpha = 1): void {
  const lx = ox + line.x;
  const top = oy + line.y;
  let shift = 0;
  const pieces: Array<{ x: number; width: number; text: string; style: UIKitTextStyle }> = [];
  for (const run of line.runs) {
    const style = run.style as UIKitTextStyle;
    if (!line.justify) {
      pieces.push({ x: run.x, width: run.width, text: run.text, style });
      continue;
    }
    // Justified: words keep their widths; every space grows.
    let x = run.x + shift;
    for (const part of run.text.split(/( )/)) {
      if (!part) continue;
      const pw = measurer.width(part, style.font, style.letterSpacing);
      pieces.push({ x, width: pw + (part === ' ' ? line.justify : 0), text: part, style });
      x += pw;
      if (part === ' ') {
        x += line.justify;
        shift += line.justify;
      }
    }
  }
  const color = (c: number) => (alpha < 1 ? withAlpha(c, alpha) : c);
  for (const p of pieces) {
    if (p.style.background) w.fillRect(lx + p.x, top, p.width, line.height, color(p.style.background));
  }
  let font = '';
  for (const p of pieces) {
    const s = p.style;
    if (s.font !== font) {
      w.font(s.font);
      font = s.font;
    }
    const baseline = oy + line.baseline - s.baselineOffset;
    if (s.shadow) w.shadow(color(s.shadow.color), s.shadow.blur * 2, s.shadow.dx, s.shadow.dy);
    if (p.text.trim()) w.text(lx + p.x, baseline, color(s.color), s.letterSpacing, p.text);
    if (s.shadow) w.shadowClear();
    if (s.underline) decorate(w, lx + p.x, baseline + s.size * 0.12, p.width, s.size, s.underline, color(s.underlineColor ?? s.color));
    if (s.strikethrough) decorate(w, lx + p.x, baseline - s.size * 0.3, p.width, s.size, s.strikethrough, color(s.strikethroughColor ?? s.color));
  }
}

function decorate(w: CommandWriter, x: number, y: number, width: number, size: number, style: number, color: number): void {
  const thickness = Math.max(1, size / 15) * (style & NSUnderlineStyle.thick ? 2 : 1);
  const pattern = style & 0x0f00;
  const dashes = pattern === NSUnderlineStyle.patternDot ? [thickness, thickness * 2]
    : pattern === NSUnderlineStyle.patternDash ? [thickness * 4, thickness * 2]
      : pattern === NSUnderlineStyle.patternDashDot ? [thickness * 4, thickness * 2, thickness, thickness * 2]
        : pattern === NSUnderlineStyle.patternDashDotDot ? [thickness * 4, thickness * 2, thickness, thickness * 2, thickness, thickness * 2]
          : null;
  const double = (style & 0x0f) === NSUnderlineStyle.double;
  const offsets = double ? [0, thickness * 2] : [0];
  for (const dy of offsets) {
    if (dashes) {
      w.save();
      w.strokeStyle(10, 0, dashes);
      w.pathBegin().moveTo(x, y + dy + thickness / 2).lineTo(x + width, y + dy + thickness / 2);
      w.strokePath(color, thickness, 0, 0);
      w.restore();
    } else {
      w.fillRect(x, y + dy, width, thickness, color);
    }
  }
}

/**
 * One line of text centered on (cx, cy), tail-truncated to `maxWidth`, as
 * one draw item — what controls use for their titles (segments, bar items).
 */
export function drawCenteredText(
  ctx: { item(bounds: Rect, draw: (w: CommandWriter) => void): void },
  text: string,
  font: UIFont,
  color: UIColor,
  cx: number,
  cy: number,
  maxWidth: number,
  traits: UITraitCollection,
  kernel: Kernel | null = CAEnvironment.kernel,
): number {
  if (!text) return 0;
  const str = new NSAttributedStringCtor(text);
  const layout = layoutAttributedString(str, { width: maxWidth, height: Infinity, numberOfLines: 1, traits }, {
    font, color, alignment: NSTextAlignment.left, lineBreakMode: NSLineBreakMode.byTruncatingTail,
  }, kernel);
  const line = layout.lines[0];
  if (!line) return 0;
  const ox = cx - line.width / 2;
  const oy = cy - line.height / 2;
  const measurer = textMeasurer(kernel);
  ctx.item(lineBounds(line, ox, oy), (w) => drawLine(w, line, ox, oy, measurer));
  return line.width;
}

/** Natural one-line width of `text` in `font`. */
export function measureText(text: string, font: UIFont, kernel: Kernel | null = CAEnvironment.kernel): CGSize {
  const layout = layoutAttributedString(new NSAttributedStringCtor(text), { width: Infinity, height: Infinity, numberOfLines: 1 }, {
    font, color: UIColor.black, alignment: NSTextAlignment.left, lineBreakMode: NSLineBreakMode.byClipping,
  }, kernel);
  return { width: layout.width, height: layout.height || font.lineHeight };
}

// ── NSStringDrawing ──────────────────────────────────────────────────────

export function boundingRectOfAttributedString(str: NSAttributedString, size: CGSize, options: number, context: NSStringDrawingContext | null): CGRect {
  const layout = layoutForDrawing(str, size, options, context);
  if (!(options & NSStringDrawingOptions.usesLineFragmentOrigin)) {
    const first = layout.lines[0];
    const ascent = first ? first.baseline - first.y : 0;
    return { origin: { x: 0, y: -ascent }, size: { width: layout.width, height: layout.height } };
  }
  if (context) context.totalBounds = { origin: { x: 0, y: 0 }, size: { width: layout.width, height: layout.height } };
  return { origin: { x: 0, y: 0 }, size: { width: layout.width, height: layout.height } };
}

function layoutForDrawing(str: NSAttributedString, size: CGSize, options: number, context: NSStringDrawingContext | null): UITextLayout {
  const multiline = (options & NSStringDrawingOptions.usesLineFragmentOrigin) !== 0;
  const defaults = stringDrawingDefaults();
  const container: TextContainer = multiline
    ? { width: size.width > 0 ? size.width : Infinity, height: size.height > 0 ? size.height : Infinity, numberOfLines: 0 }
    : { width: Infinity, height: Infinity, numberOfLines: 1 };
  if (options & NSStringDrawingOptions.truncatesLastVisibleLine) defaults.lineBreakMode = NSLineBreakMode.byTruncatingTail;
  let layout = layoutAttributedString(str, container, defaults);
  if (context && context.minimumScaleFactor > 0 && context.minimumScaleFactor < 1 && layout.truncated) {
    layout = shrinkToFit(str, container, defaults, context.minimumScaleFactor);
  }
  if (context) context.actualScaleFactor = layout.scale;
  return layout;
}

/** The largest font scale ≥ `minimum` at which the text fits untruncated (or `minimum`). */
export function shrinkToFit(str: NSAttributedString, container: TextContainer, defaults: TextDefaults, minimum: number): UITextLayout {
  const fits = (scale: number) => {
    const l = layoutAttributedString(str, { ...container, scale }, defaults);
    const tooWide = l.lines.some((line) => line.x + line.width > container.width + 0.01);
    return { layout: l, ok: !l.truncated && !tooWide };
  };
  const full = fits(1);
  if (full.ok) return full.layout;
  const floor = fits(minimum);
  if (!floor.ok) return floor.layout;
  let lo = minimum;
  let hi = 1;
  let best = floor.layout;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const r = fits(mid);
    if (r.ok) {
      lo = mid;
      best = r.layout;
    } else hi = mid;
  }
  return best;
}

export function drawAttributedString(str: NSAttributedString, rect: CGRect, options: number, context: NSStringDrawingContext | null): void {
  const ctx = UIGraphicsGetCurrentContext();
  if (!ctx) return;
  const layout = layoutForDrawing(str, rect.size, options, context);
  const measurer = textMeasurer();
  const multiline = (options & NSStringDrawingOptions.usesLineFragmentOrigin) !== 0;
  // Without usesLineFragmentOrigin the rect's origin is the baseline of the first line.
  const dy = multiline ? 0 : -(layout.lines[0] ? layout.lines[0].baseline - layout.lines[0].y : 0);
  const w = ctx.writer;
  w.save();
  if (multiline && Number.isFinite(rect.size.width) && Number.isFinite(rect.size.height) && rect.size.height > 0) {
    w.clipRect(rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
  }
  for (const line of layout.lines) drawLine(w, line, rect.origin.x, rect.origin.y + dy, measurer);
  w.restore();
}

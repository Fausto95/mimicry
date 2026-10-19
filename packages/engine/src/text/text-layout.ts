import type { TextMeasurer } from './measurer';

/**
 * Attributed-string layout. The engine resolves every line, run and baseline
 * before a single draw command is written, so hosts only ever draw
 * pre-positioned single-line strings.
 */
export interface TextStyle {
  font: string;
  size: number;
  color: number;
  letterSpacing: number;
  lineHeight: number | null;
  /** bit 1 underline, bit 2 line-through */
  decoration: number;
  decorationColor: number | null;
  background: number;
  shadow: { color: number; dx: number; dy: number; blur: number } | null;
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** the host node that produced this span (nested <Text> for press handling) */
  source: unknown;
}

export interface Span {
  text: string;
  style: TextStyle;
}

export interface TextRun {
  x: number;
  width: number;
  text: string;
  style: TextStyle;
}

export interface TextLine {
  y: number;
  height: number;
  baseline: number;
  width: number;
  runs: TextRun[];
}

export interface TextLayout {
  lines: TextLine[];
  width: number;
  height: number;
  truncated: boolean;
}

export interface TextLayoutOptions {
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
}

interface Token {
  text: string;
  style: TextStyle;
  kind: 'word' | 'space' | 'newline';
  width: number;
}

const ELLIPSIS = '…';
// A token is a newline, a whitespace run, a single CJK ideograph (breakable
// anywhere) or a run of everything else.
const TOKEN = /\n|[ \t ]+|[⺀-鿿぀-ヿ가-힯豈-﫿]|[^\s⺀-鿿぀-ヿ가-힯豈-﫿]+/g;

export function applyTextTransform(text: string, transform: TextStyle['transform']): string {
  switch (transform) {
    case 'uppercase': return text.toUpperCase();
    case 'lowercase': return text.toLowerCase();
    case 'capitalize': return text.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
    default: return text;
  }
}

function tokenize(spans: readonly Span[], measurer: TextMeasurer): Token[] {
  const tokens: Token[] = [];
  for (const span of spans) {
    const text = applyTextTransform(span.text, span.style.transform);
    for (const match of text.matchAll(TOKEN)) {
      const value = match[0];
      const kind = value === '\n' ? 'newline' : /^[ \t ]+$/.test(value) ? 'space' : 'word';
      tokens.push({
        text: value,
        style: span.style,
        kind,
        width: kind === 'newline' ? 0 : measurer.width(value, span.style.font, span.style.letterSpacing),
      });
    }
  }
  return tokens;
}

function splitWord(token: Token, available: number, measurer: TextMeasurer): [Token, Token] {
  const chars = Array.from(token.text);
  let lo = 1;
  let hi = chars.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = measurer.width(chars.slice(0, mid).join(''), token.style.font, token.style.letterSpacing);
    if (w <= available) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const head = chars.slice(0, best).join('');
  const tail = chars.slice(best).join('');
  const measure = (t: string) => measurer.width(t, token.style.font, token.style.letterSpacing);
  return [
    { ...token, text: head, width: measure(head) },
    { ...token, text: tail, width: measure(tail) },
  ];
}

/** Greedy line breaking: returns token lines. */
function breakLines(tokens: Token[], maxWidth: number, measurer: TextMeasurer): { lines: Token[][]; endStyles: TextStyle[] } {
  const lines: Token[][] = [];
  const endStyles: TextStyle[] = [];
  let line: Token[] = [];
  let width = 0;
  const finish = (style: TextStyle) => {
    while (line.length && line[line.length - 1]!.kind === 'space') line.pop();
    lines.push(line);
    endStyles.push(style);
    line = [];
    width = 0;
  };
  const queue = tokens.slice();
  for (let i = 0; i < queue.length; i++) {
    const token = queue[i]!;
    if (token.kind === 'newline') {
      finish(token.style);
      continue;
    }
    if (token.kind === 'space') {
      // whitespace at a soft wrap point is dropped
      if (line.length === 0 && lines.length > 0 && queue[i - 1]?.kind !== 'newline') continue;
      line.push(token);
      width += token.width;
      continue;
    }
    if (width + token.width <= maxWidth + 0.01 || maxWidth === Infinity) {
      line.push(token);
      width += token.width;
      continue;
    }
    const hasContent = line.some((t) => t.kind === 'word');
    if (hasContent) {
      finish(token.style);
      i--; // retry this token on the new line
      continue;
    }
    // A single word wider than the line: break by characters.
    const [head, tail] = splitWord(token, maxWidth - width, measurer);
    line.push(head);
    finish(token.style);
    if (tail.text) queue.splice(i + 1, 0, tail);
  }
  const last = tokens[tokens.length - 1];
  if (line.length || last?.kind === 'newline' || lines.length === 0) {
    finish(last?.style ?? tokens[0]!.style);
  }
  return { lines, endStyles };
}

function buildRuns(tokens: Token[], measurer: TextMeasurer): TextRun[] {
  const runs: TextRun[] = [];
  for (const token of tokens) {
    const prev = runs[runs.length - 1];
    if (prev && prev.style === token.style) prev.text += token.text;
    else runs.push({ x: 0, width: 0, text: token.text, style: token.style });
  }
  let x = 0;
  for (const run of runs) {
    run.x = x;
    run.width = measurer.width(run.text, run.style.font, run.style.letterSpacing);
    x += run.width;
  }
  return runs;
}

function ellipsize(tokens: Token[], maxWidth: number, measurer: TextMeasurer, mode: TextLayoutOptions['ellipsizeMode']): Token[] {
  const all = tokens.filter((t) => t.kind !== 'newline').map((t) => ({ ...t }));
  const style = all[all.length - 1]?.style ?? tokens[0]!.style;
  if (mode === 'clip') return all;
  const ellipsisWidth = measurer.width(ELLIPSIS, style.font, style.letterSpacing);
  const total = () => all.reduce((s, t) => s + t.width, 0);
  if (mode === 'head') {
    while (all.length && total() + ellipsisWidth > maxWidth) {
      const first = all[0]!;
      const chars = Array.from(first.text);
      if (chars.length <= 1) all.shift();
      else {
        first.text = chars.slice(1).join('');
        first.width = measurer.width(first.text, first.style.font, first.style.letterSpacing);
      }
    }
    return [{ text: ELLIPSIS, style: all[0]?.style ?? style, kind: 'word', width: ellipsisWidth }, ...all];
  }
  // tail (and middle, approximated as tail)
  while (all.length && total() + ellipsisWidth > maxWidth) {
    const lastToken = all[all.length - 1]!;
    const chars = Array.from(lastToken.text);
    if (chars.length <= 1) all.pop();
    else {
      lastToken.text = chars.slice(0, -1).join('');
      lastToken.width = measurer.width(lastToken.text, lastToken.style.font, lastToken.style.letterSpacing);
    }
  }
  while (all.length && all[all.length - 1]!.kind === 'space') all.pop();
  all.push({ text: ELLIPSIS, style: all[all.length - 1]?.style ?? style, kind: 'word', width: ellipsisWidth });
  return all;
}

export function layoutText(
  spans: readonly Span[],
  maxWidth: number,
  options: TextLayoutOptions,
  measurer: TextMeasurer,
): TextLayout {
  const nonEmpty = spans.filter((s) => s.text.length > 0);
  if (!nonEmpty.length) return { lines: [], width: 0, height: 0, truncated: false };
  const tokens = tokenize(nonEmpty, measurer);
  let { lines: tokenLines, endStyles } = breakLines(tokens, maxWidth, measurer);
  let truncated = false;
  const limit = options.numberOfLines ?? 0;
  if (limit > 0 && tokenLines.length > limit) {
    truncated = true;
    // The last visible line takes all remaining text, then gets ellipsized.
    const rest = tokenLines.slice(limit - 1).flatMap((l, i, arr) =>
      i < arr.length - 1 ? [...l, { text: ' ', style: l[l.length - 1]?.style ?? endStyles[0]!, kind: 'space' as const, width: 0 }] : l,
    );
    rest.forEach((t) => {
      if (t.kind === 'space' && t.width === 0) t.width = measurer.width(' ', t.style.font, t.style.letterSpacing);
    });
    tokenLines = [...tokenLines.slice(0, limit - 1), ellipsize(rest, maxWidth, measurer, options.ellipsizeMode ?? 'tail')];
    endStyles = endStyles.slice(0, limit);
  }

  const lines: TextLine[] = [];
  let y = 0;
  let width = 0;
  tokenLines.forEach((lineTokens, index) => {
    const runs = buildRuns(lineTokens, measurer);
    const styles = runs.length ? runs.map((r) => r.style) : [endStyles[index] ?? nonEmpty[0]!.style];
    let ascent = 0;
    let descent = 0;
    let height = 0;
    for (const style of styles) {
      const m = measurer.metrics(style.font);
      ascent = Math.max(ascent, m.ascent);
      descent = Math.max(descent, m.descent);
      height = Math.max(height, style.lineHeight ?? m.ascent + m.descent);
    }
    // Extra line height is split above and below the glyphs (RN ≥0.72 on both platforms).
    const baseline = y + (height - (ascent + descent)) / 2 + ascent;
    const lineWidth = runs.reduce((s, r) => s + r.width, 0);
    width = Math.max(width, lineWidth);
    lines.push({ y, height, baseline, width: lineWidth, runs });
    y += height;
  });
  return { lines, width, height: y, truncated };
}

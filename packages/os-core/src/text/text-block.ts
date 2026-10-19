// CommonJS package: take the default export so Node's ESM loader and bundlers agree.
import enUs from 'hyphen/en-us';
import type { CSSStyle } from '../graphics/css';
import type { TextLayout, TextLine } from './text-layout';

const { hyphenateSync } = enUs;

/**
 * Where a laid-out paragraph sits inside its text box: horizontal alignment
 * per line, vertical alignment of the block (Android's `textAlignVertical`),
 * and hyphenation points. Painting, hit testing and inline-view placement all
 * go through these so they agree to the pixel.
 */

/** x offset of a line inside the content box for `textAlign`. */
export function lineOffset(align: string, contentWidth: number, line: TextLine): number {
  if (align === 'center') return (contentWidth - line.width) / 2;
  if (align === 'right') return contentWidth - line.width;
  return 0;
}

export type VerticalAlign = 'top' | 'center' | 'bottom';

/**
 * `textAlignVertical` (or its RN 0.71+ alias `verticalAlign`) from a style,
 * normalized; null when unset or 'auto'.
 */
export function verticalAlignOf(style: CSSStyle, props: Record<string, any> = {}): VerticalAlign | null {
  const raw = props.textAlignVertical ?? style.textAlignVertical ?? style.verticalAlign;
  if (raw === 'top' || raw === 'bottom' || raw === 'center') return raw;
  if (raw === 'middle') return 'center';
  return null;
}

/** y offset of the block inside a content box of height `contentHeight`. */
export function blockOffset(align: VerticalAlign | null, contentHeight: number, layout: TextLayout): number {
  const free = contentHeight - layout.height;
  if (free <= 0 || !align || align === 'top') return 0;
  return align === 'center' ? free / 2 : free;
}

const SOFT_HYPHEN = '­';
const pointCache = new Map<string, number[]>();

/**
 * Indices where `word` may break with a hyphen, from Liang's algorithm with
 * the TeX en-US patterns (the `hyphen` package, ISC). Android's Minikin uses
 * the same algorithm and pattern family.
 */
export function hyphenationPoints(word: string): number[] {
  let points = pointCache.get(word);
  if (points) return points;
  points = [];
  if (word.length >= 5) {
    const marked = hyphenateSync(word) as string;
    let index = 0;
    for (const ch of marked) {
      if (ch === SOFT_HYPHEN) points.push(index);
      else index += ch.length;
    }
  }
  if (pointCache.size > 5000) pointCache.clear();
  pointCache.set(word, points);
  return points;
}

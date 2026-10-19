import { Looper } from '../os/looper';
import { TruncateAt } from './static-layout';
import { SpannableStringBuilder, isSpanned, stringOf, type CharSequence } from './spanned';
import type { TextPaint } from './spanned';

/**
 * android.text.TextUtils: the string helpers apps reach for, including
 * ellipsize (fitting text into a width with "…" at the start, middle or
 * end, measured with the kernel's font rasterizer).
 */
const ELLIPSIS = '…';

export const TextUtils = {
  TruncateAt,

  isEmpty(text: CharSequence | null | undefined): boolean {
    return text == null || stringOf(text).length === 0;
  },

  equals(a: CharSequence | null | undefined, b: CharSequence | null | undefined): boolean {
    if (a == null || b == null) return a == b;
    return stringOf(a) === stringOf(b);
  },

  isDigitsOnly(text: CharSequence): boolean {
    return /^\d*$/.test(stringOf(text));
  },

  getTrimmedLength(text: CharSequence): number {
    return stringOf(text).trim().length;
  },

  join(delimiter: CharSequence, tokens: Iterable<unknown>): string {
    return Array.from(tokens, (t) => String(t)).join(stringOf(delimiter));
  },

  split(text: string, expression: string): string[] {
    if (!text.length) return [];
    return text.split(new RegExp(expression));
  },

  /** Concatenate, keeping spans when any part has them. */
  concat(...parts: CharSequence[]): CharSequence {
    if (!parts.some(isSpanned)) return parts.map(stringOf).join('');
    const out = new SpannableStringBuilder();
    for (const p of parts) out.append(p);
    return out;
  },

  htmlEncode(text: string): string {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  },

  /**
   * The text shortened with an ellipsis so it measures at most `avail` with
   * `paint` (unchanged when it fits). START keeps the end, END the start,
   * MIDDLE both ends.
   */
  ellipsize(text: CharSequence, paint: TextPaint, avail: number, where: TruncateAt): string {
    const s = stringOf(text);
    const measurer = Looper.requireMainKernel().measurer;
    const font = paint.cssFont;
    const spacing = paint.getLetterSpacing() * paint.getTextSize();
    const width = (t: string) => measurer.width(t, font, spacing);
    if (width(s) <= avail) return s;
    const chars = Array.from(s);
    const fits = (keep: number) => {
      const candidate = shorten(chars, keep, where);
      return width(candidate) <= avail;
    };
    // the most characters that fit next to the ellipsis
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    if (lo === 0 && width(ELLIPSIS) > avail) return '';
    return shorten(chars, lo, where);
  },
};

function shorten(chars: string[], keep: number, where: TruncateAt): string {
  if (where === TruncateAt.START) return ELLIPSIS + chars.slice(chars.length - keep).join('');
  if (where === TruncateAt.MIDDLE) {
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    return chars.slice(0, head).join('').trimEnd() + ELLIPSIS + (tail ? chars.slice(chars.length - tail).join('').trimStart() : '');
  }
  return chars.slice(0, keep).join('').trimEnd() + ELLIPSIS;
}

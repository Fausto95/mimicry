import type { CGPoint, CGRect, CGSize } from '../core-graphics/geometry';
import { boundingRectOfAttributedString, drawAttributedString } from '../uikit/text-system';

/**
 * NSAttributedString and NSMutableAttributedString: a string with
 * attribute runs. Indices and lengths count UTF-16 code units, like
 * NSString (and JavaScript strings). The drawing additions UIKit makes
 * (NSStringDrawing: size(), boundingRect(with:options:context:), draw) lay
 * the string out with the UIKit text system (text-system.ts).
 */
export interface NSRange {
  location: number;
  length: number;
}

export const NSNotFound = Number.MAX_SAFE_INTEGER;
export const NSMakeRange = (location: number, length: number): NSRange => ({ location, length });
export const NSMaxRange = (r: NSRange) => r.location + r.length;

export enum NSAttributedStringKey {
  font = 'NSFont',
  foregroundColor = 'NSColor',
  backgroundColor = 'NSBackgroundColor',
  kern = 'NSKern',
  tracking = 'NSTracking',
  paragraphStyle = 'NSParagraphStyle',
  underlineStyle = 'NSUnderline',
  underlineColor = 'NSUnderlineColor',
  strikethroughStyle = 'NSStrikethrough',
  strikethroughColor = 'NSStrikethroughColor',
  strokeWidth = 'NSStrokeWidth',
  strokeColor = 'NSStrokeColor',
  shadow = 'NSShadow',
  baselineOffset = 'NSBaselineOffset',
  link = 'NSLink',
  ligature = 'NSLigature',
  obliqueness = 'NSObliqueness',
  expansion = 'NSExpansion',
  attachment = 'NSAttachment',
}

export type NSAttributes = Readonly<Partial<Record<string, unknown>>>;

export enum NSStringDrawingOptions {
  usesLineFragmentOrigin = 1 << 0,
  usesFontLeading = 1 << 1,
  usesDeviceMetrics = 1 << 3,
  truncatesLastVisibleLine = 1 << 5,
}

export enum NSAttributedStringEnumerationOptions { reverse = 1 << 1, longestEffectiveRangeNotRequired = 1 << 20 }

/** NSStringDrawingContext: minimumScaleFactor in, actualScaleFactor out. */
export class NSStringDrawingContext {
  minimumScaleFactor = 0;
  actualScaleFactor = 1;
  totalBounds: CGRect = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
}

interface Run {
  length: number;
  attrs: NSAttributes;
}

const sameAttributes = (a: NSAttributes, b: NSAttributes) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

export class NSAttributedString {
  protected _string: string;
  protected runs: Run[];

  constructor(string?: string, attributes?: NSAttributes);
  constructor(attributedString: NSAttributedString);
  constructor(source: string | NSAttributedString = '', attributes: NSAttributes = {}) {
    if (source instanceof NSAttributedString) {
      this._string = source._string;
      this.runs = source.runs.map((r) => ({ ...r }));
    } else {
      this._string = source;
      this.runs = source.length ? [{ length: source.length, attrs: { ...attributes } }] : [];
    }
  }

  get string(): string {
    return this._string;
  }

  get length(): number {
    return this._string.length;
  }

  /** The attribute runs in order (Mimicry: what the text system lays out). */
  get attributeRuns(): ReadonlyArray<{ range: NSRange; attributes: NSAttributes }> {
    let at = 0;
    return this.runs.map((r) => {
      const range = { location: at, length: r.length };
      at += r.length;
      return { range, attributes: r.attrs };
    });
  }

  private runAt(index: number): { run: Run; start: number } {
    if (index < 0 || index >= this._string.length) throw new RangeError(`NSAttributedString: index ${index} out of bounds (length ${this._string.length})`);
    let start = 0;
    for (const run of this.runs) {
      if (index < start + run.length) return { run, start };
      start += run.length;
    }
    throw new RangeError('NSAttributedString: inconsistent runs');
  }

  attributes(at: number, effectiveRange?: { current: NSRange }): NSAttributes {
    const { run, start } = this.runAt(at);
    if (effectiveRange) effectiveRange.current = { location: start, length: run.length };
    return run.attrs;
  }

  attribute(name: string, at: number, effectiveRange?: { current: NSRange }): unknown {
    return this.attributes(at, effectiveRange)[name] ?? null;
  }

  /** enumerateAttributes(in:options:using:) */
  enumerateAttributes(range: NSRange, options: number, block: (attrs: NSAttributes, range: NSRange, stop: { current: boolean }) => void): void {
    const pieces: Array<[NSAttributes, NSRange]> = [];
    const end = NSMaxRange(range);
    for (const { range: r, attributes } of this.attributeRuns) {
      const from = Math.max(r.location, range.location);
      const to = Math.min(NSMaxRange(r), end);
      if (to > from) pieces.push([attributes, { location: from, length: to - from }]);
    }
    if (options & NSAttributedStringEnumerationOptions.reverse) pieces.reverse();
    const stop = { current: false };
    for (const [attrs, r] of pieces) {
      block(attrs, r, stop);
      if (stop.current) break;
    }
  }

  /** enumerateAttribute(_:in:options:using:) — ranges merge where the value is the same */
  enumerateAttribute(name: string, range: NSRange, options: number, block: (value: unknown, range: NSRange, stop: { current: boolean }) => void): void {
    const merged: Array<[unknown, NSRange]> = [];
    this.enumerateAttributes(range, 0, (attrs, r) => {
      const value = attrs[name] ?? null;
      const last = merged[merged.length - 1];
      if (last && last[0] === value && NSMaxRange(last[1]) === r.location) last[1] = { location: last[1].location, length: last[1].length + r.length };
      else merged.push([value, r]);
    });
    if (options & NSAttributedStringEnumerationOptions.reverse) merged.reverse();
    const stop = { current: false };
    for (const [value, r] of merged) {
      block(value, r, stop);
      if (stop.current) break;
    }
  }

  attributedSubstring(from: NSRange): NSAttributedString {
    if (from.location < 0 || NSMaxRange(from) > this.length) throw new RangeError('NSAttributedString.attributedSubstring: range out of bounds');
    const out = new NSAttributedString(this._string.slice(from.location, NSMaxRange(from)));
    out.runs = [];
    this.enumerateAttributes(from, 0, (attrs, r) => out.runs.push({ length: r.length, attrs }));
    return out;
  }

  isEqual(other: NSAttributedString | null): boolean {
    if (!other || other._string !== this._string || other.runs.length !== this.runs.length) return false;
    return this.runs.every((r, i) => r.length === other.runs[i]!.length && sameAttributes(r.attrs, other.runs[i]!.attrs));
  }

  copy(): NSAttributedString {
    return new NSAttributedString(this);
  }

  mutableCopy(): NSMutableAttributedString {
    return new NSMutableAttributedString(this);
  }

  // ── NSStringDrawing (UIKit) ───────────────────────────────────────────

  /** size(): the size of one unconstrained line per paragraph. */
  size(): CGSize {
    return this.boundingRect({ width: Infinity, height: Infinity }, NSStringDrawingOptions.usesLineFragmentOrigin, null).size;
  }

  /**
   * boundingRect(with:options:context:): without usesLineFragmentOrigin the
   * string is measured as one line (UIKit's behavior), its origin on the
   * baseline. Sizes are not rounded (UIKit leaves ceil-ing to callers).
   */
  boundingRect(size: CGSize, options: number, context: NSStringDrawingContext | null): CGRect {
    return boundingRectOfAttributedString(this, size, options, context);
  }

  /** draw(at:) — one line per paragraph, top-left at `point`, into the current graphics context. */
  drawAt(point: CGPoint): void {
    drawAttributedString(this, { origin: point, size: { width: Infinity, height: Infinity } }, NSStringDrawingOptions.usesLineFragmentOrigin, null);
  }

  /** draw(in:) — wrapped within `rect`, into the current graphics context. */
  drawIn(rect: CGRect): void {
    drawAttributedString(this, rect, NSStringDrawingOptions.usesLineFragmentOrigin, null);
  }

  /** draw(with:options:context:) */
  draw(rect: CGRect, options: number, context: NSStringDrawingContext | null): void {
    drawAttributedString(this, rect, options, context);
  }
}

export class NSMutableAttributedString extends NSAttributedString {
  private editing = 0;

  beginEditing(): void {
    this.editing++;
  }

  endEditing(): void {
    this.editing = Math.max(0, this.editing - 1);
  }

  /** Split runs so `range`'s bounds fall between runs; returns the indices of the runs inside it. */
  private isolate(range: NSRange): [number, number] {
    const end = NSMaxRange(range);
    if (range.location < 0 || end > this.length) throw new RangeError(`NSMutableAttributedString: range {${range.location}, ${range.length}} out of bounds (length ${this.length})`);
    const split = (index: number) => {
      let start = 0;
      for (let i = 0; i < this.runs.length; i++) {
        const run = this.runs[i]!;
        if (index === start) return i;
        if (index < start + run.length) {
          this.runs.splice(i, 1, { length: index - start, attrs: run.attrs }, { length: start + run.length - index, attrs: run.attrs });
          return i + 1;
        }
        start += run.length;
      }
      return this.runs.length;
    };
    const first = split(range.location);
    const last = split(end);
    return [first, last];
  }

  private normalize(): void {
    const out: Run[] = [];
    for (const run of this.runs) {
      if (run.length <= 0) continue;
      const prev = out[out.length - 1];
      if (prev && sameAttributes(prev.attrs, run.attrs)) prev.length += run.length;
      else out.push({ ...run });
    }
    this.runs = out;
  }

  private mapAttributes(range: NSRange, fn: (attrs: NSAttributes) => NSAttributes): void {
    if (range.length === 0) return;
    const [first, last] = this.isolate(range);
    for (let i = first; i < last; i++) this.runs[i] = { length: this.runs[i]!.length, attrs: fn(this.runs[i]!.attrs) };
    this.normalize();
  }

  setAttributes(attributes: NSAttributes | null, range: NSRange): void {
    this.mapAttributes(range, () => ({ ...(attributes ?? {}) }));
  }

  addAttribute(name: string, value: unknown, range: NSRange): void {
    this.mapAttributes(range, (attrs) => ({ ...attrs, [name]: value }));
  }

  addAttributes(attributes: NSAttributes, range: NSRange): void {
    this.mapAttributes(range, (attrs) => ({ ...attrs, ...attributes }));
  }

  removeAttribute(name: string, range: NSRange): void {
    this.mapAttributes(range, (attrs) => {
      const { [name]: _removed, ...rest } = attrs;
      return rest;
    });
  }

  /** replaceCharacters(in:with:) — a plain string takes the attributes of the first replaced character. */
  replaceCharacters(range: NSRange, replacement: string | NSAttributedString): void {
    const end = NSMaxRange(range);
    if (range.location < 0 || end > this.length) throw new RangeError('NSMutableAttributedString.replaceCharacters: range out of bounds');
    let inserted: Run[];
    let text: string;
    if (replacement instanceof NSAttributedString) {
      text = replacement.string;
      inserted = replacement.attributeRuns.map((r) => ({ length: r.range.length, attrs: r.attributes }));
    } else {
      text = replacement;
      const at = this.length === 0 ? null : Math.min(range.location, this.length - 1);
      const attrs = at === null ? {} : range.length === 0 && range.location > 0 ? this.attributes(range.location - 1) : this.attributes(at);
      inserted = text.length ? [{ length: text.length, attrs }] : [];
    }
    const [first, last] = this.isolate(range);
    this.runs.splice(first, last - first, ...inserted);
    this._string = this._string.slice(0, range.location) + text + this._string.slice(end);
    this.normalize();
  }

  deleteCharacters(range: NSRange): void {
    this.replaceCharacters(range, '');
  }

  insert(attributedString: NSAttributedString, at: number): void {
    this.replaceCharacters({ location: at, length: 0 }, attributedString);
  }

  append(attributedString: NSAttributedString): void {
    this.insert(attributedString, this.length);
  }

  setAttributedString(attributedString: NSAttributedString): void {
    this.replaceCharacters({ location: 0, length: this.length }, attributedString);
  }

  /** mutableString's setString / appending, as a plain string edit */
  replaceString(text: string): void {
    this.replaceCharacters({ location: 0, length: this.length }, text);
  }
}

import type { Kernel, TextMeasurer } from '@mimicry/os-core';
import { androidKit } from '../theme';

/**
 * android.graphics.Typeface: a font family, weight and slant. The system
 * families resolve to Roboto (which Mimicry ships), 'serif' to Noto Serif
 * and 'monospace' to Roboto Mono, as on a Pixel; `sans-serif-medium` and
 * friends imply their weight. Custom fonts load on the kernel
 * (createFromAsset / createFromFile); text measures with the fallback
 * until the font arrives, then TextViews lay out again.
 *
 * Line metrics follow the framework: Roboto's hhea ascent/descent and its
 * bounding box for the font padding (top/bottom), rounded to whole device
 * pixels the way Paint.getFontMetricsInt rounds them.
 */
export interface FontMetrics {
  /** negative, from the baseline (dp) */
  top: number;
  ascent: number;
  descent: number;
  bottom: number;
  leading: number;
}

/** Roboto's metrics per em: hhea ascender/descender, head yMax/yMin (units per em 2048). */
const ROBOTO = { ascent: -1900 / 2048, descent: 500 / 2048, top: -2163 / 2048, bottom: 555 / 2048 };

const SYSTEM_FAMILIES: Record<string, { family: string; weight?: number }> = {
  'sans-serif': { family: 'sans-serif' },
  'sans-serif-thin': { family: 'sans-serif', weight: 100 },
  'sans-serif-light': { family: 'sans-serif', weight: 300 },
  'sans-serif-medium': { family: 'sans-serif', weight: 500 },
  'sans-serif-black': { family: 'sans-serif', weight: 900 },
  'sans-serif-condensed': { family: 'sans-serif-condensed' },
  'sans-serif-condensed-light': { family: 'sans-serif-condensed', weight: 300 },
  'sans-serif-condensed-medium': { family: 'sans-serif-condensed', weight: 500 },
  'google-sans': { family: 'sans-serif' },
  roboto: { family: 'sans-serif' },
  serif: { family: 'serif' },
  monospace: { family: 'monospace' },
};

export class Typeface {
  static readonly NORMAL = 0;
  static readonly BOLD = 1;
  static readonly ITALIC = 2;
  static readonly BOLD_ITALIC = 3;

  static readonly DEFAULT = new Typeface('sans-serif', 400, false);
  static readonly DEFAULT_BOLD = new Typeface('sans-serif', 700, false);
  static readonly SANS_SERIF = new Typeface('sans-serif', 400, false);
  static readonly SERIF = new Typeface('serif', 400, false);
  static readonly MONOSPACE = new Typeface('monospace', 400, false);

  constructor(readonly family: string, readonly weight: number, readonly italic: boolean) {}

  /**
   * Typeface.create(familyName | Typeface, style) and the API 28 overload
   * Typeface.create(Typeface, weight, italic).
   */
  static create(family: string | Typeface | null, style: number): Typeface;
  static create(family: Typeface | null, weight: number, italic: boolean): Typeface;
  static create(family: string | Typeface | null, styleOrWeight: number, italic?: boolean): Typeface {
    const base = family instanceof Typeface ? family : Typeface.resolveFamily(family);
    if (italic !== undefined) return new Typeface(base.family, Math.max(1, Math.min(1000, styleOrWeight)), italic);
    const style = styleOrWeight;
    // BOLD on a family that already has a weight adds 300, like the framework's synthetic bold pick.
    const weight = style & Typeface.BOLD ? Math.min(1000, Math.max(700, base.weight + 300)) : base.weight;
    return new Typeface(base.family, weight, (style & Typeface.ITALIC) !== 0);
  }

  /** Kept for callers of the earlier Mimicry API. */
  static createWeighted(family: Typeface, weight: number, italic: boolean): Typeface {
    return Typeface.create(family, weight, italic);
  }

  static defaultFromStyle(style: number): Typeface {
    return Typeface.create(Typeface.DEFAULT, style);
  }

  private static resolveFamily(name: string | null): Typeface {
    if (!name) return Typeface.DEFAULT;
    const known = SYSTEM_FAMILIES[name.toLowerCase()];
    if (known) return new Typeface(known.family, known.weight ?? 400, false);
    return new Typeface(name, 400, false);
  }

  /**
   * Typeface.createFromAsset / createFromFile: register a font file with the
   * kernel under `family` (the file name by default) and return its typeface.
   */
  static createFromAsset(context: { kernel: Kernel }, path: string, family?: string, descriptors: { weight?: number; italic?: boolean } = {}): Typeface {
    const name = family ?? path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    void context.kernel.loadFont(name, path, { weight: descriptors.weight ? String(descriptors.weight) : undefined, style: descriptors.italic ? 'italic' : undefined });
    return new Typeface(name, descriptors.weight ?? 400, descriptors.italic ?? false);
  }

  static createFromFile(context: { kernel: Kernel }, path: string, family?: string): Typeface {
    return Typeface.createFromAsset(context, path, family);
  }

  getStyle(): number {
    return (this.isBold() ? Typeface.BOLD : 0) | (this.italic ? Typeface.ITALIC : 0);
  }

  getWeight(): number {
    return this.weight;
  }

  isBold(): boolean {
    return this.weight >= 600;
  }

  isItalic(): boolean {
    return this.italic;
  }

  /** Is this one of the families drawn with Roboto (whose metrics we know)? */
  get isRoboto(): boolean {
    return this.family === 'sans-serif' || this.family === 'sans-serif-condensed' || /^roboto$/i.test(this.family);
  }

  /** The CSS font the measurer and the host draw with, at `size` dp. */
  css(size: number): string {
    const family = this.family === 'sans-serif' ? undefined : this.family === 'sans-serif-condensed' ? 'sans-serif-condensed' : this.family;
    return `${this.italic ? 'italic ' : ''}${this.weight} ${Math.round(size * 100) / 100}px ${androidKit.fontStack(family, true)}`;
  }

  /**
   * Paint.getFontMetricsInt at `size` dp on a display of `density`: metrics
   * rounded to device pixels (top floored, ascent/descent rounded, bottom
   * ceiled), returned in dp.
   */
  metrics(size: number, density: number, measurer: TextMeasurer | null): FontMetrics {
    const px = size * density;
    let em = ROBOTO;
    if (!this.isRoboto && measurer) {
      const m = measurer.metrics(this.css(size));
      em = { ascent: -m.ascent / size, descent: m.descent / size, top: -m.ascent / size, bottom: m.descent / size };
    }
    return {
      top: Math.floor(em.top * px) / density,
      ascent: Math.round(em.ascent * px) / density,
      descent: Math.round(em.descent * px) / density,
      bottom: Math.ceil(em.bottom * px) / density,
      leading: 0,
    };
  }

  equals(other: Typeface | null): boolean {
    return !!other && other.family === this.family && other.weight === this.weight && other.italic === this.italic;
  }

  toString(): string {
    return `Typeface(${this.family} ${this.weight}${this.italic ? ' italic' : ''})`;
  }
}

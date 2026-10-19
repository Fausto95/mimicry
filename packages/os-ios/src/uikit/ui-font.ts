import type { FontMetrics, Kernel } from '@mimicry/os-core';
import { iosKit } from '../theme';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { UIContentSizeCategory, UITraitCollection } from './ui-trait-collection';

/**
 * UIFont, UIFontDescriptor and UIFontMetrics.
 *
 * The system font is SF Pro; with the bundled fonts (deterministic
 * screenshots) Inter stands in for it, corrected by the kit's tracking and
 * SF's line metrics so a label occupies the same space: lineHeight is
 * 1.193 em, ascender 0.952 em, descender −0.241 em, capHeight 0.705 em and
 * xHeight 0.526 em, as UIFont reports for SF Pro. Named fonts use the
 * metrics the host's rasterizer measures.
 *
 * Dynamic Type sizes are Apple's table for every content size category.
 * monospacedDigitSystemFont is drawn with the proportional face (a canvas
 * font string cannot request tabular figures).
 */
export enum UIFontWeight {
  ultraLight = -0.8,
  thin = -0.6,
  light = -0.4,
  regular = 0,
  medium = 0.23,
  semibold = 0.3,
  bold = 0.4,
  heavy = 0.56,
  black = 0.62,
}

export enum UIFontTextStyle {
  largeTitle = 'UICTFontTextStyleTitle0',
  title1 = 'UICTFontTextStyleTitle1',
  title2 = 'UICTFontTextStyleTitle2',
  title3 = 'UICTFontTextStyleTitle3',
  headline = 'UICTFontTextStyleHeadline',
  body = 'UICTFontTextStyleBody',
  callout = 'UICTFontTextStyleCallout',
  subheadline = 'UICTFontTextStyleSubhead',
  footnote = 'UICTFontTextStyleFootnote',
  caption1 = 'UICTFontTextStyleCaption1',
  caption2 = 'UICTFontTextStyleCaption2',
}

export enum UIFontDesign { default = 'NSCTFontUIFontDesignDefault', rounded = 'NSCTFontUIFontDesignRounded', monospaced = 'NSCTFontUIFontDesignMonospaced', serif = 'NSCTFontUIFontDesignSerif' }

/** UIFontDescriptor.SymbolicTraits */
export enum UIFontDescriptorSymbolicTraits {
  traitItalic = 1 << 0,
  traitBold = 1 << 1,
  traitExpanded = 1 << 5,
  traitCondensed = 1 << 6,
  traitMonoSpace = 1 << 10,
  traitTightLeading = 1 << 15,
  traitLooseLeading = 1 << 16,
}

const CATEGORIES = [
  UIContentSizeCategory.extraSmall, UIContentSizeCategory.small, UIContentSizeCategory.medium, UIContentSizeCategory.large,
  UIContentSizeCategory.extraLarge, UIContentSizeCategory.extraExtraLarge, UIContentSizeCategory.extraExtraExtraLarge,
  UIContentSizeCategory.accessibilityMedium, UIContentSizeCategory.accessibilityLarge, UIContentSizeCategory.accessibilityExtraLarge,
  UIContentSizeCategory.accessibilityExtraExtraLarge, UIContentSizeCategory.accessibilityExtraExtraExtraLarge,
] as string[];

/** Apple's Dynamic Type sizes (pt) per category, xSmall … AX5, and each style's weight. */
const DYNAMIC_TYPE: Record<UIFontTextStyle, { sizes: number[]; weight: UIFontWeight }> = {
  [UIFontTextStyle.largeTitle]: { sizes: [31, 32, 33, 34, 36, 38, 40, 44, 48, 52, 56, 60], weight: UIFontWeight.regular },
  [UIFontTextStyle.title1]: { sizes: [25, 26, 27, 28, 30, 32, 34, 38, 43, 48, 53, 58], weight: UIFontWeight.regular },
  [UIFontTextStyle.title2]: { sizes: [19, 20, 21, 22, 24, 26, 28, 34, 39, 44, 50, 56], weight: UIFontWeight.regular },
  [UIFontTextStyle.title3]: { sizes: [17, 18, 19, 20, 22, 24, 26, 31, 37, 43, 49, 55], weight: UIFontWeight.regular },
  [UIFontTextStyle.headline]: { sizes: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53], weight: UIFontWeight.semibold },
  [UIFontTextStyle.body]: { sizes: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53], weight: UIFontWeight.regular },
  [UIFontTextStyle.callout]: { sizes: [13, 14, 15, 16, 18, 20, 22, 26, 32, 38, 44, 51], weight: UIFontWeight.regular },
  [UIFontTextStyle.subheadline]: { sizes: [12, 13, 14, 15, 17, 19, 21, 25, 30, 36, 42, 49], weight: UIFontWeight.regular },
  [UIFontTextStyle.footnote]: { sizes: [12, 12, 12, 13, 15, 17, 19, 23, 27, 33, 38, 44], weight: UIFontWeight.regular },
  [UIFontTextStyle.caption1]: { sizes: [11, 11, 11, 12, 14, 16, 18, 22, 26, 32, 37, 43], weight: UIFontWeight.regular },
  [UIFontTextStyle.caption2]: { sizes: [11, 11, 11, 11, 13, 15, 17, 20, 24, 29, 34, 41], weight: UIFontWeight.regular },
};

/** Dynamic Type size of a text style at a content size category. */
export function dynamicTypeSize(style: UIFontTextStyle, category: string): number {
  const entry = DYNAMIC_TYPE[style];
  const at = CATEGORIES.indexOf(category);
  return entry.sizes[at < 0 ? 3 : at]!;
}

/** UIFont.Weight → CSS weight (100…900). */
export function cssWeight(weight: number): number {
  const table: Array<[number, number]> = [
    [UIFontWeight.ultraLight, 100], [UIFontWeight.thin, 200], [UIFontWeight.light, 300], [UIFontWeight.regular, 400],
    [UIFontWeight.medium, 500], [UIFontWeight.semibold, 600], [UIFontWeight.bold, 700], [UIFontWeight.heavy, 800], [UIFontWeight.black, 900],
  ];
  let best = table[3]!;
  for (const entry of table) if (Math.abs(entry[0] - weight) < Math.abs(best[0] - weight)) best = entry;
  return best[1];
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Ultralight', 200: 'Thin', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy', 900: 'Black',
};

/** PostScript-style suffixes of named fonts ("Helvetica-Bold", "Avenir-HeavyOblique"). */
const NAME_SUFFIXES: Array<[RegExp, number]> = [
  [/(Ultra|Extra)?Light$/i, 300], [/Thin$/i, 200], [/Medium$/i, 500], [/(Semi|Demi)Bold$/i, 600], [/Bold$/i, 700],
  [/Heavy$/i, 800], [/Black$/i, 900], [/(Regular|Roman|Book)$/i, 400],
];

/** Families the simulated iOS has installed (the kit's named families) besides loaded fonts. */
const INSTALLED = [
  'Courier', 'Courier New', 'Menlo', 'Georgia', 'Times New Roman', 'Helvetica', 'Helvetica Neue', 'Arial',
  'American Typewriter', 'Avenir', 'Avenir Next', 'Futura', 'Gill Sans',
];

const SF = { ascender: 0.952, descender: 0.241, capHeight: 0.705, xHeight: 0.526 };

interface FontSpec {
  /** null: the system font */
  family: string | null;
  weight: number;
  italic: boolean;
  design: UIFontDesign;
  textStyle: UIFontTextStyle | null;
}

/** UIFontDescriptor: what a font is, separately from its size. */
export class UIFontDescriptor {
  /** @internal */
  constructor(readonly _spec: FontSpec, readonly pointSize: number) {}

  /** preferredFontDescriptor(withTextStyle:compatibleWith:) */
  static preferredFontDescriptor(style: UIFontTextStyle, traits?: UITraitCollection | null): UIFontDescriptor {
    return UIFont.preferredFont(style, traits).fontDescriptor;
  }

  get symbolicTraits(): number {
    const s = this._spec;
    return (s.italic ? UIFontDescriptorSymbolicTraits.traitItalic : 0)
      | (s.weight >= 600 ? UIFontDescriptorSymbolicTraits.traitBold : 0)
      | (s.design === UIFontDesign.monospaced ? UIFontDescriptorSymbolicTraits.traitMonoSpace : 0);
  }

  /** withSymbolicTraits(_:) — bold, italic, monospace */
  withSymbolicTraits(traits: number): UIFontDescriptor | null {
    const s = this._spec;
    return new UIFontDescriptor({
      ...s,
      italic: (traits & UIFontDescriptorSymbolicTraits.traitItalic) !== 0,
      weight: traits & UIFontDescriptorSymbolicTraits.traitBold ? Math.max(700, s.weight) : s.weight >= 600 ? 400 : s.weight,
      design: traits & UIFontDescriptorSymbolicTraits.traitMonoSpace ? UIFontDesign.monospaced : s.design,
    }, this.pointSize);
  }

  /** withDesign(_:) (system font only, like UIKit) */
  withDesign(design: UIFontDesign): UIFontDescriptor | null {
    if (this._spec.family !== null) return null;
    return new UIFontDescriptor({ ...this._spec, design }, this.pointSize);
  }

  withSize(size: number): UIFontDescriptor {
    return new UIFontDescriptor(this._spec, size);
  }

  /** addingAttributes([.traits: [.weight: …]]) — the weight trait is honored */
  withWeight(weight: UIFontWeight | number): UIFontDescriptor {
    return new UIFontDescriptor({ ...this._spec, weight: cssWeight(weight) }, this.pointSize);
  }
}

export class UIFont {
  static readonly systemFontSize = 14;
  static readonly smallSystemFontSize = 12;
  static readonly labelFontSize = 17;
  static readonly buttonFontSize = 18;

  /** @internal */
  private constructor(private readonly spec: FontSpec, readonly pointSize: number) {}

  static systemFont(ofSize: number, weight: UIFontWeight | number = UIFontWeight.regular): UIFont {
    return new UIFont({ family: null, weight: cssWeight(weight), italic: false, design: UIFontDesign.default, textStyle: null }, ofSize);
  }

  static boldSystemFont(ofSize: number): UIFont {
    return UIFont.systemFont(ofSize, UIFontWeight.bold);
  }

  static italicSystemFont(ofSize: number): UIFont {
    return new UIFont({ family: null, weight: 400, italic: true, design: UIFontDesign.default, textStyle: null }, ofSize);
  }

  static monospacedDigitSystemFont(ofSize: number, weight: UIFontWeight | number): UIFont {
    return UIFont.systemFont(ofSize, weight);
  }

  static monospacedSystemFont(ofSize: number, weight: UIFontWeight | number): UIFont {
    return new UIFont({ family: null, weight: cssWeight(weight), italic: false, design: UIFontDesign.monospaced, textStyle: null }, ofSize);
  }

  /** preferredFont(forTextStyle:compatibleWith:) — the Dynamic Type size for the traits' category. */
  static preferredFont(style: UIFontTextStyle, traits?: UITraitCollection | null): UIFont {
    const category = (traits ?? UITraitCollection.current).preferredContentSizeCategory;
    const entry = DYNAMIC_TYPE[style];
    return new UIFont({ family: null, weight: cssWeight(entry.weight), italic: false, design: UIFontDesign.default, textStyle: style }, dynamicTypeSize(style, category));
  }

  /** UIFont(name:size:): null when no such font is installed or loaded. */
  static named(name: string, size: number): UIFont | null {
    const families = UIFont.familyNames;
    let family = families.find((f) => f === name) ?? null;
    let weight = 400;
    let italic = false;
    if (!family) {
      const dash = name.lastIndexOf('-');
      const base = dash > 0 ? name.slice(0, dash) : name.replace(/\s+/g, '');
      family = families.find((f) => f.replace(/\s+/g, '') === base || f === base) ?? null;
      if (!family) return null;
      let suffix = dash > 0 ? name.slice(dash + 1) : '';
      if (/(Italic|Oblique)$/i.test(suffix)) {
        italic = true;
        suffix = suffix.replace(/(Italic|Oblique)$/i, '');
      }
      for (const [pattern, w] of NAME_SUFFIXES) {
        if (pattern.test(suffix)) {
          weight = w;
          break;
        }
      }
    }
    return new UIFont({ family, weight, italic, design: UIFontDesign.default, textStyle: null }, size);
  }

  /** init(descriptor:size:) — size 0 keeps the descriptor's */
  static fromDescriptor(descriptor: UIFontDescriptor, size: number): UIFont {
    return new UIFont(descriptor._spec, size > 0 ? size : descriptor.pointSize);
  }

  static get familyNames(): string[] {
    const loaded = CAEnvironment.kernel?.loadedFonts() ?? [];
    return Array.from(new Set([...INSTALLED, ...loaded])).sort();
  }

  static fontNames(forFamilyName: string): string[] {
    if (!UIFont.familyNames.includes(forFamilyName)) return [];
    const base = forFamilyName.replace(/\s+/g, '');
    return [base, `${base}-Bold`, `${base}-Italic`, `${base}-BoldItalic`];
  }

  // ── what it is ────────────────────────────────────────────────────────

  get familyName(): string {
    if (this.spec.family) return this.spec.family;
    return this.spec.design === UIFontDesign.monospaced ? '.AppleSystemUIFontMonospaced' : '.AppleSystemUIFont';
  }

  get fontName(): string {
    const s = this.spec;
    if (s.family) {
      const base = s.family.replace(/\s+/g, '');
      const weight = s.weight === 400 ? '' : WEIGHT_NAMES[s.weight] ?? '';
      const style = weight + (s.italic ? 'Italic' : '');
      return style ? `${base}-${style}` : base;
    }
    const prefix = s.design === UIFontDesign.monospaced ? '.SFMono' : this.pointSize >= 20 ? '.SFUIDisplay' : '.SFUI';
    return `${prefix}-${WEIGHT_NAMES[s.weight] ?? 'Regular'}${s.italic ? 'Italic' : ''}`;
  }

  get fontDescriptor(): UIFontDescriptor {
    return new UIFontDescriptor(this.spec, this.pointSize);
  }

  /** the Dynamic Type style a preferred font was made for */
  get textStyle(): UIFontTextStyle | null {
    return this.spec.textStyle;
  }

  /** CSS weight 100…900 */
  get weight(): number {
    return this.spec.weight;
  }

  get isItalic(): boolean {
    return this.spec.italic;
  }

  get isSystemFont(): boolean {
    return this.spec.family === null;
  }

  withSize(size: number): UIFont {
    return new UIFont(this.spec, size);
  }

  /** @internal the same face, `factor` times the size (adjustsFontSizeToFitWidth) */
  _scaled(factor: number): UIFont {
    return factor === 1 ? this : new UIFont(this.spec, this.pointSize * factor);
  }

  // ── metrics ───────────────────────────────────────────────────────────

  get ascender(): number {
    return this.metrics().ascent;
  }

  /** negative, like UIKit's */
  get descender(): number {
    return -this.metrics().descent;
  }

  get lineHeight(): number {
    const m = this.metrics();
    return m.ascent + m.descent;
  }

  get leading(): number {
    return 0;
  }

  get capHeight(): number {
    return (this.isSystemFace ? SF.capHeight : 0.7) * this.pointSize;
  }

  get xHeight(): number {
    return (this.isSystemFace ? SF.xHeight : 0.5) * this.pointSize;
  }

  private get isSystemFace(): boolean {
    return this.spec.family === null && this.spec.design !== UIFontDesign.monospaced;
  }

  private metrics(): FontMetrics {
    if (this.isSystemFace) return { ascent: SF.ascender * this.pointSize, descent: SF.descender * this.pointSize };
    const kernel = CAEnvironment.kernel;
    return kernel ? kernel.measurer.metrics(this._css(kernel)) : { ascent: this.pointSize * 0.95, descent: this.pointSize * 0.25 };
  }

  // ── for the text system ───────────────────────────────────────────────

  /** @internal the CSS font string the measurer and the host draw with */
  _css(kernel: Kernel | null = CAEnvironment.kernel): string {
    const s = this.spec;
    const bundled = kernel?.bundledFonts ?? false;
    const family = s.design === UIFontDesign.monospaced && !s.family ? 'monospace'
      : s.design === UIFontDesign.serif && !s.family ? 'Georgia'
        : s.family ?? undefined;
    const size = Math.round(this.pointSize * 100) / 100;
    return `${s.italic ? 'italic ' : ''}${s.weight} ${size}px ${iosKit.fontStack(family, bundled)}`;
  }

  /**
   * @internal When the bundled stand-in draws the system face: its extra
   * tracking (pt) and SF's line metrics. Null for every other face.
   */
  _standIn(kernel: Kernel | null = CAEnvironment.kernel): { tracking: number; metrics: FontMetrics } | null {
    if (!this.isSystemFace || !kernel?.bundledFonts) return this.isSystemFace ? { tracking: 0, metrics: this.metrics() } : null;
    const s = iosKit.standIn?.(this.pointSize, this.spec.weight);
    if (!s) return null;
    return {
      tracking: Math.round(s.tracking * this.pointSize * 100) / 100,
      metrics: { ascent: s.ascent * this.pointSize, descent: s.descent * this.pointSize },
    };
  }

  isEqual(other: UIFont | null): boolean {
    if (!other) return false;
    const a = this.spec;
    const b = other.spec;
    return this.pointSize === other.pointSize && a.family === b.family && a.weight === b.weight && a.italic === b.italic && a.design === b.design;
  }
}

/**
 * UIFontMetrics: scales fonts and values for Dynamic Type like a text style
 * does, relative to the default (large) category.
 */
export class UIFontMetrics {
  constructor(readonly textStyle: UIFontTextStyle = UIFontTextStyle.body) {}

  static get default(): UIFontMetrics {
    return new UIFontMetrics(UIFontTextStyle.body);
  }

  private factor(traits?: UITraitCollection | null): number {
    const category = (traits ?? UITraitCollection.current).preferredContentSizeCategory;
    return dynamicTypeSize(this.textStyle, category) / dynamicTypeSize(this.textStyle, UIContentSizeCategory.large);
  }

  /** scaledFont(for:maximumPointSize:compatibleWith:) */
  scaledFont(font: UIFont, maximumPointSize = 0, traits?: UITraitCollection | null): UIFont {
    let size = font.pointSize * this.factor(traits);
    if (maximumPointSize > 0) size = Math.min(size, maximumPointSize);
    return font.withSize(size);
  }

  /** scaledValue(for:compatibleWith:) */
  scaledValue(value: number, traits?: UITraitCollection | null): number {
    return value * this.factor(traits);
  }
}

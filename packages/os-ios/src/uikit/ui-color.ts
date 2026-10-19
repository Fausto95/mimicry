import { alphaOf, rgba, withAlpha } from '@mimicry/protocol';
import { IOS_COLORS } from '../theme';
import { UITraitCollection, UIUserInterfaceStyle } from './ui-trait-collection';

/**
 * UIColor: static or dynamic (resolved against a trait collection). The
 * system colors are UIKit's semantic palette, light and dark.
 */
export class UIColor {
  private constructor(private readonly provider: (traits: UITraitCollection | null) => number) {}

  static fromRGBA(packed: number): UIColor {
    return new UIColor(() => packed >>> 0);
  }

  /** UIColor(red:green:blue:alpha:), components 0…1 */
  static rgb(red: number, green: number, blue: number, alpha = 1): UIColor {
    return UIColor.fromRGBA(rgba(Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255), alpha));
  }

  static withWhite(white: number, alpha = 1): UIColor {
    return UIColor.rgb(white, white, white, alpha);
  }

  /** UIColor(dynamicProvider:) */
  static dynamic(provider: (traits: UITraitCollection) => UIColor): UIColor {
    return new UIColor((traits) => provider(traits ?? DEFAULT_TRAITS).resolvedColor(traits ?? DEFAULT_TRAITS).rgba);
  }

  /** A semantic system color by UIKit name (systemBlue, label, separator…); null when unknown. */
  static named(name: string): UIColor | null {
    const pair = IOS_COLORS[name];
    if (!pair) return null;
    return new UIColor((traits) => pair[traits?.userInterfaceStyle === UIUserInterfaceStyle.dark ? 1 : 0]);
  }

  resolvedColor(traits: UITraitCollection | null): ResolvedColor {
    return new ResolvedColor(this.provider(traits));
  }

  /** The color as a CGColor (packed RGBA), resolved for the light appearance like UITraitCollection.current at launch. */
  get cgColor(): number {
    return this.provider(null) >>> 0;
  }

  withAlphaComponent(alpha: number): UIColor {
    return new UIColor((traits) => withAlpha(this.provider(traits) | 0xff, alpha) >>> 0);
  }

  static readonly clear = UIColor.fromRGBA(0);
  static readonly black = UIColor.fromRGBA(rgba(0, 0, 0));
  static readonly white = UIColor.fromRGBA(rgba(255, 255, 255));
  static readonly darkGray = UIColor.fromRGBA(rgba(85, 85, 85));
  static readonly lightGray = UIColor.fromRGBA(rgba(170, 170, 170));
  static readonly gray = UIColor.fromRGBA(rgba(128, 128, 128));
  static readonly red = UIColor.fromRGBA(rgba(255, 0, 0));
  static readonly green = UIColor.fromRGBA(rgba(0, 255, 0));
  static readonly blue = UIColor.fromRGBA(rgba(0, 0, 255));
  static readonly cyan = UIColor.fromRGBA(rgba(0, 255, 255));
  static readonly yellow = UIColor.fromRGBA(rgba(255, 255, 0));
  static readonly magenta = UIColor.fromRGBA(rgba(255, 0, 255));
  static readonly orange = UIColor.fromRGBA(rgba(255, 128, 0));
  static readonly purple = UIColor.fromRGBA(rgba(128, 0, 128));
  static readonly brown = UIColor.fromRGBA(rgba(153, 102, 51));

  static get label() { return UIColor.named('label')!; }
  static get secondaryLabel() { return UIColor.named('secondaryLabel')!; }
  static get tertiaryLabel() { return UIColor.named('tertiaryLabel')!; }
  static get quaternaryLabel() { return UIColor.named('quaternaryLabel')!; }
  static get placeholderText() { return UIColor.named('placeholderText')!; }
  static get link() { return UIColor.named('link')!; }
  static get separator() { return UIColor.named('separator')!; }
  static get opaqueSeparator() { return UIColor.named('opaqueSeparator')!; }
  static get systemBackground() { return UIColor.named('systemBackground')!; }
  static get secondarySystemBackground() { return UIColor.named('secondarySystemBackground')!; }
  static get tertiarySystemBackground() { return UIColor.named('tertiarySystemBackground')!; }
  static get systemGroupedBackground() { return UIColor.named('systemGroupedBackground')!; }
  static get secondarySystemGroupedBackground() { return UIColor.named('secondarySystemGroupedBackground')!; }
  static get systemFill() { return UIColor.named('systemFill')!; }
  static get secondarySystemFill() { return UIColor.named('secondarySystemFill')!; }
  static get tertiarySystemFill() { return UIColor.named('tertiarySystemFill')!; }
  static get quaternarySystemFill() { return UIColor.named('quaternarySystemFill')!; }
  static get tertiarySystemGroupedBackground() { return UIColor.named('tertiarySystemGroupedBackground')!; }
  static get lightText() { return UIColor.named('lightText')!; }
  static get darkText() { return UIColor.named('darkText')!; }
  static get systemBlue() { return UIColor.named('systemBlue')!; }
  static get systemGreen() { return UIColor.named('systemGreen')!; }
  static get systemRed() { return UIColor.named('systemRed')!; }
  static get systemOrange() { return UIColor.named('systemOrange')!; }
  static get systemYellow() { return UIColor.named('systemYellow')!; }
  static get systemPink() { return UIColor.named('systemPink')!; }
  static get systemPurple() { return UIColor.named('systemPurple')!; }
  static get systemTeal() { return UIColor.named('systemTeal')!; }
  static get systemIndigo() { return UIColor.named('systemIndigo')!; }
  static get systemMint() { return UIColor.named('systemMint')!; }
  static get systemCyan() { return UIColor.named('systemCyan')!; }
  static get systemBrown() { return UIColor.named('systemBrown')!; }
  static get systemGray() { return UIColor.named('systemGray')!; }
  static get systemGray2() { return UIColor.named('systemGray2')!; }
  static get systemGray3() { return UIColor.named('systemGray3')!; }
  static get systemGray4() { return UIColor.named('systemGray4')!; }
  static get systemGray5() { return UIColor.named('systemGray5')!; }
  static get systemGray6() { return UIColor.named('systemGray6')!; }
  static get tintColor() { return UIColor.named('tintColor')!; }
}

/** A color with its components fixed (what CGColor would hold). */
export class ResolvedColor {
  constructor(readonly rgba: number) {}
  get alpha(): number {
    return alphaOf(this.rgba);
  }
}

const DEFAULT_TRAITS = new UITraitCollection(UIUserInterfaceStyle.light, 1, 2, 3, 0, 'UICTContentSizeCategoryL');

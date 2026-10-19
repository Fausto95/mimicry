import type { Appearance, Viewport } from '@mimicry/protocol';

/**
 * UITraitCollection: the environment a view renders in — light or dark,
 * size classes, display scale, Dynamic Type size, idiom. Views read it from
 * their window; dynamic colors and fonts resolve against it.
 */
export enum UIUserInterfaceStyle { unspecified = 0, light = 1, dark = 2 }
export enum UIUserInterfaceSizeClass { unspecified = 0, compact = 1, regular = 2 }
export enum UIUserInterfaceIdiom { unspecified = -1, phone = 0, pad = 1 }

/** Dynamic Type categories and their scale relative to `large` (the default). */
export const UIContentSizeCategory = {
  extraSmall: 'UICTContentSizeCategoryXS',
  small: 'UICTContentSizeCategoryS',
  medium: 'UICTContentSizeCategoryM',
  large: 'UICTContentSizeCategoryL',
  extraLarge: 'UICTContentSizeCategoryXL',
  extraExtraLarge: 'UICTContentSizeCategoryXXL',
  extraExtraExtraLarge: 'UICTContentSizeCategoryXXXL',
  accessibilityMedium: 'UICTContentSizeCategoryAccessibilityM',
  accessibilityLarge: 'UICTContentSizeCategoryAccessibilityL',
  accessibilityExtraLarge: 'UICTContentSizeCategoryAccessibilityXL',
  accessibilityExtraExtraLarge: 'UICTContentSizeCategoryAccessibilityXXL',
  accessibilityExtraExtraExtraLarge: 'UICTContentSizeCategoryAccessibilityXXXL',
} as const;

const CATEGORY_SCALE: Array<[string, number]> = [
  [UIContentSizeCategory.extraSmall, 0.82],
  [UIContentSizeCategory.small, 0.88],
  [UIContentSizeCategory.medium, 0.94],
  [UIContentSizeCategory.large, 1],
  [UIContentSizeCategory.extraLarge, 1.12],
  [UIContentSizeCategory.extraExtraLarge, 1.24],
  [UIContentSizeCategory.extraExtraExtraLarge, 1.35],
  [UIContentSizeCategory.accessibilityMedium, 1.64],
  [UIContentSizeCategory.accessibilityLarge, 1.95],
  [UIContentSizeCategory.accessibilityExtraLarge, 2.35],
  [UIContentSizeCategory.accessibilityExtraExtraLarge, 2.76],
  [UIContentSizeCategory.accessibilityExtraExtraExtraLarge, 3.12],
];

export class UITraitCollection {
  constructor(
    readonly userInterfaceStyle: UIUserInterfaceStyle,
    readonly horizontalSizeClass: UIUserInterfaceSizeClass,
    readonly verticalSizeClass: UIUserInterfaceSizeClass,
    readonly displayScale: number,
    readonly userInterfaceIdiom: UIUserInterfaceIdiom,
    readonly preferredContentSizeCategory: string,
  ) {}

  static fromViewport(viewport: Viewport, appearance: Appearance): UITraitCollection {
    const sc = (s: string) => (s === 'regular' ? UIUserInterfaceSizeClass.regular : UIUserInterfaceSizeClass.compact);
    return new UITraitCollection(
      appearance === 'dark' ? UIUserInterfaceStyle.dark : UIUserInterfaceStyle.light,
      sc(viewport.sizeClass.horizontal),
      sc(viewport.sizeClass.vertical),
      viewport.scale,
      viewport.device.idiom === 'tablet' ? UIUserInterfaceIdiom.pad : UIUserInterfaceIdiom.phone,
      categoryFor(viewport.fontScale),
    );
  }

  /** A copy with the style overridden (overrideUserInterfaceStyle). */
  withStyle(style: UIUserInterfaceStyle): UITraitCollection {
    if (style === UIUserInterfaceStyle.unspecified || style === this.userInterfaceStyle) return this;
    return new UITraitCollection(style, this.horizontalSizeClass, this.verticalSizeClass, this.displayScale, this.userInterfaceIdiom, this.preferredContentSizeCategory);
  }

  get appearance(): Appearance {
    return this.userInterfaceStyle === UIUserInterfaceStyle.dark ? 'dark' : 'light';
  }

  /** Dynamic Type multiplier for body text at this category. */
  get contentSizeScale(): number {
    return CATEGORY_SCALE.find(([c]) => c === this.preferredContentSizeCategory)?.[1] ?? 1;
  }

  hasDifferentColorAppearance(other: UITraitCollection | null): boolean {
    return !other || other.userInterfaceStyle !== this.userInterfaceStyle;
  }
}

function categoryFor(fontScale: number): string {
  let best: [string, number] = CATEGORY_SCALE[3]!;
  for (const entry of CATEGORY_SCALE) if (Math.abs(entry[1] - fontScale) < Math.abs(best[1] - fontScale)) best = entry;
  return best[0];
}

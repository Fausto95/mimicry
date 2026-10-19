import type { Kernel } from '@mimicry/os-core';
import { Looper } from '../os/looper';

/**
 * Resources.Theme for Theme.Material3.DayNight: the Material 3 color roles
 * (`?attr/colorPrimary`, `?attr/colorSurfaceContainerHigh`…), the framework
 * attributes they back (`?android:attr/textColorPrimary`, colorBackground,
 * colorControlActivated…), AppCompatDelegate's night mode, the M3 type
 * scale (TextAppearance.Material3.*) and shape scale.
 *
 * Colors are the Material 3 baseline scheme (seed #6750A4), what a Pixel
 * shows when dynamic color is off. They are ARGB ints, as on Android. Apps
 * override roles per theme (Theme.applyColors), the way a theme overlay does.
 *
 * React Native's components keep their own AppCompat palette (theme.ts);
 * this theme is for apps written against the View system and Material
 * Components.
 */
const argb = (hex: string) => (parseInt(hex.length === 6 ? `ff${hex}` : hex, 16) | 0);

type Scheme = Readonly<Record<string, number>>;

export const M3_LIGHT: Scheme = Object.freeze({
  colorPrimary: argb('6750A4'), colorOnPrimary: argb('FFFFFF'), colorPrimaryContainer: argb('EADDFF'), colorOnPrimaryContainer: argb('21005D'),
  colorSecondary: argb('625B71'), colorOnSecondary: argb('FFFFFF'), colorSecondaryContainer: argb('E8DEF8'), colorOnSecondaryContainer: argb('1D192B'),
  colorTertiary: argb('7D5260'), colorOnTertiary: argb('FFFFFF'), colorTertiaryContainer: argb('FFD8E4'), colorOnTertiaryContainer: argb('31111D'),
  colorError: argb('B3261E'), colorOnError: argb('FFFFFF'), colorErrorContainer: argb('F9DEDC'), colorOnErrorContainer: argb('410E0B'),
  colorSurface: argb('FEF7FF'), colorOnSurface: argb('1D1B20'), colorSurfaceVariant: argb('E7E0EC'), colorOnSurfaceVariant: argb('49454F'),
  colorOutline: argb('79747E'), colorOutlineVariant: argb('CAC4D0'),
  colorSurfaceInverse: argb('322F35'), colorOnSurfaceInverse: argb('F5EFF7'), colorPrimaryInverse: argb('D0BCFF'),
  colorSurfaceDim: argb('DED8E1'), colorSurfaceBright: argb('FEF7FF'),
  colorSurfaceContainerLowest: argb('FFFFFF'), colorSurfaceContainerLow: argb('F7F2FA'), colorSurfaceContainer: argb('F3EDF7'),
  colorSurfaceContainerHigh: argb('ECE6F0'), colorSurfaceContainerHighest: argb('E6E0E9'),
  colorBackground: argb('FEF7FF'), colorOnBackground: argb('1D1B20'),
  colorScrim: argb('000000'), colorShadow: argb('000000'),
});

export const M3_DARK: Scheme = Object.freeze({
  colorPrimary: argb('D0BCFF'), colorOnPrimary: argb('381E72'), colorPrimaryContainer: argb('4F378B'), colorOnPrimaryContainer: argb('EADDFF'),
  colorSecondary: argb('CCC2DC'), colorOnSecondary: argb('332D41'), colorSecondaryContainer: argb('4A4458'), colorOnSecondaryContainer: argb('E8DEF8'),
  colorTertiary: argb('EFB8C8'), colorOnTertiary: argb('492532'), colorTertiaryContainer: argb('633B48'), colorOnTertiaryContainer: argb('FFD8E4'),
  colorError: argb('F2B8B5'), colorOnError: argb('601410'), colorErrorContainer: argb('8C1D18'), colorOnErrorContainer: argb('F9DEDC'),
  colorSurface: argb('141218'), colorOnSurface: argb('E6E0E9'), colorSurfaceVariant: argb('49454F'), colorOnSurfaceVariant: argb('CAC4D0'),
  colorOutline: argb('938F99'), colorOutlineVariant: argb('49454F'),
  colorSurfaceInverse: argb('E6E0E9'), colorOnSurfaceInverse: argb('322F35'), colorPrimaryInverse: argb('6750A4'),
  colorSurfaceDim: argb('141218'), colorSurfaceBright: argb('3B383E'),
  colorSurfaceContainerLowest: argb('0F0D13'), colorSurfaceContainerLow: argb('1D1B20'), colorSurfaceContainer: argb('211F26'),
  colorSurfaceContainerHigh: argb('2B2930'), colorSurfaceContainerHighest: argb('36343B'),
  colorBackground: argb('141218'), colorOnBackground: argb('E6E0E9'),
  colorScrim: argb('000000'), colorShadow: argb('000000'),
});

/** Framework and AppCompat attributes Material 3 points at its roles. */
const ALIASES: Record<string, string> = {
  colorAccent: 'colorPrimary',
  colorControlActivated: 'colorPrimary',
  colorControlNormal: 'colorOnSurfaceVariant',
  textColorPrimary: 'colorOnSurface',
  textColorSecondary: 'colorOnSurfaceVariant',
  textColorTertiary: 'colorOnSurfaceVariant',
  textColorPrimaryInverse: 'colorOnSurfaceInverse',
  textColorHighlight: 'colorPrimaryContainer',
  textColorLink: 'colorPrimary',
  windowBackground: 'colorSurface',
  colorPrimaryVariant: 'colorPrimaryContainer',
  colorPrimaryDark: 'colorSurface',
  colorOnSurfaceInverse: 'colorOnSurfaceInverse',
  colorSurfaceInverse: 'colorSurfaceInverse',
  colorPrimarySurface: 'colorSurface',
  scrimBackground: 'colorScrim',
};

/** Colors defined from a role plus an alpha (state layers, disabled content, hints). */
const DERIVED: Record<string, [role: string, alpha: number]> = {
  textColorHint: ['colorOnSurfaceVariant', 0.6],
  colorControlHighlight: ['colorOnSurface', 0.1],
  textColorPrimaryDisabled: ['colorOnSurface', 0.38],
  colorOnSurfaceDisabled: ['colorOnSurface', 0.38],
  colorContainerDisabled: ['colorOnSurface', 0.12],
};

/** android:attr/... and ?attr/... spellings → the bare attribute name */
export function attrName(attr: string): string {
  return attr.replace(/^\?/, '').replace(/^(android:)?attr\//, '').replace(/^android:/, '').replace(/^R\.attr\./, '');
}

/** AppCompatDelegate: the app-wide night mode. */
export const AppCompatDelegate = {
  MODE_NIGHT_FOLLOW_SYSTEM: -1,
  MODE_NIGHT_AUTO_BATTERY: 3,
  MODE_NIGHT_NO: 1,
  MODE_NIGHT_YES: 2,
  MODE_NIGHT_UNSPECIFIED: -100,

  /** Per kernel (each simulated device is its own process). */
  modes: new WeakMap<Kernel, number>(),
  listeners: new WeakMap<Kernel, Set<() => void>>(),

  setDefaultNightMode(mode: number, kernel: Kernel = Looper.requireMainKernel()): void {
    if (AppCompatDelegate.getDefaultNightMode(kernel) === mode) return;
    AppCompatDelegate.modes.set(kernel, mode);
    for (const l of Array.from(AppCompatDelegate.listeners.get(kernel) ?? [])) l();
  },

  getDefaultNightMode(kernel: Kernel = Looper.requireMainKernel()): number {
    return AppCompatDelegate.modes.get(kernel) ?? AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
  },

  /** @internal activities re-resolve their configuration when the mode changes */
  onNightModeChanged(kernel: Kernel, listener: () => void): () => void {
    let set = AppCompatDelegate.listeners.get(kernel);
    if (!set) AppCompatDelegate.listeners.set(kernel, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  },

  /** Whether night resources apply on `kernel` right now. */
  isNight(kernel: Kernel): boolean {
    const mode = AppCompatDelegate.getDefaultNightMode(kernel);
    if (mode === AppCompatDelegate.MODE_NIGHT_YES) return true;
    if (mode === AppCompatDelegate.MODE_NIGHT_NO) return false;
    return kernel.env.appearance === 'dark';
  },
};

export type ColorOverride = number | readonly [light: number, dark: number];

/** android.content.res.Resources.Theme */
export class Theme {
  private readonly overrides = new Map<string, ColorOverride>();
  private readonly dimens = new Map<string, number>();

  constructor(private readonly kernel: Kernel) {}

  isNight(): boolean {
    return AppCompatDelegate.isNight(this.kernel);
  }

  /** Override color roles or attributes (a ThemeOverlay): one ARGB color, or [light, dark]. */
  applyColors(colors: Record<string, ColorOverride>): void {
    for (const [name, value] of Object.entries(colors)) this.overrides.set(attrName(name), value);
  }

  /** Copy another theme's overrides (Theme.setTo). */
  setTo(other: Theme): void {
    this.overrides.clear();
    for (const [k, v] of other.overrides) this.overrides.set(k, v);
  }

  /**
   * The ARGB color of a theme attribute ('colorPrimary', '?attr/colorPrimary',
   * '?android:attr/textColorPrimary'), or null when the theme does not define it.
   */
  resolveColor(attr: string): number | null {
    const name = attrName(attr);
    const night = this.isNight();
    const override = this.overrides.get(name);
    if (override !== undefined) return typeof override === 'number' ? override : override[night ? 1 : 0];
    const scheme = night ? M3_DARK : M3_LIGHT;
    const direct = scheme[name];
    if (direct !== undefined) return direct;
    const alias = ALIASES[name];
    if (alias) return this.resolveColor(alias);
    const derived = DERIVED[name];
    if (derived) {
      const base = this.resolveColor(derived[0]);
      return base == null ? null : withAlphaArgb(base, derived[1]);
    }
    return null;
  }

  /** Like resolveColor, but a missing attribute is an error (Resources.NotFoundException). */
  getColor(attr: string): number {
    const c = this.resolveColor(attr);
    if (c == null) throw new Error(`Resources.NotFoundException: no color for ${attr} in the theme`);
    return c;
  }

  setDimension(attr: string, value: number): void {
    this.dimens.set(attrName(attr), value);
  }

  resolveDimension(attr: string): number | null {
    const name = attrName(attr);
    return this.dimens.get(name) ?? THEME_DIMENS[name] ?? null;
  }
}

/** Dimensions a Material 3 theme defines (dp). */
const THEME_DIMENS: Record<string, number> = {
  actionBarSize: 64,
  listPreferredItemHeight: 56,
  listPreferredItemHeightSmall: 48,
  listPreferredItemHeightLarge: 72,
  listPreferredItemPaddingStart: 16,
  listPreferredItemPaddingEnd: 24,
  minTouchTargetSize: 48,
};

/** An ARGB color with its alpha multiplied by `alpha`. */
export function withAlphaArgb(color: number, alpha: number): number {
  const a = Math.round(((color >>> 24) & 255) * Math.max(0, Math.min(1, alpha)));
  return ((color & 0x00ffffff) | (a << 24)) | 0;
}

/** Composite `top` over `bottom` (both ARGB): MaterialColors.layer for state layers. */
export function layerColor(bottom: number, top: number, alpha = 1): number {
  const ta = (((top >>> 24) & 255) / 255) * alpha;
  const mix = (shift: number) => Math.round(((bottom >> shift) & 255) * (1 - ta) + ((top >> shift) & 255) * ta);
  const ba = ((bottom >>> 24) & 255) / 255;
  const a = Math.round((ta + ba * (1 - ta)) * 255);
  return ((a << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) | 0;
}

// ── type & shape scales ─────────────────────────────────────────────────

export interface TextAppearanceSpec {
  /** sp */
  size: number;
  /** sp */
  lineHeight: number;
  weight: number;
  /** em */
  letterSpacing: number;
  family?: string;
}

const ta = (size: number, lineHeight: number, weight: number, trackingSp: number): TextAppearanceSpec => ({
  size, lineHeight, weight, letterSpacing: trackingSp / size,
});

/** TextAppearance.Material3.* (the M3 type scale). */
export const TextAppearance = {
  DisplayLarge: ta(57, 64, 400, -0.25),
  DisplayMedium: ta(45, 52, 400, 0),
  DisplaySmall: ta(36, 44, 400, 0),
  HeadlineLarge: ta(32, 40, 400, 0),
  HeadlineMedium: ta(28, 36, 400, 0),
  HeadlineSmall: ta(24, 32, 400, 0),
  TitleLarge: ta(22, 28, 400, 0),
  TitleMedium: ta(16, 24, 500, 0.15),
  TitleSmall: ta(14, 20, 500, 0.1),
  BodyLarge: ta(16, 24, 400, 0.5),
  BodyMedium: ta(14, 20, 400, 0.25),
  BodySmall: ta(12, 16, 400, 0.4),
  LabelLarge: ta(14, 20, 500, 0.1),
  LabelMedium: ta(12, 16, 500, 0.5),
  LabelSmall: ta(11, 16, 500, 0.5),
} as const;

/** ShapeAppearance.Material3.Corner.* (dp). */
export const ShapeCorner = {
  None: 0,
  ExtraSmall: 4,
  Small: 8,
  Medium: 12,
  Large: 16,
  LargeIncreased: 20,
  ExtraLarge: 28,
  /** Fully rounded: half the shorter side. */
  Full: -1,
} as const;

/** com.google.android.material.color.MaterialColors */
export const MaterialColors = {
  ALPHA_FULL: 1,
  ALPHA_MEDIUM: 0.54,
  ALPHA_DISABLED: 0.38,
  ALPHA_LOW: 0.32,
  ALPHA_DISABLED_LOW: 0.12,

  getColor(context: { getTheme(): Theme }, attr: string, defaultValue?: number): number {
    const c = context.getTheme().resolveColor(attr);
    if (c != null) return c;
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`IllegalArgumentException: ${attr} is not set in the current theme`);
  },

  layer(background: number, overlay: number, overlayAlpha = 1): number {
    return layerColor(background, overlay, overlayAlpha);
  },

  compositeARGBWithAlpha(color: number, alpha: number): number {
    return withAlphaArgb(color, alpha / 255);
  },

  isColorLight(color: number): boolean {
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const l = 0.2126 * lin((color >> 16) & 255) + 0.7152 * lin((color >> 8) & 255) + 0.0722 * lin(color & 255);
    return l > 0.5;
  },
};

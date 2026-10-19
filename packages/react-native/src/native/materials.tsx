import React, { forwardRef } from 'react';
import { HostType } from '@mimicry/engine';
import { Platform, StyleSheet, useColorScheme } from '../apis/core';
import { registerNativeComponents } from './registry';

/**
 * Blur and glass materials: the native views behind expo-blur's BlurView and
 * expo-glass-effect's GlassView. Both are a view with the engine's `backdrop`
 * prop (blur + saturation of whatever is painted beneath, see paint/painter.ts)
 * under a tint drawn as its background.
 *
 * Approximations: UIKit materials also apply a luminance curve and vibrancy
 * to content; Liquid Glass refracts and magnifies the backdrop at its edges
 * and reacts to touch. Mimicry models these as blur + saturation + tint, plus
 * a hairline highlight and soft shadow for glass.
 */
const h = React.createElement as (...args: any[]) => React.ReactElement;

type Appearance = 'light' | 'dark';

/** Tint colors of the UIKit blur styles (Apple's iOS design kit values, as expo-blur's web fallback uses). */
const TINTS: Record<string, [r: number, g: number, b: number, a: number]> = {
  dark: [25, 25, 25, 0.78],
  systemMaterialDark: [25, 25, 25, 0.78],
  light: [249, 249, 249, 0.78],
  extraLight: [249, 249, 249, 0.78],
  systemMaterialLight: [249, 249, 249, 0.78],
  systemUltraThinMaterialLight: [249, 249, 249, 0.78],
  systemThickMaterialLight: [249, 249, 249, 0.78],
  default: [255, 255, 255, 0.3],
  prominent: [255, 255, 255, 0.3],
  regular: [179, 179, 179, 0.82],
  systemThinMaterialLight: [199, 199, 199, 0.78],
  systemChromeMaterialLight: [255, 255, 255, 0.97],
  systemThickMaterialDark: [37, 37, 37, 0.9],
  systemThinMaterialDark: [37, 37, 37, 0.7],
  systemUltraThinMaterialDark: [37, 37, 37, 0.55],
  systemChromeMaterialDark: [0, 0, 0, 0.75],
};

/** Blur radius (points) and saturation of each material family at full intensity. */
function materialBlur(tint: string): { blur: number; saturation: number } {
  if (/UltraThin/.test(tint)) return { blur: 14, saturation: 1.8 };
  if (/Thin/.test(tint)) return { blur: 20, saturation: 1.8 };
  if (/Thick|Chrome/.test(tint)) return { blur: 34, saturation: 1.8 };
  if (/system/.test(tint)) return { blur: 26, saturation: 1.8 };
  return { blur: 20, saturation: 1.4 };
}

/** `systemMaterial` and friends follow the appearance; `…Light`/`…Dark` and the classic styles don't. */
export function resolveBlurTint(tint: string, appearance: Appearance): string {
  if (/^system.*Material$/.test(tint)) return `${tint}${appearance === 'dark' ? 'Dark' : 'Light'}`;
  if (tint === 'default' && appearance === 'dark') return 'dark';
  return tint;
}

function rgbaString([r, g, b, a]: [number, number, number, number], scale: number): string {
  return `rgba(${r},${g},${b},${Math.round(a * scale * 1000) / 1000})`;
}

/** `requireNativeView('ExpoBlur', 'ExpoBlurView')`: tint + intensity; Android blurs only with a blur method set. */
const ExpoBlurView = forwardRef<any, any>(function ExpoBlurView(props, ref) {
  const { tint = 'default', intensity = 50, blurMethod = 'none', style, children, ...rest } = props;
  const appearance = (useColorScheme() ?? 'light') as Appearance;
  const resolved = resolveBlurTint(String(tint), appearance);
  const fraction = Math.max(0, Math.min(100, Number(intensity))) / 100;
  const color = TINTS[resolved] ?? TINTS.default!;
  const blurs = Platform.OS === 'ios' || blurMethod !== 'none';
  const material = materialBlur(resolved);
  return h(HostType.View, {
    ...rest,
    ref,
    style: [style, { backgroundColor: rgbaString(color, fraction) }],
    backdrop: blurs ? { blur: material.blur * fraction, saturation: 1 + (material.saturation - 1) * fraction } : undefined,
  }, children);
});

type GlassStyle = 'clear' | 'regular' | 'none';

/** Liquid Glass (iOS 26 `UIGlassEffect`), approximated: see the module comment. */
const GlassView = forwardRef<any, any>(function GlassView(props, ref) {
  const { glassEffectStyle = 'regular', tintColor, isInteractive: _interactive, colorScheme = 'auto', style, children, ...rest } = props;
  const system = (useColorScheme() ?? 'light') as Appearance;
  const appearance: Appearance = colorScheme === 'auto' ? system : colorScheme;
  const kind: GlassStyle = typeof glassEffectStyle === 'object' ? glassEffectStyle?.style ?? 'regular' : glassEffectStyle;
  if (kind === 'none') return h(HostType.View, { ...rest, ref, style }, children);
  const dark = appearance === 'dark';
  const clear = kind === 'clear';
  const flat = StyleSheet.flatten(style) ?? {};
  const material = {
    backdrop: clear ? { blur: 2, saturation: 1.2 } : { blur: 10, saturation: 1.8 },
    backgroundColor: tintColor ?? (clear ? (dark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)') : dark ? 'rgba(40,40,44,0.55)' : 'rgba(255,255,255,0.55)'),
    // the specular rim
    borderWidth: flat.borderWidth ?? StyleSheet.hairlineWidth,
    borderColor: flat.borderColor ?? (dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.75)'),
    shadowColor: '#000',
    shadowOpacity: clear ? 0.06 : dark ? 0.3 : 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  };
  const { backdrop, ...tint } = material;
  return h(HostType.View, { ...rest, ref, style: [tint, style], backdrop }, children);
});

/** GlassContainer merges nearby glass shapes on device; here it is a plain container. */
const GlassContainer = forwardRef<any, any>(function GlassContainer(props, ref) {
  const { spacing: _spacing, ...rest } = props;
  return h(HostType.View, { ...rest, ref });
});

registerNativeComponents({
  ExpoBlur_ExpoBlurView: ExpoBlurView,
  ExpoGlassEffect_GlassView: GlassView,
  ExpoGlassEffect_GlassContainer: GlassContainer,
});

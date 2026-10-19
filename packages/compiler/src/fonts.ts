import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Fonts Mimicry ships so text measures identically in the engine worker, the
 * browser host and headless Node: Inter stands in for SF Pro (which cannot
 * be redistributed), Roboto is Android's actual system font, and Material
 * Symbols draws system glyphs (SF Symbols are mapped onto it, see
 * react-native/src/native/expo-views.tsx).
 */
export interface BundledFont {
  family: 'Inter' | 'Roboto' | 'Material Symbols';
  weight: string;
  style: 'normal' | 'italic';
  file: string;
  /** URL path the dev server serves it under */
  url: string;
}

const WEIGHTS: Array<[string, string]> = [
  ['100', 'Thin'], ['200', 'ExtraLight'], ['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'],
  ['600', 'SemiBold'], ['700', 'Bold'], ['800', 'ExtraBold'], ['900', 'Black'],
];

const require = createRequire(import.meta.url);

function packageDir(name: string): string | null {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

export function bundledFonts(families: Array<BundledFont['family']> = ['Inter', 'Roboto', 'Material Symbols']): BundledFont[] {
  const out: BundledFont[] = [];
  for (const family of families) {
    if (family === 'Material Symbols') {
      const dir = packageDir('@expo-google-fonts/material-symbols');
      const file = dir && join(dir, '400Regular', 'MaterialSymbols_400Regular.ttf');
      if (file && existsSync(file)) out.push({ family, weight: '400', style: 'normal', file, url: '/__mimicry/fonts/MaterialSymbols_400Regular.ttf' });
      continue;
    }
    const dir = packageDir(`@expo-google-fonts/${family.toLowerCase()}`);
    if (!dir) continue;
    for (const [weight, name] of WEIGHTS) {
      for (const style of ['normal', 'italic'] as const) {
        const variant = `${weight}${name}${style === 'italic' ? '_Italic' : ''}`;
        const file = join(dir, variant, `${family}_${variant}.ttf`);
        if (existsSync(file)) out.push({ family, weight, style, file, url: `/__mimicry/fonts/${family}_${variant}.ttf` });
      }
    }
  }
  return out;
}

/** The subset a platform needs at boot (others load lazily in the browser). */
export function fontsForPlatform(platform: 'ios' | 'android'): BundledFont[] {
  const family = platform === 'ios' ? 'Inter' : 'Roboto';
  return bundledFonts([family, 'Material Symbols']).filter((f) => f.style === 'normal' || f.weight === '400');
}

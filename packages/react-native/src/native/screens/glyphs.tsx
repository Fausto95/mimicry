import React from 'react';
import { HostType } from '@mimicry/react-native-fabric';

/**
 * System glyphs drawn as paths. Shapes approximate SF Symbols (which can't
 * be redistributed) and use Material Icons (Apache 2.0) on Android.
 */
const GLYPHS = {
  /** SF Symbol chevron.backward, regular weight */
  chevronBackward: { viewBox: '0 0 12 21', d: 'M10.2 1.6 L1.8 10.5 L10.2 19.4', stroke: true, strokeWidth: 2.4 },
  /** SF Symbol chevron.forward */
  chevronForward: { viewBox: '0 0 12 21', d: 'M1.8 1.6 L10.2 10.5 L1.8 19.4', stroke: true, strokeWidth: 2.4 },
  /** SF Symbol xmark */
  xmark: { viewBox: '0 0 16 16', d: 'M2 2 L14 14 M14 2 L2 14', stroke: true, strokeWidth: 2.2 },
  /** Material arrow_back */
  arrowBack: { viewBox: '0 0 24 24', d: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z', stroke: false, strokeWidth: 0 },
  /** Material close */
  close: { viewBox: '0 0 24 24', d: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z', stroke: false, strokeWidth: 0 },
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size, color, style }: { name: GlyphName; size: { width: number; height: number }; color: unknown; style?: unknown }) {
  const g = GLYPHS[name];
  return React.createElement(HostType.Path, {
    d: g.d,
    viewBox: g.viewBox,
    fill: g.stroke ? 'none' : color,
    stroke: g.stroke ? color : undefined,
    strokeWidth: g.strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    pointerEvents: 'none',
    style: [size, style],
  });
}

import React, { forwardRef } from 'react';
import { View } from '../components/primitives';

/** expo-linear-gradient on top of the engine's linear-gradient backgrounds. */
type Point = { x: number; y: number } | [number, number];
const pt = (p: Point | null | undefined, fallback: { x: number; y: number }) =>
  !p ? fallback : Array.isArray(p) ? { x: p[0], y: p[1] } : p;

export const LinearGradient = forwardRef<any, any>(function LinearGradient(props, ref) {
  const { colors = [], locations, start, end, style, children, dither, ...rest } = props;
  const s = pt(start, { x: 0.5, y: 0 });
  const e = pt(end, { x: 0.5, y: 1 });
  const angle = (Math.atan2(e.x - s.x, -(e.y - s.y)) * 180) / Math.PI;
  const stops = (colors as string[]).map((c, i) => (locations?.[i] != null ? `${c} ${locations[i] * 100}%` : c)).join(', ');
  return React.createElement(View as any, {
    ...rest,
    ref,
    style: [style, { experimental_backgroundImage: `linear-gradient(${angle}deg, ${stops})` }],
    children,
  });
});

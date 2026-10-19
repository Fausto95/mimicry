import { cubicBezier } from '@mimicry/react-native-fabric';

export type EasingFunction = (t: number) => number;

/** React Native's Easing module. */
export const Easing = {
  step0: (n: number) => (n > 0 ? 1 : 0),
  step1: (n: number) => (n >= 1 ? 1 : 0),
  linear: (t: number) => t,
  ease: cubicBezier(0.42, 0, 1, 1),
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  poly: (n: number): EasingFunction => (t) => Math.pow(t, n),
  sin: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t: number) => 1 - Math.sqrt(1 - t * t),
  exp: (t: number) => Math.pow(2, 10 * (t - 1)),
  elastic(bounciness = 1): EasingFunction {
    const p = bounciness * Math.PI;
    return (t) => 1 - Math.pow(Math.cos((t * Math.PI) / 2), 3) * Math.cos(t * p);
  },
  back(s = 1.70158): EasingFunction {
    return (t) => t * t * ((s + 1) * t - s);
  },
  bounce(t: number): number {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) {
      const t2 = t - 1.5 / 2.75;
      return 7.5625 * t2 * t2 + 0.75;
    }
    if (t < 2.5 / 2.75) {
      const t2 = t - 2.25 / 2.75;
      return 7.5625 * t2 * t2 + 0.9375;
    }
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  },
  bezier: (x1: number, y1: number, x2: number, y2: number): EasingFunction => cubicBezier(x1, y1, x2, y2),
  in: (easing: EasingFunction): EasingFunction => easing,
  out: (easing: EasingFunction): EasingFunction => (t) => 1 - easing(1 - t),
  inOut: (easing: EasingFunction): EasingFunction => (t) => (t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2),
};

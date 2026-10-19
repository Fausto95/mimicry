import { cubicBezier } from '@mimicry/react-native-fabric';
import { Easing as RNEasing } from '../animated/easing';

/**
 * Reanimated's Easing: React Native's set plus `steps` and `bezierFn`.
 * `bezier()` returns a function that also carries Reanimated's `factory`
 * shape, so it works with both `withTiming({ easing })` and direct calls.
 */
export type EasingFunction = (t: number) => number;
export type EasingFunctionFactory = { factory: () => EasingFunction };
export type EasingLike = EasingFunction | EasingFunctionFactory;

export function resolveEasing(easing: EasingLike | undefined, fallback: EasingFunction): EasingFunction {
  if (!easing) return fallback;
  if (typeof easing === 'function') return easing;
  if (typeof (easing as EasingFunctionFactory).factory === 'function') return (easing as EasingFunctionFactory).factory();
  return fallback;
}

function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction & EasingFunctionFactory {
  const fn = cubicBezier(x1, y1, x2, y2) as EasingFunction & EasingFunctionFactory;
  fn.factory = () => fn;
  return fn;
}

export const Easing = {
  ...RNEasing,
  ease: bezier(0.42, 0, 1, 1),
  bezier,
  bezierFn: (x1: number, y1: number, x2: number, y2: number): EasingFunction => cubicBezier(x1, y1, x2, y2),
  /** n discrete steps; `roundToNextStep` rounds up like CSS `steps(n, jump-start)`. */
  steps(n = 10, roundToNextStep = true): EasingFunction {
    return (t) => {
      const value = Math.min(Math.max(t, 0), 1) * n;
      return (roundToNextStep ? Math.ceil(value) : Math.floor(value)) / n;
    };
  },
};

/** withTiming's default curve. */
export const DEFAULT_TIMING_EASING: EasingFunction = Easing.inOut(Easing.quad);

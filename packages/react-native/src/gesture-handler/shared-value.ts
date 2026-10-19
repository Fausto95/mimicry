import { AnimatedValue } from '../animated/animated';

/**
 * Swipeable and DrawerLayout hand their progress to render callbacks as
 * Reanimated shared values. Here they are Animated.Values that also expose
 * `.value`, so both `progress.value` reads and Animated interpolation work.
 */
export type SharedAnimatedValue = AnimatedValue & { value: number };

export function sharedAnimatedValue(initial: number): SharedAnimatedValue {
  const v = new AnimatedValue(initial) as SharedAnimatedValue;
  Object.defineProperty(v, 'value', {
    get: () => v.__getValue(),
    set: (next: number) => v.setValue(next),
  });
  return v;
}

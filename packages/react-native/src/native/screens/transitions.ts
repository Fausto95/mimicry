import { Animated } from '../../animated';
import { Easing } from '../../animated/easing';
import type { AnimatedValue, CompositeAnimation } from '../../animated/animated';
import type { Presentation } from './stack';

/**
 * Stack transitions, as the platforms draw them.
 *
 * A transition is described by one progress value of the *moving* screen
 * (the one pushed or popped): 0 = in place, 1 = gone. The moving screen and
 * the screen below derive their styles from it, so an interactive swipe and
 * an animated pop are the same picture at the same progress.
 *
 * Curves: UINavigationController pushes with a critically damped spring
 * (~0.5 s to settle); sheets slide with UIKit's presentation spring. Android
 * (react-native-screens' default) slides with a fade over 350 ms using
 * Material's emphasized curves. Values are tuned with the motion oracle
 * (docs/fidelity.md).
 */
export type StackAnimationName =
  | 'default' | 'fade' | 'fade_from_bottom' | 'flip' | 'simple_push' | 'slide_from_bottom'
  | 'slide_from_right' | 'slide_from_left' | 'ios_from_right' | 'ios_from_left' | 'none';

export type TransitionKind = 'push' | 'pop';

export interface TransitionSpec {
  platform: 'ios' | 'android';
  kind: TransitionKind;
  presentation: Presentation;
  animation: StackAnimationName;
  duration?: number;
  size: { width: number; height: number };
}

export interface Transition {
  moving(progress: AnimatedValue): unknown;
  below(progress: AnimatedValue): unknown;
  animate(progress: AnimatedValue, to: number, velocity: number): CompositeAnimation;
}

const clampRange = { extrapolate: 'clamp' as const };

function interpolate(progress: AnimatedValue, output: [number, number] | [string, string]) {
  return progress.interpolate({ inputRange: [0, 1], outputRange: output as any, ...clampRange });
}

/** Spring with UIKit's (response, dampingRatio) parameterization. */
function uikitSpring(progress: AnimatedValue, to: number, velocity: number, response: number, dampingRatio: number) {
  const stiffness = (2 * Math.PI / response) ** 2;
  const damping = (4 * Math.PI * dampingRatio) / response;
  return Animated.spring(progress, {
    toValue: to, stiffness, damping, mass: 1, velocity, overshootClamping: true,
    restDisplacementThreshold: 0.001, restSpeedThreshold: 0.001,
  });
}

const timing = (progress: AnimatedValue, to: number, duration: number, easing: (t: number) => number) =>
  Animated.timing(progress, { toValue: to, duration, easing });

const MATERIAL_EMPHASIZED_DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);
const MATERIAL_EMPHASIZED_ACCELERATE = Easing.bezier(0.3, 0, 0.8, 0.15);

const isSheet = (p: Presentation) => p === 'modal' || p === 'pageSheet' || p === 'formSheet';

export function stackTransition(spec: TransitionSpec): Transition {
  const { width, height } = spec.size;
  const none = spec.animation === 'none';
  const animateWith = (fn: Transition['animate']): Transition['animate'] =>
    none ? (progress, to) => timing(progress, to, 0, (t) => t) : fn;

  // ── iOS ──────────────────────────────────────────────────────────────
  if (spec.platform === 'ios') {
    if (spec.presentation !== 'push' && spec.presentation !== 'containedModal') {
      // Sheets and full-screen modals rise from the bottom; the presenter stays.
      const transparent = spec.presentation === 'transparentModal' || spec.presentation === 'containedTransparentModal';
      const fade = spec.animation === 'fade' || (transparent && spec.animation === 'default');
      return {
        moving: (p) => (fade ? { opacity: interpolate(p, [1, 0]) } : { transform: [{ translateY: interpolate(p, [0, height]) }] }),
        below: () => null,
        animate: animateWith((p, to, v) => (fade ? timing(p, to, spec.duration ?? 300, Easing.inOut(Easing.ease)) : uikitSpring(p, to, v, 0.5, 1))),
      };
    }
    switch (spec.animation) {
      case 'fade':
        return {
          moving: (p) => ({ opacity: interpolate(p, [1, 0]) }),
          below: () => null,
          animate: animateWith((p, to) => timing(p, to, spec.duration ?? 350, Easing.inOut(Easing.ease))),
        };
      case 'slide_from_bottom':
      case 'fade_from_bottom':
        return {
          moving: (p) => ({
            transform: [{ translateY: interpolate(p, [0, spec.animation === 'fade_from_bottom' ? height * 0.08 : height]) }],
            opacity: spec.animation === 'fade_from_bottom' ? interpolate(p, [1, 0]) : 1,
          }),
          below: () => null,
          animate: animateWith((p, to, v) => uikitSpring(p, to, v, 0.5, 1)),
        };
      case 'slide_from_left':
      case 'ios_from_left':
        return pushLike(-width, width * 0.3);
      case 'simple_push':
        return pushLike(width, width);
      default:
        return pushLike(width, -width * 0.3);
    }
  }

  // ── Android ──────────────────────────────────────────────────────────
  const duration = spec.duration ?? 350;
  switch (spec.animation) {
    case 'fade':
      return {
        moving: (p) => ({ opacity: interpolate(p, [1, 0]) }),
        below: () => null,
        animate: animateWith((p, to) => timing(p, to, duration, Easing.linear)),
      };
    case 'slide_from_bottom':
      return {
        moving: (p) => ({ transform: [{ translateY: interpolate(p, [0, height]) }] }),
        below: () => null,
        animate: animateWith((p, to) => timing(p, to, duration, to === 0 ? MATERIAL_EMPHASIZED_DECELERATE : MATERIAL_EMPHASIZED_ACCELERATE)),
      };
    case 'fade_from_bottom':
      return {
        moving: (p) => ({ opacity: interpolate(p, [1, 0]), transform: [{ translateY: interpolate(p, [0, height * 0.08]) }] }),
        below: () => null,
        animate: animateWith((p, to) => timing(p, to, duration, to === 0 ? MATERIAL_EMPHASIZED_DECELERATE : MATERIAL_EMPHASIZED_ACCELERATE)),
      };
    case 'slide_from_left':
      return androidSlide(-1);
    case 'ios_from_right':
    case 'ios_from_left':
    case 'simple_push':
      return pushLike(spec.animation === 'ios_from_left' ? -width : width, spec.animation === 'simple_push' ? -width : -width * 0.3);
    default:
      // react-native-screens' default on Android: the new screen slides in
      // from the right edge while fading in; the old one drifts left.
      if (isSheet(spec.presentation)) {
        return {
          moving: (p) => ({ opacity: interpolate(p, [1, 0]), transform: [{ translateY: interpolate(p, [0, height * 0.08]) }] }),
          below: () => null,
          animate: animateWith((p, to) => timing(p, to, duration, to === 0 ? MATERIAL_EMPHASIZED_DECELERATE : MATERIAL_EMPHASIZED_ACCELERATE)),
        };
      }
      return androidSlide(1);
  }

  function pushLike(movingDistance: number, belowDistance: number): Transition {
    return {
      moving: (p) => ({
        transform: [{ translateX: interpolate(p, [0, movingDistance]) }],
        shadowColor: '#000', shadowOpacity: interpolate(p, [0.18, 0]), shadowRadius: 14, shadowOffset: { width: -2, height: 0 },
      }),
      below: (p) => ({ transform: [{ translateX: interpolate(p, [belowDistance, 0]) }] }),
      animate: animateWith((p, to, v) => uikitSpring(p, to, v, 0.5, 1)),
    };
  }

  function androidSlide(direction: 1 | -1): Transition {
    return {
      moving: (p) => ({
        opacity: interpolate(p, [1, 0]),
        transform: [{ translateX: interpolate(p, [0, direction * width * 0.25]) }],
      }),
      below: (p) => ({ transform: [{ translateX: interpolate(p, [-direction * width * 0.1, 0]) }] }),
      animate: animateWith((p, to) => timing(p, to, duration, to === 0 ? MATERIAL_EMPHASIZED_DECELERATE : MATERIAL_EMPHASIZED_ACCELERATE)),
    };
  }
}

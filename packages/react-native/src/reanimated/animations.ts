import { DEFAULT_TIMING_EASING, resolveEasing, type EasingLike } from './easing';
import { componentsLike, vectorize, type Vector } from './values';

/**
 * Animation objects: what `withTiming(…)` and friends return. Assigning one
 * to a shared value (or returning it from useAnimatedStyle) starts it: the
 * owner calls `onStart(fromValue, now, previous)` once, then `onFrame(now)`
 * every frame until it returns true, reading `current` each time — the same
 * protocol as Reanimated's worklet animations. Times are in milliseconds.
 */
export type AnimationCallback = (finished?: boolean, current?: unknown) => void;

export interface AnimationObject {
  readonly __reanimatedAnimation: true;
  /** identifies "the same animation" so re-running a style updater doesn't restart it */
  readonly signature: string;
  current: unknown;
  toValue?: unknown;
  /** scalar velocity (units/s), handed from one animation to the next */
  velocity: number;
  callback?: AnimationCallback;
  onStart(start: unknown, now: number, previous: AnimationObject | null): void;
  onFrame(now: number): boolean;
}

export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' } as const;
export type ReduceMotionValue = (typeof ReduceMotion)[keyof typeof ReduceMotion];

export function isAnimation(value: unknown): value is AnimationObject {
  return !!value && typeof value === 'object' && (value as AnimationObject).__reanimatedAnimation === true;
}

const sig = (kind: string, ...parts: unknown[]) => `${kind}(${parts.map((p) => (typeof p === 'function' ? 'fn' : JSON.stringify(p) ?? 'u')).join(',')})`;

// ── timing ─────────────────────────────────────────────────────────────────

export interface WithTimingConfig {
  duration?: number;
  easing?: EasingLike;
  reduceMotion?: ReduceMotionValue;
}

export function timingAnimation(toValue: unknown, config: WithTimingConfig = {}, callback?: AnimationCallback): AnimationObject {
  const duration = config.duration ?? 300;
  const easing = resolveEasing(config.easing, DEFAULT_TIMING_EASING);
  let target: Vector = vectorize(toValue);
  let from: number[] = [];
  let startTime = 0;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('timing', toValue, duration),
    current: toValue,
    toValue,
    velocity: 0,
    callback,
    onStart(start, now) {
      target = vectorize(anim.toValue);
      from = componentsLike(start, target);
      startTime = now;
      anim.current = start;
    },
    onFrame(now) {
      const t = duration > 0 ? Math.min(1, Math.max(0, (now - startTime) / duration)) : 1;
      if (t >= 1 || !target.components.length) {
        anim.current = anim.toValue;
        anim.velocity = 0;
        return true;
      }
      const e = easing(t);
      anim.current = target.build(from.map((f, i) => f + (target.components[i]! - f) * e));
      return false;
    },
  };
  return anim;
}

// ── spring ─────────────────────────────────────────────────────────────────

export interface WithSpringConfig {
  mass?: number;
  stiffness?: number;
  damping?: number;
  duration?: number;
  dampingRatio?: number;
  velocity?: number;
  overshootClamping?: boolean;
  energyThreshold?: number;
  clamp?: { min?: number; max?: number };
  reduceMotion?: ReduceMotionValue;
  /** Reanimated 3 names, still accepted */
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
}

export const Reanimated3DefaultSpringConfig = { damping: 10, mass: 1, stiffness: 100 } as const;
export const Reanimated3DefaultSpringConfigWithDuration = { duration: 1333, dampingRatio: 0.5 } as const;
export const WigglySpringConfig = { damping: 90, mass: 4, stiffness: 900 } as const;
export const WigglySpringConfigWithDuration = { duration: 550, dampingRatio: 0.75 } as const;
export const GentleSpringConfig = { damping: 120, mass: 4, stiffness: 900 } as const;
export const GentleSpringConfigWithDuration = { duration: 550, dampingRatio: 1 } as const;
export const SnappySpringConfig = { damping: 110, mass: 4, stiffness: 900, overshootClamping: true } as const;
export const SnappySpringConfigWithDuration = { duration: 550, dampingRatio: 0.92, overshootClamping: true } as const;

interface SpringParams {
  mass: number;
  stiffness: number;
  zeta: number;
  overshootClamping: boolean;
  energyThreshold: number;
}

/** Reanimated 4 defaults: the gentle spring, or duration + dampingRatio when either is given. */
function springParams(config: WithSpringConfig, x0: number, v0: number): SpringParams {
  const useDuration = config.duration != null || config.dampingRatio != null;
  const mass = config.mass ?? 4;
  const energyThreshold = config.energyThreshold ?? 6e-9;
  const overshootClamping = !!config.overshootClamping;
  if (useDuration) {
    const zeta = config.dampingRatio ?? 1;
    const duration = config.duration ?? 550;
    const stiffness = stiffnessForDuration(x0 || 1, v0, mass, zeta, duration, energyThreshold);
    return { mass, stiffness, zeta, overshootClamping, energyThreshold };
  }
  const stiffness = config.stiffness ?? 900;
  const damping = config.damping ?? 120;
  return { mass, stiffness, zeta: damping / (2 * Math.sqrt(stiffness * mass)), overshootClamping, energyThreshold };
}

const energy = (x: number, v: number, k: number, m: number) => 0.5 * k * x * x + 0.5 * m * v * v;

/** The stiffness whose critically-damped envelope settles in 1.5 × the perceptual duration (Reanimated's model). */
function stiffnessForDuration(x0: number, v0: number, m: number, zeta: number, duration: number, threshold: number): number {
  const settle = (duration * 1.5) / 1000;
  const diff = (k: number) => {
    const w = Math.sqrt(k / m) * zeta;
    const decay = Math.exp(-w * settle);
    const xt = (x0 + (v0 + x0 * w) * settle) * decay;
    const vt = (x0 + (v0 + x0 * w) * settle) * decay * -w + (v0 + x0 * w) * decay;
    return energy(xt, vt, k, m) / energy(x0, v0, k, m) - threshold;
  };
  let lo = Number.EPSILON;
  let hi = 8e3;
  const dir = diff(hi) >= diff(lo) ? 1 : -1;
  let mid = (lo + hi) / 2;
  for (let i = 0; i < 100 && Math.abs(diff(mid)) > threshold * 1e-3; i++) {
    if (diff(mid) * dir < 0) lo = mid;
    else hi = mid;
    mid = (lo + hi) / 2;
  }
  return mid;
}

/** Closed-form damped oscillator step from (x0, v0) relative to the target. */
function oscillate(p: SpringParams, x0: number, v0: number, t: number): [number, number] {
  const w0 = Math.sqrt(p.stiffness / p.mass);
  if (p.zeta < 1) {
    const w1 = w0 * Math.sqrt(1 - p.zeta * p.zeta);
    const env = Math.exp(-p.zeta * w0 * t);
    const sin = Math.sin(w1 * t);
    const cos = Math.cos(w1 * t);
    const frag = env * (sin * ((v0 + p.zeta * w0 * x0) / w1) + x0 * cos);
    const v = -p.zeta * w0 * frag + env * (cos * (v0 + p.zeta * w0 * x0) - w1 * x0 * sin);
    return [frag, v];
  }
  const env = Math.exp(-w0 * t);
  const x = env * (x0 + (v0 + w0 * x0) * t);
  const v = env * -w0 * (x0 + (v0 + w0 * x0) * t) + env * (v0 + w0 * x0);
  return [x, v];
}

export function springAnimation(toValue: unknown, config: WithSpringConfig = {}, callback?: AnimationCallback): AnimationObject {
  let target: Vector = vectorize(toValue);
  let positions: number[] = [];
  let velocities: number[] = [];
  let starts: number[] = [];
  let params: SpringParams | null = null;
  let initialEnergy = 0;
  let last = 0;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('spring', toValue, config),
    current: toValue,
    toValue,
    velocity: config.velocity ?? 0,
    callback,
    onStart(start, now, previous) {
      target = vectorize(anim.toValue);
      positions = componentsLike(start, target);
      starts = positions.slice();
      let v0 = (config.velocity ?? 0) + (previous?.velocity ?? 0);
      const scalarTarget = target.components[0] ?? 0;
      // Inertia is kept only when it already points toward the target.
      if (positions.length === 1 && ((scalarTarget > positions[0]! && v0 < 0) || (scalarTarget < positions[0]! && v0 > 0))) v0 = 0;
      velocities = positions.map((_, i) => (i === 0 ? v0 : 0));
      const x0 = (positions[0] ?? 0) - scalarTarget;
      params = springParams(config, x0, v0);
      initialEnergy = positions.reduce((sum, p, i) => sum + energy(p - target.components[i]!, velocities[i]!, params!.stiffness, params!.mass), 0);
      last = now;
      anim.current = start;
    },
    onFrame(now) {
      const p = params!;
      if (!target.components.length || initialEnergy === 0) return finish();
      const dt = Math.min(Math.max(now - last, 0), 64) / 1000;
      last = now;
      let total = 0;
      let clamped = false;
      for (let i = 0; i < positions.length; i++) {
        const to = target.components[i]!;
        const [x, v] = oscillate(p, positions[i]! - to, velocities[i]!, dt);
        positions[i] = to + x;
        velocities[i] = v;
        total += energy(x, v, p.stiffness, p.mass);
        if (p.overshootClamping && Math.sign(positions[i]! - to) !== Math.sign(starts[i]! - to) && starts[i] !== to) clamped = true;
      }
      if (config.clamp) {
        const { min = -Infinity, max = Infinity } = config.clamp;
        positions = positions.map((x) => Math.min(max, Math.max(min, x)));
      }
      anim.velocity = velocities[0] ?? 0;
      if (clamped || total / initialEnergy <= p.energyThreshold) return finish();
      anim.current = target.build(positions);
      return false;
    },
  };
  function finish(): true {
    anim.current = anim.toValue;
    anim.velocity = 0;
    return true;
  }
  return anim;
}

// ── decay ──────────────────────────────────────────────────────────────────

export interface WithDecayConfig {
  velocity?: number;
  deceleration?: number;
  velocityFactor?: number;
  clamp?: [number, number];
  rubberBandEffect?: boolean;
  rubberBandFactor?: number;
  reduceMotion?: ReduceMotionValue;
}

/** Scroll-like deceleration: v(t) = v0 · deceleration^t (t in ms), as in Reanimated. */
export function decayAnimation(config: WithDecayConfig = {}, callback?: AnimationCallback): AnimationObject {
  const deceleration = config.deceleration ?? 0.998;
  const factor = config.velocityFactor ?? 1;
  let x = 0;
  let v = 0;
  let last = 0;
  let bounce: AnimationObject | null = null;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('decay', config, Math.random()),
    current: 0,
    velocity: (config.velocity ?? 0) * factor,
    callback,
    onStart(start, now) {
      x = typeof start === 'number' ? start : 0;
      v = (config.velocity ?? 0) * factor;
      last = now;
      anim.current = x;
    },
    onFrame(now) {
      if (bounce) {
        const done = bounce.onFrame(now);
        anim.current = bounce.current;
        return done;
      }
      const dt = Math.max(0, now - last);
      last = now;
      const kv = Math.pow(deceleration, dt);
      const kx = (deceleration * (1 - kv)) / (1 - deceleration);
      x += (v / 1000) * kx;
      v *= kv;
      anim.velocity = v;
      if (config.clamp) {
        const [min, max] = config.clamp;
        if (x < min || x > max) {
          const edge = x < min ? min : max;
          if (!config.rubberBandEffect) {
            anim.current = edge;
            return true;
          }
          bounce = springAnimation(edge, { velocity: v * (config.rubberBandFactor ?? 0.6), damping: 30, stiffness: 300, mass: 1 });
          bounce.onStart(x, now, null);
        }
      }
      anim.current = x;
      return Math.abs(v) < 1;
    },
  };
  return anim;
}

// ── composition ────────────────────────────────────────────────────────────

/** Waits, then starts `animation`; any previous animation keeps running meanwhile. */
export function delayAnimation(delayMs: number, animation: AnimationObject, _reduceMotion?: ReduceMotionValue): AnimationObject {
  let startTime = 0;
  let started = false;
  let previous: AnimationObject | null = null;
  let startValue: unknown;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('delay', delayMs, animation.signature),
    current: animation.current,
    toValue: animation.toValue,
    velocity: 0,
    callback: animation.callback,
    onStart(start, now, prev) {
      startTime = now;
      started = false;
      previous = prev;
      startValue = start;
      anim.current = start;
    },
    onFrame(now) {
      if (!started) {
        if (now - startTime < delayMs) {
          if (previous && !previous.onFrame(now)) anim.current = previous.current;
          else previous = null;
          return false;
        }
        animation.onStart(previous ? previous.current : anim.current ?? startValue, now, previous);
        started = true;
      }
      const done = animation.onFrame(now);
      anim.current = animation.current;
      anim.velocity = animation.velocity;
      return done;
    },
  };
  return anim;
}

export function sequenceAnimation(...items: Array<AnimationObject | ReduceMotionValue>): AnimationObject {
  const animations = items.filter(isAnimation);
  let index = 0;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('sequence', animations.map((a) => a.signature)),
    current: animations[0]?.current,
    toValue: animations[animations.length - 1]?.toValue,
    velocity: 0,
    onStart(start, now, previous) {
      index = 0;
      anim.current = start;
      animations[0]?.onStart(start, now, previous);
    },
    onFrame(now) {
      const current = animations[index];
      if (!current) return true;
      const done = current.onFrame(now);
      anim.current = current.current;
      anim.velocity = current.velocity;
      if (!done) return false;
      current.callback?.(true, current.current);
      index++;
      const next = animations[index];
      if (!next) return true;
      next.onStart(current.current, now, current);
      return false;
    },
  };
  return anim;
}

/** Repeats `animation`; numberOfReps <= 0 repeats forever; `reverse` ping-pongs. */
export function repeatAnimation(
  animation: AnimationObject,
  numberOfReps = 2,
  reverse = false,
  callback?: AnimationCallback,
  _reduceMotion?: ReduceMotionValue,
): AnimationObject {
  let reps = 0;
  let startValue: unknown;
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('repeat', animation.signature, numberOfReps, reverse),
    current: animation.current,
    toValue: animation.toValue,
    velocity: 0,
    callback,
    onStart(start, now, previous) {
      reps = 0;
      startValue = start;
      anim.current = start;
      animation.onStart(start, now, previous);
    },
    onFrame(now) {
      const done = animation.onFrame(now);
      anim.current = animation.current;
      if (!done) return false;
      reps++;
      animation.callback?.(true, animation.current);
      if (numberOfReps > 0 && reps >= numberOfReps) return true;
      let from = startValue;
      if (reverse) {
        from = animation.current;
        animation.toValue = startValue;
        startValue = from;
      }
      animation.onStart(from, now, null);
      return false;
    },
  };
  return anim;
}

/** Keeps a (spring) animation's value within [min, max]. */
export function clampAnimation(config: { min?: number; max?: number }, animation: AnimationObject): AnimationObject {
  const clamp = (v: unknown) => (typeof v === 'number' ? Math.min(config.max ?? Infinity, Math.max(config.min ?? -Infinity, v)) : v);
  const anim: AnimationObject = {
    __reanimatedAnimation: true,
    signature: sig('clamp', config, animation.signature),
    current: animation.current,
    toValue: animation.toValue,
    velocity: 0,
    callback: animation.callback,
    onStart(start, now, previous) {
      animation.onStart(start, now, previous);
      anim.current = clamp(animation.current);
    },
    onFrame(now) {
      const done = animation.onFrame(now);
      anim.current = clamp(animation.current);
      anim.velocity = animation.velocity;
      return done;
    },
  };
  return anim;
}

/** Reanimated's custom-animation entry point: the factory builds the animation object. */
export function defineAnimation<T>(_starting: unknown, factory: () => T): T {
  return factory();
}

// ── public signatures ──────────────────────────────────────────────────────
// Like Reanimated's typings, an animation is typed as the value it animates
// to, so `sv.value = withTiming(1)` type-checks.

export const withTiming = timingAnimation as unknown as <T>(toValue: T, config?: WithTimingConfig, callback?: AnimationCallback) => T;
export const withSpring = springAnimation as unknown as <T>(toValue: T, config?: WithSpringConfig, callback?: AnimationCallback) => T;
export const withDecay = decayAnimation as unknown as (config?: WithDecayConfig, callback?: AnimationCallback) => number;
export const withDelay = delayAnimation as unknown as <T>(delayMs: number, animation: T, reduceMotion?: ReduceMotionValue) => T;
export const withSequence = sequenceAnimation as unknown as <T>(...animations: Array<T | ReduceMotionValue>) => T;
export const withRepeat = repeatAnimation as unknown as <T>(
  animation: T,
  numberOfReps?: number,
  reverse?: boolean,
  callback?: AnimationCallback,
  reduceMotion?: ReduceMotionValue,
) => T;
export const withClamp = clampAnimation as unknown as <T>(config: { min?: number; max?: number }, animation: T) => T;

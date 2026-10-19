import {
  addValues, interpolate, keyPathSpec, toVector, type KeyPathSpec, type LayerState,
} from './animatable';
import { CAMediaTimingFunction } from './ca-media-timing-function';
import { springProgress, springSettlingDuration, perceptualSpring, type SpringParameters } from './spring';

/**
 * Core Animation's explicit animations: CAAnimation and its CAMediaTiming
 * (beginTime, duration, speed, timeOffset, repeatCount, repeatDuration,
 * autoreverses, fillMode), CAPropertyAnimation, CABasicAnimation,
 * CAKeyframeAnimation, CASpringAnimation and CAAnimationGroup.
 *
 * Animations never change the layer's model values. The render server
 * evaluates them every frame on top of the model (see CALayer) — which is
 * also why `layer.position` still reads the model value mid-animation.
 * Times are in seconds, like CFTimeInterval.
 */
export enum CAMediaTimingFillMode { removed = 'removed', forwards = 'forwards', backwards = 'backwards', both = 'both' }

export enum CAAnimationCalculationMode { linear = 'linear', discrete = 'discrete', paced = 'paced', cubic = 'cubic', cubicPaced = 'cubicPaced' }

export interface CAAnimationDelegate {
  animationDidStart?(animation: CAAnimation): void;
  animationDidStop?(animation: CAAnimation, finished: boolean): void;
}

/** Where an animation is in its active duration at a moment. */
export type TimingPhase = 'before' | 'active' | 'after';

export interface LocalTime {
  phase: TimingPhase;
  /** whether the animation contributes a value at this moment (fill modes) */
  applies: boolean;
  /** seconds into the current cycle, already reversed when autoreversing */
  within: number;
  /** completed repetitions */
  iteration: number;
}

/** CAAnimation.defaultValue(forKey:) duration when neither the animation nor a transaction sets one. */
export const DEFAULT_DURATION = 0.25;

export abstract class CAAnimation {
  beginTime = 0;
  duration = 0;
  speed = 1;
  timeOffset = 0;
  repeatCount = 0;
  repeatDuration = 0;
  autoreverses = false;
  fillMode = CAMediaTimingFillMode.removed;
  timingFunction: CAMediaTimingFunction | null = null;
  delegate: CAAnimationDelegate | null = null;
  isRemovedOnCompletion = true;
  /** iOS 15: preferredFrameRateRange (accepted, frames are the display's) */
  preferredFrameRateRange: { minimum: number; maximum: number; preferred?: number } | null = null;

  /** CA copies an animation when it is added to a layer. */
  copy(): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(clone, this);
    return clone;
  }

  /** The duration the animation runs with (0 means the transaction's / the default). */
  get effectiveDuration(): number {
    return this.duration > 0 ? this.duration : DEFAULT_DURATION;
  }

  /** One pass, forward and (when autoreversing) back. */
  get cycleDuration(): number {
    return this.effectiveDuration * (this.autoreverses ? 2 : 1);
  }

  /** How long the animation is active, in its parent's time (Infinity when it repeats forever). */
  get activeDuration(): number {
    const cycle = this.cycleDuration;
    const active = this.repeatDuration > 0 ? this.repeatDuration : cycle * (this.repeatCount > 0 ? this.repeatCount : 1);
    return active / Math.abs(this.speed || 1);
  }

  /** The animation's local time for a time in its parent's timeline (CAMediaTiming). */
  localTime(parentTime: number): LocalTime {
    const speed = this.speed;
    const t = (parentTime - this.beginTime) * speed + this.timeOffset;
    const active = this.repeatDuration > 0 ? this.repeatDuration : this.cycleDuration * (this.repeatCount > 0 ? this.repeatCount : 1);
    const fill = this.fillMode;
    if (t < 0 && speed !== 0) {
      const applies = fill === CAMediaTimingFillMode.backwards || fill === CAMediaTimingFillMode.both;
      return { phase: 'before', applies, within: 0, iteration: 0 };
    }
    if (speed !== 0 && t >= active) {
      const applies = fill === CAMediaTimingFillMode.forwards || fill === CAMediaTimingFillMode.both;
      return { phase: 'after', applies, ...this.cyclePosition(active, true) };
    }
    return { phase: 'active', applies: true, ...this.cyclePosition(Math.max(0, t), false) };
  }

  private cyclePosition(t: number, atEnd: boolean): { within: number; iteration: number } {
    const d = this.effectiveDuration;
    const cycle = this.cycleDuration;
    const iteration = Math.max(0, atEnd ? Math.ceil(t / cycle) - 1 : Math.floor(t / cycle));
    let within = Math.min(cycle, t - iteration * cycle);
    if (this.autoreverses && within > d) within = cycle - within;
    return { within, iteration };
  }

  /** Progress through one pass, `within` seconds in (timing curve applied). */
  progress(within: number): number {
    const d = this.effectiveDuration;
    const fraction = d > 0 ? Math.max(0, Math.min(1, within / d)) : 1;
    return this.timingFunction ? this.timingFunction.evaluate(fraction) : fraction;
  }

  /**
   * @internal Apply this animation's value at `parentTime` to `state`.
   * Returns false when it contributes nothing at that moment.
   */
  abstract _apply(state: LayerState, parentTime: number): boolean;

  /** @internal the key paths this animation writes */
  abstract _keyPaths(): string[];
}

// ── property animations ──────────────────────────────────────────────────

export abstract class CAPropertyAnimation extends CAAnimation {
  keyPath: string | null;
  isAdditive = false;
  isCumulative = false;

  constructor(keyPath: string | null = null) {
    super();
    this.keyPath = keyPath;
  }

  protected get spec(): KeyPathSpec {
    if (!this.keyPath) throw new Error(`${this.constructor.name}: keyPath is not set`);
    return keyPathSpec(this.keyPath);
  }

  _keyPaths(): string[] {
    return this.keyPath ? [this.keyPath] : [];
  }

  /** The animated value for this moment, given the value beneath it. */
  protected abstract valueAt(progress: number, base: number[], iteration: number): number[];

  _apply(state: LayerState, parentTime: number): boolean {
    const time = this.localTime(parentTime);
    if (!time.applies) return false;
    const spec = this.spec;
    const base = spec.get(state);
    const value = this.valueAt(this.progress(time.within), base, time.iteration);
    spec.set(state, this.isAdditive ? addValues(spec.kind, base, value) : value);
    return true;
  }
}

/** CABasicAnimation: from one value to another (either may be left to the layer's own). */
export class CABasicAnimation extends CAPropertyAnimation {
  fromValue: unknown = null;
  toValue: unknown = null;
  byValue: unknown = null;

  protected valueAt(progress: number, base: number[], iteration: number): number[] {
    const { kind } = this.spec;
    const vec = (v: unknown) => (v == null ? null : toVector(v, kind));
    const from0 = vec(this.fromValue);
    const to0 = vec(this.toValue);
    const by = vec(this.byValue);
    // Without both ends, the missing one is the value beneath (the model, or what
    // the animations before this one made of it) — or nothing, when additive.
    const current = this.isAdditive ? base.map(() => 0) : base;
    let from: number[];
    let to: number[];
    if (from0 && to0) [from, to] = [from0, to0];
    else if (from0 && by) [from, to] = [from0, addValues(kind, from0, by)];
    else if (by && to0) [from, to] = [addValues(kind, to0, by.map((n) => -n)), to0];
    else if (from0) [from, to] = [from0, current];
    else if (to0) [from, to] = [current, to0];
    else if (by) [from, to] = [current, addValues(kind, current, by)];
    else return current;
    let value = interpolate(kind, from, to, progress);
    if (this.isCumulative && iteration > 0 && kind !== 'transform') {
      value = value.map((v, i) => v + iteration * ((to[i] ?? 0) - (from[i] ?? 0)));
    }
    return value;
  }
}

/** CASpringAnimation: a basic animation whose progress is a damped spring. */
export class CASpringAnimation extends CABasicAnimation {
  mass = 1;
  stiffness = 100;
  damping = 10;
  initialVelocity = 0;
  allowsOverdamping = false;

  constructor(keyPath?: string | null);
  /** iOS 17: CASpringAnimation(perceptualDuration:bounce:) */
  constructor(options: { perceptualDuration: number; bounce: number; keyPath?: string | null });
  constructor(arg: string | null | { perceptualDuration: number; bounce: number; keyPath?: string | null } = null) {
    super(typeof arg === 'object' && arg !== null ? arg.keyPath ?? null : arg);
    if (typeof arg === 'object' && arg !== null) {
      const p = perceptualSpring(arg.perceptualDuration, arg.bounce);
      this.mass = p.mass;
      this.stiffness = p.stiffness;
      this.damping = p.damping;
    }
  }

  get parameters(): SpringParameters {
    // Without allowsOverdamping, CA clamps the damping ratio to 1.
    const critical = 2 * Math.sqrt(this.stiffness * this.mass);
    const damping = this.allowsOverdamping ? this.damping : Math.min(this.damping, critical);
    return { mass: this.mass, stiffness: this.stiffness, damping, initialVelocity: this.initialVelocity };
  }

  /** How long the spring takes to come to rest (set `duration` to it for the full motion). */
  get settlingDuration(): number {
    return springSettlingDuration(this.parameters);
  }

  /** iOS 17: the undamped period (2π·√(m/k)). */
  get perceptualDuration(): number {
    return 2 * Math.PI * Math.sqrt(this.mass / this.stiffness);
  }

  /** iOS 17: 1 - damping ratio (negative when overdamped). */
  get bounce(): number {
    const ratio = this.damping / (2 * Math.sqrt(this.stiffness * this.mass));
    return ratio <= 1 ? 1 - ratio : 1 / ratio - 1;
  }

  override progress(within: number): number {
    return springProgress(this.parameters, within);
  }
}

/** CAKeyframeAnimation: through a list of values at key times. */
export class CAKeyframeAnimation extends CAPropertyAnimation {
  values: unknown[] | null = null;
  /** 0…1, one per value (evenly spaced when null) */
  keyTimes: number[] | null = null;
  /** one per segment */
  timingFunctions: CAMediaTimingFunction[] | null = null;
  calculationMode = CAAnimationCalculationMode.linear;

  protected valueAt(progress: number, base: number[]): number[] {
    const { kind } = this.spec;
    const values = (this.values ?? []).map((v) => toVector(v, kind));
    const n = values.length;
    if (n === 0) return this.isAdditive ? base.map(() => 0) : base;
    if (n === 1) return values[0]!;
    const discrete = this.calculationMode === CAAnimationCalculationMode.discrete;
    const times = this.times(values, discrete);
    if (discrete) {
      let at = 0;
      for (let i = 0; i < n; i++) if (progress >= times[i]!) at = i;
      return values[at]!;
    }
    let i = 0;
    while (i < n - 2 && progress > times[i + 1]!) i++;
    const span = times[i + 1]! - times[i]!;
    let local = span > 0 ? Math.max(0, Math.min(1, (progress - times[i]!) / span)) : 1;
    const fn = this.timingFunctions?.[i];
    if (fn) local = fn.evaluate(local);
    if (this.calculationMode === CAAnimationCalculationMode.cubic || this.calculationMode === CAAnimationCalculationMode.cubicPaced) {
      return catmullRom(values[Math.max(0, i - 1)]!, values[i]!, values[i + 1]!, values[Math.min(n - 1, i + 2)]!, local);
    }
    return interpolate(kind, values[i]!, values[i + 1]!, local);
  }

  private times(values: number[][], discrete: boolean): number[] {
    const n = values.length;
    const paced = this.calculationMode === CAAnimationCalculationMode.paced || this.calculationMode === CAAnimationCalculationMode.cubicPaced;
    if (paced) {
      // Even speed: key times proportional to the distance covered.
      const lengths = [0];
      for (let i = 1; i < n; i++) lengths.push(lengths[i - 1]! + Math.hypot(...values[i]!.map((v, k) => v - (values[i - 1]![k] ?? 0))));
      const total = lengths[n - 1]! || 1;
      return lengths.map((l) => l / total);
    }
    const given = this.keyTimes;
    if (given && given.length >= n) return given;
    return Array.from({ length: n }, (_, i) => (discrete ? i / n : i / (n - 1)));
  }
}

function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((v1, i) => {
    const v0 = p0[i] ?? v1;
    const v2 = p2[i] ?? v1;
    const v3 = p3[i] ?? v2;
    return 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
  });
}

/** CAAnimationGroup: animations sharing one timeline (theirs is the group's local time). */
export class CAAnimationGroup extends CAAnimation {
  animations: CAAnimation[] | null = null;

  override copy(): this {
    const clone = super.copy();
    clone.animations = this.animations?.map((a) => a.copy()) ?? null;
    return clone;
  }

  _keyPaths(): string[] {
    return (this.animations ?? []).flatMap((a) => a._keyPaths());
  }

  _apply(state: LayerState, parentTime: number): boolean {
    const time = this.localTime(parentTime);
    if (!time.applies) return false;
    // The group's timing function warps the time its children see.
    const local = this.progress(time.within) * this.effectiveDuration;
    let any = false;
    for (const child of this.animations ?? []) any = child._apply(state, local) || any;
    return any;
  }
}


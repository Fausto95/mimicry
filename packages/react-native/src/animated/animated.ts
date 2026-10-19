import { parseColor, type FrameTask } from '@mimicry/react-native-fabric';
import { getEngine, maybeEngine } from '../engine-ref';
import { Easing, type EasingFunction } from './easing';

/**
 * Animated, driven by the engine's frame clock. Every animation behaves like
 * `useNativeDriver: true`: values are stepped once per frame inside the
 * engine and written straight onto host nodes (setOverrides), so React never
 * re-renders for an animation frame. `useNativeDriver` is accepted and ignored.
 */

type Listener = (state: { value: number }) => void;

export abstract class AnimatedNode {
  protected dependents = new Set<AnimatedNode | (() => void)>();
  abstract __getValue(): any;

  __addDependent(d: AnimatedNode | (() => void)): void {
    this.dependents.add(d);
  }

  __removeDependent(d: AnimatedNode | (() => void)): void {
    this.dependents.delete(d);
  }

  /** propagate a change to interpolations and mounted components */
  __notify(): void {
    for (const d of Array.from(this.dependents)) {
      if (typeof d === 'function') d();
      else d.__notify();
    }
  }

  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }

  /** leaf values this node reads (for subscriptions) */
  __leaves(): AnimatedValue[] {
    return [];
  }

  toJSON(): any {
    return this.__getValue();
  }
}

let nextValueId = 1;

export class AnimatedValue extends AnimatedNode {
  readonly _id = nextValueId++;
  _value: number;
  _offset = 0;
  private animation: Animation | null = null;
  private listeners = new Map<string, Listener>();
  private nextListener = 1;

  constructor(value = 0, _config?: { useNativeDriver?: boolean }) {
    super();
    this._value = value;
  }

  __getValue(): number {
    return this._value + this._offset;
  }

  override __leaves(): AnimatedValue[] {
    return [this];
  }

  setValue(value: number): void {
    this.stopCurrent();
    this.update(value);
  }

  setOffset(offset: number): void {
    this._offset = offset;
    this.changed();
  }

  flattenOffset(): void {
    this._value += this._offset;
    this._offset = 0;
  }

  extractOffset(): void {
    this._offset += this._value;
    this._value = 0;
  }

  addListener(callback: Listener): string {
    const id = String(this.nextListener++);
    this.listeners.set(id, callback);
    return id;
  }

  removeListener(id: string): void {
    this.listeners.delete(id);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  stopAnimation(callback?: (value: number) => void): void {
    this.stopCurrent();
    callback?.(this.__getValue());
  }

  resetAnimation(callback?: (value: number) => void): void {
    this.stopAnimation(callback);
  }

  private stopCurrent(): void {
    const a = this.animation;
    this.animation = null;
    a?.stop();
  }

  /** @internal used by animations */
  update(value: number): void {
    this._value = value;
    this.changed();
  }

  private changed(): void {
    this.__notify();
    if (this.listeners.size) {
      const v = { value: this.__getValue() };
      for (const l of this.listeners.values()) l(v);
    }
  }

  /** @internal */
  animate(animation: Animation, callback?: EndCallback): void {
    const previous = this.animation;
    this.animation = animation;
    previous?.stop();
    animation.start(
      this._value,
      (value) => this.update(value),
      (result) => {
        if (this.animation === animation) this.animation = null;
        callback?.(result);
      },
      previous,
    );
  }
}

export class AnimatedValueXY extends AnimatedNode {
  x: AnimatedValue;
  y: AnimatedValue;

  constructor(value?: { x: number | AnimatedValue; y: number | AnimatedValue }) {
    super();
    const v = value ?? { x: 0, y: 0 };
    this.x = v.x instanceof AnimatedValue ? v.x : new AnimatedValue(v.x);
    this.y = v.y instanceof AnimatedValue ? v.y : new AnimatedValue(v.y);
    this.x.__addDependent(this);
    this.y.__addDependent(this);
  }

  __getValue() {
    return { x: this.x.__getValue(), y: this.y.__getValue() };
  }

  override __leaves(): AnimatedValue[] {
    return [this.x, this.y];
  }

  setValue(v: { x: number; y: number }) {
    this.x.setValue(v.x);
    this.y.setValue(v.y);
  }
  setOffset(v: { x: number; y: number }) {
    this.x.setOffset(v.x);
    this.y.setOffset(v.y);
  }
  flattenOffset() {
    this.x.flattenOffset();
    this.y.flattenOffset();
  }
  extractOffset() {
    this.x.extractOffset();
    this.y.extractOffset();
  }
  stopAnimation(cb?: (v: { x: number; y: number }) => void) {
    this.x.stopAnimation();
    this.y.stopAnimation();
    cb?.(this.__getValue());
  }
  resetAnimation(cb?: (v: { x: number; y: number }) => void) {
    this.stopAnimation(cb);
  }
  addListener(cb: (v: { x: number; y: number }) => void): string {
    const id = this.x.addListener(() => cb(this.__getValue()));
    this.y.addListener(() => cb(this.__getValue()));
    return id;
  }
  removeListener(id: string) {
    this.x.removeListener(id);
  }
  getLayout() {
    return { left: this.x, top: this.y };
  }
  getTranslateTransform() {
    return [{ translateX: this.x }, { translateY: this.y }];
  }
}

// ── interpolation ──────────────────────────────────────────────────────────

export type Extrapolate = 'extend' | 'clamp' | 'identity';

export interface InterpolationConfig {
  inputRange: number[];
  outputRange: number[] | string[];
  easing?: EasingFunction;
  extrapolate?: Extrapolate;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
}

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function interpolateNumber(input: number, config: InterpolationConfig, out: number[]): number {
  const { inputRange } = config;
  let i = 1;
  for (; i < inputRange.length - 1; i++) if (inputRange[i]! >= input) break;
  i -= 1;
  const inMin = inputRange[i]!;
  const inMax = inputRange[i + 1]!;
  const outMin = out[i]!;
  const outMax = out[i + 1]!;
  const left = config.extrapolateLeft ?? config.extrapolate ?? 'extend';
  const right = config.extrapolateRight ?? config.extrapolate ?? 'extend';
  let result = input;
  if (result < inMin) {
    if (left === 'identity') return result;
    if (left === 'clamp') result = inMin;
  }
  if (result > inMax) {
    if (right === 'identity') return result;
    if (right === 'clamp') result = inMax;
  }
  if (outMin === outMax) return outMin;
  if (inMin === inMax) return input <= inMin ? outMin : outMax;
  let t = inMin === -Infinity ? -result : inMax === Infinity ? result - inMin : (result - inMin) / (inMax - inMin);
  t = (config.easing ?? Easing.linear)(t);
  if (outMin === -Infinity) return -t;
  if (outMax === Infinity) return t;
  return outMin + t * (outMax - outMin);
}

export function createInterpolation(config: InterpolationConfig): (input: number) => number | string {
  const output = config.outputRange;
  if (typeof output[0] !== 'string') return (input) => interpolateNumber(input, config, output as number[]);
  const strings = output as string[];
  const colors = strings.map((s) => parseColor(s));
  if (colors.every((c) => c != null)) {
    const channels = [0, 1, 2, 3].map((ch) => colors.map((c) => (ch === 3 ? (c! & 255) / 255 : (c! >>> (24 - ch * 8)) & 255)));
    return (input) => {
      const [r, g, b, a] = channels.map((range) => interpolateNumber(input, config, range));
      return `rgba(${Math.round(r!)}, ${Math.round(g!)}, ${Math.round(b!)}, ${Math.round(a! * 1000) / 1000})`;
    };
  }
  // Strings with numbers in them, e.g. '0deg' → '360deg'.
  const template = strings[0]!;
  const numbers = strings.map((s) => (s.match(NUMBER_RE) ?? []).map(Number));
  const columns = numbers[0]!.map((_, i) => numbers.map((n) => n[i]!));
  return (input) => {
    let k = 0;
    return template.replace(NUMBER_RE, () => {
      const v = interpolateNumber(input, config, columns[k++]!);
      return String(Math.round(v * 1e5) / 1e5);
    });
  };
}

export class AnimatedInterpolation extends AnimatedNode {
  private readonly fn: (input: number) => number | string;
  constructor(private readonly parent: AnimatedNode, private readonly config: InterpolationConfig) {
    super();
    this.fn = createInterpolation(config);
    parent.__addDependent(this);
  }
  __getValue() {
    return this.fn(this.parent.__getValue());
  }
  override __leaves(): AnimatedValue[] {
    return this.parent.__leaves();
  }
  override interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }
}

class AnimatedOperator extends AnimatedNode {
  constructor(private readonly inputs: AnimatedNode[], private readonly op: (...v: number[]) => number) {
    super();
    for (const i of inputs) i.__addDependent(this);
  }
  __getValue() {
    return this.op(...this.inputs.map((i) => i.__getValue() as number));
  }
  override __leaves(): AnimatedValue[] {
    return this.inputs.flatMap((i) => i.__leaves());
  }
}

const node = (v: AnimatedNode | number): AnimatedNode => (typeof v === 'number' ? new AnimatedValue(v) : v);

export const add = (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedOperator([node(a), node(b)], (x, y) => x + y);
export const subtract = (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedOperator([node(a), node(b)], (x, y) => x - y);
export const multiply = (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedOperator([node(a), node(b)], (x, y) => x * y);
export const divide = (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedOperator([node(a), node(b)], (x, y) => (y === 0 ? 0 : x / y));
export const modulo = (a: AnimatedNode, m: number) => new AnimatedOperator([a], (x) => ((x % m) + m) % m);
export function diffClamp(a: AnimatedNode, min: number, max: number) {
  let last: number | null = null;
  let value = 0;
  return new AnimatedOperator([a], (x) => {
    const diff = last === null ? 0 : x - last;
    last = x;
    value = Math.min(Math.max(value + diff, min), max);
    return value;
  });
}

// ── animations ─────────────────────────────────────────────────────────────

export type EndResult = { finished: boolean };
export type EndCallback = (result: EndResult) => void;

/** One-shot frame driver shared by all animations of a value. */
abstract class Animation implements FrameTask {
  protected onUpdate!: (value: number) => void;
  protected onEnd!: EndCallback;
  protected startTime = -1;
  protected from = 0;
  private active = false;
  private delayTimer: unknown = null;
  constructor(protected readonly delay = 0) {}

  start(from: number, onUpdate: (v: number) => void, onEnd: EndCallback, previous: Animation | null): void {
    this.from = from;
    this.onUpdate = onUpdate;
    this.onEnd = onEnd;
    this.inherit(previous);
    const begin = () => {
      this.delayTimer = null;
      this.active = true;
      this.startTime = -1;
      const engine = getEngine();
      engine.animator.add(this);
      engine.requestFrame();
    };
    if (this.delay > 0) this.delayTimer = getEngine().clock.setTimeout(begin, this.delay);
    else begin();
  }

  protected inherit(_previous: Animation | null): void {}

  tick(now: number): boolean {
    if (!this.active) return false;
    if (this.startTime < 0) this.startTime = now;
    const done = this.step(now - this.startTime);
    if (done) {
      this.active = false;
      this.onEnd({ finished: true });
      return false;
    }
    return true;
  }

  /** returns true when finished */
  protected abstract step(elapsed: number): boolean;

  stop(): void {
    const engine = maybeEngine();
    if (this.delayTimer !== null) {
      engine?.clock.clearTimeout(this.delayTimer);
      this.delayTimer = null;
      this.onEnd?.({ finished: false });
      return;
    }
    if (!this.active) return;
    this.active = false;
    engine?.animator.remove(this);
    this.onEnd({ finished: false });
  }
}

export interface TimingConfig {
  toValue: number | AnimatedValue;
  duration?: number;
  easing?: EasingFunction;
  delay?: number;
  useNativeDriver?: boolean;
  isInteraction?: boolean;
}

class TimingAnimation extends Animation {
  constructor(private readonly config: TimingConfig) {
    super(config.delay ?? 0);
  }
  protected step(elapsed: number): boolean {
    const to = resolveTo(this.config.toValue);
    const duration = this.config.duration ?? 500;
    if (duration <= 0) {
      this.onUpdate(to);
      return true;
    }
    const t = Math.min(1, elapsed / duration);
    const e = (this.config.easing ?? defaultEasing)(t);
    this.onUpdate(this.from + (to - this.from) * e);
    return t >= 1;
  }
}

const defaultEasing = Easing.inOut(Easing.ease);

export interface SpringConfig {
  toValue: number | AnimatedValue;
  overshootClamping?: boolean;
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
  velocity?: number;
  bounciness?: number;
  speed?: number;
  tension?: number;
  friction?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  delay?: number;
  useNativeDriver?: boolean;
}

const stiffnessFromOrigami = (t: number) => (t - 30) * 3.62 + 194;
const dampingFromOrigami = (f: number) => (f - 8) * 3 + 25;

function fromBouncinessAndSpeed(bounciness: number, speed: number) {
  const normalize = (v: number, s: number, e: number) => (v - s) / (e - s);
  const project = (n: number, s: number, e: number) => s + n * (e - s);
  const lin = (t: number, s: number, e: number) => t * e + (1 - t) * s;
  const quadOut = (t: number, s: number, e: number) => lin(2 * t - t * t, s, e);
  const f1 = (x: number) => 0.0007 * x ** 3 - 0.031 * x ** 2 + 0.64 * x + 1.28;
  const f2 = (x: number) => 0.000044 * x ** 3 - 0.006 * x ** 2 + 0.36 * x + 2;
  const f3 = (x: number) => 0.00000045 * x ** 3 - 0.000332 * x ** 2 + 0.1078 * x + 5.84;
  const noBounce = (t: number) => (t <= 18 ? f1(t) : t <= 44 ? f2(t) : f3(t));
  const b = project(normalize(bounciness / 1.7, 0, 20), 0, 0.8);
  const s = normalize(speed / 1.7, 0, 20);
  const tension = project(s, 0.5, 200);
  const friction = quadOut(b, noBounce(tension), 0.01);
  return { stiffness: stiffnessFromOrigami(tension), damping: dampingFromOrigami(friction) };
}

class SpringAnimation extends Animation {
  private stiffness: number;
  private damping: number;
  private mass: number;
  private velocity: number;
  private lastVelocity = 0;
  constructor(private readonly config: SpringConfig) {
    super(config.delay ?? 0);
    if (config.stiffness != null || config.damping != null || config.mass != null) {
      this.stiffness = config.stiffness ?? 100;
      this.damping = config.damping ?? 10;
      this.mass = config.mass ?? 1;
    } else if (config.bounciness != null || config.speed != null) {
      const s = fromBouncinessAndSpeed(config.bounciness ?? 8, config.speed ?? 12);
      this.stiffness = s.stiffness;
      this.damping = s.damping;
      this.mass = 1;
    } else {
      this.stiffness = stiffnessFromOrigami(config.tension ?? 40);
      this.damping = dampingFromOrigami(config.friction ?? 7);
      this.mass = 1;
    }
    this.velocity = config.velocity ?? 0;
  }

  protected override inherit(previous: Animation | null): void {
    if (previous instanceof SpringAnimation && this.config.velocity == null) this.velocity = previous.lastVelocity;
  }

  protected step(elapsedMs: number): boolean {
    const to = resolveTo(this.config.toValue);
    const k = this.stiffness;
    const c = this.damping;
    const m = this.mass;
    const v0 = -this.velocity;
    const zeta = c / (2 * Math.sqrt(k * m));
    const omega0 = Math.sqrt(k / m);
    const omega1 = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
    const x0 = to - this.from;
    const t = elapsedMs / 1000;
    let position: number;
    let velocity: number;
    if (zeta < 1) {
      const envelope = Math.exp(-zeta * omega0 * t);
      position = to - envelope * (((v0 + zeta * omega0 * x0) / omega1) * Math.sin(omega1 * t) + x0 * Math.cos(omega1 * t));
      velocity =
        zeta * omega0 * envelope * ((Math.sin(omega1 * t) * (v0 + zeta * omega0 * x0)) / omega1 + x0 * Math.cos(omega1 * t)) -
        envelope * (Math.cos(omega1 * t) * (v0 + zeta * omega0 * x0) - omega1 * x0 * Math.sin(omega1 * t));
    } else {
      const envelope = Math.exp(-omega0 * t);
      position = to - envelope * (x0 + (v0 + omega0 * x0) * t);
      velocity = envelope * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);
    }
    this.lastVelocity = velocity;
    const overshot = this.config.overshootClamping && this.stiffness !== 0 && (this.from < to ? position > to : position < to);
    const atRest =
      Math.abs(velocity) <= (this.config.restSpeedThreshold ?? 0.001) &&
      Math.abs(to - position) <= (this.config.restDisplacementThreshold ?? 0.001);
    if (overshot || atRest || this.stiffness === 0) {
      this.onUpdate(to);
      return true;
    }
    this.onUpdate(position);
    return false;
  }
}

export interface DecayConfig {
  velocity: number;
  deceleration?: number;
  delay?: number;
  useNativeDriver?: boolean;
}

class DecayAnimation extends Animation {
  private last = 0;
  constructor(private readonly config: DecayConfig) {
    super(config.delay ?? 0);
  }
  protected step(elapsed: number): boolean {
    const d = this.config.deceleration ?? 0.998;
    const value = this.from + (this.config.velocity / (1 - d)) * (1 - Math.exp(-(1 - d) * elapsed));
    this.onUpdate(value);
    const done = Math.abs(this.last - value) < 0.1 && elapsed > 16;
    this.last = value;
    return done;
  }
}

function resolveTo(to: number | AnimatedValue): number {
  return typeof to === 'number' ? to : to.__getValue();
}

// ── composite animations ───────────────────────────────────────────────────

export interface CompositeAnimation {
  start(callback?: EndCallback): void;
  stop(): void;
  reset(): void;
  _startNow?(callback?: EndCallback): void;
}

type AnyValue = AnimatedValue | AnimatedValueXY;

function single(value: AnyValue, make: (v: AnimatedValue, key: 'x' | 'y' | null) => Animation): CompositeAnimation {
  const start = (callback?: EndCallback) => {
    if (value instanceof AnimatedValueXY) {
      let pending = 2;
      let finished = true;
      const done = (r: EndResult) => {
        finished &&= r.finished;
        if (--pending === 0) callback?.({ finished });
      };
      value.x.animate(make(value.x, 'x'), done);
      value.y.animate(make(value.y, 'y'), done);
    } else {
      value.animate(make(value, null), callback);
    }
  };
  return {
    start,
    stop: () => value.stopAnimation(),
    reset: () => {
      value.stopAnimation();
    },
  };
}

const pick = <T extends { toValue: any }>(config: T, key: 'x' | 'y' | null): T =>
  key && typeof config.toValue === 'object' && !(config.toValue instanceof AnimatedNode)
    ? { ...config, toValue: config.toValue[key] }
    : key && config.toValue instanceof AnimatedValueXY
      ? { ...config, toValue: config.toValue[key] }
      : config;

export const timing = (value: AnyValue, config: TimingConfig): CompositeAnimation =>
  single(value, (_v, key) => new TimingAnimation(pick(config, key)));

export const spring = (value: AnyValue, config: SpringConfig): CompositeAnimation =>
  single(value, (_v, key) => new SpringAnimation(pick(config, key)));

export const decay = (value: AnyValue, config: DecayConfig): CompositeAnimation =>
  single(value, (_v, key) => {
    const vel = config.velocity as unknown as number | { x: number; y: number };
    return new DecayAnimation({ ...config, velocity: typeof vel === 'number' ? vel : key ? vel[key] : 0 });
  });

export function sequence(animations: CompositeAnimation[]): CompositeAnimation {
  let current = 0;
  let stopped = false;
  return {
    start(callback) {
      stopped = false;
      const next = (result: EndResult) => {
        if (!result.finished || stopped) return callback?.({ finished: false });
        current++;
        if (current >= animations.length) return callback?.({ finished: true });
        animations[current]!.start(next);
      };
      current = 0;
      if (!animations.length) return callback?.({ finished: true });
      animations[0]!.start(next);
    },
    stop() {
      stopped = true;
      animations[current]?.stop();
    },
    reset() {
      animations.forEach((a) => a.reset());
      current = 0;
    },
  };
}

export function parallel(animations: CompositeAnimation[], config?: { stopTogether?: boolean }): CompositeAnimation {
  const stopTogether = config?.stopTogether !== false;
  return {
    start(callback) {
      let remaining = animations.length;
      let failed = false;
      if (!remaining) return callback?.({ finished: true });
      animations.forEach((a) =>
        a.start((r) => {
          if (!r.finished && stopTogether && !failed) {
            failed = true;
            animations.forEach((o) => o !== a && o.stop());
          }
          if (--remaining === 0) callback?.({ finished: !failed });
        }),
      );
    },
    stop() {
      animations.forEach((a) => a.stop());
    },
    reset() {
      animations.forEach((a) => a.reset());
    },
  };
}

export function delay(time: number): CompositeAnimation {
  return timing(new AnimatedValue(0), { toValue: 0, delay: time, duration: 0 });
}

export function stagger(time: number, animations: CompositeAnimation[]): CompositeAnimation {
  return parallel(animations.map((a, i) => sequence([delay(time * i), a])));
}

export function loop(animation: CompositeAnimation, config?: { iterations?: number; resetBeforeIteration?: boolean }): CompositeAnimation {
  const iterations = config?.iterations ?? -1;
  let stopped = false;
  let count = 0;
  return {
    start(callback) {
      stopped = false;
      count = 0;
      const run = (result: EndResult) => {
        if (stopped || !result.finished) return callback?.({ finished: false });
        if (iterations !== -1 && count >= iterations) return callback?.({ finished: true });
        count++;
        if (config?.resetBeforeIteration !== false) animation.reset();
        animation.start(run);
      };
      if (iterations === 0) return callback?.({ finished: true });
      run({ finished: true });
    },
    stop() {
      stopped = true;
      animation.stop();
    },
    reset() {
      count = 0;
      animation.reset();
    },
  };
}

// ── Animated.event ─────────────────────────────────────────────────────────

export function event(argMapping: Array<unknown>, config?: { listener?: (...args: any[]) => void; useNativeDriver?: boolean }) {
  const apply = (mapping: unknown, value: unknown) => {
    if (mapping instanceof AnimatedValue) {
      if (typeof value === 'number') mapping.setValue(value);
      return;
    }
    if (mapping instanceof AnimatedValueXY) {
      const v = value as { x: number; y: number };
      if (v) mapping.setValue(v);
      return;
    }
    if (mapping && typeof mapping === 'object' && value && typeof value === 'object') {
      for (const key of Object.keys(mapping)) apply((mapping as any)[key], (value as any)[key]);
    }
  };
  const handler = (...args: any[]) => {
    argMapping.forEach((mapping, i) => apply(mapping, args[i]));
    config?.listener?.(...args);
  };
  (handler as any).__isAnimatedEvent = true;
  return handler;
}

export function forkEvent(a: any, listener: (...args: any[]) => void) {
  return (...args: any[]) => {
    if (typeof a === 'function') a(...args);
    listener(...args);
  };
}

export function unforkEvent() {}

export function attachNativeEvent() {
  return { detach() {} };
}

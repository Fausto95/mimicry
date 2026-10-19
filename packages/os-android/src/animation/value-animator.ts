import type { FrameTask, Kernel } from '@mimicry/os-core';
import { Property } from '../util/property';
import { AccelerateDecelerateInterpolator, type TimeInterpolator } from './interpolators';

/**
 * android.animation: Animator, ValueAnimator, TimeAnimator, the type
 * evaluators, Keyframe and PropertyValuesHolder, with the framework's
 * timing semantics (ValueAnimator.java):
 *
 * - start() sets the first value synchronously and notifies start
 *   listeners at once when there is no start delay; the start time is
 *   committed on the next frame, so the first frame shows fraction 0.
 * - A start delay counts from that first frame; start listeners then fire
 *   when the delay elapses.
 * - cancel() calls onAnimationCancel then onAnimationEnd; end() jumps to the
 *   end value and calls onAnimationEnd.
 *
 * Frames come from the AnimationHandler of the kernel the animator runs on
 * (the Choreographer's vsync). Time is the kernel's animation time, which
 * already runs slower when the developer option "animator duration scale"
 * is set (`kernel.animator.timeScale`), so durations are never scaled twice.
 */

// ── AnimationHandler ─────────────────────────────────────────────────────

export interface AnimationFrameCallback {
  /** return true when the animation finished (it is then removed) */
  doAnimationFrame(frameTime: number): boolean;
}

const handlers = new WeakMap<Kernel, AnimationHandler>();
let mainKernel: Kernel | null = null;

/**
 * android.animation.AnimationHandler: the per-looper list of running
 * animations, pulsed once per frame in the order they started.
 */
export class AnimationHandler implements FrameTask {
  private readonly callbacks: AnimationFrameCallback[] = [];

  private constructor(readonly kernel: Kernel) {}

  static forKernel(kernel: Kernel): AnimationHandler {
    let handler = handlers.get(kernel);
    if (!handler) handlers.set(kernel, (handler = new AnimationHandler(kernel)));
    return handler;
  }

  /**
   * The main looper's kernel: animators created without a view (ValueAnimator)
   * run on the most recently booted Android — the equivalent of the
   * framework's thread-local handler.
   */
  static setMainKernel(kernel: Kernel | null): void {
    mainKernel = kernel;
  }

  static getMainKernel(): Kernel | null {
    return mainKernel;
  }

  addAnimationFrameCallback(callback: AnimationFrameCallback): void {
    if (!this.callbacks.includes(callback)) this.callbacks.push(callback);
    this.kernel.animator.add(this);
    this.kernel.requestFrame();
  }

  removeCallback(callback: AnimationFrameCallback): void {
    const at = this.callbacks.indexOf(callback);
    if (at >= 0) this.callbacks.splice(at, 1);
  }

  has(callback: AnimationFrameCallback): boolean {
    return this.callbacks.includes(callback);
  }

  /** AnimationUtils.currentAnimationTimeMillis() */
  now(): number {
    return this.kernel.animator.animationTime;
  }

  tick(animationTime: number): boolean {
    for (const callback of this.callbacks.slice()) {
      if (!this.callbacks.includes(callback)) continue;
      let finished = true;
      try {
        finished = callback.doAnimationFrame(animationTime);
      } catch (error) {
        this.removeCallback(callback);
        this.kernel.reportError(error, 'runtime');
        continue;
      }
      if (finished) this.removeCallback(callback);
    }
    return this.callbacks.length > 0;
  }
}

function resolveKernel(preferred: Kernel | null): Kernel {
  const kernel = preferred ?? mainKernel;
  if (!kernel) throw new Error('AndroidRuntimeException: Animators may only be run on Looper threads (no Android has booted)');
  return kernel;
}

// ── listeners ────────────────────────────────────────────────────────────

export interface AnimatorListener {
  onAnimationStart?(animation: Animator, isReverse: boolean): void;
  onAnimationEnd?(animation: Animator, isReverse: boolean): void;
  onAnimationCancel?(animation: Animator): void;
  onAnimationRepeat?(animation: Animator): void;
}

export interface AnimatorPauseListener {
  onAnimationPause?(animation: Animator): void;
  onAnimationResume?(animation: Animator): void;
}

/** android.animation.AnimatorListenerAdapter: override what you need. */
export class AnimatorListenerAdapter implements AnimatorListener, AnimatorPauseListener {
  onAnimationStart(_animation: Animator, _isReverse: boolean): void {}
  onAnimationEnd(_animation: Animator, _isReverse: boolean): void {}
  onAnimationCancel(_animation: Animator): void {}
  onAnimationRepeat(_animation: Animator): void {}
  onAnimationPause(_animation: Animator): void {}
  onAnimationResume(_animation: Animator): void {}
}

export type AnimatorUpdateListener = ((animation: ValueAnimator) => void) | { onAnimationUpdate(animation: ValueAnimator): void };

// ── Animator ─────────────────────────────────────────────────────────────

export abstract class Animator {
  static readonly DURATION_INFINITE = -1;
  protected listeners: AnimatorListener[] = [];
  protected pauseListeners: AnimatorPauseListener[] = [];
  protected paused = false;

  addListener(listener: AnimatorListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: AnimatorListener): void {
    const at = this.listeners.indexOf(listener);
    if (at >= 0) this.listeners.splice(at, 1);
  }

  getListeners(): AnimatorListener[] {
    return this.listeners.slice();
  }

  addPauseListener(listener: AnimatorPauseListener): void {
    this.pauseListeners.push(listener);
  }

  removePauseListener(listener: AnimatorPauseListener): void {
    const at = this.pauseListeners.indexOf(listener);
    if (at >= 0) this.pauseListeners.splice(at, 1);
  }

  removeAllListeners(): void {
    this.listeners = [];
    this.pauseListeners = [];
  }

  abstract start(): void;
  abstract cancel(): void;
  abstract end(): void;
  abstract isRunning(): boolean;
  abstract setDuration(duration: number): this;
  abstract getDuration(): number;
  abstract setStartDelay(delay: number): void;
  abstract getStartDelay(): number;
  abstract setInterpolator(interpolator: TimeInterpolator | null): void;
  abstract getInterpolator(): TimeInterpolator | null;

  isStarted(): boolean {
    return this.isRunning();
  }

  getTotalDuration(): number {
    const d = this.getDuration();
    return d === Animator.DURATION_INFINITE ? d : this.getStartDelay() + d;
  }

  pause(): void {
    if (this.isStarted() && !this.paused) {
      this.paused = true;
      for (const l of this.pauseListeners.slice()) l.onAnimationPause?.(this);
    }
  }

  resume(): void {
    if (this.paused) {
      this.paused = false;
      for (const l of this.pauseListeners.slice()) l.onAnimationResume?.(this);
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** ObjectAnimator and AnimatorSet use the target; others ignore it. */
  setTarget(_target: unknown): void {}

  setupStartValues(): void {}
  setupEndValues(): void {}

  /** Animators run on a kernel; animators of views use the view's. */
  setKernel(_kernel: Kernel | null): void {}

  protected notifyStart(reverse: boolean): void {
    for (const l of this.listeners.slice()) l.onAnimationStart?.(this, reverse);
  }

  protected notifyEnd(reverse: boolean): void {
    for (const l of this.listeners.slice()) l.onAnimationEnd?.(this, reverse);
  }

  protected notifyCancel(): void {
    for (const l of this.listeners.slice()) l.onAnimationCancel?.(this);
  }

  protected notifyRepeat(): void {
    for (const l of this.listeners.slice()) l.onAnimationRepeat?.(this);
  }
}

// ── evaluators ───────────────────────────────────────────────────────────

export interface TypeEvaluator<T> {
  evaluate(fraction: number, startValue: T, endValue: T): T;
}

export class FloatEvaluator implements TypeEvaluator<number> {
  evaluate(fraction: number, startValue: number, endValue: number): number {
    return startValue + fraction * (endValue - startValue);
  }
}

/** Truncates toward zero, like Java's (int) cast. */
export class IntEvaluator implements TypeEvaluator<number> {
  evaluate(fraction: number, startValue: number, endValue: number): number {
    return Math.trunc(startValue + fraction * (endValue - startValue));
  }
}

/**
 * android.animation.ArgbEvaluator: interpolates ARGB ints in linear light
 * (gamma 2.2), as the framework has since API 26.
 */
export class ArgbEvaluator implements TypeEvaluator<number> {
  private static readonly instance = new ArgbEvaluator();
  static getInstance(): ArgbEvaluator {
    return ArgbEvaluator.instance;
  }

  evaluate(fraction: number, startValue: number, endValue: number): number {
    const toLinear = (c: number) => Math.pow(c / 255, 2.2);
    const startA = ((startValue >>> 24) & 255) / 255;
    const endA = ((endValue >>> 24) & 255) / 255;
    let r = toLinear((startValue >> 16) & 255);
    let g = toLinear((startValue >> 8) & 255);
    let b = toLinear(startValue & 255);
    const er = toLinear((endValue >> 16) & 255);
    const eg = toLinear((endValue >> 8) & 255);
    const eb = toLinear(endValue & 255);
    const a = (startA + fraction * (endA - startA)) * 255;
    r = Math.pow(r + fraction * (er - r), 1 / 2.2) * 255;
    g = Math.pow(g + fraction * (eg - g), 1 / 2.2) * 255;
    b = Math.pow(b + fraction * (eb - b), 1 / 2.2) * 255;
    return (Math.round(a) << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }
}

/** android.graphics.PointF as the PointFEvaluator sees it */
export interface PointFLike {
  x: number;
  y: number;
}

export class PointFEvaluator implements TypeEvaluator<PointFLike> {
  evaluate(fraction: number, s: PointFLike, e: PointFLike): PointFLike {
    return { x: s.x + fraction * (e.x - s.x), y: s.y + fraction * (e.y - s.y) };
  }
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class RectEvaluator implements TypeEvaluator<RectLike> {
  evaluate(fraction: number, s: RectLike, e: RectLike): RectLike {
    const lerp = (a: number, b: number) => Math.trunc(a + (b - a) * fraction);
    return { left: lerp(s.left, e.left), top: lerp(s.top, e.top), right: lerp(s.right, e.right), bottom: lerp(s.bottom, e.bottom) };
  }
}

export class FloatArrayEvaluator implements TypeEvaluator<number[]> {
  evaluate(fraction: number, s: number[], e: number[]): number[] {
    return s.map((v, i) => v + fraction * ((e[i] ?? v) - v));
  }
}

const FLOAT = new FloatEvaluator();
const INT = new IntEvaluator();

// ── keyframes & property values ──────────────────────────────────────────

/** android.animation.Keyframe: a value at a fraction, reached with its own interpolator. */
export class Keyframe<T = unknown> {
  private interpolator: TimeInterpolator | null = null;
  /** @internal the value was read from the target when the animation started (re-read on every start) */
  valueWasSetOnStart = false;
  private constructor(private fraction: number, private value: T | undefined, readonly kind: 'float' | 'int' | 'object') {}

  static ofFloat(fraction: number, value?: number): Keyframe<number> {
    return new Keyframe(fraction, value, 'float');
  }

  static ofInt(fraction: number, value?: number): Keyframe<number> {
    return new Keyframe(fraction, value, 'int');
  }

  static ofObject<T>(fraction: number, value?: T): Keyframe<T> {
    return new Keyframe(fraction, value, 'object');
  }

  getFraction(): number {
    return this.fraction;
  }

  setFraction(fraction: number): void {
    this.fraction = fraction;
  }

  getValue(): T {
    return this.value as T;
  }

  setValue(value: T): void {
    this.value = value;
  }

  hasValue(): boolean {
    return this.value !== undefined;
  }

  getInterpolator(): TimeInterpolator | null {
    return this.interpolator;
  }

  setInterpolator(interpolator: TimeInterpolator | null): void {
    this.interpolator = interpolator;
  }
}

/**
 * android.animation.PropertyValuesHolder: one property's keyframes, its
 * evaluator and (for ObjectAnimator) how to read and write it on the target.
 */
export class PropertyValuesHolder<T = any> {
  private keyframes: Keyframe<T>[];
  private evaluator: TypeEvaluator<T>;
  private animatedValue: T | undefined;
  private setterFn: ((target: unknown, value: T) => void) | null = null;
  private getterFn: ((target: unknown) => T) | null = null;

  private constructor(
    private propertyName: string,
    private property: Property<any, T> | null,
    keyframes: Keyframe<T>[],
    evaluator: TypeEvaluator<T>,
  ) {
    this.keyframes = keyframes;
    this.evaluator = evaluator;
  }

  private static frames<T>(kind: 'float' | 'int' | 'object', values: T[]): Keyframe<T>[] {
    const make = (f: number, v?: T) => (kind === 'float' ? Keyframe.ofFloat(f, v as number) : kind === 'int' ? Keyframe.ofInt(f, v as number) : Keyframe.ofObject(f, v)) as Keyframe<T>;
    if (values.length === 0) throw new Error('IllegalArgumentException: at least one value is required');
    // One value: the animation ends there and starts wherever the property is.
    if (values.length === 1) return [make(0), make(1, values[0])];
    return values.map((v, i) => make(i / (values.length - 1), v));
  }

  private static named<T>(nameOrProperty: string | Property<any, T>): [string, Property<any, T> | null] {
    return typeof nameOrProperty === 'string' ? [nameOrProperty, null] : [nameOrProperty.getName(), nameOrProperty];
  }

  static ofFloat(nameOrProperty: string | Property<any, number>, ...values: number[]): PropertyValuesHolder<number> {
    const [name, property] = PropertyValuesHolder.named(nameOrProperty);
    return new PropertyValuesHolder(name, property, PropertyValuesHolder.frames('float', values), FLOAT);
  }

  static ofInt(nameOrProperty: string | Property<any, number>, ...values: number[]): PropertyValuesHolder<number> {
    const [name, property] = PropertyValuesHolder.named(nameOrProperty);
    return new PropertyValuesHolder(name, property, PropertyValuesHolder.frames('int', values), INT);
  }

  static ofArgb(nameOrProperty: string | Property<any, number>, ...values: number[]): PropertyValuesHolder<number> {
    const [name, property] = PropertyValuesHolder.named(nameOrProperty);
    return new PropertyValuesHolder(name, property, PropertyValuesHolder.frames('int', values), ArgbEvaluator.getInstance());
  }

  static ofObject<T>(nameOrProperty: string | Property<any, T>, evaluator: TypeEvaluator<T>, ...values: T[]): PropertyValuesHolder<T> {
    const [name, property] = PropertyValuesHolder.named(nameOrProperty);
    return new PropertyValuesHolder(name, property, PropertyValuesHolder.frames('object', values), evaluator);
  }

  static ofKeyframe<T>(nameOrProperty: string | Property<any, T>, ...keyframes: Keyframe<T>[]): PropertyValuesHolder<T> {
    const [name, property] = PropertyValuesHolder.named(nameOrProperty);
    const kind = keyframes[0]?.kind ?? 'float';
    const evaluator = (kind === 'int' ? INT : FLOAT) as unknown as TypeEvaluator<T>;
    return new PropertyValuesHolder(name, property, keyframes.slice().sort((a, b) => a.getFraction() - b.getFraction()), evaluator);
  }

  getPropertyName(): string {
    return this.propertyName;
  }

  setPropertyName(name: string): void {
    this.propertyName = name;
  }

  setProperty(property: Property<any, T>): void {
    this.property = property;
    this.propertyName = property.getName();
  }

  setEvaluator(evaluator: TypeEvaluator<T>): void {
    this.evaluator = evaluator;
  }

  setFloatValues(...values: number[]): void {
    this.keyframes = PropertyValuesHolder.frames('float', values) as unknown as Keyframe<T>[];
    this.evaluator = FLOAT as unknown as TypeEvaluator<T>;
  }

  setIntValues(...values: number[]): void {
    this.keyframes = PropertyValuesHolder.frames('int', values) as unknown as Keyframe<T>[];
    this.evaluator = INT as unknown as TypeEvaluator<T>;
  }

  setObjectValues(...values: T[]): void {
    this.keyframes = PropertyValuesHolder.frames('object', values);
  }

  /** @internal resolve the setter and getter on `target` (reflection in the framework) */
  setupSetterAndGetter(target: unknown, warn: (message: string) => void): void {
    if (this.property) {
      const property = this.property;
      this.setterFn = property.isReadOnly() ? null : (t, v) => property.set(t, v);
      this.getterFn = (t) => property.get(t);
      return;
    }
    const cap = this.propertyName.charAt(0).toUpperCase() + this.propertyName.slice(1);
    const obj = target as Record<string, unknown>;
    const setter = obj?.[`set${cap}`];
    const getter = obj?.[`get${cap}`] ?? obj?.[`is${cap}`];
    this.setterFn = typeof setter === 'function' ? (t, v) => (setter as (v: T) => void).call(t, v) : null;
    this.getterFn = typeof getter === 'function' ? (t) => (getter as () => T).call(t) : null;
    if (!this.setterFn) warn(`Method set${cap}() not found on target class ${(target as object)?.constructor?.name ?? typeof target}`);
  }

  /** @internal fill keyframes without a value from the target's current value */
  setupStartValues(target: unknown): void {
    this.fillFrom(target, (kf) => !kf.hasValue() || kf.valueWasSetOnStart);
  }

  /** @internal ObjectAnimator.setupStartValues: overwrite the first keyframe */
  captureStart(target: unknown): void {
    if (!this.getterFn || !this.keyframes.length) return;
    this.keyframes[0]!.setValue(this.getterFn(target));
  }

  captureEnd(target: unknown): void {
    if (!this.getterFn || !this.keyframes.length) return;
    this.keyframes[this.keyframes.length - 1]!.setValue(this.getterFn(target));
  }

  private fillFrom(target: unknown, which: (kf: Keyframe<T>) => boolean): void {
    if (!this.getterFn) return;
    const missing = this.keyframes.filter(which);
    if (!missing.length) return;
    const value = this.getterFn(target);
    for (const kf of missing) {
      kf.setValue(value);
      kf.valueWasSetOnStart = true;
    }
  }

  hasMissingValues(): boolean {
    return this.keyframes.some((k) => !k.hasValue());
  }

  /** KeyframeSet.getValue: the keyframe interval containing `fraction` (extrapolating outside 0..1). */
  calculateValue(fraction: number): void {
    if (this.hasMissingValues()) return;
    this.animatedValue = this.valueAt(fraction);
  }

  private valueAt(fraction: number): T {
    const frames = this.keyframes;
    const n = frames.length;
    const value = (kf: Keyframe<T>) => kf.getValue();
    const between = (a: Keyframe<T>, b: Keyframe<T>, f: number) => {
      const interpolator = b.getInterpolator();
      if (interpolator) f = interpolator.getInterpolation(f);
      const span = b.getFraction() - a.getFraction();
      const t = span === 0 ? 1 : (f - a.getFraction()) / span;
      return this.evaluator.evaluate(t, value(a), value(b));
    };
    if (n === 2) {
      const interpolator = frames[1]!.getInterpolator();
      const f = interpolator ? interpolator.getInterpolation(fraction) : fraction;
      return this.evaluator.evaluate(f, value(frames[0]!), value(frames[1]!));
    }
    if (fraction <= 0) return between(frames[0]!, frames[1]!, fraction);
    if (fraction >= 1) return between(frames[n - 2]!, frames[n - 1]!, fraction);
    for (let i = 1; i < n; i++) {
      const next = frames[i]!;
      if (fraction < next.getFraction()) return between(frames[i - 1]!, next, fraction);
    }
    return value(frames[n - 1]!);
  }

  getAnimatedValue(): T {
    return this.animatedValue as T;
  }

  /** @internal */
  setAnimatedValue(target: unknown): void {
    if (this.setterFn && this.animatedValue !== undefined) this.setterFn(target, this.animatedValue);
  }

  toString(): string {
    return `${this.propertyName}: ${this.keyframes.map((k) => String(k.getValue())).join(' ')}`;
  }
}

// ── ValueAnimator ────────────────────────────────────────────────────────

const DEFAULT_INTERPOLATOR = new AccelerateDecelerateInterpolator();

export class ValueAnimator extends Animator implements AnimationFrameCallback {
  static readonly RESTART = 1;
  static readonly REVERSE = 2;
  static readonly INFINITE = -1;

  /** ValueAnimator.getDurationScale(): the developer option, from the kernel's time scale. */
  static getDurationScale(): number {
    return mainKernel?.animator.timeScale ?? 1;
  }

  static areAnimatorsEnabled(): boolean {
    return ValueAnimator.getDurationScale() !== 0;
  }

  static getFrameDelay(): number {
    return 10;
  }

  protected values: PropertyValuesHolder[] = [];
  private duration = 300;
  private startDelay = 0;
  private repeatCount = 0;
  private repeatMode = ValueAnimator.RESTART;
  private interpolator: TimeInterpolator = DEFAULT_INTERPOLATOR;
  private updateListeners: AnimatorUpdateListener[] = [];
  protected kernel: Kernel | null = null;

  private startTime = -1;
  private startTimeCommitted = false;
  private pauseTime = -1;
  private resumed = false;
  private lastFrameTime = -1;
  private seekFraction = -1;
  private overallFraction = 0;
  private currentFraction = 0;
  private reversing = false;
  private started = false;
  private running = false;
  private endRequested = true;
  private initialized = false;
  private startListenersCalled = false;

  static ofFloat(...values: number[]): ValueAnimator {
    const anim = new ValueAnimator();
    anim.setFloatValues(...values);
    return anim;
  }

  static ofInt(...values: number[]): ValueAnimator {
    const anim = new ValueAnimator();
    anim.setIntValues(...values);
    return anim;
  }

  static ofArgb(...values: number[]): ValueAnimator {
    const anim = new ValueAnimator();
    anim.setIntValues(...values);
    anim.setEvaluator(ArgbEvaluator.getInstance());
    return anim;
  }

  static ofObject<T>(evaluator: TypeEvaluator<T>, ...values: T[]): ValueAnimator {
    const anim = new ValueAnimator();
    anim.setObjectValues(...values);
    anim.setEvaluator(evaluator);
    return anim;
  }

  static ofPropertyValuesHolder(...values: PropertyValuesHolder[]): ValueAnimator {
    const anim = new ValueAnimator();
    anim.setValues(...values);
    return anim;
  }

  override setKernel(kernel: Kernel | null): void {
    this.kernel = kernel;
  }

  // ── values ──────────────────────────────────────────────────────────

  setFloatValues(...values: number[]): void {
    if (this.values.length) this.values[0]!.setFloatValues(...values);
    else this.values = [PropertyValuesHolder.ofFloat('', ...values)];
    this.initialized = false;
  }

  setIntValues(...values: number[]): void {
    if (this.values.length) this.values[0]!.setIntValues(...values);
    else this.values = [PropertyValuesHolder.ofInt('', ...values)];
    this.initialized = false;
  }

  setObjectValues(...values: unknown[]): void {
    if (this.values.length) this.values[0]!.setObjectValues(...values);
    else this.values = [PropertyValuesHolder.ofObject('', FLOAT as TypeEvaluator<any>, ...values)];
    this.initialized = false;
  }

  setValues(...values: PropertyValuesHolder[]): void {
    this.values = values;
    this.initialized = false;
  }

  getValues(): PropertyValuesHolder[] {
    return this.values;
  }

  setEvaluator(evaluator: TypeEvaluator<any>): void {
    this.values[0]?.setEvaluator(evaluator);
  }

  /** The first property's current value, or the named property's. */
  getAnimatedValue(propertyName?: string): any {
    const holder = propertyName === undefined ? this.values[0] : this.values.find((v) => v.getPropertyName() === propertyName);
    return holder?.getAnimatedValue() ?? null;
  }

  /** The interpolated fraction of the current iteration. */
  getAnimatedFraction(): number {
    return this.currentFraction;
  }

  // ── timing ──────────────────────────────────────────────────────────

  setDuration(duration: number): this {
    if (duration < 0) throw new Error(`IllegalArgumentException: Animators cannot have negative duration: ${duration}`);
    this.duration = duration;
    return this;
  }

  getDuration(): number {
    return this.duration;
  }

  override getTotalDuration(): number {
    if (this.repeatCount === ValueAnimator.INFINITE) return Animator.DURATION_INFINITE;
    return this.startDelay + this.duration * (this.repeatCount + 1);
  }

  setStartDelay(delay: number): void {
    this.startDelay = Math.max(0, delay);
  }

  getStartDelay(): number {
    return this.startDelay;
  }

  setRepeatCount(count: number): void {
    this.repeatCount = count;
  }

  getRepeatCount(): number {
    return this.repeatCount;
  }

  setRepeatMode(mode: number): void {
    this.repeatMode = mode;
  }

  getRepeatMode(): number {
    return this.repeatMode;
  }

  /** null means linear, as in the framework. */
  setInterpolator(interpolator: TimeInterpolator | null): void {
    this.interpolator = interpolator ?? { getInterpolation: (t) => t };
  }

  getInterpolator(): TimeInterpolator {
    return this.interpolator;
  }

  addUpdateListener(listener: AnimatorUpdateListener): void {
    this.updateListeners.push(listener);
  }

  removeUpdateListener(listener: AnimatorUpdateListener): void {
    const at = this.updateListeners.indexOf(listener);
    if (at >= 0) this.updateListeners.splice(at, 1);
  }

  removeAllUpdateListeners(): void {
    this.updateListeners = [];
  }

  getCurrentPlayTime(): number {
    if (!this.initialized || (!this.started && this.seekFraction < 0)) return 0;
    if (this.seekFraction >= 0) return this.duration * this.seekFraction;
    return this.handler().now() - this.startTime;
  }

  setCurrentPlayTime(playTime: number): void {
    this.setCurrentFraction(this.duration > 0 ? playTime / this.duration : 1);
  }

  setCurrentFraction(fraction: number): void {
    this.initAnimation();
    fraction = this.clampFraction(fraction);
    if (this.lastFrameTime >= 0) {
      this.startTime = this.handler().now() - this.duration * fraction;
      this.startTimeCommitted = true;
    } else {
      this.seekFraction = fraction;
    }
    this.overallFraction = fraction;
    this.animateValue(this.currentIterationFraction(fraction, this.reversing));
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  start(): void {
    this.startInternal(false);
  }

  private handler(): AnimationHandler {
    return AnimationHandler.forKernel(resolveKernel(this.kernel));
  }

  private startInternal(playBackwards: boolean): void {
    this.reversing = playBackwards;
    if (playBackwards && this.seekFraction !== -1 && this.seekFraction !== 0) {
      if (this.repeatCount === ValueAnimator.INFINITE) {
        const fraction = this.seekFraction - Math.floor(this.seekFraction);
        this.seekFraction = 1 - fraction;
      } else {
        this.seekFraction = 1 + this.repeatCount - this.seekFraction;
      }
    }
    this.started = true;
    this.paused = false;
    this.running = false;
    this.endRequested = false;
    this.lastFrameTime = -1;
    this.startTime = -1;
    this.handler().addAnimationFrameCallback(this);
    if (this.startDelay === 0 || this.seekFraction >= 0 || this.reversing) {
      this.startAnimation();
      if (this.seekFraction === -1) this.setCurrentPlayTime(0);
      else this.setCurrentFraction(this.seekFraction);
    }
  }

  protected initAnimation(): void {
    if (this.initialized) return;
    for (const v of this.values) v.calculateValue(0);
    this.initialized = true;
  }

  private startAnimation(): void {
    this.initAnimation();
    this.running = true;
    this.overallFraction = this.seekFraction >= 0 ? this.seekFraction : 0;
    if (!this.startListenersCalled) {
      this.startListenersCalled = true;
      this.notifyStart(this.reversing);
    }
  }

  cancel(): void {
    if (this.endRequested) return;
    if (this.started || this.running) {
      if (!this.running && !this.startListenersCalled) {
        this.startListenersCalled = true;
        this.notifyStart(this.reversing);
      }
      this.notifyCancel();
    }
    this.endAnimation();
  }

  end(): void {
    if (!this.running) {
      this.startAnimation();
      this.started = true;
    } else if (!this.initialized) {
      this.initAnimation();
    }
    this.animateValue(this.shouldPlayBackward(this.repeatCount, this.reversing) ? 0 : 1);
    this.endAnimation();
  }

  override pause(): void {
    const was = this.paused;
    super.pause();
    if (!was && this.paused) {
      this.pauseTime = -1;
      this.resumed = false;
    }
  }

  override resume(): void {
    if (this.paused && !this.resumed) {
      this.resumed = true;
      this.handler().addAnimationFrameCallback(this);
    }
    super.resume();
  }

  reverse(): void {
    if (this.started && this.lastFrameTime >= 0) {
      const now = this.handler().now();
      const playTime = now - this.startTime;
      const timeLeft = this.duration - playTime;
      this.startTime = now - timeLeft;
      this.startTimeCommitted = true;
      this.reversing = !this.reversing;
    } else if (this.started) {
      this.reversing = !this.reversing;
      this.end();
    } else {
      this.startInternal(true);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  override isStarted(): boolean {
    return this.started;
  }

  private endAnimation(): void {
    if (this.endRequested) return;
    AnimationHandler.forKernel(resolveKernel(this.kernel)).removeCallback(this);
    this.endRequested = true;
    this.paused = false;
    const notify = this.started || this.running;
    if (notify && !this.running && !this.startListenersCalled) {
      this.startListenersCalled = true;
      this.notifyStart(this.reversing);
    }
    this.running = false;
    this.started = false;
    this.startListenersCalled = false;
    this.lastFrameTime = -1;
    this.startTime = -1;
    this.seekFraction = -1;
    const reversing = this.reversing;
    this.reversing = false;
    if (notify) this.notifyEnd(reversing);
  }

  // ── frames ──────────────────────────────────────────────────────────

  doAnimationFrame(frameTime: number): boolean {
    if (this.startTime < 0) {
      // The first frame: the start delay counts from here.
      this.startTime = this.reversing ? frameTime : frameTime + this.startDelay;
    }
    if (this.paused) {
      this.pauseTime = frameTime;
      return true; // removed until resume()
    }
    if (this.resumed) {
      this.resumed = false;
      if (this.pauseTime >= 0) this.startTime += frameTime - this.pauseTime;
    }
    if (!this.running) {
      if (this.startTime > frameTime && this.seekFraction === -1) return false;
      this.running = true;
      this.startAnimation();
    }
    if (this.lastFrameTime < 0) {
      if (this.seekFraction >= 0) {
        this.startTime = frameTime - this.duration * this.seekFraction;
        this.seekFraction = -1;
      }
      this.startTimeCommitted = false;
    }
    this.lastFrameTime = frameTime;
    const finished = this.animateBasedOnTime(Math.max(frameTime, this.startTime));
    if (finished) this.endAnimation();
    return finished;
  }

  protected animateBasedOnTime(currentTime: number): boolean {
    if (!this.running) return false;
    const fraction = this.duration > 0 ? (currentTime - this.startTime) / this.duration : 1;
    const last = this.overallFraction;
    const newIteration = Math.floor(fraction) > Math.floor(last);
    const lastIterationFinished = fraction >= this.repeatCount + 1 && this.repeatCount !== ValueAnimator.INFINITE;
    let done = false;
    if (this.duration === 0) done = true;
    else if (newIteration && !lastIterationFinished) this.notifyRepeat();
    else if (lastIterationFinished) done = true;
    this.overallFraction = this.clampFraction(fraction);
    this.animateValue(this.currentIterationFraction(this.overallFraction, this.reversing));
    return done;
  }

  private clampFraction(fraction: number): number {
    if (fraction < 0) return 0;
    if (this.repeatCount !== ValueAnimator.INFINITE) return Math.min(fraction, this.repeatCount + 1);
    return fraction;
  }

  private currentIteration(fraction: number): number {
    fraction = this.clampFraction(fraction);
    let iteration = Math.floor(fraction);
    if (fraction === iteration && fraction > 0) iteration--;
    return iteration;
  }

  private currentIterationFraction(fraction: number, inReverse: boolean): number {
    fraction = this.clampFraction(fraction);
    const iteration = this.currentIteration(fraction);
    let current = fraction - iteration;
    if (this.shouldPlayBackward(iteration, inReverse)) current = 1 - current;
    return current;
  }

  private shouldPlayBackward(iteration: number, inReverse: boolean): boolean {
    if (iteration > 0 && this.repeatMode === ValueAnimator.REVERSE && (iteration < this.repeatCount + 1 || this.repeatCount === ValueAnimator.INFINITE)) {
      return inReverse ? iteration % 2 === 0 : iteration % 2 !== 0;
    }
    return inReverse;
  }

  /** Apply the interpolator, compute every property and tell the update listeners. */
  protected animateValue(fraction: number): void {
    // The framework computes fractions in single precision.
    fraction = Math.fround(this.interpolator.getInterpolation(fraction));
    this.currentFraction = fraction;
    for (const v of this.values) v.calculateValue(fraction);
    for (const listener of this.updateListeners.slice()) {
      if (typeof listener === 'function') listener(this);
      else listener.onAnimationUpdate(this);
    }
  }

  /** @internal whether the start time is committed (tests, AnimatorSet) */
  get isStartTimeCommitted(): boolean {
    return this.startTimeCommitted;
  }

  override toString(): string {
    return `ValueAnimator@${this.values.map((v) => v.toString()).join(', ')}`;
  }
}

/** android.animation.TimeAnimator: a never-ending pulse reporting total and delta time. */
export type TimeListener = (animation: TimeAnimator, totalTime: number, deltaTime: number) => void;

export class TimeAnimator extends ValueAnimator {
  private timeListener: TimeListener | null = null;
  private previousTime = -1;
  private firstTime = -1;

  setTimeListener(listener: TimeListener | null): void {
    this.timeListener = listener;
  }

  override start(): void {
    this.previousTime = -1;
    this.firstTime = -1;
    super.start();
  }

  protected override animateBasedOnTime(currentTime: number): boolean {
    if (this.firstTime < 0) this.firstTime = currentTime;
    const total = currentTime - this.firstTime;
    const delta = this.previousTime < 0 ? 0 : currentTime - this.previousTime;
    this.previousTime = currentTime;
    this.timeListener?.(this, total, delta);
    return false;
  }

  protected override animateValue(_fraction: number): void {}

  protected override initAnimation(): void {}
}

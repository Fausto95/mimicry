import type { Kernel } from '@mimicry/os-core';
import type { View } from '../view/view';
import { AnimationHandler, type AnimationFrameCallback } from './value-animator';

/**
 * androidx.dynamicanimation: physics-based animations of a float property —
 * SpringAnimation driven by a SpringForce (the analytic damped-harmonic
 * solution the library uses, stepped by each frame's elapsed time) and
 * FlingAnimation (exponential friction).
 *
 * Velocities are units per second. The rest thresholds follow the library:
 * 0.75 × the property's minimum visible change for the value and 62.5 ×
 * that for the velocity. Mimicry measures views in dp, so "one pixel" of
 * minimum visible change is one dp here.
 */
export interface FloatPropertyCompat<T> {
  readonly name: string;
  getValue(object: T): number;
  setValue(object: T, value: number): void;
}

export class FloatValueHolder {
  constructor(private value = 0) {}
  getValue(): number {
    return this.value;
  }
  setValue(value: number): void {
    this.value = value;
  }
}

/** A View property with the minimum change that is visible on screen. */
export interface ViewProperty extends FloatPropertyCompat<View> {
  readonly minimumVisibleChange: number;
}

const MIN_VISIBLE_CHANGE_PIXELS = 1;
const MIN_VISIBLE_CHANGE_ROTATION_DEGREES = 1 / 10;
const MIN_VISIBLE_CHANGE_ALPHA = 1 / 256;
const MIN_VISIBLE_CHANGE_SCALE = 1 / 500;
const THRESHOLD_MULTIPLIER = 0.75;
const VELOCITY_THRESHOLD_MULTIPLIER = 1000 / 16;

const viewProperty = (name: string, get: (v: View) => number, set: (v: View, x: number) => void, minimumVisibleChange: number): ViewProperty => ({
  name, getValue: get, setValue: set, minimumVisibleChange,
});

export type OnAnimationEndListener = (animation: DynamicAnimation, canceled: boolean, value: number, velocity: number) => void;
export type OnAnimationUpdateListener = (animation: DynamicAnimation, value: number, velocity: number) => void;

const holderProperty: FloatPropertyCompat<FloatValueHolder> = {
  name: 'FloatValueHolder',
  getValue: (h) => h.getValue(),
  setValue: (h, v) => h.setValue(v),
};

export abstract class DynamicAnimation implements AnimationFrameCallback {
  static readonly TRANSLATION_X = viewProperty('translationX', (v) => v.getTranslationX(), (v, x) => v.setTranslationX(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly TRANSLATION_Y = viewProperty('translationY', (v) => v.getTranslationY(), (v, x) => v.setTranslationY(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly TRANSLATION_Z = viewProperty('translationZ', (v) => v.getTranslationZ(), (v, x) => v.setTranslationZ(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly SCALE_X = viewProperty('scaleX', (v) => v.getScaleX(), (v, x) => v.setScaleX(x), MIN_VISIBLE_CHANGE_SCALE);
  static readonly SCALE_Y = viewProperty('scaleY', (v) => v.getScaleY(), (v, x) => v.setScaleY(x), MIN_VISIBLE_CHANGE_SCALE);
  static readonly ROTATION = viewProperty('rotation', (v) => v.getRotation(), (v, x) => v.setRotation(x), MIN_VISIBLE_CHANGE_ROTATION_DEGREES);
  static readonly ROTATION_X = viewProperty('rotationX', (v) => v.getRotationX(), (v, x) => v.setRotationX(x), MIN_VISIBLE_CHANGE_ROTATION_DEGREES);
  static readonly ROTATION_Y = viewProperty('rotationY', (v) => v.getRotationY(), (v, x) => v.setRotationY(x), MIN_VISIBLE_CHANGE_ROTATION_DEGREES);
  static readonly X = viewProperty('x', (v) => v.getX(), (v, x) => v.setX(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly Y = viewProperty('y', (v) => v.getY(), (v, x) => v.setY(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly Z = viewProperty('z', (v) => v.getZ(), (v, x) => v.setZ(x), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly ALPHA = viewProperty('alpha', (v) => v.getAlpha(), (v, x) => v.setAlpha(x), MIN_VISIBLE_CHANGE_ALPHA);
  static readonly SCROLL_X = viewProperty('scrollX', (v) => v.getScrollX(), (v, x) => v.scrollTo(x, v.getScrollY()), MIN_VISIBLE_CHANGE_PIXELS);
  static readonly SCROLL_Y = viewProperty('scrollY', (v) => v.getScrollY(), (v, y) => v.scrollTo(v.getScrollX(), y), MIN_VISIBLE_CHANGE_PIXELS);

  static readonly MIN_VISIBLE_CHANGE_PIXELS = MIN_VISIBLE_CHANGE_PIXELS;
  static readonly MIN_VISIBLE_CHANGE_ROTATION_DEGREES = MIN_VISIBLE_CHANGE_ROTATION_DEGREES;
  static readonly MIN_VISIBLE_CHANGE_ALPHA = MIN_VISIBLE_CHANGE_ALPHA;
  static readonly MIN_VISIBLE_CHANGE_SCALE = MIN_VISIBLE_CHANGE_SCALE;

  protected value = 0;
  protected velocity = 0;
  protected startValueIsSet = false;
  protected running = false;
  protected maxValue = Number.MAX_VALUE;
  protected minValue = -Number.MAX_VALUE;
  private lastFrameTime: number | null = null;
  private minimumVisibleChange: number;
  private readonly endListeners: OnAnimationEndListener[] = [];
  private readonly updateListeners: OnAnimationUpdateListener[] = [];
  private readonly target: unknown;
  private readonly property: FloatPropertyCompat<any>;
  private kernel: Kernel | null;

  constructor(holder: FloatValueHolder);
  constructor(object: unknown, property: FloatPropertyCompat<any>);
  constructor(object: unknown, property?: FloatPropertyCompat<any>) {
    if (property) {
      this.target = object;
      this.property = property;
      this.minimumVisibleChange = (property as Partial<ViewProperty>).minimumVisibleChange ?? MIN_VISIBLE_CHANGE_PIXELS;
    } else {
      this.target = object;
      this.property = holderProperty;
      this.minimumVisibleChange = 1;
    }
    this.kernel = (object as { context?: { kernel?: Kernel } } | null)?.context?.kernel ?? null;
  }

  /** Run on this kernel (defaults to the target view's, else the main one). */
  setKernel(kernel: Kernel | null): this {
    this.kernel = kernel;
    return this;
  }

  private handler(): AnimationHandler {
    const kernel = this.kernel ?? AnimationHandler.getMainKernel();
    if (!kernel) throw new Error('AndroidRuntimeException: Animators may only be run on Looper threads (no Android has booted)');
    return AnimationHandler.forKernel(kernel);
  }

  setStartValue(startValue: number): this {
    this.value = startValue;
    this.startValueIsSet = true;
    return this;
  }

  setStartVelocity(startVelocity: number): this {
    this.velocity = startVelocity;
    return this;
  }

  setMaxValue(max: number): this {
    this.maxValue = max;
    return this;
  }

  setMinValue(min: number): this {
    this.minValue = min;
    return this;
  }

  addEndListener(listener: OnAnimationEndListener): this {
    if (!this.endListeners.includes(listener)) this.endListeners.push(listener);
    return this;
  }

  removeEndListener(listener: OnAnimationEndListener): void {
    const at = this.endListeners.indexOf(listener);
    if (at >= 0) this.endListeners.splice(at, 1);
  }

  addUpdateListener(listener: OnAnimationUpdateListener): this {
    if (this.isRunning()) throw new Error('UnsupportedOperationException: Error: Update listeners must be added beforethe animation.');
    if (!this.updateListeners.includes(listener)) this.updateListeners.push(listener);
    return this;
  }

  removeUpdateListener(listener: OnAnimationUpdateListener): void {
    const at = this.updateListeners.indexOf(listener);
    if (at >= 0) this.updateListeners.splice(at, 1);
  }

  setMinimumVisibleChange(minimumVisibleChange: number): this {
    if (minimumVisibleChange <= 0) throw new Error('IllegalArgumentException: Minimum visible change must be positive.');
    this.minimumVisibleChange = minimumVisibleChange;
    this.setValueThreshold(minimumVisibleChange * THRESHOLD_MULTIPLIER);
    return this;
  }

  getMinimumVisibleChange(): number {
    return this.minimumVisibleChange;
  }

  /** @internal value threshold for "at rest" */
  protected valueThreshold(): number {
    return this.minimumVisibleChange * THRESHOLD_MULTIPLIER;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.startValueIsSet) this.value = this.property.getValue(this.target);
    if (this.value > this.maxValue || this.value < this.minValue) {
      this.running = false;
      throw new Error('IllegalArgumentException: Starting value need to be in between min value and max value');
    }
    this.lastFrameTime = null;
    this.handler().addAnimationFrameCallback(this);
  }

  cancel(): void {
    if (this.running) this.endAnimationInternal(true);
  }

  isRunning(): boolean {
    return this.running;
  }

  doAnimationFrame(frameTime: number): boolean {
    if (this.lastFrameTime === null) {
      this.lastFrameTime = frameTime;
      this.setPropertyValue(this.value);
      return false;
    }
    const deltaT = frameTime - this.lastFrameTime;
    this.lastFrameTime = frameTime;
    const finished = this.updateValueAndVelocity(deltaT);
    this.value = Math.max(this.minValue, Math.min(this.maxValue, this.value));
    this.setPropertyValue(this.value);
    if (finished) this.endAnimationInternal(false);
    return finished;
  }

  private endAnimationInternal(canceled: boolean): void {
    this.running = false;
    this.handler().removeCallback(this);
    this.lastFrameTime = null;
    this.startValueIsSet = false;
    for (const l of this.endListeners.slice()) l(this, canceled, this.value, this.velocity);
  }

  private setPropertyValue(value: number): void {
    this.property.setValue(this.target, value);
    for (const l of this.updateListeners.slice()) l(this, this.value, this.velocity);
  }

  /** Advance by `deltaT` ms; return true when the animation should end. */
  protected abstract updateValueAndVelocity(deltaT: number): boolean;
  protected abstract setValueThreshold(threshold: number): void;
}

// ── springs ──────────────────────────────────────────────────────────────

/** androidx.dynamicanimation.animation.SpringForce: a damped harmonic oscillator. */
export class SpringForce {
  static readonly STIFFNESS_HIGH = 10_000;
  static readonly STIFFNESS_MEDIUM = 1500;
  static readonly STIFFNESS_LOW = 200;
  static readonly STIFFNESS_VERY_LOW = 50;
  static readonly DAMPING_RATIO_HIGH_BOUNCY = 0.2;
  static readonly DAMPING_RATIO_MEDIUM_BOUNCY = 0.5;
  static readonly DAMPING_RATIO_LOW_BOUNCY = 0.75;
  static readonly DAMPING_RATIO_NO_BOUNCY = 1;

  private naturalFreq = Math.sqrt(SpringForce.STIFFNESS_MEDIUM);
  private dampingRatio = SpringForce.DAMPING_RATIO_MEDIUM_BOUNCY;
  private initialized = false;
  private valueThreshold = 0;
  private velocityThreshold = 0;
  private gammaPlus = 0;
  private gammaMinus = 0;
  private dampedFreq = 0;
  private finalPosition = Number.NaN;

  constructor(finalPosition?: number) {
    if (finalPosition !== undefined) this.finalPosition = finalPosition;
  }

  setStiffness(stiffness: number): this {
    if (stiffness <= 0) throw new Error('IllegalArgumentException: Spring stiffness constant must be positive.');
    this.naturalFreq = Math.sqrt(stiffness);
    this.initialized = false;
    return this;
  }

  getStiffness(): number {
    return this.naturalFreq * this.naturalFreq;
  }

  setDampingRatio(dampingRatio: number): this {
    if (dampingRatio < 0) throw new Error('IllegalArgumentException: Damping ratio must be non-negative');
    this.dampingRatio = dampingRatio;
    this.initialized = false;
    return this;
  }

  getDampingRatio(): number {
    return this.dampingRatio;
  }

  setFinalPosition(finalPosition: number): this {
    this.finalPosition = finalPosition;
    return this;
  }

  getFinalPosition(): number {
    return this.finalPosition;
  }

  getAcceleration(lastDisplacement: number, lastVelocity: number): number {
    lastDisplacement -= this.finalPosition;
    const k = this.naturalFreq * this.naturalFreq;
    const c = 2 * this.naturalFreq * this.dampingRatio;
    return -k * lastDisplacement - c * lastVelocity;
  }

  isAtEquilibrium(value: number, velocity: number): boolean {
    return Math.abs(velocity) < this.velocityThreshold && Math.abs(value - this.finalPosition) < this.valueThreshold;
  }

  /** @internal */
  setValueThreshold(threshold: number): void {
    this.valueThreshold = Math.abs(threshold);
    this.velocityThreshold = this.valueThreshold * VELOCITY_THRESHOLD_MULTIPLIER;
  }

  private init(): void {
    if (this.initialized) return;
    if (Number.isNaN(this.finalPosition)) throw new Error('IllegalStateException: Error: Final position of the spring must be set before the animation starts');
    const z = this.dampingRatio;
    const wn = this.naturalFreq;
    if (z > 1) {
      this.gammaPlus = -z * wn + wn * Math.sqrt(z * z - 1);
      this.gammaMinus = -z * wn - wn * Math.sqrt(z * z - 1);
    } else if (z >= 0 && z < 1) {
      this.dampedFreq = wn * Math.sqrt(1 - z * z);
    }
    this.initialized = true;
  }

  /** @internal the closed-form position and velocity after `deltaT` ms */
  updateValues(lastDisplacement: number, lastVelocity: number, deltaT: number): { value: number; velocity: number } {
    this.init();
    const t = deltaT / 1000;
    const x0 = lastDisplacement - this.finalPosition;
    const wn = this.naturalFreq;
    const z = this.dampingRatio;
    let displacement: number;
    let velocity: number;
    if (z > 1) {
      const gm = this.gammaMinus;
      const gp = this.gammaPlus;
      const coeffA = x0 - (gm * x0 - lastVelocity) / (gm - gp);
      const coeffB = (gm * x0 - lastVelocity) / (gm - gp);
      displacement = coeffA * Math.exp(gm * t) + coeffB * Math.exp(gp * t);
      velocity = coeffA * gm * Math.exp(gm * t) + coeffB * gp * Math.exp(gp * t);
    } else if (z === 1) {
      const coeffA = x0;
      const coeffB = lastVelocity + wn * x0;
      displacement = (coeffA + coeffB * t) * Math.exp(-wn * t);
      velocity = (coeffA + coeffB * t) * Math.exp(-wn * t) * -wn + coeffB * Math.exp(-wn * t);
    } else {
      const wd = this.dampedFreq;
      const cosCoeff = x0;
      const sinCoeff = (1 / wd) * (z * wn * x0 + lastVelocity);
      const decay = Math.exp(-z * wn * t);
      displacement = decay * (cosCoeff * Math.cos(wd * t) + sinCoeff * Math.sin(wd * t));
      velocity = displacement * -wn * z + decay * (-wd * cosCoeff * Math.sin(wd * t) + wd * sinCoeff * Math.cos(wd * t));
    }
    return { value: displacement + this.finalPosition, velocity };
  }
}

const UNSET = Number.MAX_VALUE;

export class SpringAnimation extends DynamicAnimation {
  private spring: SpringForce | null = null;
  private pendingPosition = UNSET;
  private endRequested = false;

  constructor(holder: FloatValueHolder);
  constructor(object: unknown, property: FloatPropertyCompat<any>, finalPosition?: number);
  constructor(object: unknown, property?: FloatPropertyCompat<any>, finalPosition?: number) {
    if (property) super(object, property);
    else super(object as FloatValueHolder);
    if (finalPosition !== undefined) this.spring = new SpringForce(finalPosition);
  }

  getSpring(): SpringForce | null {
    return this.spring;
  }

  setSpring(force: SpringForce): this {
    this.spring = force;
    return this;
  }

  override start(): void {
    this.sanityCheck();
    this.spring!.setValueThreshold(this.valueThreshold());
    super.start();
  }

  /** Start toward `finalPosition`, or retarget a running animation (taking effect next frame). */
  animateToFinalPosition(finalPosition: number): void {
    if (this.isRunning()) {
      this.pendingPosition = finalPosition;
    } else {
      this.spring ??= new SpringForce(finalPosition);
      this.spring.setFinalPosition(finalPosition);
      this.start();
    }
  }

  canSkipToEnd(): boolean {
    return (this.spring?.getDampingRatio() ?? 0) > 0;
  }

  /** End on the next frame at the final position (only for damped springs). */
  skipToEnd(): void {
    if (!this.canSkipToEnd()) throw new Error('UnsupportedOperationException: Spring animations can only come to an end when there is damping');
    if (this.running) this.endRequested = true;
  }

  private sanityCheck(): void {
    if (!this.spring) throw new Error('UnsupportedOperationException: Incomplete SpringAnimation: Either final position or a spring force needs to be set.');
    const final = this.spring.getFinalPosition();
    if (final > this.maxValue) throw new Error('UnsupportedOperationException: Final position of the spring cannot be greater than the max value.');
    if (final < this.minValue) throw new Error('UnsupportedOperationException: Final position of the spring cannot be less than the min value.');
  }

  protected setValueThreshold(_threshold: number): void {
    this.spring?.setValueThreshold(this.valueThreshold());
  }

  protected updateValueAndVelocity(deltaT: number): boolean {
    const spring = this.spring!;
    if (this.endRequested) {
      if (this.pendingPosition !== UNSET) {
        spring.setFinalPosition(this.pendingPosition);
        this.pendingPosition = UNSET;
      }
      this.value = spring.getFinalPosition();
      this.velocity = 0;
      this.endRequested = false;
      return true;
    }
    if (this.pendingPosition !== UNSET) {
      // Half the frame toward the old target, half toward the new one.
      let state = spring.updateValues(this.value, this.velocity, deltaT / 2);
      spring.setFinalPosition(this.pendingPosition);
      this.pendingPosition = UNSET;
      state = spring.updateValues(state.value, state.velocity, deltaT / 2);
      this.value = state.value;
      this.velocity = state.velocity;
    } else {
      const state = spring.updateValues(this.value, this.velocity, deltaT);
      this.value = state.value;
      this.velocity = state.velocity;
    }
    this.value = Math.max(this.minValue, Math.min(this.maxValue, this.value));
    if (spring.isAtEquilibrium(this.value, this.velocity)) {
      this.value = spring.getFinalPosition();
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

// ── fling ────────────────────────────────────────────────────────────────

const DEFAULT_FRICTION = -4.2;

export class FlingAnimation extends DynamicAnimation {
  private friction = DEFAULT_FRICTION;
  private velocityThreshold = 0;

  constructor(holder: FloatValueHolder);
  constructor(object: unknown, property: FloatPropertyCompat<any>);
  constructor(object: unknown, property?: FloatPropertyCompat<any>) {
    if (property) super(object, property);
    else super(object as FloatValueHolder);
    this.velocityThreshold = this.valueThreshold() * VELOCITY_THRESHOLD_MULTIPLIER;
  }

  setFriction(friction: number): this {
    if (friction <= 0) throw new Error('IllegalArgumentException: Friction must be positive');
    this.friction = friction * DEFAULT_FRICTION;
    return this;
  }

  getFriction(): number {
    return this.friction / DEFAULT_FRICTION;
  }

  override start(): void {
    this.velocityThreshold = this.valueThreshold() * VELOCITY_THRESHOLD_MULTIPLIER;
    super.start();
  }

  protected setValueThreshold(threshold: number): void {
    this.velocityThreshold = threshold * VELOCITY_THRESHOLD_MULTIPLIER;
  }

  protected updateValueAndVelocity(deltaT: number): boolean {
    const v0 = this.velocity;
    const f = this.friction;
    this.velocity = v0 * Math.exp((deltaT / 1000) * f);
    this.value = this.value - v0 / f + (v0 / f) * Math.exp((f * deltaT) / 1000);
    if (this.value < this.minValue) {
      this.value = this.minValue;
      return true;
    }
    if (this.value > this.maxValue) {
      this.value = this.maxValue;
      return true;
    }
    if (this.value >= this.maxValue || this.value <= this.minValue || Math.abs(this.velocity) < this.velocityThreshold) {
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

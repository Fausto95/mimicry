import type { Kernel } from '@mimicry/os-core';
import type { Property } from '../util/property';
import { AnimationHandler, PropertyValuesHolder, ValueAnimator, type TypeEvaluator } from './value-animator';

/**
 * android.animation.ObjectAnimator: a ValueAnimator that writes its values
 * to a property of a target — through a Property object (View.ALPHA) or by
 * name, resolving `setFoo` / `getFoo` on the target the way the framework
 * does by reflection. With a single value the animation starts from the
 * property's current value, read when the animation starts.
 *
 * Animators whose target is a View run on that view's kernel.
 */
interface KernelOwner {
  context?: { kernel?: Kernel };
}

const running = new Set<ObjectAnimator>();

export class ObjectAnimator extends ValueAnimator {
  private target: unknown = null;
  private propertyName = '';
  private property: Property<any, any> | null = null;
  private autoCancel = false;

  static override ofFloat(...values: number[]): ValueAnimator;
  static override ofFloat(target: unknown, property: string | Property<any, number>, ...values: number[]): ObjectAnimator;
  static override ofFloat(...args: any[]): any {
    if (typeof args[0] === 'number' || args.length === 0) return ValueAnimator.ofFloat(...(args as number[]));
    const [target, property, ...values] = args as [unknown, string | Property<any, number>, ...number[]];
    return ObjectAnimator.of(target, PropertyValuesHolder.ofFloat(property, ...values));
  }

  static override ofInt(...values: number[]): ValueAnimator;
  static override ofInt(target: unknown, property: string | Property<any, number>, ...values: number[]): ObjectAnimator;
  static override ofInt(...args: any[]): any {
    if (typeof args[0] === 'number' || args.length === 0) return ValueAnimator.ofInt(...(args as number[]));
    const [target, property, ...values] = args as [unknown, string | Property<any, number>, ...number[]];
    return ObjectAnimator.of(target, PropertyValuesHolder.ofInt(property, ...values));
  }

  static override ofArgb(...values: number[]): ValueAnimator;
  static override ofArgb(target: unknown, property: string | Property<any, number>, ...values: number[]): ObjectAnimator;
  static override ofArgb(...args: any[]): any {
    if (typeof args[0] === 'number' || args.length === 0) return ValueAnimator.ofArgb(...(args as number[]));
    const [target, property, ...values] = args as [unknown, string | Property<any, number>, ...number[]];
    return ObjectAnimator.of(target, PropertyValuesHolder.ofArgb(property, ...values));
  }

  static ofObjectProperty<T>(target: unknown, property: string | Property<any, T>, evaluator: TypeEvaluator<T>, ...values: T[]): ObjectAnimator {
    return ObjectAnimator.of(target, PropertyValuesHolder.ofObject(property, evaluator, ...values));
  }

  static override ofPropertyValuesHolder(...values: PropertyValuesHolder[]): ValueAnimator;
  static override ofPropertyValuesHolder(target: unknown, ...values: PropertyValuesHolder[]): ObjectAnimator;
  static override ofPropertyValuesHolder(...args: any[]): any {
    if (args[0] instanceof PropertyValuesHolder) return ValueAnimator.ofPropertyValuesHolder(...(args as PropertyValuesHolder[]));
    const [target, ...values] = args as [unknown, ...PropertyValuesHolder[]];
    return ObjectAnimator.of(target, ...values);
  }

  private static of(target: unknown, ...values: PropertyValuesHolder[]): ObjectAnimator {
    const anim = new ObjectAnimator();
    anim.setTarget(target);
    anim.setValues(...values);
    if (values.length === 1) anim.propertyName = values[0]!.getPropertyName();
    return anim;
  }

  override setTarget(target: unknown): void {
    if (this.target === target) return;
    if (this.isStarted()) this.cancel();
    this.target = target;
    const kernel = (target as KernelOwner | null)?.context?.kernel;
    if (kernel) this.setKernel(kernel);
  }

  getTarget(): unknown {
    return this.target;
  }

  setPropertyName(name: string): void {
    this.propertyName = name;
    this.values[0]?.setPropertyName(name);
  }

  getPropertyName(): string {
    return this.property?.getName() ?? this.propertyName;
  }

  setProperty(property: Property<any, any>): void {
    this.property = property;
    this.values[0]?.setProperty(property);
  }

  override setFloatValues(...values: number[]): void {
    if (this.values.length === 0) {
      this.setValues(PropertyValuesHolder.ofFloat(this.property ?? this.propertyName, ...values));
      return;
    }
    super.setFloatValues(...values);
  }

  override setIntValues(...values: number[]): void {
    if (this.values.length === 0) {
      this.setValues(PropertyValuesHolder.ofInt(this.property ?? this.propertyName, ...values));
      return;
    }
    super.setIntValues(...values);
  }

  /** Cancel other running ObjectAnimators on the same target and properties when this one starts. */
  setAutoCancel(cancel: boolean): void {
    this.autoCancel = cancel;
  }

  private warn = (message: string) => {
    const kernel = this.kernel ?? AnimationHandler.getMainKernel();
    kernel?.warnOnce(`ObjectAnimator:${message}`, `PropertyValuesHolder: ${message}`);
  };

  override start(): void {
    if (this.autoCancel) {
      for (const other of Array.from(running)) {
        if (other !== this && other.target === this.target && other.sameProperties(this)) other.cancel();
      }
    }
    this.setupValues();
    running.add(this);
    super.start();
  }

  private sameProperties(other: ObjectAnimator): boolean {
    const mine = this.values.map((v) => v.getPropertyName()).sort().join();
    return mine === other.values.map((v) => v.getPropertyName()).sort().join();
  }

  private setupValues(): void {
    for (const v of this.values) {
      v.setupSetterAndGetter(this.target, this.warn);
      v.setupStartValues(this.target);
    }
  }

  override setupStartValues(): void {
    for (const v of this.values) {
      v.setupSetterAndGetter(this.target, this.warn);
      v.captureStart(this.target);
    }
  }

  override setupEndValues(): void {
    for (const v of this.values) {
      v.setupSetterAndGetter(this.target, this.warn);
      v.captureEnd(this.target);
    }
  }

  override end(): void {
    this.setupValues();
    super.end();
  }

  protected override animateValue(fraction: number): void {
    super.animateValue(fraction);
    if (this.target == null) {
      this.cancel();
      return;
    }
    for (const v of this.values) v.setAnimatedValue(this.target);
  }

  override cancel(): void {
    running.delete(this);
    super.cancel();
  }

  override doAnimationFrame(frameTime: number): boolean {
    const finished = super.doAnimationFrame(frameTime);
    if (finished) running.delete(this);
    return finished;
  }

  override toString(): string {
    return `ObjectAnimator@${String(this.target)}, ${this.values.map((v) => v.toString()).join(', ')}`;
  }
}

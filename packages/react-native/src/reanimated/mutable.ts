import { isAnimation, type AnimationObject } from './animations';
import { track, uiRuntime, type Driver, type Mapper, type Trackable } from './runtime';

/**
 * Shared values. Reads inside a mapper (useAnimatedStyle, useDerivedValue…)
 * subscribe that mapper; writes mark subscribers dirty for the next UI frame
 * and call listeners immediately. Assigning an animation object starts it on
 * the UI runtime; the value then follows `animation.current` every frame.
 */
export class Mutable<T = any> implements Trackable {
  readonly _isReanimatedSharedValue = true;
  _value: T;
  private readonly dependents = new Set<Mapper>();
  private readonly listeners = new Map<number, (value: T) => void>();
  private running: ValueAnimation<T> | null = null;

  constructor(value: T) {
    this._value = value;
  }

  get value(): T {
    track(this);
    return this._value;
  }

  set value(next: T) {
    this.set(next);
  }

  get(): T {
    return this.value;
  }

  /** Reanimated 4 setter: a value, an animation, or an updater of the previous value. */
  set(next: T | AnimationObject | ((previous: T) => T)): void {
    if (isAnimation(next)) {
      this.animate(next);
      return;
    }
    if (typeof next === 'function') next = (next as (previous: T) => T)(this._value);
    this.cancel();
    this.write(next as T);
  }

  /** Mutate in place (objects/arrays) and notify. */
  modify(modifier?: (value: T) => T, forceUpdate = true): void {
    const next = modifier ? modifier(this._value) : this._value;
    this.cancel();
    this.write(next, forceUpdate);
  }

  addListener(id: number, listener: (value: T) => void): void {
    this.listeners.set(id, listener);
  }

  removeListener(id: number): void {
    this.listeners.delete(id);
  }

  addDependent(mapper: Mapper): void {
    this.dependents.add(mapper);
  }

  removeDependent(mapper: Mapper): void {
    this.dependents.delete(mapper);
  }

  /** @internal set without touching the running animation */
  write(next: T, force = false): void {
    if (!force && Object.is(next, this._value)) return;
    this._value = next;
    if (this.dependents.size) {
      const runtime = uiRuntime();
      for (const mapper of this.dependents) runtime.markDirty(mapper);
    }
    for (const listener of Array.from(this.listeners.values())) listener(next);
  }

  /** @internal stop the running animation, reporting finished = false */
  cancel(): void {
    const running = this.running;
    if (!running) return;
    this.running = null;
    running.stop();
  }

  private animate(animation: AnimationObject): void {
    const previous = this.running;
    this.running = null;
    previous?.stop();
    const running = new ValueAnimation(this, animation, previous?.animation ?? null, () => {
      if (this.running === running) this.running = null;
    });
    this.running = running;
  }

  toJSON(): T {
    return this._value;
  }
}

/** Drives one animation object into a shared value. */
class ValueAnimation<T> implements Driver {
  private started = false;
  private readonly runtime = uiRuntime();

  constructor(
    private readonly target: Mutable<T>,
    readonly animation: AnimationObject,
    private readonly previous: AnimationObject | null,
    private readonly onEnd: () => void,
  ) {
    // Started inside a frame (from a mapper): start at this frame's time.
    if (this.runtime.insideFrame) this.start(this.runtime.now());
    this.runtime.addDriver(this);
  }

  private start(now: number): void {
    this.started = true;
    this.animation.onStart(this.target._value, now, this.previous);
  }

  step(now: number): boolean {
    if (!this.started) this.start(now);
    const done = this.animation.onFrame(now);
    this.target.write(this.animation.current as T);
    if (!done) return true;
    this.onEnd();
    this.animation.callback?.(true, this.animation.current);
    return false;
  }

  stop(): void {
    if (!this.runtime.hasDriver(this)) return;
    this.runtime.removeDriver(this);
    this.onEnd();
    this.animation.callback?.(false, this.animation.current);
  }
}

export type SharedValue<T = any> = Mutable<T>;

export function makeMutable<T>(value: T): Mutable<T> {
  return new Mutable(value);
}

export function isSharedValue<T = unknown>(value: unknown): value is Mutable<T> {
  return value instanceof Mutable;
}

export function cancelAnimation(value: unknown): void {
  if (value instanceof Mutable) value.cancel();
}

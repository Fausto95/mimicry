import type { FrameTask } from '@mimicry/os-core';
import { CAEnvironment, mediaNow } from '../quartz-core/ca-media-time';
import { springProgress, type SpringParameters } from '../quartz-core/spring';

/**
 * A control's own value animation (a segmented control's sliding pill, a
 * slider's thumb, a refresh control's inset): one number moving on the
 * kernel's frames, with a curve or a spring, calling back each frame.
 * Starting a new motion continues from the current value.
 */
export class ControlTween implements FrameTask {
  value: number;
  private from = 0;
  private to = 0;
  private start = 0;
  private duration = 0;
  private curve: ((t: number) => number) | null = null;
  private spring: SpringParameters | null = null;
  private running = false;
  private done: (() => void) | null = null;

  constructor(initial: number, private readonly update: (value: number) => void) {
    this.value = initial;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get target(): number {
    return this.running ? this.to : this.value;
  }

  /** Jump without animating. */
  set(value: number): void {
    this.running = false;
    this.value = value;
    this.update(value);
  }

  /** Animate to `to` over `duration` seconds along `curve`, or with `spring` (duration = its settling time). */
  animate(to: number, duration: number, options: { curve?: (t: number) => number; spring?: SpringParameters; done?: () => void } = {}): void {
    const kernel = CAEnvironment.kernel;
    if (!kernel || duration <= 0) {
      this.set(to);
      options.done?.();
      return;
    }
    this.from = this.value;
    this.to = to;
    this.start = mediaNow(kernel);
    this.duration = duration * 1000;
    this.curve = options.curve ?? null;
    this.spring = options.spring ?? null;
    this.done = options.done ?? null;
    this.running = true;
    kernel.animator.add(this);
    kernel.requestFrame();
  }

  tick(): boolean {
    if (!this.running) return false;
    const elapsed = mediaNow(CAEnvironment.kernel) - this.start;
    const t = Math.min(1, elapsed / this.duration);
    const p = this.spring ? (t >= 1 ? 1 : springProgress(this.spring, elapsed / 1000)) : (this.curve ?? ((x: number) => x))(t);
    this.value = this.from + (this.to - this.from) * p;
    if (t >= 1) {
      this.value = this.to;
      this.running = false;
    }
    this.update(this.value);
    if (!this.running) {
      const done = this.done;
      this.done = null;
      done?.();
    }
    return this.running;
  }
}

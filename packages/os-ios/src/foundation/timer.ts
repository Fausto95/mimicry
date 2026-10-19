import type { Kernel } from '@mimicry/os-core';
import { CAEnvironment, mainQueueAsync } from '../quartz-core/ca-media-time';
import { RunLoop, RunLoopMode, type RunLoopSource } from './run-loop';

/**
 * Timer (NSTimer) and DispatchQueue on the kernel's clock — virtual under
 * test, so a 1 s repeating timer fires exactly once per virtual second.
 * Times are seconds, like TimeInterval. The main queue is the only queue:
 * global and private queues run their work on it, later.
 */
export class Timer implements RunLoopSource {
  readonly timeInterval: number;
  readonly repeats: boolean;
  tolerance = 0;
  userInfo: unknown = null;
  private handle: unknown = null;
  private valid = true;
  private _fireDate: number;
  private readonly kernel: Kernel | null;

  /** Timer(timeInterval:repeats:block:) — add it to a run loop to start it. */
  constructor(timeInterval: number, repeats: boolean, private readonly block: (timer: Timer) => void) {
    this.timeInterval = Math.max(0.0001, timeInterval);
    this.repeats = repeats;
    this.kernel = CAEnvironment.kernel;
    this._fireDate = this.now() + this.timeInterval;
  }

  /** scheduledTimer(withTimeInterval:repeats:block:) — already on the main run loop. */
  static scheduledTimer(timeInterval: number, repeats: boolean, block: (timer: Timer) => void): Timer {
    const timer = new Timer(timeInterval, repeats, block);
    RunLoop.main.add(timer, RunLoopMode.default);
    return timer;
  }

  private now(): number {
    return (this.kernel?.clock.now() ?? 0) / 1000;
  }

  get isValid(): boolean {
    return this.valid;
  }

  /** seconds on the kernel clock */
  get fireDate(): number {
    return this._fireDate;
  }

  _schedule(): void {
    const clock = this.kernel?.clock;
    if (!clock || !this.valid || this.handle !== null) return;
    this._fireDate = this.now() + this.timeInterval;
    const ms = this.timeInterval * 1000;
    if (this.repeats) {
      this.handle = clock.setInterval(() => this.fireScheduled(), ms);
    } else {
      this.handle = clock.setTimeout(() => {
        this.handle = null;
        this.fireScheduled();
        this.invalidate();
      }, ms);
    }
  }

  _unschedule(): void {
    if (this.handle === null) return;
    const clock = this.kernel?.clock;
    if (this.repeats) clock?.clearInterval(this.handle);
    else clock?.clearTimeout(this.handle);
    this.handle = null;
  }

  private fireScheduled(): void {
    if (!this.valid) return;
    this._fireDate = this.now() + this.timeInterval;
    this.block(this);
    // Work the block did should show on the next frame.
    this.kernel?.requestFrame();
  }

  /** fire(): run the block now; a non-repeating timer is then invalidated. */
  fire(): void {
    if (!this.valid) return;
    this.block(this);
    if (!this.repeats) this.invalidate();
  }

  invalidate(): void {
    if (!this.valid) return;
    this.valid = false;
    RunLoop.main._remove(this);
    this._unschedule();
  }
}

/** DispatchTime: seconds on the kernel clock (`.now() + 0.5`). */
export const DispatchTime = {
  now(): number {
    return (CAEnvironment.kernel?.clock.now() ?? 0) / 1000;
  },
};

export enum DispatchQoS { background = 0, utility = 1, default = 2, userInitiated = 3, userInteractive = 4 }

export class DispatchQueue {
  private static readonly mainQueue = new DispatchQueue('com.apple.main-thread');

  constructor(readonly label: string) {}

  static get main(): DispatchQueue {
    return DispatchQueue.mainQueue;
  }

  /** DispatchQueue.global(qos:) — runs on the main queue here. */
  static global(_qos: DispatchQoS = DispatchQoS.default): DispatchQueue {
    return new DispatchQueue('com.apple.root.default-qos');
  }

  /** async(execute:) — after the current task. */
  async(work: () => void): void {
    mainQueueAsync(work);
  }

  /** asyncAfter(deadline:execute:) — `deadline` from DispatchTime.now() (seconds). */
  asyncAfter(deadline: number, work: () => void): void {
    const kernel = CAEnvironment.kernel;
    if (!kernel) {
      setTimeout(work, Math.max(0, deadline * 1000));
      return;
    }
    const delay = Math.max(0, deadline * 1000 - kernel.clock.now());
    kernel.clock.setTimeout(() => {
      work();
      kernel.requestFrame();
    }, delay);
  }

  /** sync(execute:) — inline (there is one thread). */
  sync<T>(work: () => T): T {
    return work();
  }
}

